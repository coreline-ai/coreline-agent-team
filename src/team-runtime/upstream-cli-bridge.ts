import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type {
  RuntimeTurnBridge,
  RuntimeTurnInput,
  RuntimeTurnResult,
} from './types.js'

export const DEFAULT_UPSTREAM_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
export const DEFAULT_UPSTREAM_MAX_OUTPUT_BYTES = 50 * 1024 * 1024 // 50 MB

export type UpstreamCliBridgeOptions = {
  executablePath?: string
  extraArgs?: string[]
  defaultModel?: string
  fallbackBridge?: RuntimeTurnBridge
  timeoutMs?: number
  terminationGraceMs?: number
  maxOutputBytes?: number
}

function buildOutputSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary: { type: 'string' },
      assistantResponse: { type: 'string' },
      assistantSummary: { type: 'string' },
      sendTo: { type: 'string' },
      taskStatus: {
        type: 'string',
        enum: ['pending', 'in_progress', 'completed'],
      },
      completedTaskId: { type: 'string' },
      completedStatus: {
        type: 'string',
        enum: ['resolved', 'blocked', 'failed'],
      },
      failureReason: { type: 'string' },
      stop: { type: 'boolean' },
      shutdown: {
        type: 'object',
        additionalProperties: false,
        properties: {
          approved: { type: 'boolean' },
          reason: { type: 'string' },
        },
        required: ['approved'],
      },
    },
  }
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function normalizeRuntimeTurnResult(value: unknown): RuntimeTurnResult | null {
  const record = asRecord(value)
  if (record === null) {
    return null
  }

  const shutdownRecord = asRecord(record.shutdown)
  const taskStatus =
    record.taskStatus === 'pending' ||
    record.taskStatus === 'in_progress' ||
    record.taskStatus === 'completed'
      ? record.taskStatus
      : undefined
  const completedStatus =
    record.completedStatus === 'resolved' ||
    record.completedStatus === 'blocked' ||
    record.completedStatus === 'failed'
      ? record.completedStatus
      : undefined
  const shutdown =
    shutdownRecord === null
      ? undefined
      : {
          approved:
            typeof shutdownRecord.approved === 'boolean'
              ? shutdownRecord.approved
              : false,
          reason:
            typeof shutdownRecord.reason === 'string'
              ? shutdownRecord.reason
              : undefined,
        }

  if (
    typeof record.summary !== 'string' &&
    typeof record.assistantResponse !== 'string' &&
    typeof record.assistantSummary !== 'string' &&
    typeof record.failureReason !== 'string' &&
    shutdownRecord === null &&
    taskStatus === undefined
  ) {
    return null
  }

  return {
    summary: typeof record.summary === 'string' ? record.summary : undefined,
    assistantResponse:
      typeof record.assistantResponse === 'string'
        ? record.assistantResponse
        : undefined,
    assistantSummary:
      typeof record.assistantSummary === 'string'
        ? record.assistantSummary
        : undefined,
    sendTo: typeof record.sendTo === 'string' ? record.sendTo : undefined,
    taskStatus,
    completedTaskId:
      typeof record.completedTaskId === 'string'
        ? record.completedTaskId
        : undefined,
    completedStatus,
    failureReason:
      typeof record.failureReason === 'string'
        ? record.failureReason
        : undefined,
    stop: typeof record.stop === 'boolean' ? record.stop : undefined,
    shutdown,
  }
}

function coerceUpstreamResult(stdout: string): RuntimeTurnResult {
  const trimmed = stdout.trim()
  const direct = tryParseJson(trimmed)
  const directTurnResult = normalizeRuntimeTurnResult(direct)
  if (directTurnResult !== null) {
    return directTurnResult
  }

  const directRecord = asRecord(direct)
  if (directRecord !== null) {
    const structuredOutput = normalizeRuntimeTurnResult(
      directRecord.structured_output,
    )
    if (structuredOutput !== null) {
      return structuredOutput
    }
  }

  if (
    directRecord !== null &&
    typeof directRecord.result === 'string'
  ) {
    const result = directRecord.result
    return {
      summary: result.slice(0, 120),
      assistantResponse: result,
      assistantSummary: result.slice(0, 120),
    }
  }

  const lines = trimmed
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const parsed = tryParseJson(lines[index]!)
    const lineTurnResult = normalizeRuntimeTurnResult(parsed)
    if (lineTurnResult !== null) {
      return lineTurnResult
    }

    const lineRecord = asRecord(parsed)
    if (lineRecord !== null) {
      const structuredOutput = normalizeRuntimeTurnResult(
        lineRecord.structured_output,
      )
      if (structuredOutput !== null) {
        return structuredOutput
      }
    }
  }

  return {
    summary: trimmed.slice(0, 120) || 'Upstream CLI completed turn',
    assistantResponse: trimmed,
    assistantSummary: trimmed.slice(0, 120),
  }
}

function resolveDefaultUpstreamExecutable(): string {
  const explicit = process.env.AGENT_TEAM_UPSTREAM_EXECUTABLE
  if (explicit && existsSync(explicit)) {
    return explicit
  }

  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve(moduleDir, '../../../../package/cli.js'),
    resolve(moduleDir, '../../../package/cli.js'),
    resolve(process.cwd(), '../package/cli.js'),
    resolve(process.cwd(), 'package/cli.js'),
  ]

  const existingCandidate = candidates.find(candidate => existsSync(candidate))
  return existingCandidate ?? 'claude'
}

function resolveSpawnCommand(
  executablePath: string,
): { command: string; argsPrefix: string[] } {
  if (/\.(c|m)?js$/.test(executablePath)) {
    return {
      command: process.execPath,
      argsPrefix: [executablePath],
    }
  }

  return {
    command: executablePath,
    argsPrefix: [],
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
}

export function buildUpstreamCliArgs(
  input: RuntimeTurnInput,
  options: UpstreamCliBridgeOptions = {},
): string[] {
  const args = [
    '-p',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(buildOutputSchema()),
    '--tools',
    '',
    '--permission-mode',
    'dontAsk',
    '--add-dir',
    input.context.config.cwd,
    '--append-system-prompt',
    'You are the execution backend for a headless agent-team runtime. Return JSON that matches the provided schema only.',
  ]

  const model = input.context.config.model ?? options.defaultModel
  if (model) {
    args.push('--model', model)
  }

  if (input.context.config.sessionId && isUuid(input.context.config.sessionId)) {
    args.push('--session-id', input.context.config.sessionId)
  }

  if (input.context.config.upstreamArgs) {
    args.push(...input.context.config.upstreamArgs)
  }

  if (options.extraArgs) {
    args.push(...options.extraArgs)
  }

  args.push(input.prompt)
  return args
}

export async function executeUpstreamCliTurn(
  input: RuntimeTurnInput,
  options: UpstreamCliBridgeOptions = {},
): Promise<{
  exitCode: number
  stdout: string
  stderr: string
}> {
  const executablePath =
    options.executablePath ??
    input.context.config.upstreamExecutablePath ??
    resolveDefaultUpstreamExecutable()
  const timeoutMs = options.timeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS
  const terminationGraceMs = options.terminationGraceMs ?? 5_000
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_UPSTREAM_MAX_OUTPUT_BYTES
  const abortSignal =
    input.abortSignal ?? input.context.runtimeContext.abortController.signal
  const { command, argsPrefix } = resolveSpawnCommand(executablePath)
  const args = [...argsPrefix, ...buildUpstreamCliArgs(input, options)]

  const child = spawn(command, args, {
    cwd: input.context.config.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  })

  let stdout = ''
  let stderr = ''
  let stdoutBytes = 0
  let stderrBytes = 0

  child.stdout.on('data', (chunk: Buffer) => {
    const len = Buffer.byteLength(chunk)
    if (stdoutBytes + len <= maxOutputBytes) {
      stdout += String(chunk)
    }
    stdoutBytes += len
  })
  child.stderr.on('data', (chunk: Buffer) => {
    const len = Buffer.byteLength(chunk)
    if (stderrBytes + len <= maxOutputBytes) {
      stderr += String(chunk)
    }
    stderrBytes += len
  })

  const exitCode = await new Promise<number>((resolveClose, reject) => {
    let timedOut = false
    let interrupted = false
    let closed = false
    let hardKillTimer: NodeJS.Timeout | undefined

    const cleanup = () => {
      clearTimeout(timer)
      if (hardKillTimer) {
        clearTimeout(hardKillTimer)
      }
      if (abortSignal && abortListener) {
        abortSignal.removeEventListener('abort', abortListener)
      }
    }

    const requestTermination = (reason: 'timeout' | 'abort') => {
      if (closed) {
        return
      }
      timedOut = timedOut || reason === 'timeout'
      interrupted = interrupted || reason === 'abort'
      try {
        child.kill('SIGTERM')
      } catch {
        // best effort
      }
      if (hardKillTimer) {
        clearTimeout(hardKillTimer)
      }
      hardKillTimer = setTimeout(() => {
        if (closed) {
          return
        }
        try {
          child.kill('SIGKILL')
        } catch {
          // best effort
        }
      }, terminationGraceMs)
    }

    const timer = setTimeout(() => {
      requestTermination('timeout')
    }, timeoutMs)

    const abortListener = () => {
      requestTermination('abort')
    }

    child.on('error', error => {
      cleanup()
      reject(error)
    })
    child.on('close', code => {
      closed = true
      cleanup()
      if (timedOut) {
        resolveClose(124)
        return
      }
      if (interrupted) {
        resolveClose(130)
        return
      }
      resolveClose(code ?? 1)
    })

    if (abortSignal) {
      if (abortSignal.aborted) {
        abortListener()
      } else {
        abortSignal.addEventListener('abort', abortListener, { once: true })
      }
    }
  })

  return {
    exitCode,
    stdout,
    stderr,
  }
}

export function createUpstreamCliRuntimeTurnBridge(
  options: UpstreamCliBridgeOptions = {},
): RuntimeTurnBridge {
  return {
    async executeTurn(input: RuntimeTurnInput): Promise<RuntimeTurnResult | void> {
      try {
        const result = await executeUpstreamCliTurn(input, options)
        if (result.exitCode !== 0 || result.stdout.trim().length === 0) {
          if (options.fallbackBridge) {
            return options.fallbackBridge.executeTurn(input)
          }

          const failureReason =
            result.stderr.trim() ||
            result.stdout.trim() ||
            (result.exitCode === 124
              ? `Upstream CLI timed out after ${options.timeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS}ms`
              : result.exitCode === 130
                ? 'Upstream CLI interrupted before the turn completed'
                : `Upstream CLI exited with code ${result.exitCode}`)

          const summary =
            result.exitCode === 124
              ? `Upstream CLI timed out for ${input.context.config.name}`
              : result.exitCode === 130
                ? `Upstream CLI interrupted for ${input.context.config.name}`
                : `Upstream CLI failed for ${input.context.config.name}`

          return {
            summary,
            failureReason,
            idleReason: 'failed',
            taskStatus: input.workItem.kind === 'task' ? 'pending' : undefined,
          }
        }

        return coerceUpstreamResult(result.stdout)
      } catch (error) {
        if (options.fallbackBridge) {
          return options.fallbackBridge.executeTurn(input)
        }

        return {
          summary: `Upstream CLI bridge crashed for ${input.context.config.name}`,
          failureReason: error instanceof Error ? error.message : String(error),
          idleReason: 'failed',
          taskStatus: input.workItem.kind === 'task' ? 'pending' : undefined,
        }
      }
    },
  }
}

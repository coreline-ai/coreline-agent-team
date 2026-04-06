import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import type {
  RuntimeTurnBridge,
  RuntimeTurnInput,
  RuntimeTurnResult,
} from './types.js'

export const DEFAULT_CODEX_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
export const DEFAULT_MAX_OUTPUT_BYTES = 50 * 1024 * 1024 // 50 MB

export type CodexCliBridgeOptions = {
  executablePath?: string
  extraArgs?: string[]
  fallbackBridge?: RuntimeTurnBridge
  defaultModel?: string
  timeoutMs?: number
  terminationGraceMs?: number
  maxOutputBytes?: number
}

export type CodexCliExecutionResult = {
  exitCode: number
  stdout: string
  stderr: string
  lastMessage: string
}

export function buildCodexOutputSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary: { type: ['string', 'null'] },
      assistantResponse: { type: ['string', 'null'] },
      assistantSummary: { type: ['string', 'null'] },
      sendTo: { type: ['string', 'null'] },
      taskStatus: {
        type: ['string', 'null'],
        enum: ['pending', 'in_progress', 'completed', null],
      },
      completedTaskId: { type: ['string', 'null'] },
      completedStatus: {
        type: ['string', 'null'],
        enum: ['resolved', 'blocked', 'failed', null],
      },
      failureReason: { type: ['string', 'null'] },
      stop: { type: ['boolean', 'null'] },
      shutdown: {
        type: ['object', 'null'],
        additionalProperties: false,
        properties: {
          approved: { type: ['boolean', 'null'] },
          reason: { type: ['string', 'null'] },
        },
        required: ['approved', 'reason'],
      },
    },
    required: [
      'summary',
      'assistantResponse',
      'assistantSummary',
      'sendTo',
      'taskStatus',
      'completedTaskId',
      'completedStatus',
      'failureReason',
      'stop',
      'shutdown',
    ],
  }
}

function coerceTurnResult(
  workPrompt: string,
  lastMessage: string,
): RuntimeTurnResult {
  try {
    return JSON.parse(lastMessage) as RuntimeTurnResult
  } catch {
    return {
      summary: `Codex CLI completed turn for: ${workPrompt.split('\n')[0] ?? 'work item'}`,
      assistantResponse: lastMessage.trim(),
      assistantSummary: lastMessage.trim().slice(0, 120),
    }
  }
}

export function buildCodexCliArgs(
  input: RuntimeTurnInput,
  outputPath: string,
  schemaPath: string,
  options: CodexCliBridgeOptions = {},
): string[] {
  const args = [
    'exec',
    '-',
    '--color',
    'never',
    '--skip-git-repo-check',
    '--ephemeral',
    '-C',
    input.context.config.cwd,
    '-o',
    outputPath,
    '--output-schema',
    schemaPath,
  ]

  const model =
    input.context.config.model ??
    options.defaultModel
  if (model) {
    args.push('-m', model)
  }

  if (input.context.config.codexArgs) {
    args.push(...input.context.config.codexArgs)
  }

  if (options.extraArgs) {
    args.push(...options.extraArgs)
  }

  return args
}

export async function executeCodexCliTurn(
  input: RuntimeTurnInput,
  options: CodexCliBridgeOptions = {},
): Promise<CodexCliExecutionResult> {
  const executablePath = options.executablePath ?? input.context.config.codexExecutablePath ?? 'codex'
  const timeoutMs = options.timeoutMs ?? DEFAULT_CODEX_TIMEOUT_MS
  const terminationGraceMs = options.terminationGraceMs ?? 5_000
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
  const abortSignal =
    input.abortSignal ?? input.context.runtimeContext.abortController.signal
  const tempDir = await mkdtemp(join(tmpdir(), 'agent-team-codex-'))
  const outputPath = join(tempDir, 'last-message.txt')
  const schemaPath = join(tempDir, 'runtime-turn-schema.json')

  try {
    await writeFile(
      schemaPath,
      `${JSON.stringify(buildCodexOutputSchema(), null, 2)}\n`,
      'utf8',
    )

    const args = buildCodexCliArgs(input, outputPath, schemaPath, options)

    const child = spawn(executablePath, args, {
      cwd: input.context.config.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
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
    child.stdin.write(input.prompt)
    child.stdin.end()

    const exitCode = await new Promise<number>((resolve, reject) => {
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
          resolve(124)
          return
        }
        if (interrupted) {
          resolve(130)
          return
        }
        resolve(code ?? 1)
      })

      if (abortSignal) {
        if (abortSignal.aborted) {
          abortListener()
        } else {
          abortSignal.addEventListener('abort', abortListener, { once: true })
        }
      }
    })

    let lastMessage = ''
    try {
      lastMessage = await readFile(outputPath, 'utf8')
    } catch {
      lastMessage = stdout.trim()
    }

    return {
      exitCode,
      stdout,
      stderr,
      lastMessage: lastMessage.trim(),
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export function createCodexCliRuntimeTurnBridge(
  options: CodexCliBridgeOptions = {},
): RuntimeTurnBridge {
  return {
    async executeTurn(input: RuntimeTurnInput): Promise<RuntimeTurnResult | void> {
      try {
        const result = await executeCodexCliTurn(input, options)
        if (result.exitCode !== 0 || result.lastMessage.length === 0) {
          if (options.fallbackBridge) {
            return options.fallbackBridge.executeTurn(input)
          }

          const failureReason =
            result.stderr.trim() ||
            result.stdout.trim() ||
            (result.exitCode === 124
              ? `Codex CLI timed out after ${options.timeoutMs ?? DEFAULT_CODEX_TIMEOUT_MS}ms`
              : result.exitCode === 130
                ? 'Codex CLI interrupted before the turn completed'
                : `Codex CLI exited with code ${result.exitCode}`)

          const summary =
            result.exitCode === 124
              ? `Codex CLI timed out for ${input.context.config.name}`
              : result.exitCode === 130
                ? `Codex CLI interrupted for ${input.context.config.name}`
                : `Codex CLI failed for ${input.context.config.name}`

          return {
            summary,
            failureReason,
            idleReason: 'failed',
            taskStatus: input.workItem.kind === 'task' ? 'pending' : undefined,
          }
        }

        return coerceTurnResult(input.prompt, result.lastMessage)
      } catch (error) {
        if (options.fallbackBridge) {
          return options.fallbackBridge.executeTurn(input)
        }

        return {
          summary: `Codex CLI bridge crashed for ${input.context.config.name}`,
          failureReason: error instanceof Error ? error.message : String(error),
          idleReason: 'failed',
          taskStatus: input.workItem.kind === 'task' ? 'pending' : undefined,
        }
      }
    },
  }
}

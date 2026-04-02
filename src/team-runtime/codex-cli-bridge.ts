import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import type {
  RuntimeTurnBridge,
  RuntimeTurnInput,
  RuntimeTurnResult,
} from './types.js'

export type CodexCliBridgeOptions = {
  executablePath?: string
  extraArgs?: string[]
  fallbackBridge?: RuntimeTurnBridge
  defaultModel?: string
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
  const tempDir = await mkdtemp(join(tmpdir(), 'agent-team-codex-'))
  const outputPath = join(tempDir, 'last-message.txt')
  const schemaPath = join(tempDir, 'runtime-turn-schema.json')

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
  child.stdout.on('data', chunk => {
    stdout += String(chunk)
  })
  child.stderr.on('data', chunk => {
    stderr += String(chunk)
  })
  child.stdin.write(input.prompt)
  child.stdin.end()

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', code => {
      resolve(code ?? 1)
    })
  })

  let lastMessage = ''
  try {
    lastMessage = await readFile(outputPath, 'utf8')
  } catch {
    lastMessage = stdout.trim()
  }

  await rm(tempDir, { recursive: true, force: true })

  return {
    exitCode,
    stdout,
    stderr,
    lastMessage: lastMessage.trim(),
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

          return {
            summary: `Codex CLI failed for ${input.context.config.name}`,
            failureReason:
              result.stderr.trim() ||
              result.stdout.trim() ||
              `Codex CLI exited with code ${result.exitCode}`,
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

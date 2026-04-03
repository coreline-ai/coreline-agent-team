import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TeamCoreOptions } from '../team-core/index.js'
import type {
  ResumeTeammateOperatorInput,
  SpawnTeammateOperatorInput,
} from './types.js'

export type BackgroundProcessLike = {
  pid?: number
  once(event: 'spawn', listener: () => void): BackgroundProcessLike
  once(
    event: 'error',
    listener: (error: Error) => void,
  ): BackgroundProcessLike
  unref(): void
}

export type BackgroundSpawnFunction = (
  command: string,
  args: string[],
  options: {
    detached: boolean
    stdio: 'ignore'
    env: NodeJS.ProcessEnv
  },
) => BackgroundProcessLike

export type BackgroundCommandLaunchOptions = {
  cliBinPath?: string
  nodeExecutablePath?: string
  spawnImpl?: BackgroundSpawnFunction
}

export type BackgroundLaunchResult = {
  success: boolean
  pid?: number
  error?: string
  command: string
  args: string[]
}

export const DEFAULT_BACKGROUND_MAX_ITERATIONS = 50
export const DEFAULT_BACKGROUND_POLL_INTERVAL_MS = 500

function appendRootDirArg(
  args: string[],
  options: TeamCoreOptions,
): void {
  if (options.rootDir) {
    args.push('--root-dir', options.rootDir)
  }
}

export function resolveBackgroundLoopOptions(input: {
  maxIterations?: number
  pollIntervalMs?: number
}): {
  maxIterations: number
  pollIntervalMs: number
} {
  return {
    maxIterations: input.maxIterations ?? DEFAULT_BACKGROUND_MAX_ITERATIONS,
    pollIntervalMs: input.pollIntervalMs ?? DEFAULT_BACKGROUND_POLL_INTERVAL_MS,
  }
}

export function resolveAgentTeamCliBinPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url))
  return resolve(currentDir, '../team-cli/bin.js')
}

export function buildBackgroundSpawnCliArgs(
  input: SpawnTeammateOperatorInput,
  options: TeamCoreOptions = {},
): string[] {
  const loopOptions = resolveBackgroundLoopOptions(input)
  const args: string[] = []
  appendRootDirArg(args, options)
  args.push('spawn', input.teamName, input.agentName, '--prompt', input.prompt)

  args.push('--cwd', input.cwd ?? process.cwd())
  args.push('--max-iterations', String(loopOptions.maxIterations))
  args.push('--poll-interval', String(loopOptions.pollIntervalMs))

  if (input.runtimeKind) {
    args.push('--runtime', input.runtimeKind)
  }
  if (input.model) {
    args.push('--model', input.model)
  }
  if (input.planModeRequired) {
    args.push('--plan-mode')
  }
  if (input.codexExecutablePath) {
    args.push('--codex-executable', input.codexExecutablePath)
  }
  if (input.upstreamExecutablePath) {
    args.push('--upstream-executable', input.upstreamExecutablePath)
  }

  return args
}

export function buildBackgroundResumeCliArgs(
  command: 'resume' | 'reopen',
  input: ResumeTeammateOperatorInput,
  options: TeamCoreOptions = {},
): string[] {
  const loopOptions = resolveBackgroundLoopOptions(input)
  const args: string[] = []
  appendRootDirArg(args, options)
  args.push(command, input.teamName, input.agentName)
  args.push('--max-iterations', String(loopOptions.maxIterations))
  args.push('--poll-interval', String(loopOptions.pollIntervalMs))
  return args
}

export async function launchBackgroundAgentTeamCommand(
  cliArgs: string[],
  input: BackgroundCommandLaunchOptions = {},
): Promise<BackgroundLaunchResult> {
  const command = input.nodeExecutablePath ?? process.execPath
  const args = [input.cliBinPath ?? resolveAgentTeamCliBinPath(), ...cliArgs]
  const spawnImpl = input.spawnImpl ?? spawn

  return new Promise(resolvePromise => {
    let settled = false

    const child = spawnImpl(command, args, {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    })

    child.once('error', error => {
      if (settled) {
        return
      }
      settled = true
      resolvePromise({
        success: false,
        error: error.message,
        command,
        args,
      })
    })

    child.once('spawn', () => {
      child.unref()
      if (settled) {
        return
      }
      settled = true
      resolvePromise({
        success: true,
        pid: child.pid,
        command,
        args,
      })
    })
  })
}

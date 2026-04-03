import { spawn } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  appendTextFile,
  getDefaultRootDir,
  getWorkerStderrLogPath,
  getWorkerStdoutLogPath,
  type TeamCoreOptions,
} from '../team-core/index.js'
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

export type BackgroundSpawnStdio = 'ignore' | ['ignore', number, number]

export type BackgroundSpawnFunction = (
  command: string,
  args: string[],
  options: {
    detached: boolean
    stdio: BackgroundSpawnStdio
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
  stdoutLogPath?: string
  stderrLogPath?: string
}

export const DEFAULT_BACKGROUND_MAX_ITERATIONS = 50
export const DEFAULT_BACKGROUND_POLL_INTERVAL_MS = 500
export const AGENT_TEAM_LAUNCH_MODE_ENV = 'AGENT_TEAM_LAUNCH_MODE'

type BackgroundCommandContext = {
  rootDir: string
  teamName: string
  agentName: string
}

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

function parseBackgroundCommandContext(
  cliArgs: string[],
): BackgroundCommandContext | undefined {
  const args = [...cliArgs]
  let rootDir = getDefaultRootDir()

  while (args[0]?.startsWith('--')) {
    const flag = args.shift()
    if (flag === '--root-dir' && args[0]) {
      rootDir = args.shift() as string
      continue
    }
    break
  }

  const [command, teamName, agentName] = args
  if (
    (command === 'spawn' || command === 'resume' || command === 'reopen') &&
    teamName &&
    agentName
  ) {
    return {
      rootDir,
      teamName,
      agentName,
    }
  }

  return undefined
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
  const commandContext = parseBackgroundCommandContext(cliArgs)
  const stdoutLogPath = commandContext
    ? getWorkerStdoutLogPath(commandContext.teamName, commandContext.agentName, {
        rootDir: commandContext.rootDir,
      })
    : undefined
  const stderrLogPath = commandContext
    ? getWorkerStderrLogPath(commandContext.teamName, commandContext.agentName, {
        rootDir: commandContext.rootDir,
      })
    : undefined

  if (stdoutLogPath) {
    await appendTextFile(
      stdoutLogPath,
      `\n# launch ${new Date().toISOString()} ${args.join(' ')}\n`,
    )
  }
  if (stderrLogPath) {
    await appendTextFile(
      stderrLogPath,
      `\n# launch ${new Date().toISOString()} ${args.join(' ')}\n`,
    )
  }

  const stdoutFd = stdoutLogPath ? openSync(stdoutLogPath, 'a') : undefined
  const stderrFd = stderrLogPath ? openSync(stderrLogPath, 'a') : undefined

  return new Promise(resolvePromise => {
    let settled = false
    let closed = false

    const closeFds = () => {
      if (closed) {
        return
      }
      closed = true
      if (stdoutFd !== undefined) {
        closeSync(stdoutFd)
      }
      if (stderrFd !== undefined) {
        closeSync(stderrFd)
      }
    }

    let child: BackgroundProcessLike
    try {
      child = spawnImpl(command, args, {
        detached: true,
        stdio:
          stdoutFd !== undefined && stderrFd !== undefined
            ? ['ignore', stdoutFd, stderrFd]
            : 'ignore',
        env: {
          ...process.env,
          [AGENT_TEAM_LAUNCH_MODE_ENV]: 'detached',
        },
      })
    } catch (error) {
      closeFds()
      resolvePromise({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        command,
        args,
        stdoutLogPath,
        stderrLogPath,
      })
      return
    }

    child.once('error', error => {
      closeFds()
      if (settled) {
        return
      }
      settled = true
      resolvePromise({
        success: false,
        error: error.message,
        command,
        args,
        stdoutLogPath,
        stderrLogPath,
      })
    })

    child.once('spawn', () => {
      closeFds()
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
        stdoutLogPath,
        stderrLogPath,
      })
    })
  })
}

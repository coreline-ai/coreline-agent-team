import {
  getTaskListDir,
  getTaskListIdForTeam,
  getTeamFilePath,
  type TeamCoreOptions,
} from '../../team-core/index.js'
import {
  createAdapterForRuntimeKind,
  spawnInProcessTeammate,
  renderTeamContextPrompt,
} from '../../team-runtime/index.js'
import type { CliCommandResult } from '../types.js'

export type SpawnCommandInput = {
  prompt: string
  cwd?: string
  color?: string
  model?: string
  runtimeKind?: 'local' | 'codex-cli' | 'upstream'
  planModeRequired?: boolean
  maxIterations?: number
  pollIntervalMs?: number
  codexExecutablePath?: string
  upstreamExecutablePath?: string
}

function buildSpawnPrompt(
  teamName: string,
  agentName: string,
  prompt: string,
  options: TeamCoreOptions,
): string {
  const teamContextPrompt = renderTeamContextPrompt({
    agentName,
    teamName,
    teamConfigPath: getTeamFilePath(teamName, options),
    taskListPath: getTaskListDir(getTaskListIdForTeam(teamName), options),
  })

  return `${teamContextPrompt}\n\n${prompt}`.trim()
}

export async function runSpawnCommand(
  teamName: string,
  agentName: string,
  input: SpawnCommandInput,
  options: TeamCoreOptions = {},
): Promise<CliCommandResult> {
  const runtimeKind = input.runtimeKind ?? 'local'
  const adapter = createAdapterForRuntimeKind({
    name: agentName,
    teamName,
    prompt: buildSpawnPrompt(teamName, agentName, input.prompt, options),
    cwd: input.cwd ?? process.cwd(),
    color: input.color,
    model: input.model,
    runtimeKind,
    planModeRequired: input.planModeRequired,
    runtimeOptions: {
      maxIterations: input.maxIterations ?? 1,
      pollIntervalMs: input.pollIntervalMs,
    },
    codexExecutablePath: input.codexExecutablePath,
    upstreamExecutablePath: input.upstreamExecutablePath,
  })
  const runtimeConfig = {
    name: agentName,
    teamName,
    prompt: buildSpawnPrompt(teamName, agentName, input.prompt, options),
    cwd: input.cwd ?? process.cwd(),
    color: input.color,
    model: input.model,
    runtimeKind,
    planModeRequired: input.planModeRequired,
    runtimeOptions: {
      maxIterations: input.maxIterations ?? 1,
      pollIntervalMs: input.pollIntervalMs,
    },
    codexExecutablePath: input.codexExecutablePath,
    upstreamExecutablePath: input.upstreamExecutablePath,
  }

  const spawnResult = await spawnInProcessTeammate(
    runtimeConfig,
    options,
    adapter,
  )

  if (!spawnResult.success) {
    return {
      success: false,
      message:
        spawnResult.error ??
        `Failed to spawn ${agentName} in team "${teamName}"`,
    }
  }

  const loopResult = await spawnResult.handle?.join?.()
  if (!loopResult) {
    await spawnResult.handle?.stop()
  }

  const loopSummary =
    loopResult === undefined
      ? 'processed=0 iterations=0 reason=completed'
      : `processed=${loopResult.processedWorkItems} ` +
        `iterations=${loopResult.iterations} ` +
        `reason=${loopResult.stopReason}`

  return {
    success: true,
    message:
      `Spawned ${agentName} in team "${teamName}" ` +
      `with ${loopSummary}`,
  }
}

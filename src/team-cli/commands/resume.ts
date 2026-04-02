import { getTeamMember, type TeamCoreOptions } from '../../team-core/index.js'
import { createAdapterForRuntimeKind, spawnInProcessTeammate } from '../../team-runtime/index.js'
import type { CliCommandResult } from '../types.js'

export type ResumeCommandInput = {
  maxIterations?: number
  pollIntervalMs?: number
}

export async function runResumeCommand(
  teamName: string,
  agentName: string,
  input: ResumeCommandInput = {},
  options: TeamCoreOptions = {},
): Promise<CliCommandResult> {
  const member = await getTeamMember(teamName, { name: agentName }, options)
  if (!member) {
    return {
      success: false,
      message: `Teammate "${agentName}" not found in team "${teamName}"`,
    }
  }

  if (member.isActive === true) {
    return {
      success: false,
      message: `${agentName} is already active`,
    }
  }

  if (!member.runtimeState?.prompt || !member.runtimeState.cwd) {
    return {
      success: false,
      message: `${agentName} does not have resumable runtime metadata`,
    }
  }

  const runtimeConfig = {
    name: member.name,
    teamName,
    prompt: member.runtimeState.prompt,
    cwd: member.runtimeState.cwd,
    color: member.color,
    model: member.runtimeState.model ?? member.model,
    sessionId:
      member.runtimeState.sessionId ?? member.runtimeState.lastSessionId,
    runtimeKind: member.runtimeState.runtimeKind ?? 'local',
    reopenSession: true,
    planModeRequired: member.runtimeState.planModeRequired,
    runtimeOptions: {
      maxIterations:
        input.maxIterations ?? member.runtimeState.maxIterations ?? 1,
      pollIntervalMs:
        input.pollIntervalMs ?? member.runtimeState.pollIntervalMs,
    },
    codexExecutablePath: member.runtimeState.codexExecutablePath,
    codexArgs: member.runtimeState.codexArgs,
    upstreamExecutablePath: member.runtimeState.upstreamExecutablePath,
    upstreamArgs: member.runtimeState.upstreamArgs,
  } as const

  const adapter = createAdapterForRuntimeKind(runtimeConfig)
  const spawnResult = await spawnInProcessTeammate(runtimeConfig, options, adapter)

  if (!spawnResult.success) {
    return {
      success: false,
      message:
        spawnResult.error ??
        `Failed to resume ${agentName} in team "${teamName}"`,
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
    message: `Resumed ${agentName} in team "${teamName}" with ${loopSummary}`,
  }
}

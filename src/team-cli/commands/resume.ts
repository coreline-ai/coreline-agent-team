import { getTeamMember, type TeamCoreOptions } from '../../team-core/index.js'
import { createAdapterForRuntimeKind, spawnInProcessTeammate } from '../../team-runtime/index.js'
import type { CliCommandResult } from '../types.js'

export type ResumeCommandInput = {
  maxIterations?: number
  pollIntervalMs?: number
}

type StoredRuntimeLaunchMode = 'resume' | 'reopen'

type StoredRuntimeTeamMember = NonNullable<
  Awaited<ReturnType<typeof getTeamMember>>
>

function getStoredRuntimeLaunchError(
  teamName: string,
  agentName: string,
  member: StoredRuntimeTeamMember | null,
  mode: StoredRuntimeLaunchMode,
): string | null {
  if (!member) {
    return `Teammate "${agentName}" not found in team "${teamName}"`
  }

  if (member.isActive === true) {
    return `${agentName} is already active`
  }

  if (!member.runtimeState?.prompt || !member.runtimeState.cwd) {
    return `${agentName} does not have resumable runtime metadata`
  }

  if (
    mode === 'reopen' &&
    !member.runtimeState.sessionId &&
    !member.runtimeState.lastSessionId
  ) {
    return `${agentName} does not have reopenable session metadata`
  }

  return null
}

function buildStoredRuntimeConfig(
  teamName: string,
  member: StoredRuntimeTeamMember,
  input: ResumeCommandInput,
  mode: StoredRuntimeLaunchMode,
) {
  return {
    name: member.name,
    teamName,
    prompt: member.runtimeState!.prompt!,
    cwd: member.runtimeState!.cwd!,
    color: member.color,
    model: member.runtimeState!.model ?? member.model,
    sessionId:
      mode === 'reopen'
        ? member.runtimeState!.sessionId ?? member.runtimeState!.lastSessionId
        : undefined,
    runtimeKind: member.runtimeState!.runtimeKind ?? 'local',
    reopenSession: mode === 'reopen',
    planModeRequired: member.runtimeState!.planModeRequired,
    runtimeOptions: {
      maxIterations:
        input.maxIterations ?? member.runtimeState!.maxIterations ?? 1,
      pollIntervalMs:
        input.pollIntervalMs ?? member.runtimeState!.pollIntervalMs,
    },
    codexExecutablePath: member.runtimeState!.codexExecutablePath,
    codexArgs: member.runtimeState!.codexArgs,
    upstreamExecutablePath: member.runtimeState!.upstreamExecutablePath,
    upstreamArgs: member.runtimeState!.upstreamArgs,
  } as const
}

export async function runStoredRuntimeCommand(
  teamName: string,
  agentName: string,
  input: ResumeCommandInput = {},
  options: TeamCoreOptions = {},
  mode: StoredRuntimeLaunchMode = 'resume',
): Promise<CliCommandResult> {
  const member = await getTeamMember(teamName, { name: agentName }, options)
  const error = getStoredRuntimeLaunchError(teamName, agentName, member, mode)
  if (error) {
    return {
      success: false,
      message: error,
    }
  }

  const runtimeConfig = buildStoredRuntimeConfig(teamName, member!, input, mode)
  const adapter = createAdapterForRuntimeKind(runtimeConfig)
  const spawnResult = await spawnInProcessTeammate(runtimeConfig, options, adapter)

  if (!spawnResult.success) {
    return {
      success: false,
      message:
        spawnResult.error ??
        `Failed to ${mode} ${agentName} in team "${teamName}"`,
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

  const verb = mode === 'reopen' ? 'Reopened' : 'Resumed'
  const sessionMode = mode === 'reopen' ? 'existing-session' : 'new-session'

  return {
    success: true,
    message:
      `${verb} ${agentName} in team "${teamName}" ` +
      `(${sessionMode}) with ${loopSummary}`,
  }
}

export async function runResumeCommand(
  teamName: string,
  agentName: string,
  input: ResumeCommandInput = {},
  options: TeamCoreOptions = {},
): Promise<CliCommandResult> {
  return runStoredRuntimeCommand(
    teamName,
    agentName,
    input,
    options,
    'resume',
  )
}

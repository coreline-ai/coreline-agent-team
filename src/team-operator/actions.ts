import {
  analyzeTeamCostGuardrails,
  getPendingPermissionRequest,
  getTeamMember,
  readTeamFile,
  isPermissionRequest,
  isPlanApprovalRequest,
  isSandboxPermissionRequest,
  markMessagesAsReadByPredicate,
  type TeamCoreOptions,
} from '../team-core/index.js'
import {
  runApprovePermissionCommand,
  runApprovePlanCommand,
  runApproveSandboxCommand,
  runCleanupCommand,
  runDenyPermissionCommand,
  runDenySandboxCommand,
  runInitCommand,
  runRejectPlanCommand,
  runSendCommand,
  runShutdownCommand,
  runTaskCreateCommand,
} from '../team-cli/index.js'
import type {
  ApprovalDecisionInput,
  ApproveSandboxDecisionInput,
  CreateTaskOperatorInput,
  CreateTeamOperatorInput,
  DenyPermissionDecisionInput,
  OperatorActionResult,
  PlanDecisionInput,
  ResumeTeammateOperatorInput,
  SendLeaderMessageInput,
  ShutdownTeammateOperatorInput,
  SpawnTeammateOperatorInput,
} from './types.js'
import {
  type BackgroundLaunchResult,
  buildBackgroundResumeCliArgs,
  buildBackgroundSpawnCliArgs,
  launchBackgroundAgentTeamCommand,
  resolveBackgroundLoopOptions,
} from './background-process.js'

export type OperatorLifecycleActionDependencies = {
  buildBackgroundResumeCliArgs: typeof buildBackgroundResumeCliArgs
  buildBackgroundSpawnCliArgs: typeof buildBackgroundSpawnCliArgs
  launchBackgroundAgentTeamCommand: (
    cliArgs: string[],
  ) => Promise<BackgroundLaunchResult>
  resolveBackgroundLoopOptions: typeof resolveBackgroundLoopOptions
}

const defaultOperatorLifecycleActionDependencies: OperatorLifecycleActionDependencies =
  {
    buildBackgroundResumeCliArgs,
    buildBackgroundSpawnCliArgs,
    launchBackgroundAgentTeamCommand,
    resolveBackgroundLoopOptions,
  }

async function spawnTrackedTeammate(
  input: SpawnTeammateOperatorInput,
  options: TeamCoreOptions = {},
  dependencies: OperatorLifecycleActionDependencies = defaultOperatorLifecycleActionDependencies,
): Promise<OperatorActionResult> {
  const team = await readTeamFile(input.teamName, options)
  const projectedCostWarnings = !team
    ? []
    : analyzeTeamCostGuardrails({
        team: {
          members: team.members.some(member => member.name === input.agentName)
            ? team.members
            : [
                ...team.members,
                {
                  agentId: `${input.agentName}@${input.teamName}`,
                  name: input.agentName,
                  cwd: input.cwd ?? process.cwd(),
                  subscriptions: [],
                  joinedAt: Date.now(),
                },
              ],
        },
      }).warnings.filter(warning => warning.code === 'large_team')
  const loopOptions = dependencies.resolveBackgroundLoopOptions(input)
  const launched = await dependencies.launchBackgroundAgentTeamCommand(
    dependencies.buildBackgroundSpawnCliArgs(
      {
        ...input,
        ...loopOptions,
      },
      options,
    ),
  )

  if (!launched.success) {
    return {
      success: false,
      message:
        launched.error ??
        `Failed to start ${input.agentName} in team "${input.teamName}"`,
    }
  }

  return {
    success: true,
    message: [
      `Started background worker ${input.agentName} in team "${input.teamName}"` +
        ` runtime=${input.runtimeKind ?? 'local'}` +
        ` backend=${input.backendType ?? 'in-process'}` +
        ` transport=${input.transportKind ?? 'local'}` +
        ` lifecycle=bounded` +
        ` maxIterations=${loopOptions.maxIterations}` +
        ` pollIntervalMs=${loopOptions.pollIntervalMs}` +
        (launched.paneId ? ` pane=${launched.paneId}` : '') +
        (launched.pid ? ` pid=${launched.pid}` : ''),
      ...projectedCostWarnings.map(warning => `Cost: ${warning.message}`),
    ].join('\n'),
  }
}

type StoredRuntimeLaunchContext = {
  runtimeKind: 'local' | 'codex-cli' | 'upstream'
  backendType: 'in-process' | 'pane'
  transportKind: 'local' | 'remote-root'
  remoteRootDir?: string
  maxIterations: number
  pollIntervalMs: number
}

async function resolveStoredRuntimeLaunchContext(
  command: 'resume' | 'reopen',
  input: ResumeTeammateOperatorInput,
  options: TeamCoreOptions,
  dependencies: OperatorLifecycleActionDependencies = defaultOperatorLifecycleActionDependencies,
): Promise<StoredRuntimeLaunchContext | OperatorActionResult> {
  const member = await getTeamMember(
    input.teamName,
    { name: input.agentName },
    options,
  )
  if (!member) {
    return {
      success: false,
      message: `Teammate "${input.agentName}" not found in team "${input.teamName}"`,
    }
  }

  if (member.isActive === true) {
    return {
      success: false,
      message: `${input.agentName} is already active`,
    }
  }

  if (!member.runtimeState?.prompt || !member.runtimeState.cwd) {
    return {
      success: false,
      message: `${input.agentName} does not have resumable runtime metadata`,
    }
  }

  if (
    command === 'reopen' &&
    !member.runtimeState.sessionId &&
    !member.runtimeState.lastSessionId
  ) {
    return {
      success: false,
      message: `${input.agentName} does not have reopenable session metadata`,
    }
  }

  const runtimeKind =
    member.runtimeState.runtimeKind === 'local' ||
    member.runtimeState.runtimeKind === 'codex-cli' ||
    member.runtimeState.runtimeKind === 'upstream'
      ? member.runtimeState.runtimeKind
      : 'local'
  const backendType =
    member.runtimeState?.backendType === 'pane' ? 'pane' : 'in-process'
  const transportKind =
    member.runtimeState?.transportKind === 'remote-root'
      ? 'remote-root'
      : 'local'

  return {
    runtimeKind,
    backendType,
    transportKind,
    remoteRootDir: member.runtimeState?.remoteRootDir,
    ...dependencies.resolveBackgroundLoopOptions({
      maxIterations:
        input.maxIterations ?? member.runtimeState.maxIterations,
      pollIntervalMs:
        input.pollIntervalMs ?? member.runtimeState.pollIntervalMs,
    }),
  }
}

async function launchStoredRuntimeTeammate(
  command: 'resume' | 'reopen',
  input: ResumeTeammateOperatorInput,
  options: TeamCoreOptions = {},
  dependencies: OperatorLifecycleActionDependencies = defaultOperatorLifecycleActionDependencies,
): Promise<OperatorActionResult> {
  const resolved = await resolveStoredRuntimeLaunchContext(
    command,
    input,
    options,
    dependencies,
  )
  if ('success' in resolved) {
    return resolved
  }

  const launched = await dependencies.launchBackgroundAgentTeamCommand(
    dependencies.buildBackgroundResumeCliArgs(
      command,
      {
        teamName: input.teamName,
        agentName: input.agentName,
        backendType: resolved.backendType,
        transportKind: resolved.transportKind,
        remoteRootDir: resolved.remoteRootDir,
        maxIterations: resolved.maxIterations,
        pollIntervalMs: resolved.pollIntervalMs,
      },
      options,
    ),
  )

  if (!launched.success) {
    return {
      success: false,
      message:
        launched.error ??
        `Failed to ${command} ${input.agentName} in team "${input.teamName}"`,
    }
  }

  return {
    success: true,
    message:
      `${command === 'reopen' ? 'Reopened' : 'Resumed'} background worker ${input.agentName}` +
      ` in team "${input.teamName}"` +
      ` runtime=${resolved.runtimeKind}` +
      ` backend=${resolved.backendType}` +
      ` transport=${resolved.transportKind}` +
      ` session=${command === 'reopen' ? 'existing-session' : 'new-session'}` +
      ` lifecycle=bounded` +
      ` maxIterations=${resolved.maxIterations}` +
      ` pollIntervalMs=${resolved.pollIntervalMs}` +
      (launched.paneId ? ` pane=${launched.paneId}` : '') +
      (launched.pid ? ` pid=${launched.pid}` : ''),
  }
}

export function createOperatorLifecycleActions(
  dependencies: Partial<OperatorLifecycleActionDependencies> = {},
) {
  const resolvedDependencies = {
    ...defaultOperatorLifecycleActionDependencies,
    ...dependencies,
  } satisfies OperatorLifecycleActionDependencies

  return {
    async spawnTeammate(
      input: SpawnTeammateOperatorInput,
      options: TeamCoreOptions = {},
    ): Promise<OperatorActionResult> {
      return spawnTrackedTeammate(input, options, resolvedDependencies)
    },
    async resumeTeammate(
      input: ResumeTeammateOperatorInput,
      options: TeamCoreOptions = {},
    ): Promise<OperatorActionResult> {
      return launchStoredRuntimeTeammate(
        'resume',
        input,
        options,
        resolvedDependencies,
      )
    },
    async reopenTeammate(
      input: ResumeTeammateOperatorInput,
      options: TeamCoreOptions = {},
    ): Promise<OperatorActionResult> {
      return launchStoredRuntimeTeammate(
        'reopen',
        input,
        options,
        resolvedDependencies,
      )
    },
  }
}

async function markApprovalMessagesHandled(
  teamName: string,
  matcher: (text: string) => boolean,
  options: TeamCoreOptions = {},
): Promise<void> {
  await markMessagesAsReadByPredicate(
    teamName,
    'team-lead',
    message => matcher(message.text),
    options,
  )
}

export async function createTeam(
  input: CreateTeamOperatorInput,
  options: TeamCoreOptions = {},
): Promise<OperatorActionResult> {
  return runInitCommand(input.teamName, options)
}

export async function createTask(
  input: CreateTaskOperatorInput,
  options: TeamCoreOptions = {},
): Promise<OperatorActionResult> {
  return runTaskCreateCommand(
    input.teamName,
    input.subject,
    input.description,
    options,
  )
}

export async function sendLeaderMessage(
  input: SendLeaderMessageInput,
  options: TeamCoreOptions = {},
): Promise<OperatorActionResult> {
  return runSendCommand(
    input.teamName,
    input.recipient,
    input.message,
    options,
  )
}

export async function spawnTeammate(
  input: SpawnTeammateOperatorInput,
  options: TeamCoreOptions = {},
): Promise<OperatorActionResult> {
  return createOperatorLifecycleActions().spawnTeammate(input, options)
}

export async function resumeTeammate(
  input: ResumeTeammateOperatorInput,
  options: TeamCoreOptions = {},
): Promise<OperatorActionResult> {
  return createOperatorLifecycleActions().resumeTeammate(input, options)
}

export async function reopenTeammate(
  input: ResumeTeammateOperatorInput,
  options: TeamCoreOptions = {},
): Promise<OperatorActionResult> {
  return createOperatorLifecycleActions().reopenTeammate(input, options)
}

export async function shutdownTeammate(
  input: ShutdownTeammateOperatorInput,
  options: TeamCoreOptions = {},
): Promise<OperatorActionResult> {
  return runShutdownCommand(
    input.teamName,
    input.recipient,
    input.reason,
    options,
  )
}

export async function approvePermission(
  input: ApprovalDecisionInput,
  options: TeamCoreOptions = {},
): Promise<OperatorActionResult> {
  const result = await runApprovePermissionCommand(
    input.teamName,
    input.recipientName,
    input.requestId,
    {
      persistDecision: input.persistDecision,
      rulePreset: input.rulePreset,
      ruleContent: input.ruleContent,
      commandContains: input.commandContains,
      cwdPrefix: input.cwdPrefix,
      pathPrefix: input.pathPrefix,
      hostEquals: input.hostEquals,
    },
    options,
  )

  await markApprovalMessagesHandled(
    input.teamName,
    text => isPermissionRequest(text)?.request_id === input.requestId,
    options,
  )

  return result
}

export async function denyPermission(
  input: DenyPermissionDecisionInput,
  options: TeamCoreOptions = {},
): Promise<OperatorActionResult> {
  const result = await runDenyPermissionCommand(
    input.teamName,
    input.recipientName,
    input.requestId,
    {
      errorMessage: input.errorMessage,
      persistDecision: input.persistDecision,
      rulePreset: input.rulePreset,
      ruleContent: input.ruleContent,
      commandContains: input.commandContains,
      cwdPrefix: input.cwdPrefix,
      pathPrefix: input.pathPrefix,
      hostEquals: input.hostEquals,
    },
    options,
  )

  await markApprovalMessagesHandled(
    input.teamName,
    text => isPermissionRequest(text)?.request_id === input.requestId,
    options,
  )

  return result
}

export async function approveSandbox(
  input: ApproveSandboxDecisionInput,
  options: TeamCoreOptions = {},
): Promise<OperatorActionResult> {
  const result = await runApproveSandboxCommand(
    input.teamName,
    input.recipientName,
    input.requestId,
    input.host,
    options,
  )

  await markApprovalMessagesHandled(
    input.teamName,
    text => isSandboxPermissionRequest(text)?.requestId === input.requestId,
    options,
  )

  return result
}

export async function denySandbox(
  input: ApproveSandboxDecisionInput,
  options: TeamCoreOptions = {},
): Promise<OperatorActionResult> {
  const result = await runDenySandboxCommand(
    input.teamName,
    input.recipientName,
    input.requestId,
    input.host,
    options,
  )

  await markApprovalMessagesHandled(
    input.teamName,
    text => isSandboxPermissionRequest(text)?.requestId === input.requestId,
    options,
  )

  return result
}

export async function approvePlan(
  input: PlanDecisionInput,
  options: TeamCoreOptions = {},
): Promise<OperatorActionResult> {
  const result = await runApprovePlanCommand(
    input.teamName,
    input.recipientName,
    input.requestId,
    options,
  )

  await markApprovalMessagesHandled(
    input.teamName,
    text => isPlanApprovalRequest(text)?.requestId === input.requestId,
    options,
  )

  return result
}

export async function rejectPlan(
  input: PlanDecisionInput,
  options: TeamCoreOptions = {},
): Promise<OperatorActionResult> {
  const result = await runRejectPlanCommand(
    input.teamName,
    input.recipientName,
    input.requestId,
    input.feedback ?? 'Rejected in TUI',
    options,
  )

  await markApprovalMessagesHandled(
    input.teamName,
    text => isPlanApprovalRequest(text)?.requestId === input.requestId,
    options,
  )

  return result
}

export async function readTranscript(
  teamName: string,
  agentName: string,
  limit: number,
  options: TeamCoreOptions = {},
) {
  const member = await getTeamMember(teamName, { name: agentName }, options)
  if (!member) {
    return {
      success: false,
      message: `Teammate "${agentName}" not found`,
      entries: [],
    }
  }

  const entries = await import('../team-core/index.js').then(module =>
    module.readTranscriptEntries(teamName, agentName, options),
  )

  return {
    success: true,
    message: `Loaded transcript for ${agentName}`,
    entries: entries.slice(-limit),
  }
}

export async function getPendingPermissionRequestDetails(
  teamName: string,
  requestId: string,
  options: TeamCoreOptions = {},
) {
  return getPendingPermissionRequest(teamName, requestId, options)
}

export async function cleanupTeam(
  teamName: string,
  options: TeamCoreOptions = {},
): Promise<OperatorActionResult> {
  return runCleanupCommand(teamName, {}, options)
}

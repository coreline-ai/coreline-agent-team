import {
  getPendingPermissionRequest,
  getTeamMember,
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
  buildBackgroundResumeCliArgs,
  buildBackgroundSpawnCliArgs,
  launchBackgroundAgentTeamCommand,
} from './background-process.js'

async function spawnTrackedTeammate(
  input: SpawnTeammateOperatorInput,
  options: TeamCoreOptions = {},
): Promise<OperatorActionResult> {
  const launched = await launchBackgroundAgentTeamCommand(
    buildBackgroundSpawnCliArgs(input, options),
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
    message:
      `Started background worker ${input.agentName} in team "${input.teamName}"` +
      ` runtime=${input.runtimeKind ?? 'local'}` +
      ` maxIterations=${input.maxIterations ?? 50}` +
      (launched.pid ? ` pid=${launched.pid}` : ''),
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
  return spawnTrackedTeammate(input, options)
}

export async function resumeTeammate(
  input: ResumeTeammateOperatorInput,
  options: TeamCoreOptions = {},
): Promise<OperatorActionResult> {
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

  const runtimeKind =
    member.runtimeState.runtimeKind === 'local' ||
    member.runtimeState.runtimeKind === 'codex-cli' ||
    member.runtimeState.runtimeKind === 'upstream'
      ? member.runtimeState.runtimeKind
      : 'local'

  const launched = await launchBackgroundAgentTeamCommand(
    buildBackgroundResumeCliArgs(
      'resume',
      {
        teamName: input.teamName,
        agentName: input.agentName,
        maxIterations: input.maxIterations ?? member.runtimeState.maxIterations ?? 50,
        pollIntervalMs:
          input.pollIntervalMs ?? member.runtimeState.pollIntervalMs ?? 500,
      },
      options,
    ),
  )

  if (!launched.success) {
    return {
      success: false,
      message:
        launched.error ??
        `Failed to resume ${input.agentName} in team "${input.teamName}"`,
    }
  }

  return {
    success: true,
    message:
      `Resumed background worker ${input.agentName} in team "${input.teamName}"` +
      ` runtime=${runtimeKind}` +
      ` maxIterations=${input.maxIterations ?? member.runtimeState.maxIterations ?? 50}` +
      (launched.pid ? ` pid=${launched.pid}` : ''),
  }
}

export async function reopenTeammate(
  input: ResumeTeammateOperatorInput,
  options: TeamCoreOptions = {},
): Promise<OperatorActionResult> {
  const member = await getTeamMember(
    input.teamName,
    {
      name: input.agentName,
    },
    options,
  )
  if (!member) {
    return {
      success: false,
      message: `Teammate "${input.agentName}" not found in team "${input.teamName}"`,
    }
  }

  if (!member.runtimeState?.prompt || !member.runtimeState.cwd) {
    return {
      success: false,
      message: `${input.agentName} does not have resumable runtime metadata`,
    }
  }

  const launched = await launchBackgroundAgentTeamCommand(
    buildBackgroundResumeCliArgs(
      'reopen',
      {
        teamName: input.teamName,
        agentName: input.agentName,
        maxIterations: input.maxIterations ?? member.runtimeState.maxIterations ?? 50,
        pollIntervalMs:
          input.pollIntervalMs ?? member.runtimeState.pollIntervalMs ?? 500,
      },
      options,
    ),
  )

  if (!launched.success) {
    return {
      success: false,
      message:
        launched.error ??
        `Failed to reopen ${input.agentName} in team "${input.teamName}"`,
    }
  }

  return {
    success: true,
    message:
      `Reopened background worker ${input.agentName} in team "${input.teamName}"` +
      ` maxIterations=${input.maxIterations ?? member.runtimeState.maxIterations ?? 50}` +
      (launched.pid ? ` pid=${launched.pid}` : ''),
  }
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

export async function stopTrackedTeammates(
  teamName?: string,
): Promise<void> {
  void teamName
}

export async function cleanupTeam(
  teamName: string,
  options: TeamCoreOptions = {},
): Promise<OperatorActionResult> {
  return runCleanupCommand(teamName, {}, options)
}

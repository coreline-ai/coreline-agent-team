import {
  createPermissionResponseMessage,
  createTeamPermissionUpdateMessage,
  describePermissionRule,
  getPendingPermissionRequest,
  listTeamMembers,
  resolvePermissionRequest,
  type TeamCoreOptions,
  type TeamPermissionRequestRecord,
  type TeamPermissionUpdate,
  writeToMailbox,
} from '../../team-core/index.js'
import type { CliCommandResult } from '../types.js'
import {
  buildPermissionRuleFromRequest,
  type PermissionRuleFlags,
} from './permission-rule.js'

type PermissionDecisionParams = {
  teamName: string
  recipient: string
  requestId: string
  decision: 'approved' | 'rejected'
  responseSubtype: 'success' | 'error'
  responseError?: string
  feedback?: string
  updatedInput?: Record<string, unknown>
  persistDecision?: boolean
  behavior: 'allow' | 'deny'
  ruleInput?: PermissionRuleFlags
  options?: TeamCoreOptions
}

function resolveDirectoryPath(
  request: TeamPermissionRequestRecord | null,
): string {
  if (!request) {
    return process.cwd()
  }

  const input = request.input
  if (typeof input.cwd === 'string') {
    return input.cwd
  }
  if (typeof input.path === 'string') {
    return input.path
  }
  if (typeof input.file_path === 'string') {
    return input.file_path
  }
  return process.cwd()
}

function buildPermissionUpdates(
  pendingRequest: TeamPermissionRequestRecord | null,
  behavior: 'allow' | 'deny',
  persistDecision: boolean | undefined,
  ruleInput: PermissionRuleFlags | undefined,
): TeamPermissionUpdate[] {
  if (!persistDecision || !pendingRequest) {
    return []
  }

  return [
    {
      type: 'addRules',
      rules: [buildPermissionRuleFromRequest(pendingRequest, ruleInput ?? {})],
      behavior,
      destination: 'session',
    },
  ]
}

async function broadcastPermissionUpdates(
  teamName: string,
  pendingRequest: TeamPermissionRequestRecord | null,
  permissionUpdates: TeamPermissionUpdate[],
  options: TeamCoreOptions,
): Promise<void> {
  if (permissionUpdates.length === 0) {
    return
  }

  const broadcastMessage = createTeamPermissionUpdateMessage({
    permissionUpdate: permissionUpdates[0]!,
    directoryPath: resolveDirectoryPath(pendingRequest),
    toolName: pendingRequest?.toolName ?? 'unknown',
  })
  const members = await listTeamMembers(teamName, options)
  for (const member of members) {
    if (member.name === 'team-lead') {
      continue
    }
    await writeToMailbox(
      teamName,
      member.name,
      {
        from: 'team-lead',
        text: JSON.stringify(broadcastMessage),
        timestamp: new Date().toISOString(),
        summary: `team permission update ${broadcastMessage.toolName}`,
      },
      options,
    )
  }
}

export async function resolvePermissionDecision(
  params: PermissionDecisionParams,
): Promise<CliCommandResult> {
  const options = params.options ?? {}
  const pendingRequest = await getPendingPermissionRequest(
    params.teamName,
    params.requestId,
    options,
  )
  const permissionUpdates = buildPermissionUpdates(
    pendingRequest,
    params.behavior,
    params.persistDecision,
    params.ruleInput,
  )

  await resolvePermissionRequest(
    params.teamName,
    params.requestId,
    {
      decision: params.decision,
      resolvedBy: 'leader',
      feedback: params.feedback,
      updatedInput: params.updatedInput,
      permissionUpdates,
    },
    options,
  )

  const message = createPermissionResponseMessage({
    request_id: params.requestId,
    subtype: params.responseSubtype,
    error: params.responseError,
    updated_input: params.updatedInput,
    permission_updates: permissionUpdates,
  })

  await writeToMailbox(
    params.teamName,
    params.recipient,
    {
      from: 'team-lead',
      text: JSON.stringify(message),
      timestamp: new Date().toISOString(),
      summary: `${params.decision === 'approved' ? 'approve' : 'deny'} permission ${params.recipient}`,
    },
    options,
  )

  await broadcastPermissionUpdates(
    params.teamName,
    pendingRequest,
    permissionUpdates,
    options,
  )

  return {
    success: true,
    message:
      `Permission ${params.decision === 'approved' ? 'approved' : 'denied'} for ${params.recipient}. Request ID: ${params.requestId}` +
      (permissionUpdates.length > 0
        ? ` Persisted ${params.behavior} rule applied: ${describePermissionRule(
            permissionUpdates[0]!.rules[0]!,
          )}.`
        : ''),
  }
}

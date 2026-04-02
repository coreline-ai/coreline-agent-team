import {
  createPermissionResponseMessage,
  createTeamPermissionUpdateMessage,
  describePermissionRule,
  getPendingPermissionRequest,
  listTeamMembers,
  resolvePermissionRequest,
  type TeamPermissionUpdate,
  writeToMailbox,
  type TeamCoreOptions,
} from '../../team-core/index.js'
import type { CliCommandResult } from '../types.js'
import {
  buildPermissionRuleFromRequest,
  type PermissionRuleFlags,
} from './permission-rule.js'

export type DenyPermissionCommandInput = {
  errorMessage: string
  persistDecision?: boolean
} & PermissionRuleFlags

export async function runDenyPermissionCommand(
  teamName: string,
  recipient: string,
  requestId: string,
  inputOrError: string | DenyPermissionCommandInput,
  options: TeamCoreOptions = {},
): Promise<CliCommandResult> {
  const input: DenyPermissionCommandInput =
    typeof inputOrError === 'string'
      ? {
          errorMessage: inputOrError,
        }
      : inputOrError
  const pendingRequest = await getPendingPermissionRequest(teamName, requestId, options)
  const permissionUpdates: TeamPermissionUpdate[] =
    input.persistDecision && pendingRequest
      ? [
          {
            type: 'addRules',
            rules: [buildPermissionRuleFromRequest(pendingRequest, input)],
            behavior: 'deny',
            destination: 'session',
          },
        ]
      : []

  await resolvePermissionRequest(
    teamName,
    requestId,
    {
      decision: 'rejected',
      resolvedBy: 'leader',
      feedback: input.errorMessage,
      permissionUpdates,
    },
    options,
  )

  const message = createPermissionResponseMessage({
    request_id: requestId,
    subtype: 'error',
    error: input.errorMessage,
  })

  await writeToMailbox(
    teamName,
    recipient,
    {
      from: 'team-lead',
      text: JSON.stringify(message),
      timestamp: new Date().toISOString(),
      summary: `deny permission ${recipient}`,
    },
    options,
  )

  if (permissionUpdates.length > 0) {
    const broadcastMessage = createTeamPermissionUpdateMessage({
      permissionUpdate: permissionUpdates[0]!,
      directoryPath:
        typeof pendingRequest?.input.cwd === 'string'
          ? pendingRequest.input.cwd
          : process.cwd(),
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

  return {
    success: true,
    message:
      `Permission denied for ${recipient}. Request ID: ${requestId}` +
      (permissionUpdates.length > 0
        ? ` Persisted deny rule applied: ${describePermissionRule(
            permissionUpdates[0]!.rules[0]!,
          )}.`
        : ''),
  }
}

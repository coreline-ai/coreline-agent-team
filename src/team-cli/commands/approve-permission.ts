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

export type ApprovePermissionCommandInput = {
  persistDecision?: boolean
  updatedInput?: Record<string, unknown>
} & PermissionRuleFlags

function normalizeArgs(
  inputOrOptions: ApprovePermissionCommandInput | TeamCoreOptions | undefined,
  options: TeamCoreOptions | undefined,
): {
  input: ApprovePermissionCommandInput
  options: TeamCoreOptions
} {
  if (
    inputOrOptions &&
    ('persistDecision' in inputOrOptions ||
      'ruleContent' in inputOrOptions ||
      'updatedInput' in inputOrOptions ||
      'commandContains' in inputOrOptions ||
      'cwdPrefix' in inputOrOptions ||
      'pathPrefix' in inputOrOptions ||
      'hostEquals' in inputOrOptions)
  ) {
    return {
      input: inputOrOptions,
      options: options ?? {},
    }
  }

  return {
    input: {},
    options: (inputOrOptions as TeamCoreOptions | undefined) ?? options ?? {},
  }
}

function resolveDirectoryPath(
  request:
    | Awaited<ReturnType<typeof getPendingPermissionRequest>>
    | null,
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

export async function runApprovePermissionCommand(
  teamName: string,
  recipient: string,
  requestId: string,
  inputOrOptions?: ApprovePermissionCommandInput | TeamCoreOptions,
  options?: TeamCoreOptions,
): Promise<CliCommandResult> {
  const { input, options: resolvedOptions } = normalizeArgs(inputOrOptions, options)
  const pendingRequest = await getPendingPermissionRequest(
    teamName,
    requestId,
    resolvedOptions,
  )

  const permissionUpdates: TeamPermissionUpdate[] =
    input.persistDecision && pendingRequest
      ? [
          {
            type: 'addRules',
            rules: [buildPermissionRuleFromRequest(pendingRequest, input)],
            behavior: 'allow',
            destination: 'session',
          },
        ]
      : []

  await resolvePermissionRequest(
    teamName,
    requestId,
    {
      decision: 'approved',
      resolvedBy: 'leader',
      updatedInput: input.updatedInput,
      permissionUpdates,
    },
    resolvedOptions,
  )

  const message = createPermissionResponseMessage({
    request_id: requestId,
    subtype: 'success',
    updated_input: input.updatedInput,
    permission_updates: permissionUpdates,
  })

  await writeToMailbox(
    teamName,
    recipient,
    {
      from: 'team-lead',
      text: JSON.stringify(message),
      timestamp: new Date().toISOString(),
      summary: `approve permission ${recipient}`,
    },
    resolvedOptions,
  )

  if (permissionUpdates.length > 0) {
    const broadcastMessage = createTeamPermissionUpdateMessage({
      permissionUpdate: permissionUpdates[0]!,
      directoryPath: resolveDirectoryPath(pendingRequest),
      toolName: pendingRequest?.toolName ?? 'unknown',
    })
    const members = await listTeamMembers(teamName, resolvedOptions)
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
        resolvedOptions,
      )
    }
  }

  return {
    success: true,
    message:
      `Permission approved for ${recipient}. Request ID: ${requestId}` +
      (permissionUpdates.length > 0
        ? ` Persisted allow rule applied: ${describePermissionRule(
            permissionUpdates[0]!.rules[0]!,
          )}.`
        : ''),
  }
}

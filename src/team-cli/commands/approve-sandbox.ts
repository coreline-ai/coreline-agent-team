import {
  createSandboxPermissionResponseMessage,
  writeToMailbox,
  type TeamCoreOptions,
} from '../../team-core/index.js'
import type { CliCommandResult } from '../types.js'

export async function runApproveSandboxCommand(
  teamName: string,
  recipient: string,
  requestId: string,
  host: string,
  options: TeamCoreOptions = {},
): Promise<CliCommandResult> {
  const message = createSandboxPermissionResponseMessage({
    requestId,
    host,
    allow: true,
  })

  await writeToMailbox(
    teamName,
    recipient,
    {
      from: 'team-lead',
      text: JSON.stringify(message),
      timestamp: new Date().toISOString(),
      summary: `approve sandbox ${recipient}`,
    },
    options,
  )

  return {
    success: true,
    message: `Sandbox access approved for ${recipient}. Request ID: ${requestId}`,
  }
}

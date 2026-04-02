import {
  createPlanApprovalResponseMessage,
  writeToMailbox,
  type TeamCoreOptions,
} from '../../team-core/index.js'
import type { CliCommandResult } from '../types.js'

export async function runApprovePlanCommand(
  teamName: string,
  recipient: string,
  requestId: string,
  options: TeamCoreOptions = {},
): Promise<CliCommandResult> {
  const message = createPlanApprovalResponseMessage({
    requestId,
    approved: true,
    permissionMode: 'default',
  })

  await writeToMailbox(
    teamName,
    recipient,
    {
      from: 'team-lead',
      text: JSON.stringify(message),
      timestamp: new Date().toISOString(),
      summary: `approve plan ${recipient}`,
    },
    options,
  )

  return {
    success: true,
    message: `Plan approved for ${recipient}. Request ID: ${requestId}`,
  }
}

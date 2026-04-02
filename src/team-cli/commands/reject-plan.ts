import {
  createPlanApprovalResponseMessage,
  writeToMailbox,
  type TeamCoreOptions,
} from '../../team-core/index.js'
import type { CliCommandResult } from '../types.js'

export async function runRejectPlanCommand(
  teamName: string,
  recipient: string,
  requestId: string,
  feedback: string,
  options: TeamCoreOptions = {},
): Promise<CliCommandResult> {
  const message = createPlanApprovalResponseMessage({
    requestId,
    approved: false,
    feedback,
  })

  await writeToMailbox(
    teamName,
    recipient,
    {
      from: 'team-lead',
      text: JSON.stringify(message),
      timestamp: new Date().toISOString(),
      summary: `reject plan ${recipient}`,
    },
    options,
  )

  return {
    success: true,
    message: `Plan rejected for ${recipient}. Request ID: ${requestId}`,
  }
}

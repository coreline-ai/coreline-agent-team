import {
  createShutdownRequestMessage,
  writeToMailbox,
  type TeamCoreOptions,
} from '../../team-core/index.js'
import type { CliCommandResult } from '../types.js'

function createRequestId(prefix: string, target: string): string {
  return `${prefix}-${Date.now()}-${target.replace(/[^a-zA-Z0-9]/g, '-')}`
}

export async function runShutdownCommand(
  teamName: string,
  recipient: string,
  reason: string | undefined,
  options: TeamCoreOptions = {},
): Promise<CliCommandResult> {
  const requestId = createRequestId('shutdown', recipient)
  const message = createShutdownRequestMessage({
    requestId,
    from: 'team-lead',
    reason,
  })

  await writeToMailbox(
    teamName,
    recipient,
    {
      from: 'team-lead',
      text: JSON.stringify(message),
      timestamp: new Date().toISOString(),
      summary: `shutdown ${recipient}`,
    },
    options,
  )

  return {
    success: true,
    message: `Shutdown request sent to ${recipient}. Request ID: ${requestId}`,
  }
}

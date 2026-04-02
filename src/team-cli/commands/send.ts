import { writeToMailbox, type TeamCoreOptions } from '../../team-core/index.js'
import type { CliCommandResult } from '../types.js'

export async function runSendCommand(
  teamName: string,
  recipient: string,
  message: string,
  options: TeamCoreOptions = {},
): Promise<CliCommandResult> {
  await writeToMailbox(
    teamName,
    recipient,
    {
      from: 'team-lead',
      text: message,
      timestamp: new Date().toISOString(),
      summary: message.slice(0, 64),
    },
    options,
  )

  return {
    success: true,
    message: `Message sent to ${recipient} in team "${teamName}"`,
  }
}

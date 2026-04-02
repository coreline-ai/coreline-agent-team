import {
  createModeSetRequestMessage,
  setMemberMode,
  type TeamCoreOptions,
  type TeamPermissionMode,
  writeToMailbox,
} from '../../team-core/index.js'
import type { CliCommandResult } from '../types.js'

export async function runSetModeCommand(
  teamName: string,
  recipient: string,
  mode: TeamPermissionMode,
  options: TeamCoreOptions = {},
): Promise<CliCommandResult> {
  await setMemberMode(teamName, recipient, mode, options)

  const message = createModeSetRequestMessage({
    mode,
    from: 'team-lead',
  })

  await writeToMailbox(
    teamName,
    recipient,
    {
      from: 'team-lead',
      text: JSON.stringify(message),
      timestamp: new Date().toISOString(),
      summary: `set mode ${recipient}`,
    },
    options,
  )

  return {
    success: true,
    message: `Set ${recipient} mode to ${mode}`,
  }
}

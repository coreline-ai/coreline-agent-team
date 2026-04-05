import {
  analyzeTeamCostGuardrails,
  listTasks,
  readMailbox,
  readTeamFile,
  type TeamCoreOptions,
  writeToMailbox,
} from '../../team-core/index.js'
import { getTaskListIdForTeam } from '../../team-core/paths.js'
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
  const team = await readTeamFile(teamName, options)
  const tasks = await listTasks(getTaskListIdForTeam(teamName), options)
  const recipientMailboxes =
    !team
      ? []
      : await Promise.all(
          team.members
            .filter(member => member.name !== 'team-lead')
            .map(async member => ({
              recipientName: member.name,
              messages: await readMailbox(teamName, member.name, options),
            })),
        )
  const costGuardrails =
    !team
      ? { warnings: [] }
      : analyzeTeamCostGuardrails({
          team,
          tasks,
          recipientMailboxes,
        })
  const broadcastWarnings = costGuardrails.warnings.filter(
    warning => warning.code === 'broadcast_fanout',
  )

  return {
    success: true,
    message: [
      `Message sent to ${recipient} in team "${teamName}"`,
      ...broadcastWarnings.map(warning => `Cost: ${warning.message}`),
    ].join('\n'),
  }
}

import {
  createTeam,
  getTaskListIdForTeam,
  getTeamFilePath,
  resetTaskList,
  type TeamCoreOptions,
} from '../../team-core/index.js'
import type { CliCommandResult } from '../types.js'

export async function runInitCommand(
  teamName: string,
  options: TeamCoreOptions = {},
): Promise<CliCommandResult> {
  const leadAgentId = `team-lead@${teamName}`

  await createTeam(
    {
      teamName,
      leadAgentId,
      leadMember: {
        name: 'team-lead',
        agentType: 'team-lead',
        cwd: process.cwd(),
        subscriptions: [],
      },
    },
    options,
  )

  await resetTaskList(getTaskListIdForTeam(teamName), options)

  return {
    success: true,
    message: `Created team "${teamName}" at ${getTeamFilePath(teamName, options)}`,
  }
}

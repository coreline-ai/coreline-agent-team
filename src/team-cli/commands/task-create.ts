import {
  createTask,
  getTaskListIdForTeam,
  type TeamCoreOptions,
} from '../../team-core/index.js'
import type { CliCommandResult } from '../types.js'

export async function runTaskCreateCommand(
  teamName: string,
  subject: string,
  description: string,
  options: TeamCoreOptions = {},
): Promise<CliCommandResult> {
  const task = await createTask(
    getTaskListIdForTeam(teamName),
    {
      subject,
      description,
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  return {
    success: true,
    message: `Created task #${task.id}: ${task.subject}`,
  }
}

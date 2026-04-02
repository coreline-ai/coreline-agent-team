import {
  getTaskListIdForTeam,
  listTasks,
  type TeamCoreOptions,
} from '../../team-core/index.js'
import type { CliCommandResult } from '../types.js'

export async function runTasksCommand(
  teamName: string,
  options: TeamCoreOptions = {},
): Promise<CliCommandResult> {
  const tasks = await listTasks(getTaskListIdForTeam(teamName), options)

  if (tasks.length === 0) {
    return {
      success: true,
      message: 'No tasks found',
    }
  }

  return {
    success: true,
    message: tasks
      .map(task => `#${task.id} [${task.status}] ${task.subject}`)
      .join('\n'),
  }
}

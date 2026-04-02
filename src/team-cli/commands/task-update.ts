import {
  getTaskListIdForTeam,
  updateTask,
  type TaskStatus,
  type TeamCoreOptions,
} from '../../team-core/index.js'
import type { CliCommandResult } from '../types.js'

export async function runTaskUpdateCommand(
  teamName: string,
  taskId: string,
  status: TaskStatus,
  owner: string | undefined,
  options: TeamCoreOptions = {},
): Promise<CliCommandResult> {
  const task = await updateTask(
    getTaskListIdForTeam(teamName),
    taskId,
    {
      status,
      ...(owner !== undefined ? { owner: owner === '-' ? undefined : owner } : {}),
    },
    options,
  )

  if (!task) {
    return {
      success: false,
      message: `Task #${taskId} not found`,
    }
  }

  return {
    success: true,
    message: `Updated task #${task.id} to ${task.status}${task.owner ? ` owner=${task.owner}` : ''}`,
  }
}

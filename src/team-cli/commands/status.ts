import {
  getAgentStatuses,
  getTaskListIdForTeam,
  listTasks,
  type TeamCoreOptions,
} from '../../team-core/index.js'
import type { CliCommandResult } from '../types.js'

function formatHeartbeat(timestamp?: number): string {
  if (timestamp === undefined) {
    return 'n/a'
  }
  return new Date(timestamp).toISOString()
}

export async function runStatusCommand(
  teamName: string,
  options: TeamCoreOptions = {},
): Promise<CliCommandResult> {
  const statuses = await getAgentStatuses(teamName, options)
  if (!statuses) {
    return {
      success: false,
      message: `Team "${teamName}" does not exist`,
    }
  }

  const tasks = await listTasks(getTaskListIdForTeam(teamName), options)

  return {
    success: true,
    message: [
      `Team: ${teamName}`,
      `Tasks: ${tasks.length}`,
      ...statuses.map(
        status =>
          [
            `- ${status.name} [${status.status}]`,
            `active=${status.isActive === true ? 'yes' : 'no'}`,
            `runtime=${status.runtimeKind ?? 'local'}`,
            `mode=${status.mode ?? 'default'}`,
            `heartbeat=${formatHeartbeat(status.lastHeartbeatAt)}`,
            `session=${status.sessionId ?? 'n/a'}`,
            status.currentTasks.length > 0
              ? `tasks=${status.currentTasks.join(',')}`
              : 'tasks=none',
          ].join(' '),
      ),
    ].join('\n'),
  }
}

import {
  type AgentStatus,
  formatDisplayPath,
  formatElapsedShort,
  getAgentDisplayInfo,
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

function formatAgentLine(
  status: AgentStatus,
): string {
  const display = getAgentDisplayInfo(status)
  const heartbeatAge = formatElapsedShort(display.heartbeatAgeMs)
  const turnAge = formatElapsedShort(display.turnAgeMs)

  return [
    `- ${status.name} [${status.status}]`,
    `state=${display.state}`,
    `active=${status.isActive === true ? 'yes' : 'no'}`,
    `runtime=${status.runtimeKind ?? 'local'}`,
    `worker=${status.launchMode ?? 'attached'}`,
    `launch=${status.launchCommand ?? 'spawn'}`,
    `lifecycle=${status.lifecycle ?? 'n/a'}`,
    `pid=${status.processId ?? 'n/a'}`,
    ...(status.stdoutLogPath
      ? [`stdout_log=${formatDisplayPath(status.stdoutLogPath) ?? status.stdoutLogPath}`]
      : []),
    ...(status.stderrLogPath
      ? [`stderr_log=${formatDisplayPath(status.stderrLogPath) ?? status.stderrLogPath}`]
      : []),
    `started=${formatHeartbeat(status.startedAt)}`,
    `mode=${status.mode ?? 'default'}`,
    `heartbeat=${formatHeartbeat(status.lastHeartbeatAt)}`,
    `heartbeat_age=${heartbeatAge ?? 'n/a'}`,
    ...(display.workLabel ? [`work=${display.workLabel}`] : []),
    ...(display.state === 'executing-turn' && turnAge
      ? [`turn_age=${turnAge}`]
      : []),
    ...(display.state === 'settling' && turnAge
      ? [`settle_age=${turnAge}`]
      : []),
    ...(display.state === 'stale' && turnAge
      ? [`turn_age=${turnAge}`]
      : []),
    ...(status.lastExitAt !== undefined
      ? [`last_exit=${formatHeartbeat(status.lastExitAt)}`]
      : []),
    ...(status.lastExitReason !== undefined
      ? [`exit_reason=${status.lastExitReason}`]
      : []),
    ...(status.stderrTail && status.stderrTail.length > 0
      ? [`stderr_tail=${status.stderrTail.join(' | ')}`]
      : []),
    `session=${status.sessionId ?? 'n/a'}`,
    status.currentTasks.length > 0
      ? `tasks=${status.currentTasks.join(',')}`
      : 'tasks=none',
  ].join(' ')
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
      ...statuses.map(status => formatAgentLine(status)),
    ].join('\n'),
  }
}

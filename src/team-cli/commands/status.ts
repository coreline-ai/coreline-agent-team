import {
  analyzeTaskGuardrails,
  analyzeTeamCostGuardrails,
  type AgentStatus,
  deriveEffectiveTaskState,
  formatElapsedShort,
  getAgentDisplayInfo,
  getAgentStatuses,
  getTaskListIdForTeam,
  listTasks,
  readMailbox,
  readTeamFile,
  repairLostRuntimeMembers,
  type TeamCoreOptions,
} from '../../team-core/index.js'
import type { CliCommandResult } from '../types.js'
import {
  readCliLogSnapshots,
  renderInlineLogTokens,
  renderInlineLogSummaryTokens,
} from './log-utils.js'

function formatHeartbeat(timestamp?: number): string {
  if (timestamp === undefined) {
    return 'n/a'
  }
  return new Date(timestamp).toISOString()
}

async function formatAgentLine(
  status: AgentStatus,
): Promise<string> {
  const display = getAgentDisplayInfo(status)
  const heartbeatAge = formatElapsedShort(display.heartbeatAgeMs)
  const turnAge = formatElapsedShort(display.turnAgeMs)
  const logs = await readCliLogSnapshots(status)

  return [
    `- ${status.name} [${status.status}]`,
    `state=${display.state}`,
    `active=${status.isActive === true ? 'yes' : 'no'}`,
    `runtime=${status.runtimeKind ?? 'local'}`,
    `backend=${status.backendType ?? 'in-process'}`,
    `transport=${status.transportKind ?? 'local'}`,
    `worker=${status.launchMode ?? 'attached'}`,
    `launch=${status.launchCommand ?? 'spawn'}`,
    `lifecycle=${status.lifecycle ?? 'n/a'}`,
    `pid=${status.processId ?? 'n/a'}`,
    ...(status.paneId ? [`pane=${status.paneId}`] : []),
    ...(status.remoteRootDir ? [`remote_root=${status.remoteRootDir}`] : []),
    ...logs.flatMap(renderInlineLogTokens),
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
    ...logs.flatMap(renderInlineLogSummaryTokens),
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
  const recovery = await repairLostRuntimeMembers(teamName, options)
  const statuses = await getAgentStatuses(teamName, options)
  if (!statuses) {
    return {
      success: false,
      message: `Team "${teamName}" does not exist`,
    }
  }

  const tasks = await listTasks(getTaskListIdForTeam(teamName), options)
  const team = await readTeamFile(teamName, options)
  const effectiveTaskState = deriveEffectiveTaskState({
    tasks,
    statuses,
  })
  const guardrails = analyzeTaskGuardrails(tasks)
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
          statuses,
          recipientMailboxes,
        })

  return {
    success: true,
    message: [
      `Team: ${teamName}`,
      `Tasks: total=${tasks.length} pending=${effectiveTaskState.counts.pending} in_progress=${effectiveTaskState.counts.inProgress} completed=${effectiveTaskState.counts.completed}`,
      `Recovery: ${recovery.recoveredAgentNames.length}`,
      ...(recovery.recoveredAgentNames.length > 0
        ? [`- ${recovery.notificationMessage}`]
        : []),
      `Guardrails: ${guardrails.warnings.length}`,
      ...guardrails.warnings.map(warning => `- ${warning.message}`),
      `Cost: ${costGuardrails.warnings.length}`,
      ...costGuardrails.warnings.map(warning => `- ${warning.message}`),
      ...(await Promise.all(statuses.map(status => formatAgentLine(status)))),
    ].join('\n'),
  }
}

import type { AgentStatus, TeamWorkItemKind } from './types.js'

export type AgentDisplayState =
  | 'idle'
  | 'busy'
  | 'executing-turn'
  | 'settling'
  | 'stale'

export type AgentDisplayInfo = {
  state: AgentDisplayState
  workLabel?: string
  turnAgeMs?: number
  heartbeatAgeMs?: number
}

export const ACTIVE_AGENT_STALE_AFTER_MS = 15_000
export const ACTIVE_AGENT_SETTLING_AFTER_MS = 5_000

function formatWorkKind(kind: TeamWorkItemKind): string {
  if (kind === 'leader_message') {
    return 'leader-message'
  }
  if (kind === 'peer_message') {
    return 'peer-message'
  }
  if (kind === 'shutdown_request') {
    return 'shutdown-request'
  }
  return 'task'
}

export function formatElapsedShort(ms: number | undefined): string | undefined {
  if (ms === undefined) {
    return undefined
  }

  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) {
    return `${seconds}s`
  }

  const minutes = Math.floor(seconds / 60)
  const remainderSeconds = seconds % 60
  if (minutes < 60) {
    return remainderSeconds === 0
      ? `${minutes}m`
      : `${minutes}m${remainderSeconds}s`
  }

  const hours = Math.floor(minutes / 60)
  const remainderMinutes = minutes % 60
  return remainderMinutes === 0
    ? `${hours}h`
    : `${hours}h${remainderMinutes}m`
}

export function describeAgentWorkLabel(status: Pick<
  AgentStatus,
  'currentWorkKind' | 'currentTaskId'
>): string | undefined {
  if (!status.currentWorkKind) {
    return undefined
  }

  if (status.currentWorkKind === 'task') {
    return status.currentTaskId
      ? `task#${status.currentTaskId}`
      : 'task'
  }

  return formatWorkKind(status.currentWorkKind)
}

export function getAgentDisplayInfo(
  status: AgentStatus,
  now = Date.now(),
): AgentDisplayInfo {
  const heartbeatAgeMs =
    status.lastHeartbeatAt !== undefined
      ? Math.max(0, now - status.lastHeartbeatAt)
      : undefined
  const workLabel = describeAgentWorkLabel(status)

  if (
    status.isActive === true &&
    heartbeatAgeMs !== undefined &&
    heartbeatAgeMs >= ACTIVE_AGENT_STALE_AFTER_MS
  ) {
    return {
      state: 'stale',
      workLabel,
      turnAgeMs:
        status.turnStartedAt !== undefined
          ? Math.max(0, now - status.turnStartedAt)
          : undefined,
      heartbeatAgeMs,
    }
  }

  if (
    status.isActive === true &&
    status.currentWorkKind !== undefined &&
    status.turnStartedAt !== undefined
  ) {
    return {
      state: 'executing-turn',
      workLabel,
      turnAgeMs: Math.max(0, now - status.turnStartedAt),
      heartbeatAgeMs,
    }
  }

  if (
    status.isActive === true &&
    status.currentTasks.length === 0 &&
    status.lastTurnEndedAt !== undefined &&
    Math.max(0, now - status.lastTurnEndedAt) <= ACTIVE_AGENT_SETTLING_AFTER_MS
  ) {
    return {
      state: 'settling',
      heartbeatAgeMs,
      turnAgeMs: Math.max(0, now - status.lastTurnEndedAt),
    }
  }

  return {
    state: status.status,
    workLabel,
    heartbeatAgeMs,
  }
}

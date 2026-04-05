import {
  deriveEffectiveTaskState,
  getAgentDisplayInfo,
  getTaskRuntimeAssociation,
  type AgentStatus,
  type TeamTask,
} from '../team-core/index.js'

export type TaskRuntimeOverview = {
  active: number
  executing: number
  settling: number
  stale: number
}

export type TaskRuntimeSignals = {
  overview: TaskRuntimeOverview
  labelsByTaskId: Record<string, string>
  effectiveStatusByTaskId: Record<string, TeamTask['status']>
}

function createLabel(status: AgentStatus, now: number): string | undefined {
  const display = getAgentDisplayInfo(status, now)
  if (display.state === 'executing-turn') {
    return `working:${status.name}`
  }
  if (display.state === 'settling') {
    return `settling:${status.name}`
  }
  if (display.state === 'stale') {
    return `stale:${status.name}`
  }
  if (status.isActive === true || status.status === 'busy') {
    return `active:${status.name}`
  }
  return undefined
}

export function buildTaskRuntimeSignals(
  tasks: TeamTask[],
  statuses: AgentStatus[],
  now = Date.now(),
): TaskRuntimeSignals {
  const overview: TaskRuntimeOverview = {
    active: 0,
    executing: 0,
    settling: 0,
    stale: 0,
  }

  const labelsByTaskId: Record<string, string> = {}
  const { effectiveStatusByTaskId } = deriveEffectiveTaskState({
    tasks,
    statuses,
    now,
  })

  for (const status of statuses) {
    const display = getAgentDisplayInfo(status, now)
    if (status.isActive === true) {
      overview.active += 1
    }
    if (display.state === 'executing-turn') {
      overview.executing += 1
    }
    if (display.state === 'settling') {
      overview.settling += 1
    }
    if (display.state === 'stale') {
      overview.stale += 1
    }

    const label = createLabel(status, now)
    if (!label) {
      continue
    }

    const association = getTaskRuntimeAssociation(tasks, status, now)
    const taskIds =
      display.state === 'executing-turn' || display.state === 'stale'
        ? association.liveTaskIds
        : display.state === 'settling'
          ? association.settlingTaskIds
          : association.ownedTaskIds

    for (const taskId of taskIds) {
      if (!labelsByTaskId[taskId]) {
        labelsByTaskId[taskId] = label
      }
    }
  }

  return {
    overview,
    labelsByTaskId,
    effectiveStatusByTaskId,
  }
}

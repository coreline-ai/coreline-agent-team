import { getAgentDisplayInfo } from './agent-state.js'
import { isCompletedTaskStatus } from './task-status.js'
import type { AgentStatus, TaskStatus, TeamTask } from './types.js'

export type EffectiveTaskCounts = {
  pending: number
  inProgress: number
  completed: number
}

export type TaskRuntimeAssociation = {
  ownedTaskIds: string[]
  liveTaskIds: string[]
  settlingTaskIds: string[]
}

function isOpenTask(task: TeamTask): boolean {
  return !isCompletedTaskStatus(task.status)
}

function getTaskIndex(tasks: readonly TeamTask[]): {
  tasksById: Map<string, TeamTask>
  unresolvedTaskIds: Set<string>
} {
  const tasksById = new Map<string, TeamTask>()
  const unresolvedTaskIds = new Set<string>()

  for (const task of tasks) {
    tasksById.set(task.id, task)
    if (isOpenTask(task)) {
      unresolvedTaskIds.add(task.id)
    }
  }

  return {
    tasksById,
    unresolvedTaskIds,
  }
}

function getOwnedOpenTaskIds(
  tasks: readonly TeamTask[],
  status: AgentStatus,
  unresolvedTaskIds: ReadonlySet<string>,
): string[] {
  const ownedTaskIds = new Set<string>()

  for (const task of tasks) {
    if (!isOpenTask(task) || !task.owner) {
      continue
    }
    if (task.owner === status.agentId || task.owner === status.name) {
      ownedTaskIds.add(task.id)
    }
  }

  for (const taskId of status.currentTasks) {
    if (unresolvedTaskIds.has(taskId)) {
      ownedTaskIds.add(taskId)
    }
  }

  return [...ownedTaskIds]
}

function getLiveTurnTaskIds(
  tasks: readonly TeamTask[],
  status: AgentStatus,
  unresolvedTaskIds: ReadonlySet<string>,
): string[] {
  if (status.currentWorkKind !== 'task') {
    return []
  }

  if (status.currentTaskId && unresolvedTaskIds.has(status.currentTaskId)) {
    return [status.currentTaskId]
  }

  const unresolvedCurrentTasks = status.currentTasks.filter(taskId =>
    unresolvedTaskIds.has(taskId),
  )
  if (unresolvedCurrentTasks.length === 1) {
    return unresolvedCurrentTasks
  }

  const ownedTaskIds = getOwnedOpenTaskIds(tasks, status, unresolvedTaskIds)
  if (ownedTaskIds.length === 1) {
    return ownedTaskIds
  }

  return []
}

function getSettlingTaskIds(
  tasks: readonly TeamTask[],
  status: AgentStatus,
  now: number,
  tasksById: ReadonlyMap<string, TeamTask>,
  unresolvedTaskIds: ReadonlySet<string>,
): string[] {
  const display = getAgentDisplayInfo(status, now)
  if (display.state !== 'settling') {
    return []
  }

  if (status.currentTaskId) {
    const task = tasksById.get(status.currentTaskId)
    if (task && unresolvedTaskIds.has(task.id)) {
      return [task.id]
    }
  }

  const ownedTaskIds = getOwnedOpenTaskIds(tasks, status, unresolvedTaskIds)
  return ownedTaskIds.length === 1 ? ownedTaskIds : []
}

export function getTaskRuntimeAssociation(
  tasks: readonly TeamTask[],
  status: AgentStatus,
  now = Date.now(),
): TaskRuntimeAssociation {
  const { tasksById, unresolvedTaskIds } = getTaskIndex(tasks)
  return {
    ownedTaskIds: getOwnedOpenTaskIds(tasks, status, unresolvedTaskIds),
    liveTaskIds: getLiveTurnTaskIds(tasks, status, unresolvedTaskIds),
    settlingTaskIds: getSettlingTaskIds(
      tasks,
      status,
      now,
      tasksById,
      unresolvedTaskIds,
    ),
  }
}

export function deriveEffectiveTaskState(input: {
  tasks: readonly TeamTask[]
  statuses: readonly AgentStatus[]
  now?: number
}): {
  counts: EffectiveTaskCounts
  effectiveStatusByTaskId: Record<string, TaskStatus>
  effectiveInProgressTaskIds: string[]
} {
  const now = input.now ?? Date.now()
  const { tasksById, unresolvedTaskIds } = getTaskIndex(input.tasks)
  const effectiveInProgressTaskIds = new Set<string>()
  const effectiveStatusByTaskId: Record<string, TaskStatus> = {}

  for (const task of input.tasks) {
    effectiveStatusByTaskId[task.id] = task.status
  }

  for (const status of input.statuses) {
    const association = {
      ownedTaskIds: getOwnedOpenTaskIds(
        input.tasks,
        status,
        unresolvedTaskIds,
      ),
      liveTaskIds: getLiveTurnTaskIds(
        input.tasks,
        status,
        unresolvedTaskIds,
      ),
      settlingTaskIds: getSettlingTaskIds(
        input.tasks,
        status,
        now,
        tasksById,
        unresolvedTaskIds,
      ),
    }
    for (const taskId of [
      ...association.liveTaskIds,
      ...association.settlingTaskIds,
    ]) {
      const task = tasksById.get(taskId)
      if (!task || !unresolvedTaskIds.has(task.id)) {
        continue
      }
      effectiveInProgressTaskIds.add(task.id)
      effectiveStatusByTaskId[task.id] = 'in_progress'
    }
  }

  const counts: EffectiveTaskCounts = {
    pending: 0,
    inProgress: 0,
    completed: 0,
  }

  for (const task of input.tasks) {
    const effectiveStatus = effectiveStatusByTaskId[task.id]
    if (effectiveStatus === 'completed') {
      counts.completed += 1
      continue
    }
    if (effectiveStatus === 'in_progress') {
      counts.inProgress += 1
      continue
    }
    counts.pending += 1
  }

  return {
    counts,
    effectiveStatusByTaskId,
    effectiveInProgressTaskIds: [...effectiveInProgressTaskIds],
  }
}

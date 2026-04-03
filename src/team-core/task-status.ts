import type { TaskStatus, TeamTask } from './types.js'

const TASK_STATUS_ALIASES: Record<string, TaskStatus> = {
  pending: 'pending',
  todo: 'pending',
  open: 'pending',
  queued: 'pending',
  in_progress: 'in_progress',
  'in-progress': 'in_progress',
  inprogress: 'in_progress',
  working: 'in_progress',
  active: 'in_progress',
  completed: 'completed',
  complete: 'completed',
  done: 'completed',
  finished: 'completed',
  resolved: 'completed',
  success: 'completed',
}

export function normalizeTaskStatus(value: unknown): TaskStatus | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  return TASK_STATUS_ALIASES[value.trim().toLowerCase()]
}

export function isCompletedTaskStatus(value: unknown): boolean {
  return normalizeTaskStatus(value) === 'completed'
}

export function normalizeTeamTask(task: TeamTask): TeamTask {
  const normalizedStatus = normalizeTaskStatus(task.status) ?? 'pending'
  if (normalizedStatus === task.status) {
    return task
  }

  return {
    ...task,
    status: normalizedStatus,
  }
}

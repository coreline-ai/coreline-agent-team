import { readdir, unlink } from 'node:fs/promises'
import type {
  AgentStatus,
  CleanupOrphanedTasksResult,
  ClaimTaskOptions,
  ClaimTaskResult,
  CreateTaskInput,
  TaskStatus,
  TeamCoreOptions,
  TeamTask,
  UnassignTasksResult,
  UpdateTaskInput,
} from './types.js'
import {
  ensureDir,
  ensureFile,
  readJsonFile,
  readTextFile,
  writeJsonFile,
  writeTextFile,
} from './file-utils.js'
import { withFileLock } from './lockfile.js'
import {
  isCompletedTaskStatus,
  normalizeTaskStatus,
  normalizeTeamTask,
} from './task-status.js'
import {
  getTaskListDir,
  getTaskListIdForTeam,
  getTaskListLockPath,
  getTaskPath,
} from './paths.js'
import { readTeamFile } from './team-store.js'

const HIGH_WATER_MARK_FILE = '.highwatermark'
const TASK_LOCK_OPTIONS = {
  retries: {
    retries: 30,
    minTimeout: 5,
    maxTimeout: 100,
  },
}

function getHighWaterMarkPath(
  taskListId: string,
  options: TeamCoreOptions = {},
): string {
  return `${getTaskListDir(taskListId, options)}/${HIGH_WATER_MARK_FILE}`
}

async function ensureTaskListLockFile(
  taskListId: string,
  options: TeamCoreOptions,
): Promise<string> {
  const lockPath = getTaskListLockPath(taskListId, options)
  await ensureTasksDir(taskListId, options)
  await ensureFile(lockPath, '')
  return lockPath
}

async function withTaskListLock<T>(
  taskListId: string,
  options: TeamCoreOptions,
  work: () => Promise<T>,
): Promise<T> {
  const lockPath = await ensureTaskListLockFile(taskListId, options)
  return withFileLock(lockPath, work, TASK_LOCK_OPTIONS)
}

async function readHighWaterMark(
  taskListId: string,
  options: TeamCoreOptions = {},
): Promise<number> {
  const content = (await readTextFile(
    getHighWaterMarkPath(taskListId, options),
    '0',
  )).trim()
  const value = Number.parseInt(content, 10)
  return Number.isNaN(value) ? 0 : value
}

async function writeHighWaterMark(
  taskListId: string,
  value: number,
  options: TeamCoreOptions = {},
): Promise<void> {
  await writeTextFile(getHighWaterMarkPath(taskListId, options), String(value))
}

async function findHighestTaskIdFromFiles(
  taskListId: string,
  options: TeamCoreOptions = {},
): Promise<number> {
  try {
    const files = await readdir(getTaskListDir(taskListId, options))
    return files.reduce((highest, file) => {
      if (!file.endsWith('.json')) {
        return highest
      }
      const id = Number.parseInt(file.replace(/\.json$/, ''), 10)
      if (Number.isNaN(id)) {
        return highest
      }
      return Math.max(highest, id)
    }, 0)
  } catch {
    return 0
  }
}

async function findHighestTaskId(
  taskListId: string,
  options: TeamCoreOptions = {},
): Promise<number> {
  const [fromFiles, fromMark] = await Promise.all([
    findHighestTaskIdFromFiles(taskListId, options),
    readHighWaterMark(taskListId, options),
  ])
  return Math.max(fromFiles, fromMark)
}

export async function ensureTaskListDir(
  taskListId: string,
  options: TeamCoreOptions = {},
): Promise<void> {
  await ensureDir(getTaskListDir(taskListId, options))
}

export async function ensureTasksDir(
  taskListId: string,
  options: TeamCoreOptions = {},
): Promise<void> {
  await ensureTaskListDir(taskListId, options)
}

function isCompleted(task: TeamTask): boolean {
  return isCompletedTaskStatus(task.status)
}

function getTaskOwnerMatches(
  task: TeamTask,
  claimantAgentId: string,
  claimantName?: string,
): boolean {
  return task.owner === claimantAgentId || (claimantName !== undefined && task.owner === claimantName)
}

async function updateTaskUnlocked(
  taskListId: string,
  taskId: string,
  updates: UpdateTaskInput,
  options: TeamCoreOptions,
): Promise<TeamTask | null> {
  const currentTask = await getTask(taskListId, taskId, options)
  if (!currentTask) {
    return null
  }

  const nextTask: TeamTask = {
    ...currentTask,
    ...updates,
  }

  if (updates.status !== undefined) {
    nextTask.status = normalizeTaskStatus(updates.status) ?? currentTask.status
  }

  await writeJsonFile(getTaskPath(taskListId, taskId, options), nextTask)
  return nextTask
}

export async function resetTaskList(
  taskListId: string,
  options: TeamCoreOptions = {},
): Promise<void> {
  await withTaskListLock(taskListId, options, async () => {
    await ensureTaskListDir(taskListId, options)

    const currentHighest = await findHighestTaskIdFromFiles(taskListId, options)
    const previousHighWaterMark = await readHighWaterMark(taskListId, options)
    const nextHighWaterMark = Math.max(currentHighest, previousHighWaterMark)

    const files = await readdir(getTaskListDir(taskListId, options))
    await Promise.all(
      files
        .filter(file => file.endsWith('.json'))
        .map(file => unlink(`${getTaskListDir(taskListId, options)}/${file}`)),
    )

    await writeHighWaterMark(taskListId, nextHighWaterMark, options)
  })
}

export async function createTask(
  taskListId: string,
  taskData: CreateTaskInput,
  options: TeamCoreOptions = {},
): Promise<TeamTask> {
  return withTaskListLock(taskListId, options, async () => {
    await ensureTaskListDir(taskListId, options)

    const highestId = await findHighestTaskId(taskListId, options)
    const id = String(highestId + 1)
    const task: TeamTask = {
      id,
      ...taskData,
    }

    await writeJsonFile(getTaskPath(taskListId, id, options), task)
    return task
  })
}

export async function getTask(
  taskListId: string,
  taskId: string,
  options: TeamCoreOptions = {},
): Promise<TeamTask | null> {
  const task = await readJsonFile<TeamTask | null>(
    getTaskPath(taskListId, taskId, options),
    null,
  )
  return task === null ? null : normalizeTeamTask(task)
}

export async function listTasks(
  taskListId: string,
  options: TeamCoreOptions = {},
): Promise<TeamTask[]> {
  try {
    const files = await readdir(getTaskListDir(taskListId, options))
    const tasks = await Promise.all(
      files
        .filter(file => file.endsWith('.json'))
        .map(async file => {
          const id = file.replace(/\.json$/, '')
          return getTask(taskListId, id, options)
        }),
    )

    return tasks
      .filter((task): task is TeamTask => task !== null)
      .sort((left, right) => Number(left.id) - Number(right.id))
  } catch {
    return []
  }
}

export async function updateTask(
  taskListId: string,
  taskId: string,
  updates: UpdateTaskInput,
  options: TeamCoreOptions = {},
): Promise<TeamTask | null> {
  return withTaskListLock(taskListId, options, async () =>
    updateTaskUnlocked(taskListId, taskId, updates, options),
  )
}

export async function updateTaskStatus(
  taskListId: string,
  taskId: string,
  status: TaskStatus,
  options: TeamCoreOptions = {},
): Promise<TeamTask | null> {
  return updateTask(taskListId, taskId, { status }, options)
}

export async function deleteTask(
  taskListId: string,
  taskId: string,
  options: TeamCoreOptions = {},
): Promise<boolean> {
  return withTaskListLock(taskListId, options, async () => {
    const task = await getTask(taskListId, taskId, options)
    if (!task) {
      return false
    }

    const numericId = Number.parseInt(taskId, 10)
    if (!Number.isNaN(numericId)) {
      const currentMark = await readHighWaterMark(taskListId, options)
      if (numericId > currentMark) {
        await writeHighWaterMark(taskListId, numericId, options)
      }
    }

    await unlink(getTaskPath(taskListId, taskId, options))

    const tasks = await listTasks(taskListId, options)
    for (const candidate of tasks) {
      const nextBlocks = candidate.blocks.filter(id => id !== taskId)
      const nextBlockedBy = candidate.blockedBy.filter(id => id !== taskId)
      if (
        nextBlocks.length !== candidate.blocks.length ||
        nextBlockedBy.length !== candidate.blockedBy.length
      ) {
        await updateTaskUnlocked(
          taskListId,
          candidate.id,
          {
            blocks: nextBlocks,
            blockedBy: nextBlockedBy,
          },
          options,
        )
      }
    }

    return true
  })
}

export async function blockTask(
  taskListId: string,
  fromTaskId: string,
  toTaskId: string,
  options: TeamCoreOptions = {},
): Promise<boolean> {
  return withTaskListLock(taskListId, options, async () => {
    const [fromTask, toTask] = await Promise.all([
      getTask(taskListId, fromTaskId, options),
      getTask(taskListId, toTaskId, options),
    ])

    if (!fromTask || !toTask) {
      return false
    }

    await updateTaskUnlocked(
      taskListId,
      fromTaskId,
      {
        blocks: fromTask.blocks.includes(toTaskId)
          ? fromTask.blocks
          : [...fromTask.blocks, toTaskId],
      },
      options,
    )
    await updateTaskUnlocked(
      taskListId,
      toTaskId,
      {
        blockedBy: toTask.blockedBy.includes(fromTaskId)
          ? toTask.blockedBy
          : [...toTask.blockedBy, fromTaskId],
      },
      options,
    )

    return true
  })
}

export async function claimTask(
  taskListId: string,
  taskId: string,
  claimantAgentId: string,
  claimOptions: ClaimTaskOptions = {},
  options: TeamCoreOptions = {},
): Promise<ClaimTaskResult> {
  return withTaskListLock(taskListId, options, async () => {
    const tasks = await listTasks(taskListId, options)
    const task = tasks.find(item => item.id === taskId)

    if (!task) {
      return { success: false, reason: 'task_not_found' }
    }
    if (task.owner && task.owner !== claimantAgentId) {
      return { success: false, reason: 'already_claimed', task }
    }
    if (isCompleted(task)) {
      return { success: false, reason: 'already_resolved', task }
    }

    const unresolvedTaskIds = new Set(
      tasks.filter(item => !isCompleted(item)).map(item => item.id),
    )
    const blockedByTasks = task.blockedBy.filter(id => unresolvedTaskIds.has(id))
    if (blockedByTasks.length > 0) {
      return { success: false, reason: 'blocked', task, blockedByTasks }
    }

    if (claimOptions.checkAgentBusy) {
      const busyWithTasks = tasks
        .filter(
          item =>
            item.id !== taskId &&
            !isCompleted(item) &&
            item.owner === claimantAgentId,
        )
        .map(item => item.id)

      if (busyWithTasks.length > 0) {
        return {
          success: false,
          reason: 'agent_busy',
          task,
          busyWithTasks,
        }
      }
    }

    const updated = await updateTaskUnlocked(
      taskListId,
      taskId,
      { owner: claimantAgentId },
      options,
    )
    return { success: true, task: updated ?? undefined }
  })
}

export async function getAgentStatuses(
  teamName: string,
  options: TeamCoreOptions = {},
): Promise<AgentStatus[] | null> {
  const teamFile = await readTeamFile(teamName, options)
  if (!teamFile) {
    return null
  }

  const tasks = await listTasks(getTaskListIdForTeam(teamName), options)
  return teamFile.members.map(member => {
    const currentTasks = tasks
      .filter(
        task =>
          !isCompleted(task) &&
          getTaskOwnerMatches(task, member.agentId, member.name),
      )
      .map(task => task.id)
    const executingTurn =
      member.isActive === true &&
      member.runtimeState?.currentWorkKind !== undefined &&
      member.runtimeState?.turnStartedAt !== undefined

    return {
      agentId: member.agentId,
      name: member.name,
      agentType: member.agentType,
      status: currentTasks.length > 0 || executingTurn ? 'busy' : 'idle',
      currentTasks,
      isActive: member.isActive,
      mode: member.mode,
      runtimeKind: member.runtimeState?.runtimeKind,
      lastHeartbeatAt: member.runtimeState?.lastHeartbeatAt,
      currentWorkKind: member.runtimeState?.currentWorkKind,
      currentTaskId: member.runtimeState?.currentTaskId,
      currentWorkSummary: member.runtimeState?.currentWorkSummary,
      turnStartedAt: member.runtimeState?.turnStartedAt,
      lastTurnEndedAt: member.runtimeState?.lastTurnEndedAt,
      sessionId: member.runtimeState?.sessionId,
      lastSessionId: member.runtimeState?.lastSessionId,
    }
  })
}

export async function unassignTeammateTasks(
  taskListId: string,
  teammateId: string,
  teammateName: string,
  reason: 'terminated' | 'shutdown',
  options: TeamCoreOptions = {},
): Promise<UnassignTasksResult> {
  return withTaskListLock(taskListId, options, async () => {
    const tasks = await listTasks(taskListId, options)
    const unresolvedAssignedTasks = tasks.filter(
      task =>
        !isCompleted(task) &&
        getTaskOwnerMatches(task, teammateId, teammateName),
    )

    for (const task of unresolvedAssignedTasks) {
      await updateTaskUnlocked(
        taskListId,
        task.id,
        { owner: undefined, status: 'pending' },
        options,
      )
    }

    const summary =
      unresolvedAssignedTasks.length === 0
        ? `${teammateName} ${reason === 'terminated' ? 'was terminated' : 'shut down'} with no assigned open tasks.`
        : `${teammateName} ${reason === 'terminated' ? 'was terminated' : 'shut down'}; unassigned ${unresolvedAssignedTasks.length} open task(s).`

    return {
      unassignedTasks: unresolvedAssignedTasks.map(task => ({
        id: task.id,
        subject: task.subject,
      })),
      notificationMessage: summary,
    }
  })
}

export async function cleanupOrphanedTasks(
  teamName: string,
  options: TeamCoreOptions = {},
): Promise<CleanupOrphanedTasksResult> {
  const taskListId = getTaskListIdForTeam(teamName)
  const teamFile = await readTeamFile(teamName, options)

  if (!teamFile) {
    return {
      cleanedTaskIds: [],
      notificationMessage: `Team "${teamName}" does not exist.`,
    }
  }

  return withTaskListLock(taskListId, options, async () => {
    const tasks = await listTasks(taskListId, options)
    const activeOwners = new Set(
      teamFile.members
        .filter(member => member.isActive === true)
        .flatMap(member => [member.agentId, member.name]),
    )
    const orphanedTasks = tasks.filter(
      task =>
        !isCompleted(task) &&
        task.owner !== undefined &&
        !activeOwners.has(task.owner),
    )

    for (const task of orphanedTasks) {
      await updateTaskUnlocked(
        taskListId,
        task.id,
        {
          owner: undefined,
          status: 'pending',
        },
        options,
      )
    }

    return {
      cleanedTaskIds: orphanedTasks.map(task => task.id),
      notificationMessage:
        orphanedTasks.length === 0
          ? 'No orphaned open tasks found.'
          : `Cleaned ${orphanedTasks.length} orphaned open task(s).`,
    }
  })
}

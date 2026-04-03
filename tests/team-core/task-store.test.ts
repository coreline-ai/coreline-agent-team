import assert from 'node:assert/strict'
import test from 'node:test'
import {
  blockTask,
  claimTask,
  createTask,
  createTeam,
  deleteTask,
  getAgentStatuses,
  getTaskPath,
  getTask,
  getTaskListIdForTeam,
  listTasks,
  upsertTeamMember,
  unassignTeammateTasks,
  updateTask,
  writeJsonFile,
} from '../../src/team-core/index.js'
import { createTempOptions } from '../test-helpers.js'

test('task store allocates ids with a high-water mark', async t => {
  const options = await createTempOptions(t)
  const taskListId = getTaskListIdForTeam('alpha team')

  const first = await createTask(
    taskListId,
    {
      subject: 'First',
      description: 'One',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )
  const second = await createTask(
    taskListId,
    {
      subject: 'Second',
      description: 'Two',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  assert.equal(first.id, '1')
  assert.equal(second.id, '2')
  await deleteTask(taskListId, '2', options)

  const third = await createTask(
    taskListId,
    {
      subject: 'Third',
      description: 'Three',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )
  assert.equal(third.id, '3')
})

test('task store blocks and claims tasks with busy checks', async t => {
  const options = await createTempOptions(t)
  const taskListId = getTaskListIdForTeam('alpha team')

  const task1 = await createTask(
    taskListId,
    {
      subject: 'Task 1',
      description: 'First',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )
  const task2 = await createTask(
    taskListId,
    {
      subject: 'Task 2',
      description: 'Second',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )
  const task3 = await createTask(
    taskListId,
    {
      subject: 'Task 3',
      description: 'Third',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  assert.equal(await blockTask(taskListId, task1.id, task2.id, options), true)

  const blocked = await claimTask(taskListId, task2.id, 'researcher@alpha', {}, options)
  assert.equal(blocked.success, false)
  assert.equal(blocked.reason, 'blocked')

  const claimed = await claimTask(taskListId, task1.id, 'researcher@alpha', {}, options)
  assert.equal(claimed.success, true)
  await updateTask(taskListId, task1.id, { status: 'in_progress' }, options)

  const busy = await claimTask(
    taskListId,
    task3.id,
    'researcher@alpha',
    { checkAgentBusy: true },
    options,
  )
  assert.equal(busy.success, false)
  assert.equal(busy.reason, 'agent_busy')
})

test('task store reports agent statuses and can unassign tasks', async t => {
  const options = await createTempOptions(t)
  const taskListId = getTaskListIdForTeam('alpha team')

  await createTeam(
    {
      teamName: 'alpha team',
      leadAgentId: 'team-lead@alpha team',
      leadMember: {
        name: 'team-lead',
        agentType: 'team-lead',
        cwd: '/tmp/project',
        subscriptions: [],
      },
    },
    options,
  )

  const task = await createTask(
    taskListId,
    {
      subject: 'Assigned',
      description: 'Assigned task',
      status: 'in_progress',
      owner: 'researcher@alpha team',
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  await upsertTeamMember(
    'alpha team',
    {
      agentId: 'researcher@alpha team',
      name: 'researcher',
      cwd: '/tmp/project',
      subscriptions: [],
      joinedAt: Date.now(),
      backendType: 'in-process',
    },
    options,
  )

  const statusesBefore = await getAgentStatuses('alpha team', options)
  assert.equal(statusesBefore?.find(status => status.name === 'researcher')?.status, 'busy')

  const result = await unassignTeammateTasks(
    taskListId,
    'researcher@alpha team',
    'researcher',
    'shutdown',
    options,
  )
  assert.equal(result.unassignedTasks.length, 1)

  const updatedTask = await getTask(taskListId, task.id, options)
  assert.equal(updatedTask?.owner, undefined)
  assert.equal(updatedTask?.status, 'pending')

  const statusesAfter = await getAgentStatuses('alpha team', options)
  assert.equal(statusesAfter?.find(status => status.name === 'researcher')?.status, 'idle')
})

test('task creation is lock-safe under concurrent writes', async t => {
  const options = await createTempOptions(t)
  const taskListId = getTaskListIdForTeam('alpha team')

  const tasks = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      createTask(
        taskListId,
        {
          subject: `Task ${index}`,
          description: `Task ${index}`,
          status: 'pending',
          blocks: [],
          blockedBy: [],
        },
        options,
      ),
    ),
  )

  assert.equal(tasks.length, 8)
  assert.equal(new Set(tasks.map(task => task.id)).size, 8)
  assert.equal((await listTasks(taskListId, options)).length, 8)
})

test('task store normalizes legacy done status on read and blocked-task resolution', async t => {
  const options = await createTempOptions(t)
  const taskListId = getTaskListIdForTeam('alpha team')

  const task1 = await createTask(
    taskListId,
    {
      subject: 'Legacy completed task',
      description: 'Written by an older runtime turn',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  await writeJsonFile(
    getTaskPath(taskListId, task1.id, options),
    {
      ...task1,
      status: 'done',
    } as unknown as typeof task1,
  )

  const task2 = await createTask(
    taskListId,
    {
      subject: 'Follow-up task',
      description: 'Should unblock once legacy done is treated as completed',
      status: 'pending',
      blocks: [],
      blockedBy: [task1.id],
    },
    options,
  )

  const normalizedTask1 = await getTask(taskListId, task1.id, options)
  assert.equal(normalizedTask1?.status, 'completed')

  const claim = await claimTask(taskListId, task2.id, 'researcher@alpha', {}, options)
  assert.equal(claim.success, true)
  assert.equal(claim.task?.status, 'pending')
  assert.equal(claim.task?.owner, 'researcher@alpha')
})

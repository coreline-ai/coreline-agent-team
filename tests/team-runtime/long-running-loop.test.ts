import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createTask,
  createTeam,
  getTask,
  getTaskListIdForTeam,
  upsertTeamMember,
} from '../../src/team-core/index.js'
import {
  createFunctionRuntimeTurnBridge,
  createLocalRuntimeAdapter,
  spawnInProcessTeammate,
} from '../../src/team-runtime/index.js'
import { createTempOptions, sleep } from '../test-helpers.js'

async function createTeamWithWorker(
  options: Awaited<ReturnType<typeof createTempOptions>>,
  cwd: string,
): Promise<void> {
  await createTeam(
    {
      teamName: 'alpha team',
      leadAgentId: 'team-lead@alpha team',
      leadMember: {
        name: 'team-lead',
        agentType: 'team-lead',
        cwd,
        subscriptions: [],
      },
    },
    options,
  )

  await upsertTeamMember(
    'alpha team',
    {
      agentId: 'researcher@alpha team',
      name: 'researcher',
      agentType: 'researcher',
      cwd,
      subscriptions: [],
      joinedAt: Date.now(),
      backendType: 'in-process',
      isActive: true,
    },
    options,
  )
}

test('long-running worker loop can poll idle and later consume a newly created task', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'
  await createTeamWithWorker(options, cwd)

  const adapter = createLocalRuntimeAdapter({
    bridge: createFunctionRuntimeTurnBridge(async input => {
      if (input.workItem.kind !== 'task') {
        return
      }

      return {
        summary: 'late task completed',
        taskStatus: 'completed',
        completedTaskId: input.workItem.task.id,
        completedStatus: 'resolved',
        stop: true,
      }
    }),
  })

  const spawnResult = await spawnInProcessTeammate(
    {
      name: 'researcher',
      teamName: 'alpha team',
      prompt: 'Stay ready for work',
      cwd,
      runtimeOptions: {
        maxIterations: 20,
        pollIntervalMs: 5,
      },
    },
    options,
    adapter,
  )

  await sleep(20)
  await createTask(
    getTaskListIdForTeam('alpha team'),
    {
      subject: 'Investigate issue',
      description: 'Review the failing build',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  const loopResult = await spawnResult.handle?.join?.()
  const task = await getTask(getTaskListIdForTeam('alpha team'), '1', options)

  assert.equal(loopResult?.processedWorkItems, 1)
  assert.equal(task?.status, 'completed')
})


test('worker loop can claim and complete multiple tasks across iterations', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'
  await createTeamWithWorker(options, cwd)

  await createTask(
    getTaskListIdForTeam('alpha team'),
    {
      subject: 'Investigate issue',
      description: 'Review the failing build',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  await createTask(
    getTaskListIdForTeam('alpha team'),
    {
      subject: 'Write summary',
      description: 'Summarize the findings',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  const adapter = createLocalRuntimeAdapter({
    bridge: createFunctionRuntimeTurnBridge(async input => {
      if (input.workItem.kind !== 'task') {
        return
      }

      return {
        summary: `completed task ${input.workItem.task.id}`,
        taskStatus: 'completed',
        completedTaskId: input.workItem.task.id,
        completedStatus: 'resolved',
      }
    }),
  })

  const spawnResult = await spawnInProcessTeammate(
    {
      name: 'researcher',
      teamName: 'alpha team',
      prompt: 'Process queued tasks',
      cwd,
      runtimeOptions: {
        maxIterations: 2,
      },
    },
    options,
    adapter,
  )

  const loopResult = await spawnResult.handle?.join?.()
  const firstTask = await getTask(getTaskListIdForTeam('alpha team'), '1', options)
  const secondTask = await getTask(getTaskListIdForTeam('alpha team'), '2', options)

  assert.equal(loopResult?.processedWorkItems, 2)
  assert.equal(firstTask?.status, 'completed')
  assert.equal(secondTask?.status, 'completed')
})

test('worker loop ignores stop=true on ordinary task turns and continues to the next task', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'
  await createTeamWithWorker(options, cwd)

  await createTask(
    getTaskListIdForTeam('alpha team'),
    {
      subject: 'Write plan',
      description: 'Create docs/plan.md',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  await createTask(
    getTaskListIdForTeam('alpha team'),
    {
      subject: 'Write architecture',
      description: 'Create docs/architecture.md',
      status: 'pending',
      blocks: [],
      blockedBy: ['1'],
    },
    options,
  )

  const adapter = createLocalRuntimeAdapter({
    bridge: createFunctionRuntimeTurnBridge(async input => {
      if (input.workItem.kind !== 'task') {
        return
      }

      return {
        summary: `completed task ${input.workItem.task.id}`,
        taskStatus: 'completed',
        completedTaskId: input.workItem.task.id,
        completedStatus: 'resolved',
        stop: true,
      }
    }),
  })

  const spawnResult = await spawnInProcessTeammate(
    {
      name: 'researcher',
      teamName: 'alpha team',
      prompt: 'Process queued tasks',
      cwd,
      runtimeOptions: {
        maxIterations: 2,
      },
    },
    options,
    adapter,
  )

  const loopResult = await spawnResult.handle?.join?.()
  const firstTask = await getTask(getTaskListIdForTeam('alpha team'), '1', options)
  const secondTask = await getTask(getTaskListIdForTeam('alpha team'), '2', options)

  assert.equal(loopResult?.processedWorkItems, 2)
  assert.equal(firstTask?.status, 'completed')
  assert.equal(secondTask?.status, 'completed')
})

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createTask,
  createTeam,
  createShutdownRequestMessage,
  getTask,
  getTaskListIdForTeam,
  readTeamFile,
  upsertTeamMember,
  writeToMailbox,
} from '../../src/team-core/index.js'
import {
  createFunctionRuntimeTurnBridge,
  createLocalRuntimeAdapter,
  createRuntimeContext,
  requestPlanApproval,
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

test('shutdown during active work unassigns the claimed task and stops the worker', async t => {
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

  const adapter = createLocalRuntimeAdapter({
    bridge: createFunctionRuntimeTurnBridge(async input => {
      if (input.workItem.kind === 'task') {
        return {
          summary: 'working on task',
          taskStatus: 'in_progress',
        }
      }

      return {
        summary: 'shutdown accepted',
        shutdown: {
          approved: true,
        },
        stop: true,
      }
    }),
  })

  const spawnResult = await spawnInProcessTeammate(
    {
      name: 'researcher',
      teamName: 'alpha team',
      prompt: 'Investigate issues',
      cwd,
      runtimeOptions: {
        maxIterations: 10,
        pollIntervalMs: 5,
      },
    },
    options,
    adapter,
  )

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const task = await getTask(getTaskListIdForTeam('alpha team'), '1', options)
    if (task?.status === 'in_progress') {
      break
    }
    await sleep(5)
  }

  const shutdownRequest = createShutdownRequestMessage({
    requestId: 'shutdown-1',
    from: 'team-lead',
    reason: 'wrap up now',
  })
  await writeToMailbox(
    'alpha team',
    'researcher',
    {
      from: 'team-lead',
      text: JSON.stringify(shutdownRequest),
      timestamp: shutdownRequest.timestamp,
      summary: 'shutdown',
    },
    options,
  )

  const loopResult = await spawnResult.handle?.join?.()
  const task = await getTask(getTaskListIdForTeam('alpha team'), '1', options)

  assert.equal(loopResult?.stopReason, 'shutdown')
  assert.equal(task?.status, 'pending')
  assert.equal(task?.owner, undefined)
})

test('requestPlanApproval rejects when the runtime is aborted before approval arrives', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'
  await createTeamWithWorker(options, cwd)

  const runtimeContext = createRuntimeContext({
    agentId: 'researcher@alpha team',
    agentName: 'researcher',
    teamName: 'alpha team',
  })

  const approvalPromise = requestPlanApproval(
    {
      name: 'researcher',
      teamName: 'alpha team',
      prompt: 'Wait for plan approval',
      cwd,
      planModeRequired: true,
    },
    {
      runtimeContext,
      coreOptions: options,
      requestId: 'plan-timeout-1',
      planFilePath: `${cwd}/PLAN.md`,
      planContent: '# Plan',
      pollIntervalMs: 5,
    },
  )

  await sleep(20)
  runtimeContext.abortController.abort()

  await assert.rejects(
    approvalPromise,
    /Plan approval wait aborted/,
  )
})

test('worker failure returns claimed work to pending and marks the teammate inactive', async t => {
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

  const adapter = createLocalRuntimeAdapter({
    bridge: createFunctionRuntimeTurnBridge(async input => {
      if (input.workItem.kind !== 'task') {
        return
      }

      throw new Error('bridge crashed mid-task')
    }),
  })

  const spawnResult = await spawnInProcessTeammate(
    {
      name: 'researcher',
      teamName: 'alpha team',
      prompt: 'Investigate issues',
      cwd,
      runtimeOptions: {
        maxIterations: 5,
        pollIntervalMs: 5,
      },
    },
    options,
    adapter,
  )

  const loopResult = await spawnResult.handle?.join?.()
  const task = await getTask(getTaskListIdForTeam('alpha team'), '1', options)
  const stored = await readTeamFile('alpha team', options)
  const teammate = stored?.members.find(member => member.name === 'researcher')

  assert.equal(loopResult?.stopReason, 'aborted')
  assert.equal(task?.status, 'pending')
  assert.equal(task?.owner, undefined)
  assert.equal(teammate?.isActive, false)
  assert.equal(teammate?.runtimeState?.lastExitReason, 'aborted')
  assert.equal(teammate?.runtimeState?.currentWorkKind, undefined)
  assert.equal(teammate?.runtimeState?.currentTaskId, undefined)
  assert.equal(teammate?.runtimeState?.turnStartedAt, undefined)
  assert.equal(teammate?.runtimeState?.lastTurnEndedAt !== undefined, true)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createTask,
  createTeam,
  createShutdownRequestMessage,
  getTask,
  getTaskListIdForTeam,
  isIdleNotification,
  isPlanApprovalRequest,
  isShutdownApproved,
  readMailbox,
  upsertTeamMember,
  writeToMailbox,
} from '../../src/team-core/index.js'
import { runApprovePlanCommand } from '../../src/team-cli/commands/approve-plan.js'
import {
  createRuntimeContext,
  requestPlanApproval,
  runInProcessTeammateOnce,
} from '../../src/team-runtime/index.js'
import { createTempOptions } from '../test-helpers.js'

async function createTeamWithWorker(
  rootDirOptions: Awaited<ReturnType<typeof createTempOptions>>,
): Promise<void> {
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
    rootDirOptions,
  )

  await upsertTeamMember(
    'alpha team',
    {
      agentId: 'researcher@alpha team',
      name: 'researcher',
      agentType: 'researcher',
      cwd: '/tmp/project',
      subscriptions: [],
      joinedAt: Date.now(),
      backendType: 'in-process',
      isActive: true,
    },
    rootDirOptions,
  )
}

function createWorkerRuntimeContext() {
  return createRuntimeContext({
    agentId: 'researcher@alpha team',
    agentName: 'researcher',
    teamName: 'alpha team',
  })
}

test('runInProcessTeammateOnce prioritizes leader messages over task fallback', async t => {
  const options = await createTempOptions(t)
  await createTeamWithWorker(options)

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

  await writeToMailbox(
    'alpha team',
    'researcher',
    {
      from: 'team-lead',
      text: 'Please review the newest failure first',
      timestamp: new Date().toISOString(),
      summary: 'Leader follow-up',
    },
    options,
  )

  const result = await runInProcessTeammateOnce(
    {
      name: 'researcher',
      teamName: 'alpha team',
      prompt: 'Investigate issues',
      cwd: '/tmp/project',
    },
    {
      runtimeContext: createWorkerRuntimeContext(),
      coreOptions: options,
    },
  )

  assert.equal(result.workItem?.kind, 'leader_message')

  const task = await getTask(getTaskListIdForTeam('alpha team'), '1', options)
  assert.equal(task?.owner, undefined)
  assert.equal(task?.status, 'pending')

  const leaderMailbox = await readMailbox('alpha team', 'team-lead', options)
  const idleMessage = leaderMailbox
    .map(message => isIdleNotification(message.text))
    .find(message => message !== null)
  assert.equal(idleMessage?.type, 'idle_notification')
})

test('runInProcessTeammateOnce auto-claims a pending task when no messages exist', async t => {
  const options = await createTempOptions(t)
  await createTeamWithWorker(options)

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

  const result = await runInProcessTeammateOnce(
    {
      name: 'researcher',
      teamName: 'alpha team',
      prompt: 'Investigate issues',
      cwd: '/tmp/project',
    },
    {
      runtimeContext: createWorkerRuntimeContext(),
      coreOptions: options,
    },
  )

  assert.equal(result.workItem?.kind, 'task')

  const task = await getTask(getTaskListIdForTeam('alpha team'), '1', options)
  assert.equal(task?.owner, 'researcher@alpha team')
  assert.equal(task?.status, 'in_progress')
})

test('runInProcessTeammateOnce clears task ownership when a handler returns pending', async t => {
  const options = await createTempOptions(t)
  await createTeamWithWorker(options)

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

  await runInProcessTeammateOnce(
    {
      name: 'researcher',
      teamName: 'alpha team',
      prompt: 'Investigate issues',
      cwd: '/tmp/project',
    },
    {
      runtimeContext: createWorkerRuntimeContext(),
      coreOptions: options,
      async workHandler(workItem) {
        assert.equal(workItem.kind, 'task')
        return {
          summary: 'returning task to the queue',
          taskStatus: 'pending',
          idleReason: 'failed',
          failureReason: 'temporary backend failure',
        }
      },
    },
  )

  const task = await getTask(getTaskListIdForTeam('alpha team'), '1', options)
  assert.equal(task?.status, 'pending')
  assert.equal(task?.owner, undefined)
})

test('runInProcessTeammateOnce approves shutdown requests and unassigns open tasks', async t => {
  const options = await createTempOptions(t)
  await createTeamWithWorker(options)

  await createTask(
    getTaskListIdForTeam('alpha team'),
    {
      subject: 'Investigate issue',
      description: 'Review the failing build',
      status: 'in_progress',
      owner: 'researcher@alpha team',
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  const shutdownRequest = createShutdownRequestMessage({
    requestId: 'shutdown-1',
    from: 'team-lead',
    reason: 'all done',
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

  const runtimeContext = createWorkerRuntimeContext()
  const result = await runInProcessTeammateOnce(
    {
      name: 'researcher',
      teamName: 'alpha team',
      prompt: 'Investigate issues',
      cwd: '/tmp/project',
    },
    {
      runtimeContext,
      coreOptions: options,
    },
  )

  assert.equal(result.workItem?.kind, 'shutdown_request')
  assert.equal(result.stopRequested, true)
  assert.equal(runtimeContext.abortController.signal.aborted, true)

  const task = await getTask(getTaskListIdForTeam('alpha team'), '1', options)
  assert.equal(task?.owner, undefined)
  assert.equal(task?.status, 'pending')

  const leaderMailbox = await readMailbox('alpha team', 'team-lead', options)
  const shutdownApproved = leaderMailbox
    .map(message => isShutdownApproved(message.text))
    .find(message => message !== null)
  assert.equal(shutdownApproved?.type, 'shutdown_approved')
})

test('requestPlanApproval waits for a matching leader response', async t => {
  const options = await createTempOptions(t)
  await createTeamWithWorker(options)

  const runtimeContext = createWorkerRuntimeContext()
  const approvalPromise = requestPlanApproval(
    {
      name: 'researcher',
      teamName: 'alpha team',
      prompt: 'Plan first',
      cwd: '/tmp/project',
      planModeRequired: true,
    },
    {
      runtimeContext,
      coreOptions: options,
      requestId: 'plan-1',
      planFilePath: '/tmp/project/PLAN.md',
      planContent: '# Plan',
      pollIntervalMs: 5,
    },
  )

  let planRequestSeen = false
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const leaderMailbox = await readMailbox('alpha team', 'team-lead', options)
    planRequestSeen = leaderMailbox.some(
      message => isPlanApprovalRequest(message.text)?.requestId === 'plan-1',
    )
    if (planRequestSeen) {
      break
    }
    await new Promise(resolve => {
      setTimeout(resolve, 5)
    })
  }

  assert.equal(planRequestSeen, true)

  await runApprovePlanCommand('alpha team', 'researcher', 'plan-1', options)

  const response = await approvalPromise
  assert.equal(response.approved, true)
  assert.equal(response.requestId, 'plan-1')
})

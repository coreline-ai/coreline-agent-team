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
  readUnreadMessages,
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

test('runInProcessTeammateOnce can complete a preassigned task from a leader message result', async t => {
  const options = await createTempOptions(t)
  await createTeamWithWorker(options)

  await createTask(
    getTaskListIdForTeam('alpha team'),
    {
      subject: 'Plan the work',
      description: 'The researcher may complete this directly from the leader request',
      status: 'pending',
      owner: 'researcher@alpha team',
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
      text: 'Please complete the planning task and report back',
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
      workHandler: async workItem => {
        assert.equal(workItem.kind, 'leader_message')
        return {
          summary: 'Completed the preassigned planning task',
          completedTaskId: '1',
          completedStatus: 'resolved',
        }
      },
    },
  )

  assert.equal(result.workItem?.kind, 'leader_message')

  const task = await getTask(getTaskListIdForTeam('alpha team'), '1', options)
  assert.equal(task?.status, 'completed')
  assert.equal(task?.owner, 'researcher@alpha team')
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

test('runInProcessTeammateOnce normalizes legacy done task results to completed', async t => {
  const options = await createTempOptions(t)
  await createTeamWithWorker(options)

  await createTask(
    getTaskListIdForTeam('alpha team'),
    {
      subject: 'Implement backend slice',
      description: 'A legacy runtime may report done instead of completed',
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
      prompt: 'Implement the assigned task',
      cwd: '/tmp/project',
    },
    {
      runtimeContext: createWorkerRuntimeContext(),
      coreOptions: options,
      workHandler: async workItem => {
        assert.equal(workItem.kind, 'task')
        return {
          summary: 'Finished the implementation task',
          taskStatus: 'done' as never,
        }
      },
    },
  )

  assert.equal(result.workItem?.kind, 'task')

  const task = await getTask(getTaskListIdForTeam('alpha team'), '1', options)
  assert.equal(task?.status, 'completed')
})

test('runInProcessTeammateOnce can pick up a pending task preassigned to the same agent', async t => {
  const options = await createTempOptions(t)
  await createTeamWithWorker(options)

  await createTask(
    getTaskListIdForTeam('alpha team'),
    {
      subject: 'Handle assigned work',
      description: 'Only the researcher should pick this up',
      status: 'pending',
      owner: 'researcher@alpha team',
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

test('runInProcessTeammateOnce skips a pending task preassigned to a different agent', async t => {
  const options = await createTempOptions(t)
  await createTeamWithWorker(options)

  await upsertTeamMember(
    'alpha team',
    {
      agentId: 'reviewer@alpha team',
      name: 'reviewer',
      agentType: 'reviewer',
      cwd: '/tmp/project',
      subscriptions: [],
      joinedAt: Date.now(),
      backendType: 'in-process',
      isActive: true,
    },
    options,
  )

  await createTask(
    getTaskListIdForTeam('alpha team'),
    {
      subject: 'Review output',
      description: 'Only the reviewer should pick this up',
      status: 'pending',
      owner: 'reviewer@alpha team',
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

  assert.equal(result.workItem, null)

  const task = await getTask(getTaskListIdForTeam('alpha team'), '1', options)
  assert.equal(task?.owner, 'reviewer@alpha team')
  assert.equal(task?.status, 'pending')
})

test('runInProcessTeammateOnce skips a pending task when task scope does not match teammate scope', async t => {
  const options = await createTempOptions(t)
  await createTeamWithWorker(options)

  await createTask(
    getTaskListIdForTeam('alpha team'),
    {
      subject: 'Implement frontend shell',
      description: 'Build frontend/ shell and interactions.',
      status: 'pending',
      owner: 'frontend@alpha team',
      blocks: [],
      blockedBy: [],
      metadata: {
        ownership: {
          scopedPaths: ['frontend/**'],
          scopeSource: 'metadata',
        },
      },
    },
    options,
  )

  const result = await runInProcessTeammateOnce(
    {
      name: 'backend-impl',
      teamName: 'alpha team',
      prompt: 'Implement backend work',
      cwd: '/tmp/project',
    },
    {
      runtimeContext: createRuntimeContext({
        agentId: 'backend-impl@alpha team',
        agentName: 'backend-impl',
        teamName: 'alpha team',
      }),
      coreOptions: options,
    },
  )

  assert.equal(result.workItem, null)

  const task = await getTask(getTaskListIdForTeam('alpha team'), '1', options)
  assert.equal(task?.status, 'pending')
  assert.equal(task?.owner, 'frontend@alpha team')
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

test('runInProcessTeammateOnce acknowledges mailbox messages only after successful handling', async t => {
  const options = await createTempOptions(t)
  await createTeamWithWorker(options)

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
        assert.equal(workItem.kind, 'leader_message')
        return {
          summary: 'message processed',
        }
      },
    },
  )

  const unread = await readUnreadMessages('alpha team', 'researcher', options)
  assert.equal(unread.length, 0)
})

test('runInProcessTeammateOnce leaves mailbox messages unread when handling fails', async t => {
  const options = await createTempOptions(t)
  await createTeamWithWorker(options)

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

  await assert.rejects(
    runInProcessTeammateOnce(
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
          assert.equal(workItem.kind, 'leader_message')
          throw new Error('simulated failure')
        },
      },
    ),
    /simulated failure/,
  )

  const unread = await readUnreadMessages('alpha team', 'researcher', options)
  assert.equal(unread.length, 1)
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

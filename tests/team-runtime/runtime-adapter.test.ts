import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createTask,
  createTeam,
  getAgentStatuses,
  getTask,
  getTaskListIdForTeam,
  isIdleNotification,
  isPlanApprovalRequest,
  readMailbox,
  readTeamFile,
  upsertTeamMember,
} from '../../src/team-core/index.js'
import { runApprovePlanCommand } from '../../src/team-cli/commands/approve-plan.js'
import {
  createFunctionRuntimeTurnBridge,
  createLocalRuntimeAdapter,
  createMockRuntimeAdapter,
  renderWorkItemPrompt,
  spawnInProcessTeammate,
} from '../../src/team-runtime/index.js'
import { createTempOptions, sleep } from '../test-helpers.js'

async function createTeamWithWorker(
  options: Awaited<ReturnType<typeof createTempOptions>>,
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
    options,
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
    options,
  )
}

test('mock adapter sees runtimeOptions forwarded through spawn config', async t => {
  const options = await createTempOptions(t)

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

  let seenMaxIterations: number | undefined
  const adapter = createMockRuntimeAdapter(async config => {
    seenMaxIterations = config.runtimeOptions?.maxIterations
    return {
      success: true,
      agentId: `${config.name}@${config.teamName}`,
    }
  })

  const result = await spawnInProcessTeammate(
    {
      name: 'researcher',
      teamName: 'alpha team',
      prompt: 'Investigate the failure',
      cwd: '/tmp/project',
      runtimeOptions: {
        maxIterations: 3,
      },
    },
    options,
    adapter,
  )

  assert.equal(result.success, true)
  assert.equal(seenMaxIterations, 3)
})

test('local runtime adapter executes a task bridge and join waits for completion', async t => {
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

  const prompts: string[] = []
  const adapter = createLocalRuntimeAdapter({
    bridge: createFunctionRuntimeTurnBridge(async input => {
      prompts.push(input.prompt)
      return {
        summary: 'Task resolved by local runtime bridge',
        assistantResponse: 'Done with task #1',
        assistantSummary: 'task complete',
        taskStatus: 'completed',
        completedTaskId:
          input.workItem.kind === 'task' ? input.workItem.task.id : undefined,
        completedStatus: 'resolved',
      }
    }),
  })

  const result = await spawnInProcessTeammate(
    {
      name: 'researcher',
      teamName: 'alpha team',
      prompt: 'Investigate the failure',
      cwd: '/tmp/project',
      runtimeOptions: {
        maxIterations: 1,
      },
    },
    options,
    adapter,
  )

  assert.equal(result.success, true)

  const loopResult = await result.handle?.join?.()
  assert.equal(loopResult?.processedWorkItems, 1)
  assert.equal(loopResult?.stopReason, 'completed')

  const task = await getTask(getTaskListIdForTeam('alpha team'), '1', options)
  assert.equal(task?.status, 'completed')
  assert.equal(task?.owner, 'researcher@alpha team')

  const leaderMailbox = await readMailbox('alpha team', 'team-lead', options)
  assert.equal(
    leaderMailbox.some(message => message.text === 'Done with task #1'),
    true,
  )
  assert.equal(
    leaderMailbox.some(
      message => isIdleNotification(message.text)?.completedTaskId === '1',
    ),
    true,
  )

  const stored = await readTeamFile('alpha team', options)
  assert.equal(
    stored?.members.find(member => member.name === 'researcher')?.isActive,
    false,
  )
  assert.match(prompts[0] ?? '', /Task #1: Investigate issue/)
  assert.match(
    renderWorkItemPrompt(
      {
        name: 'researcher',
        teamName: 'alpha team',
        prompt: 'Investigate the failure',
        cwd: '/tmp/project',
      },
      {
        kind: 'task',
        task: task!,
      },
    ),
    /Base Instructions/,
  )
})

test('local runtime adapter infers task completion from completedTaskId even when taskStatus and summary are omitted', async t => {
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

  const adapter = createLocalRuntimeAdapter({
    bridge: createFunctionRuntimeTurnBridge(async input => {
      if (input.workItem.kind !== 'task') {
        return
      }

      return {
        assistantResponse: 'Completed without explicit summary field.',
        assistantSummary: 'implicit completion',
        completedTaskId: input.workItem.task.id,
        completedStatus: 'resolved',
      }
    }),
  })

  const result = await spawnInProcessTeammate(
    {
      name: 'researcher',
      teamName: 'alpha team',
      prompt: 'Investigate the failure',
      cwd: '/tmp/project',
      runtimeOptions: {
        maxIterations: 1,
      },
    },
    options,
    adapter,
  )

  const loopResult = await result.handle?.join?.()
  const task = await getTask(getTaskListIdForTeam('alpha team'), '1', options)
  const leaderMailbox = await readMailbox('alpha team', 'team-lead', options)
  const idleNotification = leaderMailbox
    .map(message => isIdleNotification(message.text))
    .find(message => message !== null)

  assert.equal(loopResult?.processedWorkItems, 1)
  assert.equal(task?.status, 'completed')
  assert.equal(idleNotification?.summary, 'implicit completion')
  assert.equal(
    leaderMailbox.some(
      message => message.text === 'Completed without explicit summary field.',
    ),
    true,
  )
})

test('local runtime adapter returns unresolved owned tasks to pending when the worker exits', async t => {
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

  const adapter = createLocalRuntimeAdapter({
    bridge: createFunctionRuntimeTurnBridge(async input => {
      if (input.workItem.kind !== 'task') {
        return
      }

      return {
        summary: 'picked up work but did not finish in time',
        taskStatus: 'in_progress',
      }
    }),
  })

  const result = await spawnInProcessTeammate(
    {
      name: 'researcher',
      teamName: 'alpha team',
      prompt: 'Investigate the failure',
      cwd: '/tmp/project',
      runtimeOptions: {
        maxIterations: 1,
      },
    },
    options,
    adapter,
  )

  const loopResult = await result.handle?.join?.()
  const task = await getTask(getTaskListIdForTeam('alpha team'), '1', options)
  const stored = await readTeamFile('alpha team', options)

  assert.equal(loopResult?.stopReason, 'completed')
  assert.equal(task?.status, 'pending')
  assert.equal(task?.owner, undefined)
  assert.equal(
    stored?.members.find(member => member.name === 'researcher')?.isActive,
    false,
  )
})

test('local runtime adapter bridge can request plan approval and resume execution', async t => {
  const options = await createTempOptions(t)
  await createTeamWithWorker(options)

  await createTask(
    getTaskListIdForTeam('alpha team'),
    {
      subject: 'Draft a plan',
      description: 'Prepare an implementation plan first',
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

      const approval = await input.context.requestPlanApproval({
        requestId: 'bridge-plan-1',
        planFilePath: '/tmp/project/PLAN.md',
        planContent: '# Plan',
        pollIntervalMs: 5,
      })

      return {
        summary: approval.approved
          ? 'Plan approved by team lead'
          : 'Plan rejected by team lead',
        assistantResponse: approval.approved
          ? 'Plan approved, continuing task.'
          : 'Plan rejected, pausing work.',
        assistantSummary: 'plan approval update',
        taskStatus: approval.approved ? 'completed' : 'pending',
        completedTaskId: approval.approved ? input.workItem.task.id : undefined,
        completedStatus: approval.approved ? 'resolved' : undefined,
      }
    }),
  })

  const spawnResult = await spawnInProcessTeammate(
    {
      name: 'researcher',
      teamName: 'alpha team',
      prompt: 'Work only after plan approval',
      cwd: '/tmp/project',
      planModeRequired: true,
      runtimeOptions: {
        maxIterations: 1,
        pollIntervalMs: 5,
      },
    },
    options,
    adapter,
  )

  let requestSeen = false
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const leaderMailbox = await readMailbox('alpha team', 'team-lead', options)
    requestSeen = leaderMailbox.some(
      message => isPlanApprovalRequest(message.text)?.requestId === 'bridge-plan-1',
    )
    if (requestSeen) {
      break
    }
    await new Promise(resolve => {
      setTimeout(resolve, 5)
    })
  }

  assert.equal(requestSeen, true)

  await runApprovePlanCommand('alpha team', 'researcher', 'bridge-plan-1', options)

  const loopResult = await spawnResult.handle?.join?.()
  assert.equal(loopResult?.processedWorkItems, 1)
  assert.equal(loopResult?.stopReason, 'completed')

  const task = await getTask(getTaskListIdForTeam('alpha team'), '1', options)
  assert.equal(task?.status, 'completed')

  const leaderMailbox = await readMailbox('alpha team', 'team-lead', options)
  assert.equal(
    leaderMailbox.some(message => message.text === 'Plan approved, continuing task.'),
    true,
  )
})

test('local runtime adapter includes recent transcript context in subsequent prompts', async t => {
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

  const firstAdapter = createLocalRuntimeAdapter({
    bridge: createFunctionRuntimeTurnBridge(async input => {
      if (input.workItem.kind !== 'task') {
        return
      }

      return {
        summary: 'Completed first task',
        assistantResponse: 'Done with task #1',
        assistantSummary: 'first task complete',
        taskStatus: 'completed',
        completedTaskId: input.workItem.task.id,
        completedStatus: 'resolved',
      }
    }),
  })

  const firstRun = await spawnInProcessTeammate(
    {
      name: 'researcher',
      teamName: 'alpha team',
      prompt: 'Investigate the failure',
      cwd: '/tmp/project',
      runtimeOptions: {
        maxIterations: 1,
      },
    },
    options,
    firstAdapter,
  )

  await firstRun.handle?.join?.()

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

  let seenPrompt = ''
  const secondAdapter = createLocalRuntimeAdapter({
    bridge: createFunctionRuntimeTurnBridge(async input => {
      seenPrompt = input.prompt
      if (input.workItem.kind !== 'task') {
        return
      }

      return {
        summary: 'Completed second task',
        taskStatus: 'completed',
        completedTaskId: input.workItem.task.id,
        completedStatus: 'resolved',
      }
    }),
  })

  const secondRun = await spawnInProcessTeammate(
    {
      name: 'researcher',
      teamName: 'alpha team',
      prompt: 'Continue the investigation',
      cwd: '/tmp/project',
      runtimeOptions: {
        maxIterations: 1,
      },
    },
    options,
    secondAdapter,
  )

  await secondRun.handle?.join?.()

  assert.match(seenPrompt, /Recent Transcript Context/)
  assert.match(seenPrompt, /Done with task #1/)
})

test('local runtime adapter refreshes heartbeat and clears turn metadata while a bridge is still executing', async t => {
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

  let resolveBridge: (() => void) | undefined
  const bridgeGate = new Promise<void>(resolve => {
    resolveBridge = resolve
  })

  const adapter = createLocalRuntimeAdapter({
    bridge: createFunctionRuntimeTurnBridge(async input => {
      if (input.workItem.kind !== 'task') {
        return
      }

      await bridgeGate
      return {
        summary: 'Long-running task completed',
        taskStatus: 'completed',
        completedTaskId: input.workItem.task.id,
        completedStatus: 'resolved',
      }
    }),
  })

  const result = await spawnInProcessTeammate(
    {
      name: 'researcher',
      teamName: 'alpha team',
      prompt: 'Investigate the failure',
      cwd: '/tmp/project',
      runtimeOptions: {
        maxIterations: 1,
      },
    },
    options,
    adapter,
  )

  let activeMember = await readTeamFile('alpha team', options)
  let runtimeState = activeMember?.members.find(member => member.name === 'researcher')?.runtimeState
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (runtimeState?.currentWorkKind === 'task' && runtimeState.turnStartedAt !== undefined) {
      break
    }
    await sleep(20)
    activeMember = await readTeamFile('alpha team', options)
    runtimeState = activeMember?.members.find(member => member.name === 'researcher')?.runtimeState
  }

  assert.equal(runtimeState?.currentWorkKind, 'task')
  assert.equal(runtimeState?.currentTaskId, '1')
  assert.equal(runtimeState?.turnStartedAt !== undefined, true)
  assert.match(runtimeState?.currentWorkSummary ?? '', /Task #1: Investigate issue/)

  const statusWhileExecuting = await getAgentStatuses('alpha team', options)
  assert.equal(
    statusWhileExecuting?.find(status => status.name === 'researcher')?.currentWorkKind,
    'task',
  )

  const firstHeartbeatAt = runtimeState?.lastHeartbeatAt ?? 0
  await sleep(650)

  const duringExecution = await readTeamFile('alpha team', options)
  const updatedRuntimeState = duringExecution?.members.find(
    member => member.name === 'researcher',
  )?.runtimeState

  assert.equal(
    (updatedRuntimeState?.lastHeartbeatAt ?? 0) > firstHeartbeatAt,
    true,
  )
  assert.equal(updatedRuntimeState?.currentWorkKind, 'task')

  resolveBridge?.()
  await result.handle?.join?.()

  const settled = await readTeamFile('alpha team', options)
  const settledRuntimeState = settled?.members.find(
    member => member.name === 'researcher',
  )?.runtimeState

  assert.equal(settledRuntimeState?.currentWorkKind, undefined)
  assert.equal(settledRuntimeState?.currentTaskId, undefined)
  assert.equal(settledRuntimeState?.turnStartedAt, undefined)
  assert.equal(settledRuntimeState?.lastTurnEndedAt !== undefined, true)
  assert.equal(settled?.members.find(member => member.name === 'researcher')?.isActive, false)
})

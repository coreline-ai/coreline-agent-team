import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import {
  createShutdownRequestMessage,
  createTask,
  createTeam,
  getAgentStatuses,
  getTask,
  getTaskListIdForTeam,
  isIdleNotification,
  isPlanApprovalRequest,
  isShutdownApproved,
  readMailbox,
  readTeamFile,
  upsertTeamMember,
  writeToMailbox,
} from '../../src/team-core/index.js'
import { runApprovePlanCommand } from '../../src/team-cli/commands/approve-plan.js'
import {
  createFunctionRuntimeTurnBridge,
  createLocalRuntimeAdapter,
  createMockRuntimeAdapter,
  renderWorkItemPrompt,
  spawnInProcessTeammate,
} from '../../src/team-runtime/index.js'
import { createTempDir, createTempOptions, sleep } from '../test-helpers.js'

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

test('local runtime adapter prompt includes scoped starter snapshots for implementation work', async t => {
  const options = await createTempOptions(t)
  const cwd = await createTempDir(t)
  await mkdir(join(cwd, 'docs'), { recursive: true })
  await mkdir(join(cwd, 'backend'), { recursive: true })
  await createTeamWithWorker(options)

  await writeFile(
    join(cwd, 'docs', 'implementation-contract.md'),
    '# Implementation Contract\n\n- API: GET /health\n',
    'utf8',
  )
  await writeFile(
    join(cwd, 'docs', 'plan.md'),
    '# Implementation Plan\n\n1. Build router\n',
    'utf8',
  )
  await writeFile(
    join(cwd, 'docs', 'architecture.md'),
    '# Architecture Notes\n\n- backend/router.mjs\n',
    'utf8',
  )
  await writeFile(
    join(cwd, 'backend', 'router.mjs'),
    "export function routeRequest() {\n  throw new Error('todo')\n}\n",
    'utf8',
  )

  await createTask(
    getTaskListIdForTeam('alpha team'),
    {
      subject: 'Create backend route module',
      description:
        'Using docs/implementation-contract.md, docs/plan.md, and docs/architecture.md, create backend/router.mjs for the goal. Edit the existing backend/router.mjs starter in place.',
      status: 'pending',
      blocks: [],
      blockedBy: [],
      metadata: {
        ownership: {
          scopedPaths: ['backend/router.mjs'],
          scopeSource: 'metadata',
        },
      },
    },
    options,
  )

  let capturedPrompt = ''
  const adapter = createLocalRuntimeAdapter({
    bridge: createFunctionRuntimeTurnBridge(async input => {
      capturedPrompt = input.prompt
      if (input.workItem.kind !== 'task') {
        return
      }

      return {
        summary: 'captured prompt',
        taskStatus: 'completed',
        completedTaskId: input.workItem.task.id,
        completedStatus: 'resolved',
      }
    }),
  })

  const result = await spawnInProcessTeammate(
    {
      name: 'backend',
      teamName: 'alpha team',
      prompt: 'Implement the backend in narrow slices.',
      cwd,
      runtimeOptions: {
        maxIterations: 1,
      },
    },
    options,
    adapter,
  )

  await result.handle?.join?.()

  assert.match(capturedPrompt, /## Provided File Snapshots/)
  assert.match(capturedPrompt, /### docs\/implementation-contract\.md/)
  assert.match(capturedPrompt, /### backend\/router\.mjs/)
  assert.match(capturedPrompt, /Edit the currently scoped starter file in place/)
  assert.match(capturedPrompt, /throw new Error\('todo'\)/)
})

test('local runtime adapter records filesystem evidence when a turn fails after writing scoped files', async t => {
  const options = await createTempOptions(t)
  const cwd = await createTempDir(t)
  await createTeamWithWorker(options)

  await createTask(
    getTaskListIdForTeam('alpha team'),
    {
      subject: 'Implement backend contract and router',
      description: 'Work in backend/ and docs/backend-api.md.',
      status: 'pending',
      owner: 'researcher@alpha team',
      blocks: [],
      blockedBy: [],
      metadata: {
        ownership: {
          scopedPaths: ['backend/**', 'docs/backend-api.md'],
          scopeSource: 'metadata',
        },
      },
    },
    options,
  )

  const adapter = createLocalRuntimeAdapter({
    bridge: createFunctionRuntimeTurnBridge(async input => {
      if (input.workItem.kind !== 'task') {
        return
      }
      await mkdir(join(cwd, 'backend'), { recursive: true })
      await mkdir(join(cwd, 'docs'), { recursive: true })
      await writeFile(join(cwd, 'backend', 'router.mjs'), 'export {}\\n', 'utf8')
      await writeFile(join(cwd, 'docs', 'backend-api.md'), '# API\\n', 'utf8')
      return {
        summary: 'Codex CLI timed out for researcher',
        failureReason: 'timeout',
        idleReason: 'failed',
        taskStatus: 'pending',
      }
    }),
  })

  const result = await spawnInProcessTeammate(
    {
      name: 'researcher',
      teamName: 'alpha team',
      prompt: 'Implement the backend work',
      cwd,
      runtimeOptions: {
        maxIterations: 1,
      },
    },
    options,
    adapter,
  )

  const loopResult = await result.handle?.join?.()
  const task = await getTask(getTaskListIdForTeam('alpha team'), '1', options)

  assert.equal(loopResult?.processedWorkItems, 1)
  assert.equal(task?.status, 'pending')
  assert.deepEqual(
    (task?.metadata as { runtimeEvidence?: { recentFiles?: string[] } } | undefined)
      ?.runtimeEvidence?.recentFiles,
    ['backend/router.mjs', 'docs/backend-api.md'],
  )
})

test('local runtime adapter promotes interrupted scoped work to completed when runtime evidence exists', async t => {
  const options = await createTempOptions(t)
  const cwd = await createTempDir(t)
  await createTeamWithWorker(options)

  await createTask(
    getTaskListIdForTeam('alpha team'),
    {
      subject: 'Implement backend contract and router',
      description: 'Work in backend/ and docs/backend-api.md.',
      status: 'pending',
      owner: 'researcher@alpha team',
      blocks: [],
      blockedBy: [],
      metadata: {
        ownership: {
          scopedPaths: ['backend/**', 'docs/backend-api.md'],
          scopeSource: 'metadata',
        },
      },
    },
    options,
  )

  const adapter = createLocalRuntimeAdapter({
    bridge: createFunctionRuntimeTurnBridge(async input => {
      if (input.workItem.kind !== 'task') {
        return
      }
      await mkdir(join(cwd, 'backend'), { recursive: true })
      await mkdir(join(cwd, 'docs'), { recursive: true })
      await writeFile(join(cwd, 'backend', 'router.mjs'), 'export {}\\n', 'utf8')
      await writeFile(join(cwd, 'docs', 'backend-api.md'), '# API\\n', 'utf8')
      throw new Error('Codex CLI interrupted')
    }),
  })

  const result = await spawnInProcessTeammate(
    {
      name: 'researcher',
      teamName: 'alpha team',
      prompt: 'Implement the backend work',
      cwd,
      runtimeOptions: {
        maxIterations: 1,
      },
    },
    options,
    adapter,
  )

  const loopResult = await result.handle?.join?.()
  const task = await getTask(getTaskListIdForTeam('alpha team'), '1', options)

  assert.equal(loopResult?.processedWorkItems, 1)
  assert.equal(task?.status, 'completed')
  assert.equal(
    (task?.metadata as { runtimeOutcome?: { classification?: string } } | undefined)
      ?.runtimeOutcome?.classification,
    'completed-with-evidence',
  )
  assert.deepEqual(
    (task?.metadata as { runtimeEvidence?: { recentFiles?: string[] } } | undefined)
      ?.runtimeEvidence?.recentFiles,
    ['backend/router.mjs', 'docs/backend-api.md'],
  )
})

test('local runtime adapter interrupts an active turn when an unread shutdown request appears', async t => {
  const options = await createTempOptions(t)
  await createTeamWithWorker(options)

  await createTask(
    getTaskListIdForTeam('alpha team'),
    {
      subject: 'Build frontend shell',
      description: 'Create the initial page shell',
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

      await new Promise<void>(resolve => {
        input.abortSignal?.addEventListener('abort', () => resolve(), {
          once: true,
        })
      })

      return {
        summary: 'Interrupted by pending shutdown request',
        failureReason: 'shutdown requested while turn was active',
        taskStatus: 'pending',
        idleReason: 'failed',
      }
    }),
  })

  const spawnResult = await spawnInProcessTeammate(
    {
      name: 'researcher',
      teamName: 'alpha team',
      prompt: 'Build the frontend shell',
      cwd: '/tmp/project',
      runtimeOptions: {
        maxIterations: 8,
        pollIntervalMs: 10,
      },
    },
    options,
    adapter,
  )

  setTimeout(() => {
    const shutdownRequest = createShutdownRequestMessage({
      requestId: 'shutdown-active-turn',
      from: 'team-lead',
      reason: 'stop the active turn',
    })

    void writeToMailbox(
      'alpha team',
      'researcher',
      {
        from: 'team-lead',
        text: JSON.stringify(shutdownRequest),
        timestamp: shutdownRequest.timestamp,
        summary: 'shutdown researcher',
      },
      options,
    )
  }, 50)

  const loopResult = await spawnResult.handle?.join?.()

  assert.equal(loopResult?.stopReason, 'shutdown')

  const task = await getTask(getTaskListIdForTeam('alpha team'), '1', options)
  assert.equal(task?.status, 'pending')
  assert.equal(task?.owner, undefined)

  const leaderMailbox = await readMailbox('alpha team', 'team-lead', options)
  const shutdownApproved = leaderMailbox
    .map(message => isShutdownApproved(message.text))
    .find(message => message !== null)

  assert.equal(shutdownApproved?.type, 'shutdown_approved')
  assert.equal(
    leaderMailbox.some(
      message =>
        isIdleNotification(message.text)?.summary ===
        'Interrupted by pending shutdown request',
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

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  deriveEffectiveTaskState,
  getTaskRuntimeAssociation,
  type AgentStatus,
  type TeamTask,
} from '../../src/team-core/index.js'

function createPendingTask(overrides: Partial<TeamTask> = {}): TeamTask {
  return {
    id: '1',
    subject: 'Keep task state consistent',
    description: 'Runtime-aware effective state fixture',
    status: 'pending',
    owner: 'researcher@alpha team',
    blocks: [],
    blockedBy: [],
    ...overrides,
  }
}

function createStatus(overrides: Partial<AgentStatus> = {}): AgentStatus {
  return {
    agentId: 'researcher@alpha team',
    name: 'researcher',
    status: 'busy',
    currentTasks: ['1'],
    isActive: true,
    ...overrides,
  }
}

test('deriveEffectiveTaskState promotes a pending task to effective in_progress during a task turn', () => {
  const tasks = [createPendingTask()]
  const statuses = [
    createStatus({
      currentWorkKind: 'task',
      currentTaskId: '1',
      turnStartedAt: Date.now() - 2_000,
      lastHeartbeatAt: Date.now() - 100,
    }),
  ]

  const result = deriveEffectiveTaskState({ tasks, statuses })

  assert.deepEqual(result.counts, {
    pending: 0,
    inProgress: 1,
    completed: 0,
  })
  assert.equal(result.effectiveStatusByTaskId['1'], 'in_progress')
})

test('task runtime association does not mislabel owned tasks as working during a non-task turn', () => {
  const tasks = [createPendingTask()]
  const status = createStatus({
    currentWorkKind: 'leader_message',
    currentTaskId: undefined,
    turnStartedAt: Date.now() - 2_000,
    lastHeartbeatAt: Date.now() - 100,
  })

  const association = getTaskRuntimeAssociation(tasks, status)
  const result = deriveEffectiveTaskState({
    tasks,
    statuses: [status],
  })

  assert.deepEqual(association.liveTaskIds, [])
  assert.deepEqual(association.ownedTaskIds, ['1'])
  assert.deepEqual(result.counts, {
    pending: 1,
    inProgress: 0,
    completed: 0,
  })
  assert.equal(result.effectiveStatusByTaskId['1'], 'pending')
})

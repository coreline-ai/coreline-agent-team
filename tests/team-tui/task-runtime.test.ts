import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTaskRuntimeSignals } from '../../src/team-tui/task-runtime.js'
import type { AgentStatus, TeamTask } from '../../src/team-core/index.js'

function createPendingTask(): TeamTask {
  return {
    id: '1',
    subject: 'Render runtime hints safely',
    description: 'Prevent false working labels',
    status: 'pending',
    owner: 'researcher@alpha team',
    blocks: [],
    blockedBy: [],
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

test('buildTaskRuntimeSignals upgrades pending task labels to effective in_progress during a task turn', () => {
  const signals = buildTaskRuntimeSignals(
    [createPendingTask()],
    [
      createStatus({
        currentWorkKind: 'task',
        currentTaskId: '1',
        turnStartedAt: Date.now() - 2_000,
        lastHeartbeatAt: Date.now() - 100,
      }),
    ],
  )

  assert.equal(signals.labelsByTaskId['1'], 'working:researcher')
  assert.equal(signals.effectiveStatusByTaskId['1'], 'in_progress')
})

test('buildTaskRuntimeSignals does not mark owned tasks as working during leader-message turns', () => {
  const signals = buildTaskRuntimeSignals(
    [createPendingTask()],
    [
      createStatus({
        currentWorkKind: 'leader_message',
        turnStartedAt: Date.now() - 2_000,
        lastHeartbeatAt: Date.now() - 100,
      }),
    ],
  )

  assert.equal(signals.labelsByTaskId['1'], undefined)
  assert.equal(signals.effectiveStatusByTaskId['1'], 'pending')
})

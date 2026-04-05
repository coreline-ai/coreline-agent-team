import assert from 'node:assert/strict'
import test from 'node:test'
import {
  analyzeTeamCostGuardrails,
  BROADCAST_FANOUT_WARNING_THRESHOLD,
  type AgentStatus,
  type TeamFile,
  type TeamTask,
  type TeammateMessage,
} from '../../src/team-core/index.js'

function createTeamWithTeammates(count: number): TeamFile {
  return {
    name: 'alpha-team',
    createdAt: Date.now(),
    leadAgentId: 'team-lead@alpha-team',
    members: [
      {
        agentId: 'team-lead@alpha-team',
        name: 'team-lead',
        cwd: '/tmp/project',
        subscriptions: [],
        joinedAt: Date.now(),
      },
      ...Array.from({ length: count }, (_, index) => ({
        agentId: `worker${index + 1}@alpha-team`,
        name: `worker${index + 1}`,
        cwd: '/tmp/project',
        subscriptions: [],
        joinedAt: Date.now(),
      })),
    ],
  }
}

function createActiveStatuses(count: number): AgentStatus[] {
  return Array.from({ length: count }, (_, index) => ({
    agentId: `worker${index + 1}@alpha-team`,
    name: `worker${index + 1}`,
    status: 'busy',
    currentTasks: [String(index + 1)],
    isActive: true,
    currentWorkKind: 'task',
    currentTaskId: String(index + 1),
    turnStartedAt: Date.now() - 2_000,
    lastHeartbeatAt: Date.now() - 100,
  }))
}

function createPendingTasks(count: number): TeamTask[] {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index + 1),
    subject: `Task ${index + 1}`,
    description: `Work in frontend/file-${index + 1}.tsx`,
    status: 'pending',
    owner: `worker${index + 1}@alpha-team`,
    blocks: [],
    blockedBy: [],
  }))
}

function createMailboxMessage(text: string): TeammateMessage {
  return {
    from: 'team-lead',
    text,
    timestamp: new Date().toISOString(),
    read: false,
    summary: text,
  }
}

test('analyzeTeamCostGuardrails warns when the team exceeds the recommended size', () => {
  const report = analyzeTeamCostGuardrails({
    team: createTeamWithTeammates(6),
  })

  assert.ok(report.warnings.some(warning => warning.code === 'large_team'))
})

test('analyzeTeamCostGuardrails warns on wide active parallel fan-out', () => {
  const report = analyzeTeamCostGuardrails({
    team: createTeamWithTeammates(6),
    tasks: createPendingTasks(6),
    statuses: createActiveStatuses(6),
  })

  assert.ok(
    report.warnings.some(warning => warning.code === 'wide_active_team'),
  )
  assert.ok(
    report.warnings.some(warning => warning.code === 'wide_parallel_fanout'),
  )
})

test('analyzeTeamCostGuardrails warns when a recent leader message fans out broadly', () => {
  const recipientMailboxes = Array.from(
    { length: BROADCAST_FANOUT_WARNING_THRESHOLD },
    (_, index) => ({
      recipientName: `worker${index + 1}`,
      messages: [createMailboxMessage('broadcast:phase-1')],
    }),
  )

  const report = analyzeTeamCostGuardrails({
    team: createTeamWithTeammates(4),
    recipientMailboxes,
  })

  assert.ok(
    report.warnings.some(warning => warning.code === 'broadcast_fanout'),
  )
})

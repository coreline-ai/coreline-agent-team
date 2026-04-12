import assert from 'node:assert/strict'
import test from 'node:test'
import {
  analyzeTaskGuardrails,
  canActorClaimTask,
  decorateTaskInputWithGuardrails,
} from '../../src/team-core/index.js'
import type { TeamTask } from '../../src/team-core/index.js'

function createTaskFixture(overrides: Partial<TeamTask> = {}): TeamTask {
  return {
    id: '1',
    subject: 'Task',
    description: 'Task description',
    status: 'pending',
    blocks: [],
    blockedBy: [],
    ...overrides,
  }
}

test('decorateTaskInputWithGuardrails stores inferred scoped paths in metadata', () => {
  const input = decorateTaskInputWithGuardrails({
    subject: 'Implement frontend task',
    description: 'Work in frontend/ and update package.json if needed.',
    status: 'pending',
    blocks: [],
    blockedBy: [],
  })

  assert.deepEqual(input.metadata, {
    ownership: {
      scopedPaths: ['frontend/**', 'package.json'],
      scopeSource: 'content',
    },
  })
})

test('analyzeTaskGuardrails warns when a task spans multiple workspace areas', () => {
  const report = analyzeTaskGuardrails([
    createTaskFixture({
      description: 'Touch frontend/ and backend/ in one task.',
    }),
  ])

  assert.equal(report.warnings[0]?.code, 'multi_area_task')
  assert.match(
    report.warnings[0]?.message ?? '',
    /split it into narrower tasks/i,
  )
})

test('analyzeTaskGuardrails warns on overlapping scopes without dependency ordering', () => {
  const report = analyzeTaskGuardrails([
    createTaskFixture({
      id: '1',
      owner: 'frontend@alpha team',
      description: 'Build frontend/ routes.',
    }),
    createTaskFixture({
      id: '2',
      owner: 'reviewer@alpha team',
      description: 'Also update frontend/ shell.',
    }),
  ])

  assert.ok(
    report.warnings.some(warning => warning.code === 'overlapping_scope'),
  )
})

test('analyzeTaskGuardrails suppresses overlap warnings when tasks are ordered by dependency', () => {
  const report = analyzeTaskGuardrails([
    createTaskFixture({
      id: '1',
      owner: 'frontend@alpha team',
      description: 'Build frontend/ routes.',
      blocks: ['2'],
    }),
    createTaskFixture({
      id: '2',
      owner: 'reviewer@alpha team',
      description: 'Also update frontend/ shell.',
      blockedBy: ['1'],
    }),
  ])

  assert.equal(
    report.warnings.some(warning => warning.code === 'overlapping_scope'),
    false,
  )
})

test('canActorClaimTask blocks cross-role claims when scoped paths do not overlap', () => {
  const result = canActorClaimTask(
    createTaskFixture({
      id: '2',
      owner: 'frontend@alpha team',
      description: 'Implement frontend/ interactions and shell.',
    }),
    'backend-impl',
    'backend-impl@alpha team',
  )

  assert.equal(result.allowed, false)
  assert.match(result.reason ?? '', /owned by frontend@alpha team|touches frontend/i)
})

test('canActorClaimTask allows claims when actor scope matches task scope', () => {
  const result = canActorClaimTask(
    createTaskFixture({
      id: '3',
      owner: 'backend@alpha team',
      description: 'Implement backend/ routes and update docs/backend-api.md.',
    }),
    'backend',
    'backend@alpha team',
  )

  assert.equal(result.allowed, true)
  assert.ok(result.actorScopedPaths.includes('backend/**'))
})

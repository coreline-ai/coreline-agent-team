import assert from 'node:assert/strict'
import test from 'node:test'
import {
  closeTeamSession,
  openTeamSession,
  readLatestSessionRecord,
  readSessionState,
  updateTeamSessionProgress,
} from '../../src/team-core/index.js'
import { createTempOptions } from '../test-helpers.js'

test('session store opens, closes, and reopens a teammate session with progress', async t => {
  const options = await createTempOptions(t)

  await openTeamSession(
    'alpha team',
    'researcher',
    {
      sessionId: '11111111-1111-4111-8111-111111111111',
      runtimeKind: 'codex-cli',
      cwd: '/tmp/project',
      prompt: 'Investigate the failure',
    },
    options,
  )

  await updateTeamSessionProgress(
    'alpha team',
    'researcher',
    '11111111-1111-4111-8111-111111111111',
    {
      lastWorkSummary: 'Handled task #1',
      lastWorkItemKind: 'task',
      lastTaskId: '1',
    },
    options,
  )

  await closeTeamSession(
    'alpha team',
    'researcher',
    '11111111-1111-4111-8111-111111111111',
    {
      lastExitReason: 'completed',
    },
    options,
  )

  await openTeamSession(
    'alpha team',
    'researcher',
    {
      sessionId: '11111111-1111-4111-8111-111111111111',
      runtimeKind: 'codex-cli',
      cwd: '/tmp/project',
      prompt: 'Investigate the failure',
      reopen: true,
    },
    options,
  )

  const latest = await readLatestSessionRecord('alpha team', 'researcher', options)
  const state = await readSessionState('alpha team', 'researcher', options)

  assert.equal(latest?.status, 'open')
  assert.equal(latest?.lastExitReason, undefined)
  assert.equal(latest?.lastWorkSummary, 'Handled task #1')
  assert.equal(latest?.lastTaskId, '1')
  assert.equal(latest?.reopenedAt.length, 1)
  assert.equal(state.currentSessionId, '11111111-1111-4111-8111-111111111111')
})

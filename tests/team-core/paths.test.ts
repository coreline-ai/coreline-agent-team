import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getInboxPath,
  getPendingPermissionsDir,
  getResolvedPermissionsDir,
  getRootDir,
  getTaskListIdForTeam,
  getTaskListLockPath,
  getTaskPath,
  getTeamFilePath,
  getTeamLockPath,
  sanitizePathComponent,
} from '../../src/team-core/index.js'

test('sanitizePathComponent normalizes unsafe characters', () => {
  assert.equal(sanitizePathComponent('Team Alpha/@42'), 'Team-Alpha--42')
})

test('path helpers use the provided root dir', () => {
  const options = { rootDir: '/tmp/agent-team-test' }

  assert.equal(getRootDir(options), '/tmp/agent-team-test')
  assert.equal(
    getTeamFilePath('alpha team', options),
    '/tmp/agent-team-test/teams/alpha-team/config.json',
  )
  assert.equal(
    getTeamLockPath('alpha team', options),
    '/tmp/agent-team-test/teams/alpha-team/.lock',
  )
  assert.equal(
    getInboxPath('alpha team', 'researcher@1', options),
    '/tmp/agent-team-test/teams/alpha-team/inboxes/researcher-1.json',
  )
  assert.equal(
    getTaskPath('alpha team', '3', options),
    '/tmp/agent-team-test/tasks/alpha-team/3.json',
  )
  assert.equal(
    getTaskListLockPath('alpha team', options),
    '/tmp/agent-team-test/tasks/alpha-team/.lock',
  )
  assert.equal(
    getPendingPermissionsDir('alpha team', options),
    '/tmp/agent-team-test/teams/alpha-team/permissions/pending',
  )
  assert.equal(
    getResolvedPermissionsDir('alpha team', options),
    '/tmp/agent-team-test/teams/alpha-team/permissions/resolved',
  )
})

test('task list ids are canonicalized from team names', () => {
  assert.equal(getTaskListIdForTeam('Alpha Team'), 'Alpha-Team')
})

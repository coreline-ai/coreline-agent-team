import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAtcliForwardedArgs } from '../../src/atcli/forwarded-args.js'

test('atcli forwards bare invocation to app command', () => {
  assert.deepEqual(buildAtcliForwardedArgs([]), ['app'])
  assert.deepEqual(buildAtcliForwardedArgs(['--runtime', 'local']), ['app', '--runtime', 'local'])
})

test('atcli preserves global root-dir before app command', () => {
  assert.deepEqual(buildAtcliForwardedArgs(['--root-dir', '/tmp/team-root', '--runtime', 'local']), [
    '--root-dir',
    '/tmp/team-root',
    'app',
    '--runtime',
    'local',
  ])
})

test('atcli opens app when only a global root-dir is provided', () => {
  assert.deepEqual(buildAtcliForwardedArgs(['--root-dir', '/tmp/team-root']), [
    '--root-dir',
    '/tmp/team-root',
    'app',
  ])
})

test('atcli routes help flags to top-level help even after root-dir', () => {
  assert.deepEqual(buildAtcliForwardedArgs(['--help']), ['help'])
  assert.deepEqual(buildAtcliForwardedArgs(['help']), ['help'])
  assert.deepEqual(buildAtcliForwardedArgs(['-h']), ['help'])
  assert.deepEqual(buildAtcliForwardedArgs(['--root-dir', '/tmp/team-root', '--help']), ['help'])
})

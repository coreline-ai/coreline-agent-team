import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createPermissionRequestRecord,
  createTeam,
  getPersistedPermissionDecision,
  getTeamPermissionState,
  readPendingPermissionRequests,
  readResolvedPermissionRequests,
  resolvePermissionRequest,
  writePendingPermissionRequest,
} from '../../src/team-core/index.js'
import { createTempOptions } from '../test-helpers.js'

test('permission store persists pending and resolved requests and applies team permission updates', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'

  await createTeam(
    {
      teamName: 'alpha team',
      leadAgentId: 'team-lead@alpha team',
      leadMember: {
        name: 'team-lead',
        agentType: 'team-lead',
        cwd,
        subscriptions: [],
      },
    },
    options,
  )

  await writePendingPermissionRequest(
    createPermissionRequestRecord({
      id: 'perm-1',
      teamName: 'alpha team',
      workerId: 'researcher@alpha team',
      workerName: 'researcher',
      toolName: 'exec_command',
      toolUseId: 'tool-1',
      description: 'Need shell access',
      input: {
        cmd: 'pwd',
      },
    }),
    options,
  )

  assert.equal((await readPendingPermissionRequests('alpha team', options)).length, 1)

  await resolvePermissionRequest(
    'alpha team',
    'perm-1',
    {
      decision: 'approved',
      resolvedBy: 'leader',
      permissionUpdates: [
        {
          type: 'addRules',
          rules: [
            {
              toolName: 'exec_command',
              ruleContent: 'pwd',
            },
          ],
          behavior: 'allow',
          destination: 'session',
        },
      ],
    },
    options,
  )

  const pending = await readPendingPermissionRequests('alpha team', options)
  const resolved = await readResolvedPermissionRequests('alpha team', options)
  const permissionState = await getTeamPermissionState('alpha team', options)
  const decision = await getPersistedPermissionDecision(
    'alpha team',
    'exec_command',
    {
      cmd: 'pwd',
    },
    options,
  )

  assert.equal(pending.length, 0)
  assert.equal(resolved.length, 1)
  assert.equal(resolved[0]?.status, 'approved')
  assert.equal(permissionState?.rules.length, 1)
  assert.equal(permissionState?.updates.length, 1)
  assert.equal(decision?.behavior, 'allow')
})

test('permission store supports structured rule matching for command, cwd, path, and host', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'

  await createTeam(
    {
      teamName: 'alpha team',
      leadAgentId: 'team-lead@alpha team',
      leadMember: {
        name: 'team-lead',
        agentType: 'team-lead',
        cwd,
        subscriptions: [],
      },
    },
    options,
  )

  await resolvePermissionRequest(
    'alpha team',
    'missing-request',
    {
      decision: 'approved',
      resolvedBy: 'leader',
    },
    options,
  )

  await writePendingPermissionRequest(
    createPermissionRequestRecord({
      id: 'perm-structured-1',
      teamName: 'alpha team',
      workerId: 'researcher@alpha team',
      workerName: 'researcher',
      toolName: 'exec_command',
      toolUseId: 'tool-structured-1',
      description: 'Need scoped shell access',
      input: {
        cmd: 'git status',
        cwd: `${cwd}/repo`,
        path: `${cwd}/repo/src/index.ts`,
        host: 'api.example.com',
      },
    }),
    options,
  )

  await resolvePermissionRequest(
    'alpha team',
    'perm-structured-1',
    {
      decision: 'approved',
      resolvedBy: 'leader',
      permissionUpdates: [
        {
          type: 'addRules',
          rules: [
            {
              toolName: 'exec_command',
              match: {
                commandContains: 'git status',
                cwdPrefix: `${cwd}/repo`,
                pathPrefix: `${cwd}/repo/src`,
                hostEquals: 'api.example.com',
              },
            },
          ],
          behavior: 'deny',
          destination: 'session',
        },
      ],
    },
    options,
  )

  const matchingDecision = await getPersistedPermissionDecision(
    'alpha team',
    'exec_command',
    {
      cmd: 'git status --short',
      cwd: `${cwd}/repo`,
      path: `${cwd}/repo/src/index.ts`,
      host: 'api.example.com',
    },
    options,
  )
  const nonMatchingDecision = await getPersistedPermissionDecision(
    'alpha team',
    'exec_command',
    {
      cmd: 'npm test',
      cwd: `${cwd}/repo`,
      path: `${cwd}/repo/src/index.ts`,
      host: 'api.example.com',
    },
    options,
  )

  assert.equal(matchingDecision?.behavior, 'deny')
  assert.equal(nonMatchingDecision, null)
})

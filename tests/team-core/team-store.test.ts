import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cleanupTeamDirectories,
  createTask,
  createTeam,
  getTaskListIdForTeam,
  listTeamMembers,
  pathExists,
  readTeamFile,
  removeTeamMember,
  setMemberActive,
  setMemberMode,
  upsertTeamMember,
} from '../../src/team-core/index.js'
import { getTaskListDir, getTeamDir } from '../../src/team-core/paths.js'
import { createTempOptions } from '../test-helpers.js'

test('team store creates and reads a team file', async t => {
  const options = await createTempOptions(t)

  const created = await createTeam(
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

  assert.equal(created.members.length, 1)

  const stored = await readTeamFile('alpha team', options)
  assert.equal(stored?.leadAgentId, 'team-lead@alpha team')
  await assert.rejects(
    createTeam(
      {
        teamName: 'alpha team',
        leadAgentId: 'duplicate',
        leadMember: {
          name: 'team-lead',
          cwd: '/tmp/project',
          subscriptions: [],
        },
      },
      options,
    ),
    /already exists/,
  )
})

test('team store upserts members and updates activity/mode', async t => {
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

  await upsertTeamMember(
    'alpha team',
    {
      agentId: 'researcher@alpha team',
      name: 'researcher',
      cwd: '/tmp/project',
      subscriptions: [],
      joinedAt: Date.now(),
      backendType: 'in-process',
    },
    options,
  )

  assert.equal((await listTeamMembers('alpha team', options)).length, 2)
  assert.equal(await setMemberActive('alpha team', 'researcher', false, options), true)
  assert.equal(await setMemberMode('alpha team', 'researcher', 'plan', options), true)

  const stored = await readTeamFile('alpha team', options)
  const researcher = stored?.members.find(member => member.name === 'researcher')
  assert.equal(researcher?.isActive, false)
  assert.equal(researcher?.mode, 'plan')

  assert.equal(
    await removeTeamMember('alpha team', { name: 'researcher' }, options),
    true,
  )
  assert.equal((await listTeamMembers('alpha team', options)).length, 1)
})

test('team store cleanup removes team and task directories', async t => {
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
  await createTask(
    getTaskListIdForTeam('alpha team'),
    {
      subject: 'Initial task',
      description: 'Do the thing',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  await cleanupTeamDirectories('alpha team', options)

  assert.equal(await pathExists(getTeamDir('alpha team', options)), false)
  assert.equal(
    await pathExists(getTaskListDir(getTaskListIdForTeam('alpha team'), options)),
    false,
  )
})

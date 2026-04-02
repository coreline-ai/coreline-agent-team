import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cleanupOrphanedTasks,
  createTask,
  createTeam,
  getTask,
  getTaskListIdForTeam,
  listStaleMembers,
  setMemberActive,
  setMemberRuntimeState,
  upsertTeamMember,
} from '../../src/team-core/index.js'
import { createTempOptions } from '../test-helpers.js'

test('cleanupOrphanedTasks resets open tasks owned by inactive teammates', async t => {
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
      agentType: 'researcher',
      cwd: '/tmp/project',
      subscriptions: [],
      joinedAt: Date.now(),
      backendType: 'in-process',
      isActive: false,
      runtimeState: {
        prompt: 'Investigate the failure',
        cwd: '/tmp/project',
        lastHeartbeatAt: Date.now() - 60_000,
      },
    },
    options,
  )

  await createTask(
    getTaskListIdForTeam('alpha team'),
    {
      subject: 'Investigate issue',
      description: 'Review the failing build',
      status: 'in_progress',
      owner: 'researcher@alpha team',
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  const cleanup = await cleanupOrphanedTasks('alpha team', options)
  const task = await getTask(getTaskListIdForTeam('alpha team'), '1', options)

  assert.deepEqual(cleanup.cleanedTaskIds, ['1'])
  assert.equal(task?.status, 'pending')
  assert.equal(task?.owner, undefined)
})

test('listStaleMembers returns inactive teammates whose heartbeat is older than threshold', async t => {
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
      agentId: 'reviewer@alpha team',
      name: 'reviewer',
      agentType: 'reviewer',
      cwd: '/tmp/project',
      subscriptions: [],
      joinedAt: Date.now(),
      backendType: 'in-process',
      isActive: true,
    },
    options,
  )

  await setMemberActive('alpha team', 'reviewer', false, options)
  await setMemberRuntimeState(
    'alpha team',
    'reviewer',
    {
      prompt: 'Review the patch',
      cwd: '/tmp/project',
      lastHeartbeatAt: Date.now() - 30_000,
    },
    options,
  )

  const staleMembers = await listStaleMembers(
    'alpha team',
    10_000,
    options,
    Date.now(),
  )

  assert.deepEqual(staleMembers.map(member => member.name), ['reviewer'])
})

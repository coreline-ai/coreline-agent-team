import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createTask,
  createTeam,
  getTask,
  getTaskListIdForTeam,
  readTeamFile,
  setMemberActive,
  setMemberRuntimeState,
  upsertTeamMember,
} from '../../src/team-core/index.js'
import { runCleanupCommand } from '../../src/team-cli/commands/cleanup.js'
import { runStatusCommand } from '../../src/team-cli/commands/status.js'
import { createTempOptions } from '../test-helpers.js'

test('runCleanupCommand removes stale inactive teammates and resets orphaned tasks', async t => {
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

  await upsertTeamMember(
    'alpha team',
    {
      agentId: 'researcher@alpha team',
      name: 'researcher',
      agentType: 'researcher',
      cwd,
      subscriptions: [],
      joinedAt: Date.now(),
      backendType: 'in-process',
      isActive: true,
    },
    options,
  )

  await setMemberActive('alpha team', 'researcher', false, options)
  await setMemberRuntimeState(
    'alpha team',
    'researcher',
    {
      prompt: 'Investigate the failure',
      cwd,
      runtimeKind: 'local',
      lastHeartbeatAt: Date.now() - 120_000,
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

  const cleanup = await runCleanupCommand(
    'alpha team',
    {
      staleAfterMs: 1,
      removeInactiveMembers: true,
    },
    options,
  )

  assert.match(cleanup.message, /Stale members: 1/)
  assert.match(cleanup.message, /Orphaned tasks cleaned: 1/)
  assert.match(cleanup.message, /Removed inactive members: 1/)

  const task = await getTask(getTaskListIdForTeam('alpha team'), '1', options)
  assert.equal(task?.status, 'pending')
  assert.equal(task?.owner, undefined)

  const stored = await readTeamFile('alpha team', options)
  assert.equal(
    stored?.members.some(member => member.name === 'researcher'),
    false,
  )
})

test('runStatusCommand shows runtime and heartbeat metadata for teammates', async t => {
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

  await upsertTeamMember(
    'alpha team',
    {
      agentId: 'researcher@alpha team',
      name: 'researcher',
      agentType: 'researcher',
      cwd,
      subscriptions: [],
      joinedAt: Date.now(),
      backendType: 'in-process',
      isActive: false,
      mode: 'plan',
      runtimeState: {
        runtimeKind: 'codex-cli',
        prompt: 'Investigate the failure',
        cwd,
        lastHeartbeatAt: Date.now(),
      },
    },
    options,
  )

  const status = await runStatusCommand('alpha team', options)

  assert.match(status.message, /researcher \[idle\]/)
  assert.match(status.message, /active=no/)
  assert.match(status.message, /runtime=codex-cli/)
  assert.match(status.message, /mode=plan/)
  assert.match(status.message, /heartbeat=/)
})

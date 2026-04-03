import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import test from 'node:test'
import {
  createTask,
  createTeam,
  getTask,
  getTaskListIdForTeam,
  getWorkerStderrLogPath,
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
        processId: 4242,
        launchMode: 'detached',
        launchCommand: 'resume',
        lifecycle: 'bounded',
        startedAt: Date.now() - 30_000,
        prompt: 'Investigate the failure',
        cwd,
        lastHeartbeatAt: Date.now(),
      },
    },
    options,
  )

  const stderrLogPath = getWorkerStderrLogPath(
    'alpha team',
    'researcher',
    options,
  )
  await mkdir(dirname(stderrLogPath), { recursive: true })

  await writeFile(
    stderrLogPath,
    'resume warning\nwaiting for leader response\n',
    'utf8',
  )

  const status = await runStatusCommand('alpha team', options)

  assert.match(status.message, /researcher \[idle\]/)
  assert.match(status.message, /state=idle/)
  assert.match(status.message, /active=no/)
  assert.match(status.message, /runtime=codex-cli/)
  assert.match(status.message, /worker=detached/)
  assert.match(status.message, /launch=resume/)
  assert.match(status.message, /lifecycle=bounded/)
  assert.match(status.message, /pid=4242/)
  assert.match(status.message, /stderr_log=.*researcher\.stderr\.log/)
  assert.match(status.message, /stderr_tail=resume warning \| waiting for leader response/)
  assert.match(status.message, /started=/)
  assert.match(status.message, /mode=plan/)
  assert.match(status.message, /heartbeat=/)
  assert.match(status.message, /heartbeat_age=/)
})

test('runStatusCommand shows executing-turn metadata for an active teammate', async t => {
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
      runtimeState: {
        runtimeKind: 'codex-cli',
        processId: 31337,
        launchMode: 'detached',
        launchCommand: 'spawn',
        lifecycle: 'bounded',
        startedAt: Date.now() - 30_000,
        prompt: 'Investigate the failure',
        cwd,
        currentWorkKind: 'leader_message',
        currentWorkSummary: 'Leader message from team-lead: Please inspect the current release issue.',
        turnStartedAt: Date.now() - 4_000,
        lastHeartbeatAt: Date.now() - 500,
      },
    },
    options,
  )

  const status = await runStatusCommand('alpha team', options)

  assert.match(status.message, /researcher \[busy\]/)
  assert.match(status.message, /state=executing-turn/)
  assert.match(status.message, /worker=detached/)
  assert.match(status.message, /launch=spawn/)
  assert.match(status.message, /pid=31337/)
  assert.match(status.message, /work=leader-message/)
  assert.match(status.message, /turn_age=/)
})

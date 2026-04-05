import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cleanupOrphanedTasks,
  createTask,
  createTeam,
  getTask,
  getTaskListIdForTeam,
  listStaleMembers,
  openTeamSession,
  repairLostDetachedMembers,
  setMemberActive,
  setMemberRuntimeState,
  upsertTeamMember,
  readLatestSessionRecord,
  readTeamFile,
} from '../../src/team-core/index.js'
import { createTempOptions } from '../test-helpers.js'

async function createDeadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5)'])
  const pid = child.pid

  await new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', () => resolve())
  })

  if (!pid) {
    throw new Error('Failed to capture child pid')
  }

  return pid
}

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

test('repairLostDetachedMembers marks dead detached workers inactive and unassigns their tasks', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'
  const deadPid = await createDeadPid()

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

  await openTeamSession(
    'alpha team',
    'researcher',
    {
      sessionId: 'lost-session-1',
      runtimeKind: 'codex-cli',
      cwd,
      prompt: 'Investigate the failure',
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
        launchMode: 'detached',
        launchCommand: 'spawn',
        lifecycle: 'bounded',
        processId: deadPid,
        prompt: 'Investigate the failure',
        cwd,
        sessionId: 'lost-session-1',
        lastHeartbeatAt: Date.now() - 5_000,
        currentWorkKind: 'task',
        currentTaskId: '1',
        turnStartedAt: Date.now() - 5_000,
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

  const repaired = await repairLostDetachedMembers('alpha team', options)
  const task = await getTask(getTaskListIdForTeam('alpha team'), '1', options)
  const team = await readTeamFile('alpha team', options)
  const member = team?.members.find(candidate => candidate.name === 'researcher')
  const latestSession = await readLatestSessionRecord('alpha team', 'researcher', options)

  assert.deepEqual(repaired.recoveredAgentNames, ['researcher'])
  assert.deepEqual(repaired.cleanedTaskIds, ['1'])
  assert.equal(task?.status, 'pending')
  assert.equal(task?.owner, undefined)
  assert.equal(member?.isActive, false)
  assert.equal(member?.runtimeState?.processId, undefined)
  assert.equal(member?.runtimeState?.lastExitReason, 'lost')
  assert.equal(member?.runtimeState?.currentWorkKind, undefined)
  assert.equal(member?.runtimeState?.currentTaskId, undefined)
  assert.equal(member?.runtimeState?.turnStartedAt, undefined)
  assert.equal(latestSession?.status, 'closed')
  assert.equal(latestSession?.lastExitReason, 'lost')
})

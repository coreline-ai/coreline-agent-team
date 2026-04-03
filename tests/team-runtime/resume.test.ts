import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createTask,
  createTeam,
  getTask,
  getTaskListIdForTeam,
  readLatestSessionRecord,
  readSessionState,
  readTeamFile,
} from '../../src/team-core/index.js'
import { runReopenCommand } from '../../src/team-cli/commands/reopen.js'
import { runResumeCommand } from '../../src/team-cli/commands/resume.js'
import { runSpawnCommand } from '../../src/team-cli/commands/spawn.js'
import { createTempOptions } from '../test-helpers.js'

test('runResumeCommand starts a new session using stored runtime metadata', async t => {
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

  const spawned = await runSpawnCommand(
    'alpha team',
    'researcher',
    {
      prompt: 'Investigate the failure',
      cwd,
      maxIterations: 1,
    },
    options,
  )

  assert.match(spawned.message, /Spawned researcher/)

  const initialTeam = await readTeamFile('alpha team', options)
  const initialMember = initialTeam?.members.find(member => member.name === 'researcher')
  const initialSessionId = initialMember?.runtimeState?.sessionId

  await createTask(
    getTaskListIdForTeam('alpha team'),
    {
      subject: 'Investigate issue',
      description: 'Review the failing build',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  const resumed = await runResumeCommand(
    'alpha team',
    'researcher',
    {
      maxIterations: 1,
    },
    options,
  )

  assert.match(resumed.message, /Resumed researcher/)
  assert.match(resumed.message, /new-session/)

  const task = await getTask(getTaskListIdForTeam('alpha team'), '1', options)
  assert.equal(task?.status, 'completed')
  assert.equal(task?.owner, 'researcher@alpha team')

  const stored = await readTeamFile('alpha team', options)
  const teammate = stored?.members.find(member => member.name === 'researcher')
  const session = await readLatestSessionRecord('alpha team', 'researcher', options)
  const sessionState = await readSessionState('alpha team', 'researcher', options)
  assert.equal(teammate?.isActive, false)
  assert.equal(teammate?.runtimeState?.prompt?.includes('Investigate the failure'), true)
  assert.equal(teammate?.runtimeState?.lastExitAt !== undefined, true)
  assert.notEqual(teammate?.runtimeState?.sessionId, initialSessionId)
  assert.equal(teammate?.runtimeState?.lastSessionId, initialSessionId)
  assert.equal(teammate?.runtimeState?.reopenCount, 0)
  assert.notEqual(session?.sessionId, initialSessionId)
  assert.equal(session?.status, 'closed')
  assert.equal(session?.reopenedAt.length, 0)
  assert.equal(sessionState.sessions.length, 2)
})

test('runReopenCommand reuses the stored session id and records a reopen', async t => {
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

  const spawned = await runSpawnCommand(
    'alpha team',
    'researcher',
    {
      prompt: 'Investigate the failure',
      cwd,
      maxIterations: 1,
    },
    options,
  )

  assert.match(spawned.message, /Spawned researcher/)

  const initialTeam = await readTeamFile('alpha team', options)
  const initialMember = initialTeam?.members.find(member => member.name === 'researcher')
  const initialSessionId = initialMember?.runtimeState?.sessionId

  await createTask(
    getTaskListIdForTeam('alpha team'),
    {
      subject: 'Investigate issue',
      description: 'Review the failing build',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  const reopened = await runReopenCommand(
    'alpha team',
    'researcher',
    {
      maxIterations: 1,
    },
    options,
  )

  assert.match(reopened.message, /Reopened researcher/)
  assert.match(reopened.message, /existing-session/)

  const task = await getTask(getTaskListIdForTeam('alpha team'), '1', options)
  assert.equal(task?.status, 'completed')
  assert.equal(task?.owner, 'researcher@alpha team')

  const stored = await readTeamFile('alpha team', options)
  const teammate = stored?.members.find(member => member.name === 'researcher')
  const session = await readLatestSessionRecord('alpha team', 'researcher', options)
  const sessionState = await readSessionState('alpha team', 'researcher', options)
  assert.equal(teammate?.runtimeState?.sessionId, initialSessionId)
  assert.equal(teammate?.runtimeState?.reopenCount, 1)
  assert.equal(session?.sessionId, initialSessionId)
  assert.equal(session?.status, 'closed')
  assert.equal(session?.reopenedAt.length, 1)
  assert.equal(sessionState.sessions.length, 1)
})

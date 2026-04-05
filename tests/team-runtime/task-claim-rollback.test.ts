import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createRuntimeContext,
  resolveNextWorkItem,
} from '../../src/team-runtime/index.js'
import {
  createTask,
  createTeam,
  getTask,
  getTaskListIdForTeam,
  upsertTeamMember,
} from '../../src/team-core/index.js'
import { createTempOptions } from '../test-helpers.js'

async function createTeamWithWorker(
  options: Awaited<ReturnType<typeof createTempOptions>>,
  cwd: string,
): Promise<void> {
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
}

test('resolveNextWorkItem rolls a claimed task back to pending if the in_progress update fails', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'
  await createTeamWithWorker(options, cwd)

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

  const runtimeContext = createRuntimeContext({
    agentId: 'researcher@alpha team',
    agentName: 'researcher',
    teamName: 'alpha team',
  })

  const firstWorkItem = await resolveNextWorkItem(
    {
      name: 'researcher',
      teamName: 'alpha team',
      prompt: 'Investigate issues',
      cwd,
    },
    runtimeContext,
    options,
    {
      async taskUpdateImpl() {
        throw new Error('forced update failure')
      },
    },
  )

  assert.equal(firstWorkItem, null)

  const rolledBackTask = await getTask(
    getTaskListIdForTeam('alpha team'),
    '1',
    options,
  )
  assert.equal(rolledBackTask?.status, 'pending')
  assert.equal(rolledBackTask?.owner, undefined)

  const secondWorkItem = await resolveNextWorkItem(
    {
      name: 'researcher',
      teamName: 'alpha team',
      prompt: 'Investigate issues',
      cwd,
    },
    runtimeContext,
    options,
  )

  assert.equal(secondWorkItem?.kind, 'task')

  const claimedTask = await getTask(
    getTaskListIdForTeam('alpha team'),
    '1',
    options,
  )
  assert.equal(claimedTask?.status, 'in_progress')
  assert.equal(claimedTask?.owner, 'researcher@alpha team')
})

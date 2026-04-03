import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendTranscriptEntry,
  createPermissionRequestRecord,
  createPlanApprovalRequestMessage,
  createTask,
  createTeam,
  createTranscriptEntry,
  setMemberActive,
  updateTask,
  upsertTeamMember,
  writePendingPermissionRequest,
  writeToMailbox,
} from '../../src/team-core/index.js'
import { getTaskListIdForTeam } from '../../src/team-core/paths.js'
import { listPendingApprovals, listTeams, loadDashboard } from '../../src/team-operator/index.js'
import { createTempOptions } from '../test-helpers.js'

test('team-operator aggregates dashboard state, activity, and approvals', async t => {
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
        prompt: 'help with tasks',
        cwd,
      },
    },
    options,
  )

  await createTask(
    getTaskListIdForTeam('alpha team'),
    {
      subject: 'Investigate parser',
      description: 'Check the parser issue',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  await appendTranscriptEntry(
    'alpha team',
    'researcher',
    createTranscriptEntry({
      sessionId: 'session-1',
      agentName: 'researcher',
      role: 'assistant',
      content: 'peer-note:researcher->reviewer',
    }),
    options,
  )

  await writeToMailbox(
    'alpha team',
    'team-lead',
    {
      from: 'researcher',
      text: JSON.stringify(
        createPlanApprovalRequestMessage({
          from: 'researcher',
          planFilePath: '/tmp/plan.md',
          planContent: '# plan',
          requestId: 'plan-1',
        }),
      ),
      timestamp: new Date().toISOString(),
      summary: 'plan request',
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
      description: 'Run build',
      input: {
        cmd: 'npm test',
        cwd,
      },
    }),
    options,
  )

  const teams = await listTeams(options)
  assert.equal(teams.length, 1)
  assert.equal(teams[0]?.name, 'alpha team')

  const approvals = await listPendingApprovals('alpha team', options)
  assert.equal(approvals.length, 2)

  const dashboard = await loadDashboard(
    'alpha team',
    options,
    {
      selectedAgentName: 'researcher',
    },
  )

  assert.ok(dashboard)
  assert.equal(dashboard?.taskCounts.pending, 1)
  assert.equal(dashboard?.approvals.length, 2)
  assert.equal(dashboard?.transcriptAgentName, 'researcher')
  assert.match(dashboard?.activity.at(-1)?.text ?? '', /pending plan approval/)
  assert.match(dashboard?.transcriptEntries[0]?.content ?? '', /peer-note/)
})

test('dashboard aggregates an inactive teammate with no open owned tasks as idle', async t => {
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
        runtimeKind: 'local',
        prompt: 'help with tasks',
        cwd,
      },
    },
    options,
  )

  await createTask(
    getTaskListIdForTeam('alpha team'),
    {
      subject: 'Investigate parser',
      description: 'Check the parser issue',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  await updateTask(
    getTaskListIdForTeam('alpha team'),
    '1',
    {
      status: 'completed',
      owner: 'researcher@alpha team',
    },
    options,
  )
  await setMemberActive('alpha team', 'researcher', false, options)

  const dashboard = await loadDashboard('alpha team', options)
  assert.ok(dashboard)

  const researcher = dashboard?.statuses.find(status => status.name === 'researcher')
  assert.equal(researcher?.status, 'idle')
  assert.equal(researcher?.isActive, false)
  assert.deepEqual(researcher?.currentTasks ?? [], [])
  assert.equal(dashboard?.taskCounts.completed, 1)
  assert.equal(dashboard?.taskCounts.inProgress, 0)
})

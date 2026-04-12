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
import {
  listPendingApprovals,
  listTeams,
  loadDashboard,
  loadGlobalDashboardSummary,
} from '../../src/team-operator/index.js'
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
  assert.equal(teams[0]?.resultState, 'attention')
  assert.equal(teams[0]?.pendingApprovals, 2)
  assert.equal(teams[0]?.activeWorkerCount, 1)
  assert.equal(teams[0]?.taskCounts.pending, 1)
  assert.match(teams[0]?.attentionReasons.join(' ') ?? '', /approval/i)

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

test('listTeams sorts attention teams first and surfaces overview counts', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'

  await createTeam(
    {
      teamName: 'blocked team',
      leadAgentId: 'team-lead@blocked team',
      leadMember: {
        name: 'team-lead',
        agentType: 'team-lead',
        cwd,
        subscriptions: [],
      },
    },
    options,
  )
  await createTask(
    getTaskListIdForTeam('blocked team'),
    {
      subject: 'Wait for approval',
      description: 'Blocked until someone approves the command.',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )
  await writePendingPermissionRequest(
    createPermissionRequestRecord({
      id: 'perm-blocked',
      teamName: 'blocked team',
      workerId: 'researcher@blocked team',
      workerName: 'researcher',
      toolName: 'exec_command',
      toolUseId: 'tool-blocked',
      description: 'Run the blocked task',
      input: {
        cmd: 'npm run build',
        cwd,
      },
    }),
    options,
  )

  await createTeam(
    {
      teamName: 'running team',
      leadAgentId: 'team-lead@running team',
      leadMember: {
        name: 'team-lead',
        agentType: 'team-lead',
        cwd,
        subscriptions: [],
      },
    },
    options,
  )
  await createTask(
    getTaskListIdForTeam('running team'),
    {
      subject: 'Keep processing',
      description: 'A worker is currently active on this task.',
      status: 'pending',
      owner: 'researcher@running team',
      blocks: [],
      blockedBy: [],
    },
    options,
  )
  await upsertTeamMember(
    'running team',
    {
      agentId: 'researcher@running team',
      name: 'researcher',
      agentType: 'researcher',
      cwd,
      subscriptions: [],
      joinedAt: Date.now(),
      backendType: 'in-process',
      isActive: true,
      runtimeState: {
        runtimeKind: 'codex-cli',
        currentWorkKind: 'task',
        currentTaskId: '1',
        turnStartedAt: Date.now() - 1_000,
        lastHeartbeatAt: Date.now() - 100,
      },
    },
    options,
  )

  await createTeam(
    {
      teamName: 'completed team',
      leadAgentId: 'team-lead@completed team',
      leadMember: {
        name: 'team-lead',
        agentType: 'team-lead',
        cwd,
        subscriptions: [],
      },
    },
    options,
  )
  await createTask(
    getTaskListIdForTeam('completed team'),
    {
      subject: 'Already done',
      description: 'This team has finished its only task.',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )
  await updateTask(
    getTaskListIdForTeam('completed team'),
    '1',
    {
      status: 'completed',
    },
    options,
  )

  const teams = await listTeams(options)
  assert.deepEqual(
    teams.map(team => team.name),
    ['blocked team', 'running team', 'completed team'],
  )
  assert.equal(teams[0]?.resultState, 'attention')
  assert.equal(teams[0]?.pendingApprovals, 1)
  assert.equal(teams[0]?.taskCounts.pending, 1)
  assert.match(teams[0]?.attentionReasons.join(' ') ?? '', /pending approval/i)
  assert.equal(teams[1]?.resultState, 'running')
  assert.equal(teams[1]?.activeWorkerCount, 1)
  assert.equal(teams[1]?.executingWorkerCount, 1)
  assert.equal(teams[2]?.resultState, 'completed')
  assert.equal(teams[2]?.taskCounts.completed, 1)
})

test('loadGlobalDashboardSummary aggregates totals, attention grouping, and empty state', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'

  const emptySummary = await loadGlobalDashboardSummary(options)
  assert.equal(emptySummary.teamCounts.total, 0)
  assert.equal(emptySummary.pendingApprovalsTotal, 0)
  assert.deepEqual(emptySummary.attentionTeams, [])

  await createTeam(
    {
      teamName: 'approval team',
      leadAgentId: 'team-lead@approval team',
      leadMember: {
        name: 'team-lead',
        agentType: 'team-lead',
        cwd,
        subscriptions: [],
      },
    },
    options,
  )
  await createTask(
    getTaskListIdForTeam('approval team'),
    {
      subject: 'Need an approval',
      description: 'Wait for approval before continuing.',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )
  await writePendingPermissionRequest(
    createPermissionRequestRecord({
      id: 'perm-approval',
      teamName: 'approval team',
      workerId: 'researcher@approval team',
      workerName: 'researcher',
      toolName: 'exec_command',
      toolUseId: 'tool-approval',
      description: 'Run build',
      input: {
        cmd: 'npm run build',
        cwd,
      },
    }),
    options,
  )

  await createTeam(
    {
      teamName: 'stale team',
      leadAgentId: 'team-lead@stale team',
      leadMember: {
        name: 'team-lead',
        agentType: 'team-lead',
        cwd,
        subscriptions: [],
      },
    },
    options,
  )
  await createTask(
    getTaskListIdForTeam('stale team'),
    {
      subject: 'Recover stale worker',
      description: 'Investigate the stale execution turn.',
      status: 'pending',
      owner: 'worker@stale team',
      blocks: [],
      blockedBy: [],
    },
    options,
  )
  await upsertTeamMember(
    'stale team',
    {
      agentId: 'worker@stale team',
      name: 'worker',
      agentType: 'worker',
      cwd,
      subscriptions: [],
      joinedAt: Date.now(),
      backendType: 'in-process',
      isActive: true,
      runtimeState: {
        runtimeKind: 'codex-cli',
        currentWorkKind: 'task',
        currentTaskId: '1',
        turnStartedAt: Date.now() - 60_000,
        lastHeartbeatAt: Date.now() - 60_000,
      },
    },
    options,
  )

  await createTeam(
    {
      teamName: 'completed team',
      leadAgentId: 'team-lead@completed team',
      leadMember: {
        name: 'team-lead',
        agentType: 'team-lead',
        cwd,
        subscriptions: [],
      },
    },
    options,
  )
  await createTask(
    getTaskListIdForTeam('completed team'),
    {
      subject: 'Ship notes',
      description: 'Done already.',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )
  await updateTask(
    getTaskListIdForTeam('completed team'),
    '1',
    { status: 'completed' },
    options,
  )

  const summary = await loadGlobalDashboardSummary(options)
  assert.equal(summary.teamCounts.total, 3)
  assert.equal(summary.teamCounts.attention, 2)
  assert.equal(summary.teamCounts.completed, 1)
  assert.equal(summary.pendingApprovalsTotal, 1)
  assert.equal(summary.staleWorkersTotal, 1)
  assert.deepEqual(
    summary.attentionTeams.map(team => team.name),
    ['approval team', 'stale team'],
  )
  assert.equal(summary.pendingApprovalTeams[0]?.name, 'approval team')
  assert.equal(summary.staleWorkerTeams[0]?.name, 'stale team')
  assert.equal(summary.blockedOrPendingTeams[0]?.name, 'approval team')
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

test('dashboard promotes pending task counts to in_progress during an active task turn', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'
  const teamName = 'effective counts team'

  await createTeam(
    {
      teamName,
      leadAgentId: `team-lead@${teamName}`,
      leadMember: {
        name: 'team-lead',
        agentType: 'team-lead',
        cwd,
        subscriptions: [],
      },
    },
    options,
  )

  await createTask(
    getTaskListIdForTeam(teamName),
    {
      subject: 'Keep counts consistent with runtime state',
      description: 'Pending task should surface as effective in_progress',
      status: 'pending',
      owner: `researcher@${teamName}`,
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  await upsertTeamMember(
    teamName,
    {
      agentId: `researcher@${teamName}`,
      name: 'researcher',
      agentType: 'researcher',
      cwd,
      subscriptions: [],
      joinedAt: Date.now(),
      backendType: 'in-process',
      isActive: true,
      runtimeState: {
        runtimeKind: 'codex-cli',
        currentWorkKind: 'task',
        currentTaskId: '1',
        turnStartedAt: Date.now() - 1_500,
        lastHeartbeatAt: Date.now() - 100,
      },
    },
    options,
  )

  const dashboard = await loadDashboard(teamName, options)
  assert.ok(dashboard)
  assert.equal(dashboard?.taskCounts.pending, 0)
  assert.equal(dashboard?.taskCounts.inProgress, 1)
  assert.equal(dashboard?.taskCounts.completed, 0)
})

test('dashboard exposes file-collision guardrail warnings for overlapping open tasks', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'
  const teamName = 'collision dashboard team'

  await createTeam(
    {
      teamName,
      leadAgentId: `team-lead@${teamName}`,
      leadMember: {
        name: 'team-lead',
        agentType: 'team-lead',
        cwd,
        subscriptions: [],
      },
    },
    options,
  )

  await createTask(
    getTaskListIdForTeam(teamName),
    {
      subject: 'Implement the app shell',
      description: 'Touch frontend/ and backend/ in one broad task.',
      status: 'pending',
      owner: `planner@${teamName}`,
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  await createTask(
    getTaskListIdForTeam(teamName),
    {
      subject: 'Refine the frontend shell',
      description: 'Also update frontend/ while the broad task is open.',
      status: 'pending',
      owner: `frontend@${teamName}`,
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  const dashboard = await loadDashboard(teamName, options)
  assert.ok(dashboard)
  assert.ok((dashboard?.guardrailWarnings.length ?? 0) > 0)
  assert.match(
    dashboard?.guardrailWarnings[0]?.message ?? '',
    /Task #1 spans multiple areas|Tasks #1 and #2 both touch/i,
  )
})

test('dashboard exposes team-size and broadcast cost warnings', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'
  const teamName = 'cost dashboard team'

  await createTeam(
    {
      teamName,
      leadAgentId: `team-lead@${teamName}`,
      leadMember: {
        name: 'team-lead',
        agentType: 'team-lead',
        cwd,
        subscriptions: [],
      },
    },
    options,
  )

  for (const agentName of ['a', 'b', 'c', 'd', 'e', 'f']) {
    await upsertTeamMember(
      teamName,
      {
        agentId: `${agentName}@${teamName}`,
        name: agentName,
        agentType: agentName,
        cwd,
        subscriptions: [],
        joinedAt: Date.now(),
        backendType: 'in-process',
        isActive: true,
      },
      options,
    )

    await writeToMailbox(
      teamName,
      agentName,
      {
        from: 'team-lead',
        text: 'broadcast:phase-1',
        timestamp: new Date().toISOString(),
        summary: 'broadcast',
      },
      options,
    )
  }

  const dashboard = await loadDashboard(teamName, options)
  assert.ok(dashboard)
  assert.ok(
    dashboard?.costWarnings.some(warning => warning.code === 'large_team'),
  )
  assert.ok(
    dashboard?.costWarnings.some(warning => warning.code === 'broadcast_fanout'),
  )
})

import { readdir } from 'node:fs/promises'
import {
  analyzeTaskGuardrails,
  analyzeTeamCostGuardrails,
  deriveEffectiveTaskState,
  getAgentDisplayInfo,
  getAgentStatuses,
  readAgentLogSnapshots,
  getTaskListIdForTeam,
  getTeamsDir,
  isIdleNotification,
  isPermissionRequest,
  isPlanApprovalRequest,
  isSandboxPermissionRequest,
  isShutdownRequest,
  isTeamPermissionUpdate,
  listTasks,
  parseStructuredMessage,
  pathExists,
  readJsonFile,
  readMailbox,
  readPendingPermissionRequests,
  readTeamFile,
  readTranscriptEntries,
  repairLostDetachedMembers,
  type TeamCoreOptions,
  type TeamFile,
} from '../team-core/index.js'
import type {
  DashboardActivityItem,
  DashboardApprovalItem,
  GlobalDashboardSummary,
  LoadDashboardInput,
  TeamDashboard,
  TeamListItem,
} from './types.js'

function pluralize(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return count === 1 ? singular : plural
}

function classifyTeamListState(input: {
  totalTasks: number
  pendingTasks: number
  inProgressTasks: number
  completedTasks: number
  activeWorkerCount: number
  pendingApprovals: number
  staleWorkerCount: number
}): TeamListItem['resultState'] {
  if (input.pendingApprovals > 0 || input.staleWorkerCount > 0) {
    return 'attention'
  }
  if (input.totalTasks > 0 && input.completedTasks === input.totalTasks) {
    return 'completed'
  }
  if (input.activeWorkerCount > 0 || input.inProgressTasks > 0) {
    return 'running'
  }
  return 'pending'
}

function buildTeamAttentionReasons(input: {
  pendingApprovals: number
  staleWorkerCount: number
  pendingTasks: number
  activeWorkerCount: number
  inProgressTasks: number
}): string[] {
  const reasons: string[] = []
  if (input.pendingApprovals > 0) {
    reasons.push(
      `${input.pendingApprovals} pending ${pluralize(input.pendingApprovals, 'approval')}`,
    )
  }
  if (input.staleWorkerCount > 0) {
    reasons.push(
      `${input.staleWorkerCount} ${pluralize(input.staleWorkerCount, 'stale worker')}`,
    )
  }
  if (
    input.pendingTasks > 0 &&
    input.activeWorkerCount === 0 &&
    input.inProgressTasks === 0
  ) {
    reasons.push(
      `${input.pendingTasks} pending ${pluralize(input.pendingTasks, 'task')} with no active worker`,
    )
  }
  return reasons
}

function getTeamListStatePriority(
  state: TeamListItem['resultState'],
): number {
  if (state === 'attention') {
    return 0
  }
  if (state === 'running') {
    return 1
  }
  if (state === 'pending') {
    return 2
  }
  return 3
}

function getMessageTimestamp(value: string | undefined): number {
  if (!value) {
    return 0
  }
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function toActivityText(messageText: string): string {
  const idle = isIdleNotification(messageText)
  if (idle) {
    return idle.summary ?? `${idle.from} is ${idle.idleReason ?? 'available'}`
  }

  const permissionRequest = isPermissionRequest(messageText)
  if (permissionRequest) {
    return `permission request ${permissionRequest.tool_name}: ${permissionRequest.description}`
  }

  const planRequest = isPlanApprovalRequest(messageText)
  if (planRequest) {
    return `pending plan approval: ${planRequest.requestId}`
  }

  const sandboxRequest = isSandboxPermissionRequest(messageText)
  if (sandboxRequest) {
    return `pending sandbox approval: ${sandboxRequest.hostPattern.host}`
  }

  const shutdownRequest = isShutdownRequest(messageText)
  if (shutdownRequest) {
    return `shutdown request: ${shutdownRequest.reason ?? 'no reason provided'}`
  }

  const permissionUpdate = isTeamPermissionUpdate(messageText)
  if (permissionUpdate) {
    return `permission rules updated for ${permissionUpdate.toolName}`
  }

  return messageText.replace(/\s+/g, ' ').trim().slice(0, 240)
}

function toActivityKind(
  messageText: string,
): DashboardActivityItem['kind'] {
  const structured = parseStructuredMessage(messageText)
  if (!structured) {
    return 'message'
  }
  if (structured.type === 'idle_notification') {
    return 'idle'
  }
  if (structured.type === 'permission_request') {
    return 'permission_request'
  }
  if (structured.type === 'plan_approval_request') {
    return 'plan_request'
  }
  if (structured.type === 'sandbox_permission_request') {
    return 'sandbox_request'
  }
  if (structured.type === 'shutdown_request') {
    return 'shutdown_request'
  }
  if (structured.type === 'team_permission_update') {
    return 'permission_update'
  }
  return 'message'
}

function buildActivity(
  leaderMailbox: Awaited<ReturnType<typeof readMailbox>>,
  limit: number,
): DashboardActivityItem[] {
  return leaderMailbox
    .slice(-limit)
    .map((message, index) => ({
      id: `${message.timestamp}-${index}-${message.from}`,
      from: message.from,
      text: toActivityText(message.text),
      createdAt: getMessageTimestamp(message.timestamp),
      unread: !message.read,
      kind: toActivityKind(message.text),
    }))
    .sort((left, right) => left.createdAt - right.createdAt)
}

export async function listTeams(
  options: TeamCoreOptions = {},
): Promise<TeamListItem[]> {
  const teamsDir = getTeamsDir(options)
  if (!(await pathExists(teamsDir))) {
    return []
  }

  const entries = await readdir(teamsDir, { withFileTypes: true })
  const teams = await Promise.all(
    entries
      .filter(entry => entry.isDirectory())
      .map(async entry => {
        const configPath = `${teamsDir}/${entry.name}/config.json`
        const team = await readJsonFile<TeamFile | null>(configPath, null)
        if (!team) {
          return null
        }

        await repairLostDetachedMembers(team.name, options)
        const [statuses, tasks, leaderMailbox, approvals] = await Promise.all([
          getAgentStatuses(team.name, options),
          listTasks(getTaskListIdForTeam(team.name), options),
          readMailbox(team.name, 'team-lead', options),
          listPendingApprovals(team.name, options),
        ])
        const resolvedStatuses = (statuses ?? []).filter(
          status => status.name !== 'team-lead',
        )
        const effectiveTaskState = deriveEffectiveTaskState({
          tasks,
          statuses: resolvedStatuses,
        })
        const displayNow = Date.now()
        const displayStates = resolvedStatuses.map(status => ({
          status,
          display: getAgentDisplayInfo(status, displayNow),
        }))
        const activeWorkerCount = resolvedStatuses.filter(
          status => status.isActive === true,
        ).length
        const executingWorkerCount = displayStates.filter(
          item => item.display.state === 'executing-turn',
        ).length
        const staleWorkerCount = displayStates.filter(
          item => item.display.state === 'stale',
        ).length
        const taskCounts = {
          total: tasks.length,
          pending: effectiveTaskState.counts.pending,
          inProgress: effectiveTaskState.counts.inProgress,
          completed: effectiveTaskState.counts.completed,
        }
        const resultState = classifyTeamListState({
          totalTasks: taskCounts.total,
          pendingTasks: taskCounts.pending,
          inProgressTasks: taskCounts.inProgress,
          completedTasks: taskCounts.completed,
          activeWorkerCount,
          pendingApprovals: approvals.length,
          staleWorkerCount,
        })
        const attentionReasons = buildTeamAttentionReasons({
          pendingApprovals: approvals.length,
          staleWorkerCount,
          pendingTasks: taskCounts.pending,
          activeWorkerCount,
          inProgressTasks: taskCounts.inProgress,
        })

        return {
          name: team.name,
          description: team.description,
          createdAt: team.createdAt,
          memberCount: team.members.length,
          resultState,
          pendingApprovals: approvals.length,
          activeWorkerCount,
          executingWorkerCount,
          staleWorkerCount,
          unreadLeaderMessages: leaderMailbox.filter(message => !message.read)
            .length,
          taskCounts,
          attentionReasons,
        } satisfies TeamListItem
      }),
  )

  return teams
    .filter(team => team !== null)
    .map(team => ({
      name: team.name,
      description: team.description,
      createdAt: team.createdAt,
      memberCount: team.memberCount,
      resultState: team.resultState,
      pendingApprovals: team.pendingApprovals,
      activeWorkerCount: team.activeWorkerCount,
      executingWorkerCount: team.executingWorkerCount,
      staleWorkerCount: team.staleWorkerCount,
      unreadLeaderMessages: team.unreadLeaderMessages,
      taskCounts: team.taskCounts,
      attentionReasons: team.attentionReasons,
    }))
    .sort((left, right) => {
      const stateDiff =
        getTeamListStatePriority(left.resultState) -
        getTeamListStatePriority(right.resultState)
      if (stateDiff !== 0) {
        return stateDiff
      }

      const attentionDiff =
        right.pendingApprovals +
        right.staleWorkerCount +
        right.taskCounts.pending -
        (left.pendingApprovals + left.staleWorkerCount + left.taskCounts.pending)
      if (attentionDiff !== 0) {
        return attentionDiff
      }

      return left.name.localeCompare(right.name)
    })
}

function sortTeamsByCount(
  teams: TeamListItem[],
  getCount: (team: TeamListItem) => number,
): TeamListItem[] {
  return [...teams].sort((left, right) => {
    const countDiff = getCount(right) - getCount(left)
    if (countDiff !== 0) {
      return countDiff
    }

    const stateDiff =
      getTeamListStatePriority(left.resultState) -
      getTeamListStatePriority(right.resultState)
    if (stateDiff !== 0) {
      return stateDiff
    }

    return left.name.localeCompare(right.name)
  })
}

export async function loadGlobalDashboardSummary(
  options: TeamCoreOptions = {},
): Promise<GlobalDashboardSummary> {
  const teams = await listTeams(options)

  const teamCounts = {
    total: teams.length,
    attention: teams.filter(team => team.resultState === 'attention').length,
    running: teams.filter(team => team.resultState === 'running').length,
    pending: teams.filter(team => team.resultState === 'pending').length,
    completed: teams.filter(team => team.resultState === 'completed').length,
  }

  const pendingApprovalsTotal = teams.reduce(
    (sum, team) => sum + team.pendingApprovals,
    0,
  )
  const activeWorkersTotal = teams.reduce(
    (sum, team) => sum + team.activeWorkerCount,
    0,
  )
  const executingWorkersTotal = teams.reduce(
    (sum, team) => sum + team.executingWorkerCount,
    0,
  )
  const staleWorkersTotal = teams.reduce(
    (sum, team) => sum + team.staleWorkerCount,
    0,
  )
  const unreadLeaderMessagesTotal = teams.reduce(
    (sum, team) => sum + team.unreadLeaderMessages,
    0,
  )

  return {
    teams,
    teamCounts,
    pendingApprovalsTotal,
    activeWorkersTotal,
    executingWorkersTotal,
    staleWorkersTotal,
    unreadLeaderMessagesTotal,
    attentionTeams: teams.filter(team => team.resultState === 'attention'),
    pendingApprovalTeams: sortTeamsByCount(
      teams.filter(team => team.pendingApprovals > 0),
      team => team.pendingApprovals,
    ),
    staleWorkerTeams: sortTeamsByCount(
      teams.filter(team => team.staleWorkerCount > 0),
      team => team.staleWorkerCount,
    ),
    activeWorkerTeams: sortTeamsByCount(
      teams.filter(team => team.activeWorkerCount > 0),
      team => team.activeWorkerCount,
    ),
    blockedOrPendingTeams: sortTeamsByCount(
      teams.filter(
        team =>
          team.taskCounts.pending > 0 ||
          (team.resultState === 'attention' && team.taskCounts.inProgress === 0),
      ),
      team => team.taskCounts.pending,
    ),
  }
}

export async function listPendingApprovals(
  teamName: string,
  options: TeamCoreOptions = {},
): Promise<DashboardApprovalItem[]> {
  const [permissionRequests, leaderMailbox] = await Promise.all([
    readPendingPermissionRequests(teamName, options),
    readMailbox(teamName, 'team-lead', options),
  ])

  const permissionApprovals: DashboardApprovalItem[] = permissionRequests.map(
    request => ({
      id: `permission:${request.id}`,
      kind: 'permission',
      requestId: request.id,
      recipientName: request.workerName,
      workerName: request.workerName,
      toolName: request.toolName,
      description: request.description,
      createdAt: request.createdAt,
      request,
    }),
  )

  const mailboxApprovals: DashboardApprovalItem[] = leaderMailbox
    .filter(message => !message.read)
    .flatMap<DashboardApprovalItem>(message => {
      const planRequest = isPlanApprovalRequest(message.text)
      if (planRequest) {
        return [
          {
            id: `plan:${planRequest.requestId}`,
            kind: 'plan',
            requestId: planRequest.requestId,
            recipientName: planRequest.from,
            workerName: planRequest.from,
            planFilePath: planRequest.planFilePath,
            planContent: planRequest.planContent,
            createdAt: getMessageTimestamp(planRequest.timestamp),
          },
        ]
      }

      const sandboxRequest = isSandboxPermissionRequest(message.text)
      if (sandboxRequest) {
        return [
          {
            id: `sandbox:${sandboxRequest.requestId}`,
            kind: 'sandbox',
            requestId: sandboxRequest.requestId,
            recipientName: sandboxRequest.workerName,
            workerName: sandboxRequest.workerName,
            host: sandboxRequest.hostPattern.host,
            createdAt: sandboxRequest.createdAt,
          },
        ]
      }

      return []
    })

  return [...permissionApprovals, ...mailboxApprovals].sort(
    (left, right) => left.createdAt - right.createdAt,
  )
}

function getDefaultTranscriptAgentName(
  team: TeamFile,
  selectedAgentName?: string,
): string | undefined {
  if (
    selectedAgentName &&
    team.members.some(member => member.name === selectedAgentName)
  ) {
    return selectedAgentName
  }

  return (
    team.members.find(member => member.name !== 'team-lead')?.name ??
    team.members[0]?.name
  )
}

export async function loadDashboard(
  teamName: string,
  options: TeamCoreOptions = {},
  input: LoadDashboardInput = {},
): Promise<TeamDashboard | null> {
  await repairLostDetachedMembers(teamName, options)
  const transcriptLimit = input.transcriptLimit ?? 12
  const activityLimit = input.activityLimit ?? 12
  const team = await readTeamFile(teamName, options)

  if (!team) {
    return null
  }

  const transcriptAgentName = getDefaultTranscriptAgentName(
    team,
    input.selectedAgentName,
  )

  const [statuses, tasks, leaderMailbox, approvals, transcriptEntries] =
    await Promise.all([
      getAgentStatuses(teamName, options),
      listTasks(getTaskListIdForTeam(teamName), options),
      readMailbox(teamName, 'team-lead', options),
      listPendingApprovals(teamName, options),
      transcriptAgentName
        ? readTranscriptEntries(teamName, transcriptAgentName, options)
        : Promise.resolve([]),
    ])
  const recipientMailboxes = await Promise.all(
    team.members
      .filter(member => member.name !== 'team-lead')
      .map(async member => ({
        recipientName: member.name,
        messages: await readMailbox(teamName, member.name, options),
      })),
  )

  const resolvedStatuses = statuses ?? []
  const logViewerStatus = input.selectedAgentName
    ? resolvedStatuses.find(status => status.name === input.selectedAgentName)
    : undefined
  const logViewer = logViewerStatus
    ? {
        agentName: logViewerStatus.name,
        snapshots: await readAgentLogSnapshots(logViewerStatus, {
          maxLines: input.logTailLines ?? 24,
          maxBytes: input.logTailBytes ?? 16 * 1024,
        }),
      }
    : undefined
  const effectiveTaskState = deriveEffectiveTaskState({
    tasks,
    statuses: resolvedStatuses,
  })
  const guardrails = analyzeTaskGuardrails(tasks)
  const costGuardrails = analyzeTeamCostGuardrails({
    team,
    tasks,
    statuses: resolvedStatuses,
    recipientMailboxes,
  })

  return {
    team,
    statuses: resolvedStatuses,
    tasks,
    taskCounts: effectiveTaskState.counts,
    guardrailWarnings: guardrails.warnings,
    costWarnings: costGuardrails.warnings,
    activity: buildActivity(leaderMailbox, activityLimit),
    approvals,
    transcriptAgentName,
    transcriptEntries: transcriptEntries.slice(-transcriptLimit),
    logViewer,
    unreadLeaderMessages: leaderMailbox.filter(message => !message.read).length,
    rootDir: options.rootDir,
  }
}

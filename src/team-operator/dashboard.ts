import { readdir } from 'node:fs/promises'
import {
  getAgentStatuses,
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
  type TeamCoreOptions,
  type TeamFile,
} from '../team-core/index.js'
import type {
  DashboardActivityItem,
  DashboardApprovalItem,
  LoadDashboardInput,
  TeamDashboard,
  TeamListItem,
} from './types.js'

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
        return {
          name: team.name,
          description: team.description,
          createdAt: team.createdAt,
          memberCount: team.members.length,
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
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
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

  return {
    team,
    statuses: statuses ?? [],
    tasks,
    taskCounts: {
      pending: tasks.filter(task => task.status === 'pending').length,
      inProgress: tasks.filter(task => task.status === 'in_progress').length,
      completed: tasks.filter(task => task.status === 'completed').length,
    },
    activity: buildActivity(leaderMailbox, activityLimit),
    approvals,
    transcriptAgentName,
    transcriptEntries: transcriptEntries.slice(-transcriptLimit),
    unreadLeaderMessages: leaderMailbox.filter(message => !message.read).length,
    rootDir: options.rootDir,
  }
}

import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  getAgentStatuses,
  getTaskListIdForTeam,
  getTeamsDir,
  isIdleNotification,
  listTasks,
  pathExists,
  readMailbox,
  readTeamFile,
  readJsonFile,
  type TeamCoreOptions,
  type TeamFile,
} from '../../team-core/index.js'
import type { CliCommandResult } from '../types.js'
import { classifySummaryState, listWorkspaceFiles } from './summary-utils.js'

type ActivityItem = {
  text: string
  isFailure: boolean
  createdAt: number
}

function quoteSegment(segment: string): string {
  return /\s/.test(segment) ? JSON.stringify(segment) : segment
}

function renderUserInvocation(
  args: string[],
  options: TeamCoreOptions,
): string {
  return [
    'agent-team',
    ...(options.rootDir ? ['--root-dir', options.rootDir] : []),
    ...args,
  ]
    .map(quoteSegment)
    .join(' ')
}

function truncate(text: string, maxLength = 120): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`
}

async function listAvailableTeams(
  options: TeamCoreOptions,
): Promise<string[]> {
  const teamsDir = getTeamsDir(options)
  if (!(await pathExists(teamsDir))) {
    return []
  }

  const entries = await readdir(teamsDir, { withFileTypes: true })
  const teams = await Promise.all(
    entries
      .filter(entry => entry.isDirectory())
      .map(async entry => {
        const team = await readJsonFile<TeamFile | null>(
          join(teamsDir, entry.name, 'config.json'),
          null,
        )
        return team?.name ?? null
      }),
  )

  return teams
    .filter((teamName): teamName is string => teamName !== null)
    .sort((left, right) => left.localeCompare(right))
}

function buildRecentActivity(
  leaderMailbox: Awaited<ReturnType<typeof readMailbox>>,
): ActivityItem[] {
  return leaderMailbox
    .map(message => {
      const idle = isIdleNotification(message.text)
      if (idle) {
        if (idle.idleReason === 'failed') {
          return {
            text: `[${idle.from}] failed: ${truncate(
              idle.failureReason ?? idle.summary ?? 'unknown failure',
            )}`,
            isFailure: true,
            createdAt: Date.parse(idle.timestamp) || Date.now(),
          }
        }
        if (idle.completedTaskId) {
          return {
            text: `[${idle.from}] completed task #${idle.completedTaskId}: ${truncate(
              idle.summary ?? idle.completedStatus ?? 'completed',
            )}`,
            isFailure: false,
            createdAt: Date.parse(idle.timestamp) || Date.now(),
          }
        }
        return {
          text: `[${idle.from}] ${truncate(idle.summary ?? 'is idle')}`,
          isFailure: false,
          createdAt: Date.parse(idle.timestamp) || Date.now(),
        }
      }

      return {
        text: `[${message.from}] ${truncate(message.summary ?? message.text)}`,
        isFailure: false,
        createdAt: Date.parse(message.timestamp) || Date.now(),
      }
    })
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, 5)
}


export async function runAttachCommand(
  teamName: string | undefined,
  options: TeamCoreOptions = {},
): Promise<CliCommandResult> {
  if (!teamName) {
    const teams = await listAvailableTeams(options)
    return {
      success: teams.length > 0,
      message:
        teams.length === 0
          ? [
              'No teams found.',
              'Start a team with:',
              `- ${renderUserInvocation(['run', '<goal>', '--workspace', '<path>', '--runtime', 'codex-cli'], options)}`,
            ].join('\n')
          : [
              'Available teams:',
              ...teams.map(name => `- ${name}`),
              '',
              'Attach with:',
              `- ${renderUserInvocation(['attach', '<team-name>'], options)}`,
            ].join('\n'),
    }
  }

  const team = await readTeamFile(teamName, options)
  if (!team) {
    const teams = await listAvailableTeams(options)
    return {
      success: false,
      message: [
        `Team "${teamName}" does not exist.`,
        ...(teams.length > 0
          ? ['', 'Available teams:', ...teams.map(name => `- ${name}`)]
          : []),
      ].join('\n'),
    }
  }

  const [statuses, tasks, leaderMailbox] = await Promise.all([
    getAgentStatuses(teamName, options),
    listTasks(getTaskListIdForTeam(teamName), options),
    readMailbox(teamName, 'team-lead', options),
  ])

  const resolvedStatuses = statuses ?? []
  const totalTasks = tasks.length
  const pendingTasks = tasks.filter(task => task.status === 'pending').length
  const inProgressTasks = tasks.filter(task => task.status === 'in_progress').length
  const completedTasks = tasks.filter(task => task.status === 'completed').length
  const activeMembers = resolvedStatuses.filter(status => status.isActive === true).length
  const busyMembers = resolvedStatuses.filter(status => status.status === 'busy').length
  const idleMembers = resolvedStatuses.filter(status => status.status === 'idle').length

  const recentActivity = buildRecentActivity(leaderMailbox)
  const failureCount = recentActivity.filter(item => item.isFailure).length
  const summaryState = classifySummaryState({
    totalTasks,
    pendingTasks,
    inProgressTasks,
    completedTasks,
    activeMembers,
    failureCount,
  })

  const workspacePath =
    team.members.find(member => member.name === 'team-lead')?.cwd ??
    team.members[0]?.cwd
  const resolvedWorkspace = workspacePath ? resolve(workspacePath) : undefined
  const workspaceFiles =
    resolvedWorkspace === undefined
      ? []
      : await listWorkspaceFiles(resolvedWorkspace)

  const nextCommands = [
    renderUserInvocation(['attach', teamName], options),
    renderUserInvocation(['watch', teamName], options),
    renderUserInvocation(['tui', teamName], options),
    renderUserInvocation(['status', teamName], options),
    renderUserInvocation(['tasks', teamName], options),
    renderUserInvocation(['transcript', teamName, 'planner', '--limit', '20'], options),
  ]

  return {
    success: true,
    message: [
      `Attached to team "${teamName}"`,
      `goal=${team.description ?? 'n/a'}`,
      `workspace=${resolvedWorkspace ?? 'n/a'}`,
      `result=${summaryState}`,
      '',
      `members: total=${resolvedStatuses.length} active=${activeMembers} busy=${busyMembers} idle=${idleMembers}`,
      `tasks: total=${totalTasks} pending=${pendingTasks} in_progress=${inProgressTasks} completed=${completedTasks}`,
      '',
      'teammates:',
      ...resolvedStatuses.map(
        status =>
          `- ${status.name} [${status.status}] active=${status.isActive === true ? 'yes' : 'no'} runtime=${status.runtimeKind ?? 'local'}`,
      ),
      '',
      'recent activity:',
      ...(recentActivity.length > 0
        ? recentActivity.map(item => `- ${item.text}`)
        : ['- no recent activity']),
      '',
      'generated files:',
      ...(workspaceFiles.length > 0
        ? workspaceFiles.map(file => `- ${file}`)
        : ['- no generated files detected yet']),
      '',
      'next commands:',
      ...nextCommands.map(command => `- ${command}`),
    ].join('\n'),
  }
}

import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  formatDisplayPath,
  formatElapsedShort,
  getAgentDisplayInfo,
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
import {
  classifySummaryState,
  listWorkspaceFiles,
  readWorkspacePreview,
  summarizeWorkspaceFiles,
} from './summary-utils.js'

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
    ...(options.rootDir ? ['--root-dir', formatDisplayPath(options.rootDir) ?? options.rootDir] : []),
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

function summarizeLogTail(lines: string[] | undefined): string | undefined {
  if (!lines || lines.length === 0) {
    return undefined
  }
  return truncate(lines.join(' | '), 140)
}

function formatTimestamp(timestamp?: number): string {
  if (timestamp === undefined) {
    return 'n/a'
  }
  return new Date(timestamp).toISOString()
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
  const displayNow = Date.now()
  const displayStates = resolvedStatuses.map(status => ({
    status,
    display: getAgentDisplayInfo(status, displayNow),
  }))
  const executingMembers = displayStates.filter(
    item => item.display.state === 'executing-turn',
  ).length
  const settlingMembers = displayStates.filter(
    item => item.display.state === 'settling',
  ).length
  const staleMembers = displayStates.filter(
    item => item.display.state === 'stale',
  ).length

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
  const workspaceSummary = summarizeWorkspaceFiles(workspaceFiles, 6)
  const workspacePreview =
    resolvedWorkspace === undefined
      ? undefined
      : await readWorkspacePreview(resolvedWorkspace, workspaceFiles)

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
      `workspace=${formatDisplayPath(resolvedWorkspace) ?? 'n/a'}`,
      `result=${summaryState}`,
      '',
      `members: total=${resolvedStatuses.length} active=${activeMembers} busy=${busyMembers} idle=${idleMembers}`,
      `tasks: total=${totalTasks} pending=${pendingTasks} in_progress=${inProgressTasks} completed=${completedTasks}`,
      `live: executing=${executingMembers} settling=${settlingMembers} stale=${staleMembers}`,
      '',
      'teammates:',
      ...displayStates.map(({ status, display }) =>
        [
          `- ${status.name} [${status.status}]`,
          `active=${status.isActive === true ? 'yes' : 'no'}`,
          `runtime=${status.runtimeKind ?? 'local'}`,
          `worker=${status.launchMode ?? 'attached'}`,
          `launch=${status.launchCommand ?? 'spawn'}`,
          `lifecycle=${status.lifecycle ?? 'n/a'}`,
          `pid=${status.processId ?? 'n/a'}`,
          ...(status.stdoutLogPath
            ? [
                `stdout_log=${formatDisplayPath(status.stdoutLogPath) ?? status.stdoutLogPath}`,
              ]
            : []),
          ...(status.stderrLogPath
            ? [
                `stderr_log=${formatDisplayPath(status.stderrLogPath) ?? status.stderrLogPath}`,
              ]
            : []),
          `started=${formatTimestamp(status.startedAt)}`,
          `state=${display.state}`,
          ...(display.workLabel ? [`work=${display.workLabel}`] : []),
          ...(display.state === 'executing-turn' && display.turnAgeMs !== undefined
            ? [`turn_age=${formatElapsedShort(display.turnAgeMs)}`]
            : []),
          ...(display.state === 'settling' && display.turnAgeMs !== undefined
            ? [`settle_age=${formatElapsedShort(display.turnAgeMs)}`]
            : []),
          ...(display.state === 'stale' && display.heartbeatAgeMs !== undefined
            ? [`heartbeat_age=${formatElapsedShort(display.heartbeatAgeMs)}`]
            : []),
          ...(status.lastExitAt !== undefined
            ? [`last_exit=${formatTimestamp(status.lastExitAt)}`]
            : []),
          ...(status.lastExitReason !== undefined
            ? [`exit_reason=${status.lastExitReason}`]
            : []),
          ...(summarizeLogTail(status.stderrTail)
            ? [`stderr_tail=${summarizeLogTail(status.stderrTail)}`]
            : []),
        ].join(' '),
      ),
      '',
      'recent activity:',
      ...(recentActivity.length > 0
        ? recentActivity.map(item => `- ${item.text}`)
        : ['- no recent activity']),
      '',
      'generated files:',
      ...(workspaceSummary.total > 0
        ? [
            `- summary: ${workspaceSummary.overview}`,
            ...workspaceSummary.featuredFiles.map(file => `- ${file}`),
            ...(workspaceSummary.hiddenCount > 0
              ? [`- +${workspaceSummary.hiddenCount} more files`]
              : []),
          ]
        : ['- no generated files detected yet']),
      ...(workspacePreview
        ? [
            '',
            `preview: ${workspacePreview.path}`,
            ...(workspacePreview.headline
              ? [`preview_headline=${workspacePreview.headline}`]
              : []),
            ...(workspacePreview.excerpt.length > 0
              ? [`preview_excerpt=${workspacePreview.excerpt}`]
              : []),
          ]
        : []),
      '',
      'next commands:',
      ...nextCommands.map(command => `- ${command}`),
    ].join('\n'),
  }
}

import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  analyzeTaskGuardrails,
  analyzeTeamCostGuardrails,
  deriveEffectiveTaskState,
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
  repairLostDetachedMembers,
  type TeamCoreOptions,
  type TeamFile,
} from '../../team-core/index.js'
import type { CliCommandResult } from '../types.js'
import {
  readCliLogSnapshots,
  renderInlineLogTokens,
  renderInlineLogSummaryTokens,
} from './log-utils.js'
import {
  classifySummaryState,
  getWorkspaceHiddenFilesLabel,
  getWorkspacePreviewTrimmedLabel,
  listWorkspaceFileSnapshot,
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

  await repairLostDetachedMembers(teamName, options)
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
  const recipientMailboxes = await Promise.all(
    team.members
      .filter(member => member.name !== 'team-lead')
      .map(async member => ({
        recipientName: member.name,
        messages: await readMailbox(teamName, member.name, options),
      })),
  )

  const resolvedStatuses = statuses ?? []
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
  const totalTasks = tasks.length
  const pendingTasks = effectiveTaskState.counts.pending
  const inProgressTasks = effectiveTaskState.counts.inProgress
  const completedTasks = effectiveTaskState.counts.completed
  const activeMembers = resolvedStatuses.filter(status => status.isActive === true).length
  const busyMembers = resolvedStatuses.filter(status => status.status === 'busy').length
  const idleMembers = resolvedStatuses.filter(status => status.status === 'idle').length
  const displayNow = Date.now()
  const displayStates = resolvedStatuses.map(status => ({
    status,
    display: getAgentDisplayInfo(status, displayNow),
  }))
  const displayStatesWithLogs = await Promise.all(
    displayStates.map(async item => ({
      ...item,
      logs: await readCliLogSnapshots(item.status),
    })),
  )
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
  const workspaceFileSnapshot =
    resolvedWorkspace === undefined
      ? {
          files: [],
          scanLimit: 0,
          scanTruncated: false,
        }
      : await listWorkspaceFileSnapshot(resolvedWorkspace)
  const workspaceSummary = summarizeWorkspaceFiles(workspaceFileSnapshot, 6)
  const hiddenFilesLabel = getWorkspaceHiddenFilesLabel(workspaceSummary)
  const workspacePreview =
    resolvedWorkspace === undefined
      ? undefined
      : await readWorkspacePreview(resolvedWorkspace, workspaceFileSnapshot)
  const previewTrimmedLabel =
    workspacePreview === undefined
      ? undefined
      : getWorkspacePreviewTrimmedLabel(workspacePreview)

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
      ...(guardrails.warnings.length > 0
        ? [
            `guardrails: warnings=${guardrails.warnings.length}`,
            ...guardrails.warnings.map(warning => `- ${warning.message}`),
          ]
        : ['guardrails: warnings=0']),
      ...(costGuardrails.warnings.length > 0
        ? [
            `cost: warnings=${costGuardrails.warnings.length}`,
            ...costGuardrails.warnings.map(warning => `- ${warning.message}`),
          ]
        : ['cost: warnings=0']),
      '',
      'teammates:',
      ...displayStatesWithLogs.map(({ status, display, logs }) =>
        [
          `- ${status.name} [${status.status}]`,
          `active=${status.isActive === true ? 'yes' : 'no'}`,
          `runtime=${status.runtimeKind ?? 'local'}`,
          `backend=${status.backendType ?? 'in-process'}`,
          `transport=${status.transportKind ?? 'local'}`,
          `worker=${status.launchMode ?? 'attached'}`,
          `launch=${status.launchCommand ?? 'spawn'}`,
          `lifecycle=${status.lifecycle ?? 'n/a'}`,
          `pid=${status.processId ?? 'n/a'}`,
          ...(status.paneId ? [`pane=${status.paneId}`] : []),
          ...(status.remoteRootDir
            ? [`remote_root=${status.remoteRootDir}`]
            : []),
          ...logs.flatMap(renderInlineLogTokens),
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
          ...logs.flatMap(renderInlineLogSummaryTokens),
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
            ...(workspaceSummary.overflowLabel
              ? [`- ${workspaceSummary.overflowLabel}`]
              : []),
            ...workspaceSummary.featuredFiles.map(file => `- ${file}`),
            ...(hiddenFilesLabel ? [`- ${hiddenFilesLabel}`] : []),
          ]
        : ['- no generated files detected yet']),
      ...(workspacePreview
        ? [
            '',
            `preview: ${workspacePreview.path}`,
            `preview_selection=${workspacePreview.selectionKind}`,
            ...(workspacePreview.headline
              ? [`preview_headline=${workspacePreview.headline}`]
              : []),
            ...(workspacePreview.excerpt.length > 0
              ? [`preview_excerpt=${workspacePreview.excerpt}`]
              : []),
            ...(workspacePreview.sourceTruncated &&
            workspaceSummary.overflowLabel
              ? [`preview_scan=${workspaceSummary.overflowLabel}`]
              : []),
            ...(previewTrimmedLabel ? [`preview_${previewTrimmedLabel}`] : []),
          ]
        : []),
      '',
      'next commands:',
      ...nextCommands.map(command => `- ${command}`),
    ].join('\n'),
  }
}

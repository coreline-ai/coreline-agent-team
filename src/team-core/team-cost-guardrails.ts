import { deriveEffectiveTaskState } from './effective-task-state.js'
import { isCompletedTaskStatus } from './task-status.js'
import type {
  AgentStatus,
  TeamFile,
  TeamTask,
  TeammateMessage,
} from './types.js'

export const RECOMMENDED_TEAM_SIZE_MIN = 3
export const RECOMMENDED_TEAM_SIZE_MAX = 5
export const BROADCAST_FANOUT_WARNING_THRESHOLD = 4
export const RECENT_BROADCAST_WINDOW_MS = 10 * 60 * 1000

export type TeamCostWarningCode =
  | 'large_team'
  | 'wide_active_team'
  | 'wide_parallel_fanout'
  | 'broadcast_fanout'

export type TeamCostWarning = {
  code: TeamCostWarningCode
  message: string
}

export type TeamCostMetrics = {
  teammateCount: number
  activeTeammateCount: number
  distinctOpenOwnerCount: number
  effectiveInProgressTaskCount: number
  recentBroadcastRecipientCount: number
}

export type TeamCostReport = {
  metrics: TeamCostMetrics
  warnings: TeamCostWarning[]
}

export type TeamRecipientMailbox = {
  recipientName: string
  messages: TeammateMessage[]
}

function normalizeMessageText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 240)
}

function getRecentBroadcastRecipientCount(
  recipientMailboxes: readonly TeamRecipientMailbox[],
  now: number,
): number {
  const groupedRecipients = new Map<string, Set<string>>()

  for (const mailbox of recipientMailboxes) {
    for (const message of mailbox.messages) {
      if (message.from !== 'team-lead') {
        continue
      }
      const timestamp = Date.parse(message.timestamp)
      if (Number.isNaN(timestamp) || now - timestamp > RECENT_BROADCAST_WINDOW_MS) {
        continue
      }

      const normalizedText = normalizeMessageText(message.text)
      if (normalizedText.length === 0) {
        continue
      }

      const recipients = groupedRecipients.get(normalizedText)
      if (recipients) {
        recipients.add(mailbox.recipientName)
        continue
      }
      groupedRecipients.set(normalizedText, new Set([mailbox.recipientName]))
    }
  }

  return [...groupedRecipients.values()].reduce(
    (highest, recipients) => Math.max(highest, recipients.size),
    0,
  )
}

export function analyzeTeamCostGuardrails(input: {
  team: Pick<TeamFile, 'members'>
  tasks?: readonly TeamTask[]
  statuses?: readonly AgentStatus[]
  recipientMailboxes?: readonly TeamRecipientMailbox[]
  now?: number
}): TeamCostReport {
  const now = input.now ?? Date.now()
  const teammateCount = input.team.members.filter(
    member => member.name !== 'team-lead',
  ).length
  const statuses = input.statuses ?? []
  const tasks = input.tasks ?? []
  const activeTeammateCount = statuses.filter(
    status => status.name !== 'team-lead' && status.isActive === true,
  ).length
  const distinctOpenOwnerCount = new Set(
    tasks
      .filter(task => !isCompletedTaskStatus(task.status) && task.owner)
      .map(task => task.owner as string),
  ).size
  const effectiveInProgressTaskCount = deriveEffectiveTaskState({
    tasks,
    statuses,
    now,
  }).counts.inProgress
  const recentBroadcastRecipientCount = getRecentBroadcastRecipientCount(
    input.recipientMailboxes ?? [],
    now,
  )

  const warnings: TeamCostWarning[] = []

  if (teammateCount > RECOMMENDED_TEAM_SIZE_MAX) {
    warnings.push({
      code: 'large_team',
      message:
        `Team has ${teammateCount} teammates; coordination cost rises past the recommended ${RECOMMENDED_TEAM_SIZE_MIN}-${RECOMMENDED_TEAM_SIZE_MAX}.`,
    })
  }

  if (activeTeammateCount > RECOMMENDED_TEAM_SIZE_MAX) {
    warnings.push({
      code: 'wide_active_team',
      message:
        `${activeTeammateCount} teammates are active at once; prefer 3-5 concurrent workers unless the work is cleanly partitioned.`,
    })
  }

  const parallelFanout = Math.max(
    distinctOpenOwnerCount,
    effectiveInProgressTaskCount,
  )
  if (parallelFanout > RECOMMENDED_TEAM_SIZE_MAX) {
    warnings.push({
      code: 'wide_parallel_fanout',
      message:
        `${parallelFanout} parallel task contexts are open; split phases or add dependencies before widening fan-out further.`,
    })
  }

  if (recentBroadcastRecipientCount >= BROADCAST_FANOUT_WARNING_THRESHOLD) {
    warnings.push({
      code: 'broadcast_fanout',
      message:
        `Recent leader message fan-out reached ${recentBroadcastRecipientCount} recipients; prefer targeted routing over broad broadcast.`,
    })
  }

  return {
    metrics: {
      teammateCount,
      activeTeammateCount,
      distinctOpenOwnerCount,
      effectiveInProgressTaskCount,
      recentBroadcastRecipientCount,
    },
    warnings,
  }
}

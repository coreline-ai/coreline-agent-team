import {
  getAgentStatuses,
  repairLostDetachedMembers,
  type TeamCoreOptions,
} from '../../team-core/index.js'
import type { CliCommandResult } from '../types.js'
import { readCliLogSnapshots, summarizeLogTail } from './log-utils.js'

export async function runLogsCommand(
  teamName: string,
  agentName: string,
  input: {
    stream?: 'stdout' | 'stderr' | 'both'
    lines?: number
    bytes?: number
  } = {},
  options: TeamCoreOptions = {},
): Promise<CliCommandResult> {
  await repairLostDetachedMembers(teamName, options)
  const statuses = await getAgentStatuses(teamName, options)
  if (!statuses) {
    return {
      success: false,
      message: `Team "${teamName}" does not exist`,
    }
  }

  const agent = statuses.find(status => status.name === agentName)
  if (!agent) {
    return {
      success: false,
      message: [
        `Agent "${agentName}" was not found in team "${teamName}".`,
        `Available agents: ${statuses.map(status => status.name).join(', ') || 'none'}`,
      ].join('\n'),
    }
  }

  const stream = input.stream ?? 'both'
  const snapshots = (await readCliLogSnapshots(agent, {
    maxLines: input.lines ?? 20,
    maxBytes: input.bytes ?? 16 * 1024,
  })).filter(snapshot => stream === 'both' || snapshot.stream === stream)

  return {
    success: true,
    message: [
      `Logs: team=${teamName} agent=${agentName} stream=${stream}`,
      ...snapshots.flatMap(snapshot => {
        if (!snapshot.path) {
          return [`- ${snapshot.stream}: not configured`]
        }

        return [
          `- ${snapshot.stream}: path=${snapshot.displayPath ?? snapshot.path} state=${snapshot.tail?.state ?? 'missing'}${snapshot.tail?.truncated ? ` truncated=yes bytes=${snapshot.tail.bytesRead}/${snapshot.tail.fileSize}` : ''}`,
          ...(summarizeLogTail(snapshot.tail?.lines)
            ? (snapshot.tail?.lines ?? []).map(line => `  ${line}`)
            : []),
          ...(snapshot.tail?.state === 'unreadable' && snapshot.tail.error
            ? [`  error=${snapshot.tail.error}`]
            : []),
        ]
      }),
    ].join('\n'),
  }
}

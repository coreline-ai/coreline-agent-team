import type { AgentStatus } from './types.js'
import { readBoundedTail, type BoundedTailResult } from './file-utils.js'
import { formatDisplayPath } from './paths.js'

export type AgentLogStream = 'stdout' | 'stderr'

export type AgentLogSnapshot = {
  stream: AgentLogStream
  path?: string
  displayPath?: string
  tail: BoundedTailResult | null
}

export async function readAgentLogSnapshots(
  status: Pick<AgentStatus, 'stdoutLogPath' | 'stderrLogPath'>,
  options: {
    maxLines?: number
    maxBytes?: number
  } = {},
): Promise<AgentLogSnapshot[]> {
  return Promise.all(
    ([
      ['stdout', status.stdoutLogPath],
      ['stderr', status.stderrLogPath],
    ] as const).map(async ([stream, path]) => ({
      stream,
      path,
      displayPath: path ? formatDisplayPath(path) ?? path : undefined,
      tail: path
        ? await readBoundedTail(path, {
            maxLines: options.maxLines ?? 2,
            maxBytes: options.maxBytes ?? 4 * 1024,
          })
        : null,
    })),
  )
}

import {
  readAgentLogSnapshots,
  type AgentLogSnapshot,
  type AgentStatus,
} from '../../team-core/index.js'

export type CliLogSnapshot = AgentLogSnapshot

function truncate(text: string, maxLength = 140): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`
}

export function summarizeLogTail(lines: string[] | undefined): string | undefined {
  if (!lines || lines.length === 0) {
    return undefined
  }

  return truncate(lines.join(' | '), 140)
}

export async function readCliLogSnapshots(
  status: AgentStatus,
  options: {
    maxLines?: number
    maxBytes?: number
  } = {},
): Promise<CliLogSnapshot[]> {
  return readAgentLogSnapshots(status, {
    maxLines: options.maxLines ?? 2,
    maxBytes: options.maxBytes ?? 4 * 1024,
  })
}

export function renderInlineLogTokens(snapshot: CliLogSnapshot): string[] {
  if (!snapshot.path) {
    return []
  }

  const tokens = [`${snapshot.stream}_log=${snapshot.displayPath ?? snapshot.path}`]
  return tokens
}

export function renderInlineLogSummaryTokens(snapshot: CliLogSnapshot): string[] {
  if (!snapshot.path) {
    return []
  }

  const tokens: string[] = []
  const tailSummary = summarizeLogTail(snapshot.tail?.lines)

  if (tailSummary) {
    tokens.push(`${snapshot.stream}_tail=${tailSummary}`)
  }

  if (snapshot.tail && snapshot.tail.state !== 'ok') {
    tokens.push(`${snapshot.stream}_state=${snapshot.tail.state}`)
  }

  if (snapshot.tail?.state === 'unreadable' && snapshot.tail.error) {
    tokens.push(`${snapshot.stream}_error=${truncate(snapshot.tail.error, 80)}`)
  }

  if (snapshot.tail?.truncated) {
    tokens.push(
      `${snapshot.stream}_truncated=yes`,
      `${snapshot.stream}_bytes=${snapshot.tail.bytesRead}/${snapshot.tail.fileSize}`,
    )
  }

  return tokens
}

import { Box, Text } from 'ink'
import type { AgentLogSnapshot } from '../../team-core/index.js'
import { Panel } from './layout.js'

function truncateLogLine(line: string, maxLength = 160): string {
  return line.length <= maxLength ? line : `${line.slice(0, maxLength - 1)}…`
}

export function LogViewer(props: {
  agentName?: string
  snapshot?: AgentLogSnapshot
  stream: 'stdout' | 'stderr'
  isFocused?: boolean
  isExpanded?: boolean
  width?: number | string
  minHeight?: number
  windowSize?: number
  scrollOffset?: number
  maxLineLength?: number
}) {
  const rawLines =
    props.snapshot?.tail?.state === 'ok' ? props.snapshot.tail.lines : []
  const maxLineLength = props.maxLineLength ?? 160
  const trimmedLines = rawLines.map(line => truncateLogLine(line, maxLineLength))
  const trimmedLineCount = rawLines.filter(line => line.length > maxLineLength).length
  const windowSize = props.windowSize ?? 8
  const maxScrollOffset = Math.max(0, trimmedLines.length - windowSize)
  const scrollOffset = Math.max(
    0,
    Math.min(props.scrollOffset ?? 0, maxScrollOffset),
  )
  const startIndex = Math.max(0, maxScrollOffset - scrollOffset)
  const visibleLines = trimmedLines.slice(startIndex, startIndex + windowSize)

  return (
    <Panel
      title={`Logs${props.agentName ? ` / ${props.agentName}` : ''} [${props.stream}]${props.isExpanded ? ' [focus]' : ''}`}
      width={props.width}
      minHeight={props.minHeight ?? 8}
      borderColor={props.isFocused ? 'green' : 'cyan'}
    >
      {!props.agentName ? (
        <Text color="gray">Select a teammate to inspect logs.</Text>
      ) : !props.snapshot?.path ? (
        <Text color="gray">{props.stream} log path is not recorded for {props.agentName}.</Text>
      ) : (
        <Box flexDirection="column">
          <Text color="gray">path={props.snapshot.displayPath ?? props.snapshot.path}</Text>
          {props.snapshot.tail?.truncated ? (
            <Text color="yellow">
              showing bounded tail {props.snapshot.tail.bytesRead}/{props.snapshot.tail.fileSize} bytes
            </Text>
          ) : null}
          {trimmedLineCount > 0 ? (
            <Text color="yellow">
              trimmed {trimmedLineCount} long line(s) for the TUI
            </Text>
          ) : null}
          {trimmedLines.length > windowSize ? (
            <Text color="gray">
              showing {startIndex + 1}-{startIndex + visibleLines.length} of {trimmedLines.length}
            </Text>
          ) : null}
          {props.snapshot.tail?.state === 'missing' ? (
            <Text color="yellow">{props.stream} log file is missing.</Text>
          ) : props.snapshot.tail?.state === 'empty' ? (
            <Text color="gray">{props.stream} log file is empty.</Text>
          ) : props.snapshot.tail?.state === 'unreadable' ? (
            <Text color="red">
              {props.stream} log is unreadable{props.snapshot.tail.error ? `: ${props.snapshot.tail.error}` : '.'}
            </Text>
          ) : visibleLines.length === 0 ? (
            <Text color="gray">No log lines available.</Text>
          ) : (
            visibleLines.map((line, index) => (
              <Text key={`${props.stream}-${startIndex + index}`}>
                <Text color="gray">{String(startIndex + index + 1).padStart(2, '0')} </Text>
                {line}
              </Text>
            ))
          )}
        </Box>
      )}
    </Panel>
  )
}

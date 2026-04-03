import { Box, Text } from 'ink'
import type { TeamTranscriptEntry } from '../../team-core/index.js'
import { Panel } from './layout.js'

export function TranscriptDrawer(props: {
  agentName?: string
  entries: TeamTranscriptEntry[]
  isFocused?: boolean
  isExpanded?: boolean
  width?: number | string
  minHeight?: number
  windowSize?: number
  scrollOffset?: number
}) {
  const windowSize = props.windowSize ?? 8
  const maxScrollOffset = Math.max(0, props.entries.length - windowSize)
  const scrollOffset = Math.max(
    0,
    Math.min(props.scrollOffset ?? 0, maxScrollOffset),
  )
  const startIndex = Math.max(0, maxScrollOffset - scrollOffset)
  const visibleEntries = props.entries.slice(startIndex, startIndex + windowSize)

  return (
    <Panel
      title={`Transcript${props.agentName ? ` / ${props.agentName}` : ''}${props.isExpanded ? ' [focus]' : ''}`}
      width={props.width}
      minHeight={props.minHeight ?? 8}
      borderColor={props.isFocused ? 'green' : 'cyan'}
    >
      <Box flexDirection="column">
        {props.entries.length > windowSize ? (
          <Text color="gray">
            showing {startIndex + 1}-{startIndex + visibleEntries.length} of {props.entries.length}
          </Text>
        ) : null}
        {props.entries.length === 0 ? (
          <Text color="gray">No transcript entries.</Text>
        ) : (
          visibleEntries.map(entry => (
            <Text key={entry.id}>
              [{entry.role}] {entry.content.replace(/\s+/g, ' ').trim()}
            </Text>
          ))
        )}
      </Box>
    </Panel>
  )
}

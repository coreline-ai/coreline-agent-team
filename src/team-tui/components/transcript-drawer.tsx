import { Box, Text } from 'ink'
import type { TeamTranscriptEntry } from '../../team-core/index.js'
import { Panel } from './layout.js'

export function TranscriptDrawer(props: {
  agentName?: string
  entries: TeamTranscriptEntry[]
}) {
  return (
    <Panel title={`Transcript${props.agentName ? ` / ${props.agentName}` : ''}`} minHeight={8}>
      <Box flexDirection="column">
        {props.entries.length === 0 ? (
          <Text color="gray">No transcript entries.</Text>
        ) : (
          props.entries.map(entry => (
            <Text key={entry.id}>
              [{entry.role}] {entry.content.replace(/\s+/g, ' ').trim()}
            </Text>
          ))
        )}
      </Box>
    </Panel>
  )
}

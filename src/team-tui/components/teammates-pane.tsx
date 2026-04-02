import { Box, Text } from 'ink'
import type { AgentStatus } from '../../team-core/index.js'
import { Panel } from './layout.js'

export function TeammatesPane(props: {
  statuses: AgentStatus[]
  selectedTeammateIndex: number
  isFocused: boolean
}) {
  const visibleStatuses = props.statuses.filter(status => status.name !== 'team-lead')

  return (
    <Panel
      title={`Teammates${props.isFocused ? ' [focused]' : ''}`}
      width="50%"
      minHeight={12}
      borderColor={props.isFocused ? 'green' : 'cyan'}
    >
      <Box flexDirection="column">
        {visibleStatuses.length === 0 ? (
          <Text color="gray">No teammates yet.</Text>
        ) : (
          visibleStatuses.map((status, index) => (
            <Text
              key={status.agentId}
              color={props.selectedTeammateIndex === index ? 'green' : undefined}
            >
              {props.selectedTeammateIndex === index ? '> ' : '  '}
              {status.name} {status.isActive ? 'active' : 'inactive'} {status.status}
              {'  '}
              {status.runtimeKind ?? 'local'}
              {'  '}
              mode={status.mode ?? 'default'}
            </Text>
          ))
        )}
      </Box>
    </Panel>
  )
}

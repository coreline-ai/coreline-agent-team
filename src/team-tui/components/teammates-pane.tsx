import { Box, Text } from 'ink'
import {
  formatElapsedShort,
  getAgentDisplayInfo,
  type AgentStatus,
} from '../../team-core/index.js'
import { Panel } from './layout.js'

export function TeammatesPane(props: {
  statuses: AgentStatus[]
  selectedTeammateIndex: number
  isFocused: boolean
}) {
  const visibleStatuses = props.statuses.filter(status => status.name !== 'team-lead')
  const displayNow = Date.now()

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
          visibleStatuses.map((status, index) => {
            const display = getAgentDisplayInfo(status, displayNow)
            const turnAge = formatElapsedShort(display.turnAgeMs)
            const heartbeatAge = formatElapsedShort(display.heartbeatAgeMs)

            return (
              <Text
                key={status.agentId}
                color={props.selectedTeammateIndex === index ? 'green' : undefined}
              >
                {props.selectedTeammateIndex === index ? '> ' : '  '}
                {status.name} {status.isActive ? 'active' : 'inactive'} {status.status}
                {'  '}
                state={display.state}
                {display.workLabel ? ` ${display.workLabel}` : ''}
                {display.state === 'executing-turn' && turnAge ? ` ${turnAge}` : ''}
                {display.state === 'settling' && turnAge ? ` settle=${turnAge}` : ''}
                {display.state === 'stale' && heartbeatAge ? ` stale=${heartbeatAge}` : ''}
                {'  '}
                {status.runtimeKind ?? 'local'}
                {'  '}
                mode={status.mode ?? 'default'}
              </Text>
            )
          })
        )}
      </Box>
    </Panel>
  )
}

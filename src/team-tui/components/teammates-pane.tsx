import { Box, Text } from 'ink'
import {
  formatElapsedShort,
  formatDisplayPath,
  getAgentDisplayInfo,
  type AgentStatus,
} from '../../team-core/index.js'
import { Panel } from './layout.js'

function truncateLogLine(line: string | undefined, maxLength = 48): string | undefined {
  if (!line) {
    return undefined
  }
  return line.length <= maxLength ? line : `${line.slice(0, maxLength - 1)}…`
}

export function TeammatesPane(props: {
  statuses: AgentStatus[]
  selectedTeammateIndex: number
  isFocused: boolean
  isExpanded?: boolean
  width?: number | string
  minHeight?: number
  windowSize?: number
}) {
  const visibleStatuses = props.statuses.filter(status => status.name !== 'team-lead')
  const windowSize = props.windowSize ?? 8
  const maxStartIndex = Math.max(0, visibleStatuses.length - windowSize)
  const startIndex = Math.min(
    Math.max(0, props.selectedTeammateIndex - Math.floor(windowSize / 2)),
    maxStartIndex,
  )
  const windowedStatuses = visibleStatuses.slice(
    startIndex,
    startIndex + windowSize,
  )
  const displayNow = Date.now()

  return (
    <Panel
      title={`Teammates${props.isFocused ? ' [focused]' : ''}${props.isExpanded ? ' [focus]' : ''}`}
      width={props.width ?? '50%'}
      minHeight={props.minHeight ?? 12}
      borderColor={props.isFocused ? 'green' : 'cyan'}
    >
      <Box flexDirection="column">
        {visibleStatuses.length > windowSize ? (
          <Text color="gray">
            showing {startIndex + 1}-{startIndex + windowedStatuses.length} of {visibleStatuses.length}
          </Text>
        ) : null}
        {visibleStatuses.length === 0 ? (
          <Text color="gray">No teammates yet.</Text>
        ) : (
          windowedStatuses.map((status, index) => {
            const absoluteIndex = startIndex + index
            const display = getAgentDisplayInfo(status, displayNow)
            const turnAge = formatElapsedShort(display.turnAgeMs)
            const heartbeatAge = formatElapsedShort(display.heartbeatAgeMs)

            return (
              <Text
                key={status.agentId}
                color={props.selectedTeammateIndex === absoluteIndex ? 'green' : undefined}
              >
                {props.selectedTeammateIndex === absoluteIndex ? '> ' : '  '}
                {status.name} {status.isActive ? 'active' : 'inactive'} {status.status}
                {'  '}
                state={display.state}
                {display.workLabel ? ` ${display.workLabel}` : ''}
                {display.state === 'executing-turn' && turnAge ? ` ${turnAge}` : ''}
                {display.state === 'settling' && turnAge ? ` settle=${turnAge}` : ''}
                {display.state === 'stale' && heartbeatAge ? ` stale=${heartbeatAge}` : ''}
                {'  '}
                {status.runtimeKind ?? 'local'}
                {status.processId ? ` pid=${status.processId}` : ''}
                {status.launchMode ? ` ${status.launchMode}` : ''}
                {status.launchCommand ? `/${status.launchCommand}` : ''}
                {status.stderrLogPath
                  ? ` log=${formatDisplayPath(status.stderrLogPath) ?? status.stderrLogPath}`
                  : ''}
                {truncateLogLine(status.stderrTail?.at(-1))
                  ? ` err=${truncateLogLine(status.stderrTail?.at(-1))}`
                  : ''}
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

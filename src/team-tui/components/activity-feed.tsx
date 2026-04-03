import { Box, Text } from 'ink'
import type { DashboardActivityItem } from '../../team-operator/index.js'
import { Panel } from './layout.js'

export function ActivityFeed(props: {
  activity: DashboardActivityItem[]
  isFocused: boolean
  isExpanded?: boolean
  width?: number | string
  minHeight?: number
  windowSize?: number
  scrollOffset?: number
}) {
  const windowSize = props.windowSize ?? 8
  const maxScrollOffset = Math.max(0, props.activity.length - windowSize)
  const scrollOffset = Math.max(
    0,
    Math.min(props.scrollOffset ?? 0, maxScrollOffset),
  )
  const startIndex = Math.max(0, maxScrollOffset - scrollOffset)
  const visible = props.activity.slice(startIndex, startIndex + windowSize)

  return (
    <Panel
      title={`Activity Feed${props.isFocused ? ' [focused]' : ''}${props.isExpanded ? ' [focus]' : ''}`}
      width={props.width}
      minHeight={props.minHeight ?? 10}
      borderColor={props.isFocused ? 'green' : 'cyan'}
    >
      <Box flexDirection="column">
        {props.activity.length > windowSize ? (
          <Text color="gray">
            showing {startIndex + 1}-{startIndex + visible.length} of {props.activity.length}
          </Text>
        ) : null}
        {visible.length === 0 ? (
          <Text color="gray">No activity yet.</Text>
        ) : (
          visible.map(item => (
            <Text key={item.id} color={item.unread ? 'yellow' : undefined}>
              {item.from}: {item.text}
            </Text>
          ))
        )}
      </Box>
    </Panel>
  )
}

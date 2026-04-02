import { Box, Text } from 'ink'
import type { DashboardActivityItem } from '../../team-operator/index.js'
import { Panel } from './layout.js'

export function ActivityFeed(props: {
  activity: DashboardActivityItem[]
  isFocused: boolean
}) {
  const visible = props.activity.slice(-8)

  return (
    <Panel
      title={`Activity Feed${props.isFocused ? ' [focused]' : ''}`}
      minHeight={10}
      borderColor={props.isFocused ? 'green' : 'cyan'}
    >
      <Box flexDirection="column">
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

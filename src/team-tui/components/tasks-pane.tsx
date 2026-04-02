import { Box, Text } from 'ink'
import type { TeamTask } from '../../team-core/index.js'
import { Panel } from './layout.js'

export function TasksPane(props: {
  tasks: TeamTask[]
  selectedTaskIndex: number
  isFocused: boolean
  counts: {
    pending: number
    inProgress: number
    completed: number
  }
}) {
  const visibleTasks = props.tasks.slice(0, 8)

  return (
    <Panel
      title={`Tasks${props.isFocused ? ' [focused]' : ''}`}
      width="50%"
      minHeight={12}
      borderColor={props.isFocused ? 'green' : 'cyan'}
    >
      <Text color="gray">
        {props.counts.pending} pending  {props.counts.inProgress} in_progress  {props.counts.completed} done
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {visibleTasks.length === 0 ? (
          <Text color="gray">No tasks yet.</Text>
        ) : (
          visibleTasks.map((task, index) => (
            <Text
              key={task.id}
              color={props.selectedTaskIndex === index ? 'green' : undefined}
            >
              {props.selectedTaskIndex === index ? '> ' : '  '}
              #{task.id} [{task.status}] {task.subject}
            </Text>
          ))
        )}
      </Box>
    </Panel>
  )
}

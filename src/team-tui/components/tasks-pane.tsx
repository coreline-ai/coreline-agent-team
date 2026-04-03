import { Box, Text } from 'ink'
import type { TeamTask } from '../../team-core/index.js'
import { Panel } from './layout.js'
import type { TaskRuntimeOverview } from '../task-runtime.js'

export function TasksPane(props: {
  tasks: TeamTask[]
  selectedTaskIndex: number
  isFocused: boolean
  isExpanded?: boolean
  width?: number | string
  minHeight?: number
  windowSize?: number
  counts: {
    pending: number
    inProgress: number
    completed: number
  }
  runtimeOverview?: TaskRuntimeOverview
  taskRuntimeLabels?: Record<string, string>
}) {
  const windowSize = props.windowSize ?? 8
  const maxStartIndex = Math.max(0, props.tasks.length - windowSize)
  const startIndex = Math.min(
    Math.max(0, props.selectedTaskIndex - Math.floor(windowSize / 2)),
    maxStartIndex,
  )
  const visibleTasks = props.tasks.slice(startIndex, startIndex + windowSize)
  const runtimeOverview = props.runtimeOverview ?? {
    active: 0,
    executing: 0,
    settling: 0,
    stale: 0,
  }
  const hasRuntimeActivity =
    runtimeOverview.active > 0 ||
    runtimeOverview.executing > 0 ||
    runtimeOverview.settling > 0 ||
    runtimeOverview.stale > 0

  return (
    <Panel
      title={`Tasks${props.isFocused ? ' [focused]' : ''}${props.isExpanded ? ' [focus]' : ''}`}
      width={props.width ?? '50%'}
      minHeight={props.minHeight ?? 12}
      borderColor={props.isFocused ? 'green' : 'cyan'}
    >
      <Text color="gray">
        {props.counts.pending} pending  {props.counts.inProgress} in_progress  {props.counts.completed} done
      </Text>
      <Text color="gray">
        {hasRuntimeActivity
          ? `workers ${runtimeOverview.active} active  ${runtimeOverview.executing} running  ${runtimeOverview.settling} settling  ${runtimeOverview.stale} stale`
          : 'workers idle'}
      </Text>
      {props.tasks.length > windowSize ? (
        <Text color="gray">
          showing {startIndex + 1}-{startIndex + visibleTasks.length} of {props.tasks.length}
        </Text>
      ) : null}
      <Box flexDirection="column" marginTop={1}>
        {visibleTasks.length === 0 ? (
          <Text color="gray">No tasks yet.</Text>
        ) : (
          visibleTasks.map((task, index) => {
            const absoluteIndex = startIndex + index
            return (
            <Text
              key={task.id}
              color={props.selectedTaskIndex === absoluteIndex ? 'green' : undefined}
            >
              {props.selectedTaskIndex === absoluteIndex ? '> ' : '  '}
              #{task.id} [{task.status}] {task.subject}
              {props.taskRuntimeLabels?.[task.id]
                ? ` · ${props.taskRuntimeLabels[task.id]}`
                : ''}
            </Text>
            )
          })
        )}
      </Box>
    </Panel>
  )
}

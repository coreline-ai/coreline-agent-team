import {
  analyzeTaskGuardrails,
  inferTaskScopedPaths,
  getTaskListIdForTeam,
  listTasks,
  type TeamCoreOptions,
} from '../../team-core/index.js'
import type { CliCommandResult } from '../types.js'

export async function runTasksCommand(
  teamName: string,
  options: TeamCoreOptions = {},
): Promise<CliCommandResult> {
  const tasks = await listTasks(getTaskListIdForTeam(teamName), options)

  if (tasks.length === 0) {
    return {
      success: true,
      message: 'No tasks found',
    }
  }

  return {
    success: true,
    message: [
      ...tasks.map(task => {
        const inferred = inferTaskScopedPaths(task)
        return [
          `#${task.id} [${task.status}] ${task.subject}`,
          ...(inferred.scopedPaths.length > 0
            ? [` scoped=${inferred.scopedPaths.join(', ')}`]
            : []),
        ].join('')
      }),
      ...(() => {
        const guardrails = analyzeTaskGuardrails(tasks)
        if (guardrails.warnings.length === 0) {
          return []
        }
        return [
          '',
          'Guardrails:',
          ...guardrails.warnings.map(warning => `- ${warning.message}`),
        ]
      })(),
    ].join('\n'),
  }
}

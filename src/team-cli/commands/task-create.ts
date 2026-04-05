import {
  analyzeTaskGuardrails,
  createTask,
  decorateTaskInputWithGuardrails,
  getTaskListIdForTeam,
  listTasks,
  type TeamCoreOptions,
} from '../../team-core/index.js'
import type { CliCommandResult } from '../types.js'

export async function runTaskCreateCommand(
  teamName: string,
  subject: string,
  description: string,
  options: TeamCoreOptions = {},
): Promise<CliCommandResult> {
  const taskListId = getTaskListIdForTeam(teamName)
  const task = await createTask(
    taskListId,
    decorateTaskInputWithGuardrails({
      subject,
      description,
      status: 'pending',
      blocks: [],
      blockedBy: [],
    }),
    options,
  )
  const tasks = await listTasks(taskListId, options)
  const guardrails = analyzeTaskGuardrails(tasks)
  const relevantWarnings = guardrails.warnings.filter(warning =>
    warning.taskIds.includes(task.id),
  )

  return {
    success: true,
    message: [
      `Created task #${task.id}: ${task.subject}`,
      ...(
        relevantWarnings.length > 0
          ? [
              'Guardrails:',
              ...relevantWarnings.map(warning => `- ${warning.message}`),
            ]
          : []
      ),
    ].join('\n'),
  }
}

import type { TeamCoreOptions } from '../../team-core/index.js'
import { runResumeCommand, type ResumeCommandInput } from './resume.js'
import type { CliCommandResult } from '../types.js'

export async function runReopenCommand(
  teamName: string,
  agentName: string,
  input: ResumeCommandInput = {},
  options: TeamCoreOptions = {},
): Promise<CliCommandResult> {
  const result = await runResumeCommand(teamName, agentName, input, options)
  if (!result.success) {
    return result
  }

  return {
    ...result,
    message: result.message.replace(/^Resumed /, 'Reopened '),
  }
}

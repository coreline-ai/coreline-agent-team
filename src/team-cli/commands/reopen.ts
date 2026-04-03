import type { TeamCoreOptions } from '../../team-core/index.js'
import {
  runStoredRuntimeCommand,
  type ResumeCommandInput,
} from './resume.js'
import type { CliCommandResult } from '../types.js'

export async function runReopenCommand(
  teamName: string,
  agentName: string,
  input: ResumeCommandInput = {},
  options: TeamCoreOptions = {},
): Promise<CliCommandResult> {
  return runStoredRuntimeCommand(
    teamName,
    agentName,
    input,
    options,
    'reopen',
  )
}

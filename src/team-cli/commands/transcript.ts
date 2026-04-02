import {
  readTranscriptEntries,
  type TeamCoreOptions,
} from '../../team-core/index.js'
import type { CliCommandResult } from '../types.js'

export async function runTranscriptCommand(
  teamName: string,
  agentName: string,
  limit = 10,
  options: TeamCoreOptions = {},
): Promise<CliCommandResult> {
  const entries = await readTranscriptEntries(teamName, agentName, options)
  const slice = entries.slice(-limit)

  return {
    success: true,
    message: [
      `Transcript for ${agentName} in "${teamName}"`,
      `Entries: ${entries.length}`,
      ...(slice.length === 0
        ? ['- none']
        : slice.map(
            entry =>
              `- [${entry.role}] (${entry.sessionId}) ${entry.content.replace(/\s+/g, ' ').trim()}`,
          )),
    ].join('\n'),
  }
}

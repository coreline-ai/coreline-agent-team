import {
  cleanupOrphanedTasks,
  listStaleMembers,
  removeTeamMember,
  type TeamCoreOptions,
} from '../../team-core/index.js'
import type { CliCommandResult } from '../types.js'

export type CleanupCommandInput = {
  staleAfterMs?: number
  removeInactiveMembers?: boolean
}

export async function runCleanupCommand(
  teamName: string,
  input: CleanupCommandInput = {},
  options: TeamCoreOptions = {},
): Promise<CliCommandResult> {
  const staleAfterMs = input.staleAfterMs ?? 5 * 60 * 1000
  const staleMembers = await listStaleMembers(teamName, staleAfterMs, options)
  const orphanCleanup = await cleanupOrphanedTasks(teamName, options)

  let removedMembers = 0
  if (input.removeInactiveMembers) {
    for (const member of staleMembers) {
      const removed = await removeTeamMember(
        teamName,
        { agentId: member.agentId },
        options,
      )
      if (removed) {
        removedMembers += 1
      }
    }
  }

  return {
    success: true,
    message: [
      `Cleanup complete for team "${teamName}"`,
      `Stale members: ${staleMembers.length}`,
      `Orphaned tasks cleaned: ${orphanCleanup.cleanedTaskIds.length}`,
      `Removed inactive members: ${removedMembers}`,
    ].join('\n'),
  }
}

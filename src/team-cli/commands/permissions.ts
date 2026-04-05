import {
  describePermissionRequestContext,
  describePermissionRule,
  describeSuggestedPermissionRuleMatch,
  getTeamPermissionState,
  readPendingPermissionRequests,
  readResolvedPermissionRequests,
  type TeamCoreOptions,
} from '../../team-core/index.js'
import type { CliCommandResult } from '../types.js'

export type PermissionListScope = 'pending' | 'resolved' | 'rules'

export async function runPermissionsCommand(
  teamName: string,
  scope: PermissionListScope = 'pending',
  options: TeamCoreOptions = {},
): Promise<CliCommandResult> {
  if (scope === 'rules') {
    const state = await getTeamPermissionState(teamName, options)
    return {
      success: true,
      message: [
        `Permission rules for "${teamName}"`,
        `Updates: ${state?.updates.length ?? 0}`,
        `Rules: ${state?.rules.length ?? 0}`,
        ...(state?.updates.length
          ? state.updates.flatMap((update, updateIndex) =>
              update.rules.map(
                rule =>
                  `- [${updateIndex + 1}] ${update.behavior} ${describePermissionRule(rule)}`,
              ),
            )
          : ['- none']),
      ].join('\n'),
    }
  }

  const records =
    scope === 'pending'
      ? await readPendingPermissionRequests(teamName, options)
      : await readResolvedPermissionRequests(teamName, options)

  return {
    success: true,
    message: [
      `Permission ${scope} for "${teamName}"`,
      `Count: ${records.length}`,
      ...(records.length === 0
        ? ['- none']
        : records.flatMap(record => {
            const contextLines = describePermissionRequestContext(record.input).map(
              line => `  ${line}`,
            )
            const suggestionLines = describeSuggestedPermissionRuleMatch(
              record.input,
            ).map(line => `  ${line}`)

            return [
              `- ${record.id} [${record.status}] ${record.workerName} ${record.toolName} ${record.description}`,
              ...contextLines,
              ...suggestionLines,
            ]
          })),
    ].join('\n'),
  }
}

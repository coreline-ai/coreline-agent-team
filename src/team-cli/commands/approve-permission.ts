import {
  type TeamCoreOptions,
} from '../../team-core/index.js'
import type { CliCommandResult } from '../types.js'
import { type PermissionRuleFlags } from './permission-rule.js'
import { resolvePermissionDecision } from './permission-response.js'

export type ApprovePermissionCommandInput = {
  persistDecision?: boolean
  updatedInput?: Record<string, unknown>
} & PermissionRuleFlags

function normalizeArgs(
  inputOrOptions: ApprovePermissionCommandInput | TeamCoreOptions | undefined,
  options: TeamCoreOptions | undefined,
): {
  input: ApprovePermissionCommandInput
  options: TeamCoreOptions
} {
  if (
    inputOrOptions &&
    ('persistDecision' in inputOrOptions ||
      'ruleContent' in inputOrOptions ||
      'rulePreset' in inputOrOptions ||
      'updatedInput' in inputOrOptions ||
      'commandContains' in inputOrOptions ||
      'cwdPrefix' in inputOrOptions ||
      'pathPrefix' in inputOrOptions ||
      'hostEquals' in inputOrOptions)
  ) {
    return {
      input: inputOrOptions,
      options: options ?? {},
    }
  }

  return {
    input: {},
    options: (inputOrOptions as TeamCoreOptions | undefined) ?? options ?? {},
  }
}

export async function runApprovePermissionCommand(
  teamName: string,
  recipient: string,
  requestId: string,
  inputOrOptions?: ApprovePermissionCommandInput | TeamCoreOptions,
  options?: TeamCoreOptions,
): Promise<CliCommandResult> {
  const { input, options: resolvedOptions } = normalizeArgs(inputOrOptions, options)
  return resolvePermissionDecision({
    teamName,
    recipient,
    requestId,
    decision: 'approved',
    responseSubtype: 'success',
    updatedInput: input.updatedInput,
    persistDecision: input.persistDecision,
    behavior: 'allow',
    ruleInput: input,
    options: resolvedOptions,
  })
}

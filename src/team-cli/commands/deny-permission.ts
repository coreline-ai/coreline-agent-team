import {
  type TeamCoreOptions,
} from '../../team-core/index.js'
import type { CliCommandResult } from '../types.js'
import { type PermissionRuleFlags } from './permission-rule.js'
import { resolvePermissionDecision } from './permission-response.js'

export type DenyPermissionCommandInput = {
  errorMessage: string
  persistDecision?: boolean
} & PermissionRuleFlags

export async function runDenyPermissionCommand(
  teamName: string,
  recipient: string,
  requestId: string,
  inputOrError: string | DenyPermissionCommandInput,
  options: TeamCoreOptions = {},
): Promise<CliCommandResult> {
  const input: DenyPermissionCommandInput =
    typeof inputOrError === 'string'
      ? {
          errorMessage: inputOrError,
        }
      : inputOrError
  return resolvePermissionDecision({
    teamName,
    recipient,
    requestId,
    decision: 'rejected',
    responseSubtype: 'error',
    responseError: input.errorMessage,
    feedback: input.errorMessage,
    persistDecision: input.persistDecision,
    behavior: 'deny',
    ruleInput: input,
    options,
  })
}

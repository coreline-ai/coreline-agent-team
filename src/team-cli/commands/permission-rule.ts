import type {
  TeamPermissionRequestRecord,
  TeamPermissionRule,
  TeamPermissionRuleMatch,
} from '../../team-core/index.js'

export type PermissionRuleFlags = {
  ruleContent?: string
  commandContains?: string
  cwdPrefix?: string
  pathPrefix?: string
  hostEquals?: string
}

function getInputString(
  input: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.length > 0) {
      return value
    }
  }
  return undefined
}

function getHostFromInput(input: Record<string, unknown>): string | undefined {
  const directHost = getInputString(input, 'host', 'hostname')
  if (directHost) {
    return directHost
  }

  const url = getInputString(input, 'url')
  if (!url) {
    return undefined
  }

  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}

function hasExplicitStructuredRule(flags: PermissionRuleFlags): boolean {
  return (
    flags.commandContains !== undefined ||
    flags.cwdPrefix !== undefined ||
    flags.pathPrefix !== undefined ||
    flags.hostEquals !== undefined
  )
}

function buildStructuredMatch(
  request: TeamPermissionRequestRecord,
  flags: PermissionRuleFlags,
): TeamPermissionRuleMatch | undefined {
  if (hasExplicitStructuredRule(flags)) {
    return {
      commandContains: flags.commandContains,
      cwdPrefix: flags.cwdPrefix,
      pathPrefix: flags.pathPrefix,
      hostEquals: flags.hostEquals,
    }
  }

  if (flags.ruleContent) {
    return undefined
  }

  const command = getInputString(request.input, 'cmd', 'command')
  const cwdPrefix = getInputString(request.input, 'cwd')
  const pathPrefix = getInputString(
    request.input,
    'path',
    'file_path',
    'target_path',
  )
  const hostEquals = getHostFromInput(request.input)

  if (!command && !cwdPrefix && !pathPrefix && !hostEquals) {
    return undefined
  }

  return {
    commandContains: command,
    cwdPrefix,
    pathPrefix,
    hostEquals,
  }
}

export function buildPermissionRuleFromRequest(
  request: TeamPermissionRequestRecord,
  flags: PermissionRuleFlags,
): TeamPermissionRule {
  const match = buildStructuredMatch(request, flags)

  return {
    toolName: request.toolName,
    ruleContent: flags.ruleContent,
    match,
  }
}

import type {
  PermissionRulePreset,
  TeamPermissionRequestRecord,
  TeamPermissionRule,
  TeamPermissionRuleMatch,
} from '../../team-core/index.js'
import {
  getAvailablePermissionRulePresets,
  getPermissionRequestContext,
} from '../../team-core/index.js'

export type PermissionRuleFlags = {
  ruleContent?: string
  rulePreset?: PermissionRulePreset
  commandContains?: string
  cwdPrefix?: string
  pathPrefix?: string
  hostEquals?: string
}

function hasExplicitStructuredRule(flags: PermissionRuleFlags): boolean {
  return (
    flags.commandContains !== undefined ||
    flags.cwdPrefix !== undefined ||
    flags.pathPrefix !== undefined ||
    flags.hostEquals !== undefined
  )
}

function buildPresetStructuredMatch(
  request: TeamPermissionRequestRecord,
  preset: PermissionRulePreset,
): TeamPermissionRuleMatch | undefined {
  const context = getPermissionRequestContext(request.input)
  switch (preset) {
    case 'suggested': {
      const match: TeamPermissionRuleMatch = {}
      if (context.command) {
        match.commandContains = context.command
      }
      if (context.cwd) {
        match.cwdPrefix = context.cwd
      }
      if (context.path) {
        match.pathPrefix = context.path
      }
      if (context.host) {
        match.hostEquals = context.host
      }
      return Object.keys(match).length > 0 ? match : undefined
    }
    case 'command':
      return context.command
        ? {
            commandContains: context.command,
          }
        : undefined
    case 'cwd':
      return context.cwd
        ? {
            cwdPrefix: context.cwd,
          }
        : undefined
    case 'path':
      return context.path
        ? {
            pathPrefix: context.path,
          }
        : undefined
    case 'host':
      return context.host
        ? {
            hostEquals: context.host,
          }
        : undefined
  }
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

  if (flags.rulePreset) {
    const match = buildPresetStructuredMatch(request, flags.rulePreset)
    if (!match || Object.keys(match).length === 0) {
      throw new Error(
        `Permission preset "${flags.rulePreset}" is unavailable for request ${request.id}`,
      )
    }
    return match
  }

  if (flags.ruleContent) {
    return undefined
  }

  const availablePresets = getAvailablePermissionRulePresets(request.input)
  if (!availablePresets.includes('suggested')) {
    return undefined
  }

  return buildPresetStructuredMatch(request, 'suggested')
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

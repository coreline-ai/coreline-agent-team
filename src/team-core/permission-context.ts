import type { TeamPermissionRuleMatch } from './types.js'

export const permissionRulePresets = [
  'suggested',
  'command',
  'cwd',
  'path',
  'host',
] as const

export type PermissionRulePreset = (typeof permissionRulePresets)[number]

export type PermissionRequestContext = {
  command?: string
  cwd?: string
  path?: string
  host?: string
}

export function isPermissionRulePreset(
  value: string,
): value is PermissionRulePreset {
  return permissionRulePresets.includes(value as PermissionRulePreset)
}

function getInputString(
  input: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value
    }
  }
  return undefined
}

function getNormalizedHost(input: Record<string, unknown>): string | undefined {
  const directHost = getInputString(input, 'host', 'hostname')
  if (directHost) {
    return directHost
  }

  const urlValue = getInputString(input, 'url')
  if (!urlValue) {
    return undefined
  }

  try {
    return new URL(urlValue).host
  } catch {
    return undefined
  }
}

export function getPermissionRequestContext(
  input: Record<string, unknown>,
): PermissionRequestContext {
  return {
    command: getInputString(input, 'cmd', 'command'),
    cwd: getInputString(input, 'cwd'),
    path: getInputString(input, 'path', 'file_path', 'target_path'),
    host: getNormalizedHost(input),
  }
}

export function describePermissionRequestContext(
  input: Record<string, unknown>,
): string[] {
  const context = getPermissionRequestContext(input)
  const lines: string[] = []

  if (context.command) {
    lines.push(`cmd=${context.command}`)
  }
  if (context.cwd) {
    lines.push(`cwd=${context.cwd}`)
  }
  if (context.path) {
    lines.push(`path=${context.path}`)
  }
  if (context.host) {
    lines.push(`host=${context.host}`)
  }

  return lines
}

export function suggestPermissionRuleMatch(
  input: Record<string, unknown>,
): TeamPermissionRuleMatch | undefined {
  const context = getPermissionRequestContext(input)
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

export function getAvailablePermissionRulePresets(
  input: Record<string, unknown>,
): PermissionRulePreset[] {
  const context = getPermissionRequestContext(input)
  const presets: PermissionRulePreset[] = []

  if (context.command || context.cwd || context.path || context.host) {
    presets.push('suggested')
  }
  if (context.command) {
    presets.push('command')
  }
  if (context.cwd) {
    presets.push('cwd')
  }
  if (context.path) {
    presets.push('path')
  }
  if (context.host) {
    presets.push('host')
  }

  return presets
}

export function describeSuggestedPermissionRuleMatch(
  input: Record<string, unknown>,
): string[] {
  const match = suggestPermissionRuleMatch(input)
  if (!match) {
    return []
  }

  const lines: string[] = []
  if (match.commandContains) {
    lines.push(`match command~${match.commandContains}`)
  }
  if (match.cwdPrefix) {
    lines.push(`match cwd^=${match.cwdPrefix}`)
  }
  if (match.pathPrefix) {
    lines.push(`match path^=${match.pathPrefix}`)
  }
  if (match.hostEquals) {
    lines.push(`match host=${match.hostEquals}`)
  }
  return lines
}

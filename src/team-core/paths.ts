import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import type { TeamCoreOptions } from './types.js'

export function sanitizePathComponent(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, '-')
}

export function getDefaultRootDir(): string {
  return join(homedir(), '.agent-team')
}

export function formatDisplayPath(path: string | undefined): string | undefined {
  if (!path) {
    return path
  }

  const resolvedPath = resolve(path)
  const resolvedHome = resolve(homedir())

  if (resolvedPath === resolvedHome) {
    return '~'
  }

  if (resolvedPath.startsWith(`${resolvedHome}${sep}`)) {
    return `~${resolvedPath.slice(resolvedHome.length)}`
  }

  return resolvedPath
}

export function getRootDir(options: TeamCoreOptions = {}): string {
  return options.rootDir ?? getDefaultRootDir()
}

export function getTeamsDir(options: TeamCoreOptions = {}): string {
  return join(getRootDir(options), 'teams')
}

export function getTasksRootDir(options: TeamCoreOptions = {}): string {
  return join(getRootDir(options), 'tasks')
}

export function getWorkspacesDir(options: TeamCoreOptions = {}): string {
  return join(getRootDir(options), 'workspaces')
}

export function getDefaultWorkspacePath(
  teamName: string,
  options: TeamCoreOptions = {},
): string {
  return join(getWorkspacesDir(options), sanitizePathComponent(teamName))
}

export function getTaskListIdForTeam(teamName: string): string {
  return sanitizePathComponent(teamName)
}

export function getTeamDir(
  teamName: string,
  options: TeamCoreOptions = {},
): string {
  return join(getTeamsDir(options), sanitizePathComponent(teamName))
}

export function getTeamFilePath(
  teamName: string,
  options: TeamCoreOptions = {},
): string {
  return join(getTeamDir(teamName, options), 'config.json')
}

export function getTeamLockPath(
  teamName: string,
  options: TeamCoreOptions = {},
): string {
  return join(getTeamDir(teamName, options), '.lock')
}

export function getInboxDir(
  teamName: string,
  options: TeamCoreOptions = {},
): string {
  return join(getTeamDir(teamName, options), 'inboxes')
}

export function getInboxPath(
  teamName: string,
  agentName: string,
  options: TeamCoreOptions = {},
): string {
  return join(
    getInboxDir(teamName, options),
    `${sanitizePathComponent(agentName)}.json`,
  )
}

export function getTaskListDir(
  taskListId: string,
  options: TeamCoreOptions = {},
): string {
  return join(getTasksRootDir(options), sanitizePathComponent(taskListId))
}

export function getTaskListLockPath(
  taskListId: string,
  options: TeamCoreOptions = {},
): string {
  return join(getTaskListDir(taskListId, options), '.lock')
}

export function getTaskPath(
  taskListId: string,
  taskId: string,
  options: TeamCoreOptions = {},
): string {
  return join(
    getTaskListDir(taskListId, options),
    `${sanitizePathComponent(taskId)}.json`,
  )
}

export function getPermissionsDir(
  teamName: string,
  options: TeamCoreOptions = {},
): string {
  return join(getTeamDir(teamName, options), 'permissions')
}

export function getPendingPermissionsDir(
  teamName: string,
  options: TeamCoreOptions = {},
): string {
  return join(getPermissionsDir(teamName, options), 'pending')
}

export function getResolvedPermissionsDir(
  teamName: string,
  options: TeamCoreOptions = {},
): string {
  return join(getPermissionsDir(teamName, options), 'resolved')
}

export function getPermissionsLockPath(
  teamName: string,
  options: TeamCoreOptions = {},
): string {
  return join(getPermissionsDir(teamName, options), '.lock')
}

export function getPendingPermissionRequestPath(
  teamName: string,
  requestId: string,
  options: TeamCoreOptions = {},
): string {
  return join(
    getPendingPermissionsDir(teamName, options),
    `${sanitizePathComponent(requestId)}.json`,
  )
}

export function getResolvedPermissionRequestPath(
  teamName: string,
  requestId: string,
  options: TeamCoreOptions = {},
): string {
  return join(
    getResolvedPermissionsDir(teamName, options),
    `${sanitizePathComponent(requestId)}.json`,
  )
}

export function getTranscriptsDir(
  teamName: string,
  options: TeamCoreOptions = {},
): string {
  return join(getTeamDir(teamName, options), 'transcripts')
}

export function getTranscriptPath(
  teamName: string,
  agentName: string,
  options: TeamCoreOptions = {},
): string {
  return join(
    getTranscriptsDir(teamName, options),
    `${sanitizePathComponent(agentName)}.json`,
  )
}

export function getSessionsDir(
  teamName: string,
  options: TeamCoreOptions = {},
): string {
  return join(getTeamDir(teamName, options), 'sessions')
}

export function getLogsDir(
  teamName: string,
  options: TeamCoreOptions = {},
): string {
  return join(getTeamDir(teamName, options), 'logs')
}

export function getWorkerStdoutLogPath(
  teamName: string,
  agentName: string,
  options: TeamCoreOptions = {},
): string {
  return join(
    getLogsDir(teamName, options),
    `${sanitizePathComponent(agentName)}.stdout.log`,
  )
}

export function getWorkerStderrLogPath(
  teamName: string,
  agentName: string,
  options: TeamCoreOptions = {},
): string {
  return join(
    getLogsDir(teamName, options),
    `${sanitizePathComponent(agentName)}.stderr.log`,
  )
}

export function getSessionStatePath(
  teamName: string,
  agentName: string,
  options: TeamCoreOptions = {},
): string {
  return join(
    getSessionsDir(teamName, options),
    `${sanitizePathComponent(agentName)}.json`,
  )
}

import { readdir, rm } from 'node:fs/promises'
import { basename } from 'node:path'
import {
  ensureDir,
  ensureFile,
  pathExists,
  readJsonFile,
  writeJsonFile,
} from './file-utils.js'
import { withFileLock } from './lockfile.js'
import {
  getPendingPermissionRequestPath,
  getPendingPermissionsDir,
  getPermissionsLockPath,
  getResolvedPermissionRequestPath,
  getResolvedPermissionsDir,
} from './paths.js'
import { applyTeamPermissionUpdates, getTeamPermissionState } from './team-store.js'
import type {
  TeamCoreOptions,
  TeamPermissionRequestRecord,
  TeamPermissionRule,
  TeamPermissionRuleMatch,
  TeamPermissionUpdate,
} from './types.js'

const PERMISSIONS_LOCK_OPTIONS = {
  retries: {
    retries: 20,
    minTimeout: 5,
    maxTimeout: 100,
  },
}

type PersistedPermissionDecision = {
  behavior: TeamPermissionUpdate['behavior']
  rule: TeamPermissionRule
  update: TeamPermissionUpdate
}

async function ensurePermissionsLock(
  teamName: string,
  options: TeamCoreOptions,
): Promise<string> {
  const lockPath = getPermissionsLockPath(teamName, options)
  await ensureFile(lockPath, '')
  return lockPath
}

async function withPermissionsLock<T>(
  teamName: string,
  options: TeamCoreOptions,
  work: () => Promise<T>,
): Promise<T> {
  const lockPath = await ensurePermissionsLock(teamName, options)
  return withFileLock(lockPath, work, PERMISSIONS_LOCK_OPTIONS)
}

function matchesRule(
  rule: TeamPermissionRule,
  toolName: string,
  input: Record<string, unknown>,
): boolean {
  if (rule.toolName !== toolName) {
    return false
  }

  const structuredMatch = rule.match
  if (structuredMatch) {
    if (!matchesStructuredRule(structuredMatch, input)) {
      return false
    }
  }

  if (!rule.ruleContent || rule.ruleContent.trim().length === 0) {
    return true
  }
  return JSON.stringify(input).includes(rule.ruleContent)
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

function matchesStructuredRule(
  match: TeamPermissionRuleMatch,
  input: Record<string, unknown>,
): boolean {
  if (
    match.inputContains &&
    !JSON.stringify(input).includes(match.inputContains)
  ) {
    return false
  }

  if (match.commandContains) {
    const command = getInputString(input, 'cmd', 'command')
    if (!command || !command.includes(match.commandContains)) {
      return false
    }
  }

  if (match.cwdPrefix) {
    const cwd = getInputString(input, 'cwd')
    if (!cwd || !cwd.startsWith(match.cwdPrefix)) {
      return false
    }
  }

  if (match.pathPrefix) {
    const pathValue = getInputString(input, 'path', 'file_path', 'target_path')
    if (!pathValue || !pathValue.startsWith(match.pathPrefix)) {
      return false
    }
  }

  if (match.hostEquals) {
    const host = getNormalizedHost(input)
    if (!host || host !== match.hostEquals) {
      return false
    }
  }

  return true
}

function getRuleSpecificity(rule: TeamPermissionRule): number {
  let specificity = 0
  if (rule.ruleContent && rule.ruleContent.trim().length > 0) {
    specificity += 1
  }

  const match = rule.match
  if (!match) {
    return specificity
  }

  if (match.inputContains) {
    specificity += 1
  }
  if (match.commandContains) {
    specificity += 2
  }
  if (match.cwdPrefix) {
    specificity += 2
  }
  if (match.pathPrefix) {
    specificity += 2
  }
  if (match.hostEquals) {
    specificity += 2
  }
  return specificity
}

export function describePermissionRule(rule: TeamPermissionRule): string {
  const parts = [rule.toolName]
  if (rule.ruleContent) {
    parts.push(`contains=${rule.ruleContent}`)
  }
  if (rule.match?.commandContains) {
    parts.push(`command~${rule.match.commandContains}`)
  }
  if (rule.match?.cwdPrefix) {
    parts.push(`cwd^=${rule.match.cwdPrefix}`)
  }
  if (rule.match?.pathPrefix) {
    parts.push(`path^=${rule.match.pathPrefix}`)
  }
  if (rule.match?.hostEquals) {
    parts.push(`host=${rule.match.hostEquals}`)
  }
  if (rule.match?.inputContains) {
    parts.push(`input~${rule.match.inputContains}`)
  }
  return parts.join(' ')
}

async function readPermissionRecordsFromDir(
  directoryPath: string,
): Promise<TeamPermissionRequestRecord[]> {
  if (!(await pathExists(directoryPath))) {
    return []
  }

  const entries = (await readdir(directoryPath))
    .filter(entry => entry.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right))

  const records = await Promise.all(
    entries.map(entry =>
      readJsonFile<TeamPermissionRequestRecord>(
        `${directoryPath}/${entry}`,
        {
          id: basename(entry, '.json'),
          teamName: '',
          workerId: '',
          workerName: '',
          toolName: '',
          toolUseId: '',
          description: '',
          input: {},
          permissionSuggestions: [],
          status: 'pending',
          createdAt: 0,
        },
      ),
    ),
  )

  return records.sort((left, right) => left.createdAt - right.createdAt)
}

export function createPermissionRequestRecord(params: {
  id: string
  teamName: string
  workerId: string
  workerName: string
  workerColor?: string
  toolName: string
  toolUseId: string
  description: string
  input: Record<string, unknown>
  permissionSuggestions?: unknown[]
}): TeamPermissionRequestRecord {
  return {
    id: params.id,
    teamName: params.teamName,
    workerId: params.workerId,
    workerName: params.workerName,
    workerColor: params.workerColor,
    toolName: params.toolName,
    toolUseId: params.toolUseId,
    description: params.description,
    input: params.input,
    permissionSuggestions: params.permissionSuggestions ?? [],
    status: 'pending',
    createdAt: Date.now(),
  }
}

export async function writePendingPermissionRequest(
  request: TeamPermissionRequestRecord,
  options: TeamCoreOptions = {},
): Promise<TeamPermissionRequestRecord> {
  return withPermissionsLock(request.teamName, options, async () => {
    await ensureDir(getPendingPermissionsDir(request.teamName, options))
    await writeJsonFile(
      getPendingPermissionRequestPath(request.teamName, request.id, options),
      request,
    )
    return request
  })
}

export async function getPendingPermissionRequest(
  teamName: string,
  requestId: string,
  options: TeamCoreOptions = {},
): Promise<TeamPermissionRequestRecord | null> {
  const path = getPendingPermissionRequestPath(teamName, requestId, options)
  if (!(await pathExists(path))) {
    return null
  }
  return readJsonFile<TeamPermissionRequestRecord | null>(path, null)
}

export async function readPendingPermissionRequests(
  teamName: string,
  options: TeamCoreOptions = {},
): Promise<TeamPermissionRequestRecord[]> {
  return readPermissionRecordsFromDir(getPendingPermissionsDir(teamName, options))
}

export async function readResolvedPermissionRequests(
  teamName: string,
  options: TeamCoreOptions = {},
): Promise<TeamPermissionRequestRecord[]> {
  return readPermissionRecordsFromDir(getResolvedPermissionsDir(teamName, options))
}

export async function resolvePermissionRequest(
  teamName: string,
  requestId: string,
  resolution: {
    decision: 'approved' | 'rejected'
    resolvedBy: 'leader' | 'worker'
    feedback?: string
    updatedInput?: Record<string, unknown>
    permissionUpdates?: TeamPermissionUpdate[]
  },
  options: TeamCoreOptions = {},
): Promise<TeamPermissionRequestRecord | null> {
  const pendingRequest = await getPendingPermissionRequest(teamName, requestId, options)
  if (!pendingRequest) {
    return null
  }

  const resolvedRequest: TeamPermissionRequestRecord = {
    ...pendingRequest,
    status: resolution.decision === 'approved' ? 'approved' : 'rejected',
    resolvedBy: resolution.resolvedBy,
    resolvedAt: Date.now(),
    feedback: resolution.feedback,
    updatedInput: resolution.updatedInput,
    permissionUpdates: resolution.permissionUpdates,
  }

  await withPermissionsLock(teamName, options, async () => {
    await ensureDir(getResolvedPermissionsDir(teamName, options))
    await writeJsonFile(
      getResolvedPermissionRequestPath(teamName, requestId, options),
      resolvedRequest,
    )
    await rm(getPendingPermissionRequestPath(teamName, requestId, options), {
      force: true,
    })
  })

  if (resolution.permissionUpdates && resolution.permissionUpdates.length > 0) {
    await applyTeamPermissionUpdates(
      teamName,
      resolution.permissionUpdates,
      options,
    )
  }

  return resolvedRequest
}

export async function getPersistedPermissionDecision(
  teamName: string,
  toolName: string,
  input: Record<string, unknown>,
  options: TeamCoreOptions = {},
): Promise<PersistedPermissionDecision | null> {
  const permissionState = await getTeamPermissionState(teamName, options)
  if (!permissionState) {
    return null
  }

  let selectedDecision: PersistedPermissionDecision | null = null
  let selectedSpecificity = -1

  for (let index = permissionState.updates.length - 1; index >= 0; index -= 1) {
    const update = permissionState.updates[index]
    if (!update || update.type !== 'addRules') {
      continue
    }

    const matchingRules = update.rules.filter(rule =>
      matchesRule(rule, toolName, input),
    )
    if (matchingRules.length === 0) {
      continue
    }

    const matchingRule = matchingRules
      .slice()
      .sort((left, right) => getRuleSpecificity(right) - getRuleSpecificity(left))[0]
    if (!matchingRule) {
      continue
    }

    const specificity = getRuleSpecificity(matchingRule)
    if (specificity >= selectedSpecificity) {
      selectedDecision = {
        behavior: update.behavior,
        rule: matchingRule,
        update,
      }
      selectedSpecificity = specificity
    }
  }

  return selectedDecision
}

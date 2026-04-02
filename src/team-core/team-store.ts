import type {
  CreateTeamInput,
  TeamCoreOptions,
  TeamFile,
  TeamMember,
  TeamMemberMatcher,
  TeamPermissionRule,
  TeamPermissionMode,
  TeamPermissionState,
  TeamPermissionUpdate,
  TeamMemberRuntimeState,
} from './types.js'
import {
  ensureFile,
  pathExists,
  readJsonFile,
  removeDir,
  writeJsonFile,
} from './file-utils.js'
import { withFileLock } from './lockfile.js'
import {
  getTaskListDir,
  getTaskListIdForTeam,
  getTeamDir,
  getTeamFilePath,
  getTeamLockPath,
} from './paths.js'

const TEAM_LOCK_OPTIONS = {
  retries: {
    retries: 20,
    minTimeout: 5,
    maxTimeout: 100,
  },
}

async function ensureTeamLockFile(
  teamName: string,
  options: TeamCoreOptions,
): Promise<string> {
  const lockPath = getTeamLockPath(teamName, options)
  await ensureFile(lockPath, '')
  return lockPath
}

async function withTeamLock<T>(
  teamName: string,
  options: TeamCoreOptions,
  work: () => Promise<T>,
): Promise<T> {
  const lockPath = await ensureTeamLockFile(teamName, options)
  return withFileLock(lockPath, work, TEAM_LOCK_OPTIONS)
}

async function writeTeamFileUnlocked(
  teamName: string,
  teamFile: TeamFile,
  options: TeamCoreOptions,
): Promise<void> {
  await writeJsonFile(getTeamFilePath(teamName, options), teamFile)
}

function matchesMember(member: TeamMember, matcher: TeamMemberMatcher): boolean {
  return (
    (matcher.agentId !== undefined && member.agentId === matcher.agentId) ||
    (matcher.name !== undefined && member.name === matcher.name)
  )
}

async function updateTeamMemberUnlocked(
  teamName: string,
  matcher: TeamMemberMatcher,
  options: TeamCoreOptions,
  updater: (member: TeamMember) => TeamMember,
): Promise<boolean> {
  const teamFile = await readTeamFile(teamName, options)
  if (!teamFile) {
    return false
  }

  const member = teamFile.members.find(item => matchesMember(item, matcher))
  if (!member) {
    return false
  }

  const nextTeamFile: TeamFile = {
    ...teamFile,
    members: teamFile.members.map(item =>
      matchesMember(item, matcher) ? updater(item) : item,
    ),
  }
  await writeTeamFileUnlocked(teamName, nextTeamFile, options)
  return true
}

function mergePermissionRules(
  existing: TeamPermissionRule[],
  updates: TeamPermissionUpdate[],
): TeamPermissionRule[] {
  const nextRules = [...existing]
  for (const update of updates) {
    if (update.type !== 'addRules') {
      continue
    }
    for (const rule of update.rules) {
      const exists = nextRules.some(
        existingRule =>
          existingRule.toolName === rule.toolName &&
          existingRule.ruleContent === rule.ruleContent &&
          JSON.stringify(existingRule.match ?? null) ===
            JSON.stringify(rule.match ?? null),
      )
      if (!exists) {
        nextRules.push(rule)
      }
    }
  }
  return nextRules
}

export async function readTeamFile(
  teamName: string,
  options: TeamCoreOptions = {},
): Promise<TeamFile | null> {
  return readJsonFile<TeamFile | null>(getTeamFilePath(teamName, options), null)
}

export async function writeTeamFile(
  teamName: string,
  teamFile: TeamFile,
  options: TeamCoreOptions = {},
): Promise<void> {
  await withTeamLock(teamName, options, async () => {
    await writeTeamFileUnlocked(teamName, teamFile, options)
  })
}

export async function createTeam(
  input: CreateTeamInput,
  options: TeamCoreOptions = {},
): Promise<TeamFile> {
  return withTeamLock(input.teamName, options, async () => {
    if (await pathExists(getTeamFilePath(input.teamName, options))) {
      throw new Error(`Team "${input.teamName}" already exists`)
    }

    const teamFile: TeamFile = {
      name: input.teamName,
      description: input.description,
      createdAt: Date.now(),
      leadAgentId: input.leadAgentId,
      leadSessionId: input.leadSessionId,
      members: [
        {
          ...input.leadMember,
          agentId: input.leadAgentId,
          joinedAt: Date.now(),
        },
      ],
    }

    await writeTeamFileUnlocked(input.teamName, teamFile, options)
    return teamFile
  })
}

export async function listTeamMembers(
  teamName: string,
  options: TeamCoreOptions = {},
): Promise<TeamMember[]> {
  const teamFile = await readTeamFile(teamName, options)
  return teamFile?.members ?? []
}

export async function getTeamMember(
  teamName: string,
  matcher: TeamMemberMatcher,
  options: TeamCoreOptions = {},
): Promise<TeamMember | null> {
  const members = await listTeamMembers(teamName, options)
  return members.find(member => matchesMember(member, matcher)) ?? null
}

export async function upsertTeamMember(
  teamName: string,
  member: TeamMember,
  options: TeamCoreOptions = {},
): Promise<TeamFile> {
  return withTeamLock(teamName, options, async () => {
    const teamFile = await readTeamFile(teamName, options)

    if (!teamFile) {
      throw new Error(`Team "${teamName}" does not exist`)
    }

    const nextMembers = teamFile.members.filter(
      existing => existing.agentId !== member.agentId,
    )
    nextMembers.push(member)

    const nextTeamFile: TeamFile = {
      ...teamFile,
      members: nextMembers,
    }

    await writeTeamFileUnlocked(teamName, nextTeamFile, options)
    return nextTeamFile
  })
}

export async function removeTeamMember(
  teamName: string,
  matcher: TeamMemberMatcher,
  options: TeamCoreOptions = {},
): Promise<boolean> {
  return withTeamLock(teamName, options, async () => {
    const teamFile = await readTeamFile(teamName, options)

    if (!teamFile) {
      return false
    }

    const nextMembers = teamFile.members.filter(member => {
      return !matchesMember(member, matcher)
    })

    if (nextMembers.length === teamFile.members.length) {
      return false
    }

    await writeTeamFileUnlocked(
      teamName,
      {
        ...teamFile,
        members: nextMembers,
      },
      options,
    )

    return true
  })
}

export async function setMemberActive(
  teamName: string,
  memberName: string,
  isActive: boolean,
  options: TeamCoreOptions = {},
): Promise<boolean> {
  return withTeamLock(teamName, options, async () => {
    return updateTeamMemberUnlocked(
      teamName,
      { name: memberName },
      options,
      member =>
        member.isActive === isActive
          ? member
          : {
              ...member,
              isActive,
            },
    )
  })
}

export async function setMemberMode(
  teamName: string,
  memberName: string,
  mode: TeamPermissionMode,
  options: TeamCoreOptions = {},
): Promise<boolean> {
  return withTeamLock(teamName, options, async () => {
    return updateTeamMemberUnlocked(
      teamName,
      { name: memberName },
      options,
      member =>
        member.mode === mode
          ? member
          : {
              ...member,
              mode,
            },
    )
  })
}

export async function setMemberRuntimeState(
  teamName: string,
  memberName: string,
  runtimeState: Partial<TeamMemberRuntimeState>,
  options: TeamCoreOptions = {},
): Promise<boolean> {
  return withTeamLock(teamName, options, async () =>
    updateTeamMemberUnlocked(
      teamName,
      { name: memberName },
      options,
      member => ({
        ...member,
        runtimeState: {
          ...member.runtimeState,
          ...runtimeState,
        },
      }),
    ),
  )
}

export async function getTeamPermissionState(
  teamName: string,
  options: TeamCoreOptions = {},
): Promise<TeamPermissionState | null> {
  const teamFile = await readTeamFile(teamName, options)
  return teamFile?.permissionState ?? null
}

export async function applyTeamPermissionUpdates(
  teamName: string,
  updates: TeamPermissionUpdate[],
  options: TeamCoreOptions = {},
): Promise<boolean> {
  if (updates.length === 0) {
    return false
  }

  return withTeamLock(teamName, options, async () => {
    const teamFile = await readTeamFile(teamName, options)
    if (!teamFile) {
      return false
    }

    const currentState: TeamPermissionState = teamFile.permissionState ?? {
      rules: [],
      updates: [],
    }

    const nextState: TeamPermissionState = {
      rules: mergePermissionRules(currentState.rules, updates),
      updates: [...currentState.updates, ...updates],
      updatedAt: Date.now(),
    }

    await writeTeamFileUnlocked(
      teamName,
      {
        ...teamFile,
        permissionState: nextState,
      },
      options,
    )

    return true
  })
}

export async function touchMemberHeartbeat(
  teamName: string,
  memberName: string,
  timestamp = Date.now(),
  options: TeamCoreOptions = {},
): Promise<boolean> {
  return setMemberRuntimeState(
    teamName,
    memberName,
    {
      lastHeartbeatAt: timestamp,
    },
    options,
  )
}

export async function listResumableMembers(
  teamName: string,
  options: TeamCoreOptions = {},
): Promise<TeamMember[]> {
  const members = await listTeamMembers(teamName, options)
  return members.filter(
    member =>
      member.isActive !== true &&
      member.runtimeState?.prompt !== undefined &&
      member.runtimeState.cwd !== undefined,
  )
}

export async function listStaleMembers(
  teamName: string,
  staleAfterMs: number,
  options: TeamCoreOptions = {},
  now = Date.now(),
): Promise<TeamMember[]> {
  const members = await listTeamMembers(teamName, options)
  return members.filter(member => {
    if (member.isActive === true) {
      return false
    }
    const lastHeartbeatAt = member.runtimeState?.lastHeartbeatAt
    if (lastHeartbeatAt === undefined) {
      return false
    }
    return now - lastHeartbeatAt >= staleAfterMs
  })
}

export async function cleanupTeamDirectories(
  teamName: string,
  options: TeamCoreOptions = {},
): Promise<void> {
  await Promise.all([
    removeDir(getTeamDir(teamName, options)),
    removeDir(getTaskListDir(getTaskListIdForTeam(teamName), options)),
  ])
}

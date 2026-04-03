import {
  ensureDir,
  ensureFile,
  readJsonFile,
  writeJsonFile,
} from './file-utils.js'
import { withFileLock } from './lockfile.js'
import { getSessionStatePath, getSessionsDir } from './paths.js'
import type {
  TeamCoreOptions,
  TeamRuntimeKind,
  TeamSessionRecord,
  TeamSessionState,
} from './types.js'

const SESSION_LOCK_OPTIONS = {
  retries: {
    retries: 20,
    minTimeout: 5,
    maxTimeout: 100,
  },
}

async function ensureSessionStateFile(
  teamName: string,
  agentName: string,
  options: TeamCoreOptions,
): Promise<string> {
  await ensureDir(getSessionsDir(teamName, options))
  const sessionStatePath = getSessionStatePath(teamName, agentName, options)
  await ensureFile(
    sessionStatePath,
    JSON.stringify(
      {
        agentName,
        sessions: [],
        updatedAt: Date.now(),
      } satisfies TeamSessionState,
      null,
      2,
    ) + '\n',
  )
  return sessionStatePath
}

async function withSessionLock<T>(
  teamName: string,
  agentName: string,
  options: TeamCoreOptions,
  work: (sessionStatePath: string) => Promise<T>,
): Promise<T> {
  const sessionStatePath = await ensureSessionStateFile(
    teamName,
    agentName,
    options,
  )
  return withFileLock(
    sessionStatePath,
    () => work(sessionStatePath),
    {
      ...SESSION_LOCK_OPTIONS,
      lockfilePath: `${sessionStatePath}.lock`,
    },
  )
}

function createDefaultSessionState(agentName: string): TeamSessionState {
  return {
    agentName,
    sessions: [],
    updatedAt: Date.now(),
  }
}

export async function readSessionState(
  teamName: string,
  agentName: string,
  options: TeamCoreOptions = {},
): Promise<TeamSessionState> {
  const sessionStatePath = await ensureSessionStateFile(teamName, agentName, options)
  return readJsonFile<TeamSessionState>(
    sessionStatePath,
    createDefaultSessionState(agentName),
  )
}

export async function listSessionRecords(
  teamName: string,
  agentName: string,
  options: TeamCoreOptions = {},
): Promise<TeamSessionRecord[]> {
  const state = await readSessionState(teamName, agentName, options)
  return [...state.sessions].sort(
    (left, right) => right.lastOpenedAt - left.lastOpenedAt,
  )
}

export async function readLatestSessionRecord(
  teamName: string,
  agentName: string,
  options: TeamCoreOptions = {},
): Promise<TeamSessionRecord | null> {
  const sessions = await listSessionRecords(teamName, agentName, options)
  return sessions[0] ?? null
}

export async function openTeamSession(
  teamName: string,
  agentName: string,
  input: {
    sessionId: string
    runtimeKind?: TeamRuntimeKind
    cwd: string
    prompt: string
    model?: string
    reopen?: boolean
  },
  options: TeamCoreOptions = {},
): Promise<TeamSessionRecord> {
  return withSessionLock(teamName, agentName, options, async sessionStatePath => {
    const state = await readJsonFile<TeamSessionState>(
      sessionStatePath,
      createDefaultSessionState(agentName),
    )
    const now = Date.now()
    const existingRecord = state.sessions.find(
      record => record.sessionId === input.sessionId,
    )

    const nextRecord: TeamSessionRecord = existingRecord
      ? {
          ...existingRecord,
          runtimeKind: input.runtimeKind ?? existingRecord.runtimeKind,
          cwd: input.cwd,
          prompt: input.prompt,
          model: input.model ?? existingRecord.model,
          status: 'open',
          lastOpenedAt: now,
          reopenedAt:
            input.reopen === true && existingRecord.status === 'closed'
              ? [...existingRecord.reopenedAt, now]
              : existingRecord.reopenedAt,
          closedAt: undefined,
          lastExitReason: undefined,
        }
      : {
          sessionId: input.sessionId,
          agentName,
          runtimeKind: input.runtimeKind,
          cwd: input.cwd,
          prompt: input.prompt,
          model: input.model,
          status: 'open',
          createdAt: now,
          lastOpenedAt: now,
          reopenedAt: [],
        }

    const otherRecords = state.sessions.filter(
      record => record.sessionId !== input.sessionId,
    )
    const nextState: TeamSessionState = {
      agentName,
      currentSessionId: input.sessionId,
      sessions: [nextRecord, ...otherRecords],
      updatedAt: now,
    }

    await writeJsonFile(sessionStatePath, nextState)
    return nextRecord
  })
}

export async function updateTeamSessionProgress(
  teamName: string,
  agentName: string,
  sessionId: string,
  input: {
    lastWorkSummary?: string
    lastWorkItemKind?: TeamSessionRecord['lastWorkItemKind']
    lastTaskId?: string
  },
  options: TeamCoreOptions = {},
): Promise<boolean> {
  return withSessionLock(teamName, agentName, options, async sessionStatePath => {
    const state = await readJsonFile<TeamSessionState>(
      sessionStatePath,
      createDefaultSessionState(agentName),
    )
    const existingRecord = state.sessions.find(record => record.sessionId === sessionId)
    if (!existingRecord) {
      return false
    }

    const nextState: TeamSessionState = {
      ...state,
      updatedAt: Date.now(),
      sessions: state.sessions.map(record =>
        record.sessionId === sessionId
          ? {
              ...record,
              lastWorkSummary:
                input.lastWorkSummary ?? record.lastWorkSummary,
              lastWorkItemKind:
                input.lastWorkItemKind ?? record.lastWorkItemKind,
              lastTaskId: input.lastTaskId ?? record.lastTaskId,
            }
          : record,
      ),
    }

    await writeJsonFile(sessionStatePath, nextState)
    return true
  })
}

export async function closeTeamSession(
  teamName: string,
  agentName: string,
  sessionId: string,
  input: {
    lastExitReason?: string
    lastWorkSummary?: string
    lastWorkItemKind?: TeamSessionRecord['lastWorkItemKind']
    lastTaskId?: string
  } = {},
  options: TeamCoreOptions = {},
): Promise<boolean> {
  return withSessionLock(teamName, agentName, options, async sessionStatePath => {
    const state = await readJsonFile<TeamSessionState>(
      sessionStatePath,
      createDefaultSessionState(agentName),
    )
    const existingRecord = state.sessions.find(record => record.sessionId === sessionId)
    if (!existingRecord) {
      return false
    }

    const now = Date.now()
    const nextState: TeamSessionState = {
      ...state,
      currentSessionId:
        state.currentSessionId === sessionId ? undefined : state.currentSessionId,
      updatedAt: now,
      sessions: state.sessions.map(record =>
        record.sessionId === sessionId
          ? {
              ...record,
              status: 'closed',
              closedAt: now,
              lastExitReason: input.lastExitReason ?? record.lastExitReason,
              lastWorkSummary:
                input.lastWorkSummary ?? record.lastWorkSummary,
              lastWorkItemKind:
                input.lastWorkItemKind ?? record.lastWorkItemKind,
              lastTaskId: input.lastTaskId ?? record.lastTaskId,
            }
          : record,
      ),
    }

    await writeJsonFile(sessionStatePath, nextState)
    return true
  })
}

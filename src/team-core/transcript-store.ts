import type {
  TeamCoreOptions,
  TeamTranscriptEntry,
  TeamTranscriptEntryRole,
} from './types.js'
import { ensureFile, readJsonFile, writeJsonFile } from './file-utils.js'
import { withFileLock } from './lockfile.js'
import { getTranscriptPath } from './paths.js'

const TRANSCRIPT_LOCK_OPTIONS = {
  lockfilePath: undefined,
  retries: {
    retries: 20,
    minTimeout: 5,
    maxTimeout: 100,
  },
}

async function ensureTranscriptFile(
  teamName: string,
  agentName: string,
  options: TeamCoreOptions,
): Promise<string> {
  const transcriptPath = getTranscriptPath(teamName, agentName, options)
  await ensureFile(transcriptPath, '[]\n')
  return transcriptPath
}

async function withTranscriptLock<T>(
  teamName: string,
  agentName: string,
  options: TeamCoreOptions,
  work: () => Promise<T>,
): Promise<T> {
  const transcriptPath = await ensureTranscriptFile(teamName, agentName, options)
  return withFileLock(transcriptPath, work, {
    ...TRANSCRIPT_LOCK_OPTIONS,
    lockfilePath: `${transcriptPath}.lock`,
  })
}

async function readTranscriptFile(
  teamName: string,
  agentName: string,
  options: TeamCoreOptions,
): Promise<TeamTranscriptEntry[]> {
  return readJsonFile<TeamTranscriptEntry[]>(
    getTranscriptPath(teamName, agentName, options),
    [],
  )
}

export function createTranscriptEntry(params: {
  sessionId: string
  agentName: string
  role: TeamTranscriptEntryRole
  content: string
  metadata?: Record<string, unknown>
}): TeamTranscriptEntry {
  return {
    id: `${params.sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: params.sessionId,
    agentName: params.agentName,
    role: params.role,
    content: params.content,
    createdAt: Date.now(),
    metadata: params.metadata,
  }
}

export async function readTranscriptEntries(
  teamName: string,
  agentName: string,
  options: TeamCoreOptions = {},
): Promise<TeamTranscriptEntry[]> {
  return readTranscriptFile(teamName, agentName, options)
}

export async function appendTranscriptEntry(
  teamName: string,
  agentName: string,
  entry: TeamTranscriptEntry,
  options: TeamCoreOptions = {},
): Promise<TeamTranscriptEntry[]> {
  return withTranscriptLock(teamName, agentName, options, async () => {
    const entries = await readTranscriptFile(teamName, agentName, options)
    const nextEntries = [...entries, entry]
    await writeJsonFile(getTranscriptPath(teamName, agentName, options), nextEntries)
    return nextEntries
  })
}

function formatTranscriptLine(entry: TeamTranscriptEntry): string {
  const content = entry.content.replace(/\s+/g, ' ').trim().slice(0, 240)
  return `[${entry.role}] ${content}`
}

export function buildTranscriptContext(
  entries: TeamTranscriptEntry[],
  options: {
    limit?: number
  } = {},
): string {
  const limit = options.limit ?? 8
  const slice = entries.slice(-limit)
  if (slice.length === 0) {
    return ''
  }

  return [
    '# Recent Transcript Context',
    ...slice.map(formatTranscriptLine),
  ].join('\n')
}

export async function getRecentTranscriptContext(
  teamName: string,
  agentName: string,
  options: TeamCoreOptions = {},
  input?: {
    limit?: number
  },
): Promise<string> {
  const entries = await readTranscriptFile(teamName, agentName, options)
  return buildTranscriptContext(entries, input)
}

export async function clearTranscript(
  teamName: string,
  agentName: string,
  options: TeamCoreOptions = {},
): Promise<void> {
  await withTranscriptLock(teamName, agentName, options, async () => {
    await writeJsonFile(getTranscriptPath(teamName, agentName, options), [])
  })
}

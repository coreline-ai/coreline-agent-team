import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, resolve, join } from 'node:path'
import {
  createTask,
  getAgentStatuses,
  getTaskListIdForTeam,
  listSessionRecords,
  listTasks,
  readTranscriptEntries,
  type AgentStatus,
  type TeamCoreOptions,
  type TeamSessionRecord,
  type TeamTask,
} from '../../team-core/index.js'
import { runAttachCommand } from '../commands/attach.js'
import { runCleanupCommand } from '../commands/cleanup.js'
import { runInitCommand } from '../commands/init.js'
import { runReopenCommand } from '../commands/reopen.js'
import { runResumeCommand } from '../commands/resume.js'
import { runSpawnCommand } from '../commands/spawn.js'
import { runStatusCommand } from '../commands/status.js'
import { runTasksCommand } from '../commands/tasks.js'
import { runTranscriptCommand } from '../commands/transcript.js'

export type CodexRepeatedSoakOptions = {
  rootDir?: string
  cwd?: string
  teamName?: string
  agentName?: string
  prompt?: string
  model?: string
  iterations?: number
  maxIterationsPerLaunch?: number
  pollIntervalMs?: number
  codexExecutablePath?: string
  artifactDir?: string
  continueOnFailure?: boolean
}

export type CodexRepeatedSoakPreflight = {
  success: boolean
  executable: string
  executableResolvedPath?: string
  rootDir: string
  cwd: string
  issues: string[]
}

export type CodexRepeatedSoakStateSnapshot = {
  attachOutput: string
  statusOutput: string
  tasksOutput: string
  transcriptOutput: string
  agentStatuses: AgentStatus[]
  tasks: TeamTask[]
  sessionRecords: TeamSessionRecord[]
  transcriptEntryCount: number
}

export type CodexRepeatedSoakSummaryArtifact = {
  createdAt: string
  success: boolean
  teamName: string
  agentName: string
  rootDir: string
  artifactDir: string
  iterationsRequested: number
  iterationsCompleted: number
  latestAttachOutput?: string
  latestStatusOutput?: string
  latestTasksOutput?: string
  cleanupMessage?: string
  failureMessage?: string
  failureSnapshotPath?: string
}

export type CodexRepeatedSoakStepResult = {
  step: 'spawn' | 'resume' | 'reopen'
  commandMessage: string
  state: CodexRepeatedSoakStateSnapshot
}

export type CodexRepeatedSoakIterationResult = {
  iteration: number
  createdTaskIds: string[]
  spawn: CodexRepeatedSoakStepResult
  resume: CodexRepeatedSoakStepResult
  reopen: CodexRepeatedSoakStepResult
}

export type CodexRepeatedSoakFailureSnapshot = {
  createdAt: string
  preflight: CodexRepeatedSoakPreflight
  teamName: string
  agentName: string
  rootDir: string
  iteration?: number
  step: 'preflight' | 'init' | 'spawn' | 'resume' | 'reopen' | 'cleanup'
  message: string
  state?: CodexRepeatedSoakStateSnapshot
}

export type CodexRepeatedSoakResult = {
  success: boolean
  teamName: string
  agentName: string
  rootDir: string
  artifactDir: string
  preflight: CodexRepeatedSoakPreflight
  iterations: CodexRepeatedSoakIterationResult[]
  cleanupMessage?: string
  failureMessage?: string
  failureSnapshotPath?: string
  summaryArtifactPath?: string
}

type ResolvedCodexRepeatedSoakOptions = {
  rootDir: string
  cwd: string
  teamName: string
  agentName: string
  prompt: string
  model?: string
  iterations: number
  maxIterationsPerLaunch: number
  pollIntervalMs?: number
  codexExecutablePath?: string
  artifactDir: string
  continueOnFailure: boolean
}

class SoakStepError extends Error {
  constructor(
    readonly step: CodexRepeatedSoakFailureSnapshot['step'],
    readonly iteration: number,
    message: string,
  ) {
    super(message)
    this.name = 'SoakStepError'
  }
}

function createDefaultTeamName(): string {
  return `codex-soak-${Date.now().toString(36)}`
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

async function resolveRootDir(rootDir?: string): Promise<string> {
  if (rootDir) {
    return resolve(rootDir)
  }
  return mkdtemp(join(tmpdir(), 'agent-team-codex-soak-'))
}

function resolveExecutablePath(
  executable?: string,
): { executable: string; executableResolvedPath?: string } {
  const resolvedExecutable = executable?.trim() || 'codex'

  if (resolvedExecutable.includes('/') || isAbsolute(resolvedExecutable)) {
    return {
      executable: resolvedExecutable,
      executableResolvedPath: resolve(resolvedExecutable),
    }
  }

  const whichResult = spawnSync('which', [resolvedExecutable], {
    encoding: 'utf8',
  })
  if (whichResult.status === 0) {
    return {
      executable: resolvedExecutable,
      executableResolvedPath: whichResult.stdout.trim() || undefined,
    }
  }

  return {
    executable: resolvedExecutable,
  }
}

export async function resolveCodexRepeatedSoakOptions(
  input: CodexRepeatedSoakOptions = {},
): Promise<ResolvedCodexRepeatedSoakOptions> {
  const rootDir = await resolveRootDir(input.rootDir)
  const cwd = resolve(input.cwd ?? process.cwd())
  const teamName = input.teamName?.trim() || createDefaultTeamName()
  const agentName = input.agentName?.trim() || 'researcher'

  return {
    rootDir,
    cwd,
    teamName,
    agentName,
    prompt:
      input.prompt?.trim() ||
      'Complete the current task immediately. Do not inspect repository files. Return the minimal schema-compliant result that marks the task completed.',
    model: input.model,
    iterations: input.iterations ?? 5,
    maxIterationsPerLaunch: input.maxIterationsPerLaunch ?? 1,
    pollIntervalMs: input.pollIntervalMs,
    codexExecutablePath: input.codexExecutablePath,
    artifactDir: resolve(input.artifactDir ?? join(rootDir, 'soak-artifacts')),
    continueOnFailure: input.continueOnFailure ?? false,
  }
}

export async function runCodexRepeatedSoakPreflight(
  input: CodexRepeatedSoakOptions = {},
): Promise<CodexRepeatedSoakPreflight> {
  const resolved = await resolveCodexRepeatedSoakOptions(input)
  const executable = resolveExecutablePath(resolved.codexExecutablePath)
  const issues: string[] = []

  if (!existsSync(resolved.cwd)) {
    issues.push(`cwd does not exist: ${resolved.cwd}`)
  }

  if (!isPositiveInteger(resolved.iterations)) {
    issues.push(`iterations must be a positive integer (received ${resolved.iterations})`)
  }

  if (!isPositiveInteger(resolved.maxIterationsPerLaunch)) {
    issues.push(
      `maxIterationsPerLaunch must be a positive integer (received ${resolved.maxIterationsPerLaunch})`,
    )
  }

  if (
    executable.executableResolvedPath &&
    !existsSync(executable.executableResolvedPath)
  ) {
    issues.push(
      `Codex executable does not exist: ${executable.executableResolvedPath}`,
    )
  }

  if (
    !executable.executableResolvedPath &&
    !resolved.codexExecutablePath &&
    executable.executable === 'codex'
  ) {
    issues.push(
      'Unable to resolve `codex` on PATH. Provide --codex-executable or install Codex CLI first.',
    )
  }

  await mkdir(resolved.rootDir, { recursive: true })
  await mkdir(resolved.artifactDir, { recursive: true })

  return {
    success: issues.length === 0,
    executable: executable.executable,
    executableResolvedPath: executable.executableResolvedPath,
    rootDir: resolved.rootDir,
    cwd: resolved.cwd,
    issues,
  }
}

async function captureStateSnapshot(
  teamName: string,
  agentName: string,
  options: TeamCoreOptions,
): Promise<CodexRepeatedSoakStateSnapshot> {
  const attach =
    await runAttachCommand(teamName, options).catch(() => ({
      success: false,
      message: `Attach snapshot unavailable for team "${teamName}"`,
    }))
  const [status, tasks, transcript, agentStatuses, taskRecords, sessionRecords, transcriptEntries] =
    await Promise.all([
      runStatusCommand(teamName, options),
      runTasksCommand(teamName, options),
      runTranscriptCommand(teamName, agentName, 20, options),
      getAgentStatuses(teamName, options),
      listTasks(getTaskListIdForTeam(teamName), options),
      listSessionRecords(teamName, agentName, options),
      readTranscriptEntries(teamName, agentName, options),
    ])

  return {
    attachOutput: attach.message,
    statusOutput: status.message,
    tasksOutput: tasks.message,
    transcriptOutput: transcript.message,
    agentStatuses: agentStatuses ?? [],
    tasks: taskRecords,
    sessionRecords,
    transcriptEntryCount: transcriptEntries.length,
  }
}

async function writeSummaryArtifact(
  artifactDir: string,
  artifact: CodexRepeatedSoakSummaryArtifact,
): Promise<string> {
  await mkdir(artifactDir, { recursive: true })
  const filePath = join(artifactDir, 'latest-summary.json')
  await writeFile(filePath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  return filePath
}

function buildSummaryArtifact(
  resolved: ResolvedCodexRepeatedSoakOptions,
  result: Pick<
    CodexRepeatedSoakResult,
    | 'success'
    | 'teamName'
    | 'agentName'
    | 'rootDir'
    | 'artifactDir'
    | 'iterations'
    | 'cleanupMessage'
    | 'failureMessage'
    | 'failureSnapshotPath'
  >,
): CodexRepeatedSoakSummaryArtifact {
  const latestIteration = result.iterations[result.iterations.length - 1]
  const latestState = latestIteration?.reopen.state ?? latestIteration?.resume.state ?? latestIteration?.spawn.state

  return {
    createdAt: new Date().toISOString(),
    success: result.success,
    teamName: result.teamName,
    agentName: result.agentName,
    rootDir: result.rootDir,
    artifactDir: result.artifactDir,
    iterationsRequested: resolved.iterations,
    iterationsCompleted: result.iterations.length,
    latestAttachOutput: latestState?.attachOutput,
    latestStatusOutput: latestState?.statusOutput,
    latestTasksOutput: latestState?.tasksOutput,
    cleanupMessage: result.cleanupMessage,
    failureMessage: result.failureMessage,
    failureSnapshotPath: result.failureSnapshotPath,
  }
}

async function writeFailureSnapshot(
  artifactDir: string,
  snapshot: CodexRepeatedSoakFailureSnapshot,
): Promise<string> {
  await mkdir(artifactDir, { recursive: true })
  const filePath = join(
    artifactDir,
    `failure-${Date.now()}-${snapshot.step}${snapshot.iteration !== undefined ? `-iter-${snapshot.iteration}` : ''}.json`,
  )
  await writeFile(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  return filePath
}

function findAgentStatus(
  state: CodexRepeatedSoakStateSnapshot,
  agentName: string,
): AgentStatus | undefined {
  return state.agentStatuses.find(status => status.name === agentName)
}

function getTrackedTasks(
  state: CodexRepeatedSoakStateSnapshot,
  createdTaskIds: string[],
): TeamTask[] {
  const trackedTaskIds = new Set(createdTaskIds)
  return state.tasks.filter(task => trackedTaskIds.has(task.id))
}

function validateIdleAgentState(
  state: CodexRepeatedSoakStateSnapshot,
  agentName: string,
): string | null {
  const status = findAgentStatus(state, agentName)
  if (!status) {
    return `Agent "${agentName}" was not found in status output`
  }
  if (status.isActive === true) {
    return `Agent "${agentName}" is still active after bounded command execution`
  }
  if (status.status !== 'idle') {
    return `Agent "${agentName}" should be idle but was ${status.status}`
  }
  if (status.currentTasks.length > 0) {
    return `Agent "${agentName}" still owns open tasks: ${status.currentTasks.join(',')}`
  }
  return null
}

function validateTaskProgress(
  state: CodexRepeatedSoakStateSnapshot,
  createdTaskIds: string[],
  expectedCompleted: number,
): string | null {
  const trackedTasks = getTrackedTasks(state, createdTaskIds)
  if (trackedTasks.length !== createdTaskIds.length) {
    return `Expected ${createdTaskIds.length} tracked tasks but found ${trackedTasks.length}`
  }

  const completedCount = trackedTasks.filter(
    task => task.status === 'completed',
  ).length
  const pendingCount = trackedTasks.filter(task => task.status === 'pending').length
  const inProgressCount = trackedTasks.filter(
    task => task.status === 'in_progress',
  ).length

  if (completedCount !== expectedCompleted) {
    return `Expected ${expectedCompleted} completed tracked tasks but found ${completedCount}`
  }
  if (inProgressCount !== 0) {
    return `Expected no tracked tasks in progress but found ${inProgressCount}`
  }
  if (pendingCount !== createdTaskIds.length - expectedCompleted) {
    return `Expected ${createdTaskIds.length - expectedCompleted} pending tracked tasks but found ${pendingCount}`
  }

  return null
}

function validateSessionSemantics(
  state: CodexRepeatedSoakStateSnapshot,
  expectedCurrentSessionId: string,
  previousReopenCount?: number,
): string | null {
  const latest = state.sessionRecords[0]
  if (!latest) {
    return 'No session records were found for the soak agent'
  }
  if (latest.sessionId !== expectedCurrentSessionId) {
    return `Expected latest session ${expectedCurrentSessionId} but found ${latest.sessionId}`
  }
  if (previousReopenCount !== undefined && latest.reopenedAt.length <= previousReopenCount) {
    return `Expected reopen count to grow beyond ${previousReopenCount} but found ${latest.reopenedAt.length}`
  }
  return null
}

async function createIterationTasks(
  iteration: number,
  teamName: string,
  options: TeamCoreOptions,
): Promise<string[]> {
  const taskListId = getTaskListIdForTeam(teamName)
  const taskSubjects = [
    `Iteration ${iteration} / spawn`,
    `Iteration ${iteration} / resume`,
    `Iteration ${iteration} / reopen`,
  ]

  const createdTasks: string[] = []
  for (const subject of taskSubjects) {
    const task = await createTask(
      taskListId,
      {
        subject,
        description: `Repeated Codex soak validation task for ${subject}`,
        status: 'pending',
        blocks: [],
        blockedBy: [],
      },
      options,
    )
    createdTasks.push(task.id)
  }

  return createdTasks
}

function invariant(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

async function runIteration(
  iteration: number,
  resolved: ResolvedCodexRepeatedSoakOptions,
  options: TeamCoreOptions,
): Promise<CodexRepeatedSoakIterationResult> {
  const createdTaskIds = await createIterationTasks(iteration, resolved.teamName, options)
  let spawnResult: Awaited<ReturnType<typeof runSpawnCommand>>
  let spawnState: CodexRepeatedSoakStateSnapshot
  let spawnSession: TeamSessionRecord | undefined
  try {
    spawnResult = await runSpawnCommand(
      resolved.teamName,
      resolved.agentName,
      {
        prompt: resolved.prompt,
        cwd: resolved.cwd,
        runtimeKind: 'codex-cli',
        model: resolved.model,
        maxIterations: resolved.maxIterationsPerLaunch,
        pollIntervalMs: resolved.pollIntervalMs,
        codexExecutablePath: resolved.codexExecutablePath,
      },
      options,
    )
    if (!spawnResult.success) {
      throw new Error(`Spawn failed: ${spawnResult.message}`)
    }

    spawnState = await captureStateSnapshot(
      resolved.teamName,
      resolved.agentName,
      options,
    )
    invariant(
      validateIdleAgentState(spawnState, resolved.agentName) === null,
      validateIdleAgentState(spawnState, resolved.agentName) ??
        'invalid spawn agent state',
    )
    invariant(
      validateTaskProgress(spawnState, createdTaskIds, 1) === null,
      validateTaskProgress(spawnState, createdTaskIds, 1) ??
        'invalid spawn task state',
    )

    spawnSession = spawnState.sessionRecords[0]
    invariant(spawnSession, 'Spawn did not create a session record')
  } catch (error) {
    throw new SoakStepError(
      'spawn',
      iteration,
      error instanceof Error ? error.message : String(error),
    )
  }

  let resumeResult: Awaited<ReturnType<typeof runResumeCommand>>
  let resumeState: CodexRepeatedSoakStateSnapshot
  let resumeSession: TeamSessionRecord | undefined
  try {
    resumeResult = await runResumeCommand(
      resolved.teamName,
      resolved.agentName,
      {
        maxIterations: resolved.maxIterationsPerLaunch,
        pollIntervalMs: resolved.pollIntervalMs,
      },
      options,
    )
    if (!resumeResult.success) {
      throw new Error(`Resume failed: ${resumeResult.message}`)
    }
    invariant(
      resumeResult.message.includes('(new-session)'),
      `Resume output did not indicate a new session: ${resumeResult.message}`,
    )

    resumeState = await captureStateSnapshot(
      resolved.teamName,
      resolved.agentName,
      options,
    )
    invariant(
      validateIdleAgentState(resumeState, resolved.agentName) === null,
      validateIdleAgentState(resumeState, resolved.agentName) ??
        'invalid resume agent state',
    )
    invariant(
      validateTaskProgress(resumeState, createdTaskIds, 2) === null,
      validateTaskProgress(resumeState, createdTaskIds, 2) ??
        'invalid resume task state',
    )

    resumeSession = resumeState.sessionRecords[0]
    invariant(resumeSession, 'Resume did not create a latest session record')
    invariant(
      resumeSession.sessionId !== spawnSession.sessionId,
      'Resume should create a new session but reused the previous session ID',
    )
  } catch (error) {
    throw new SoakStepError(
      'resume',
      iteration,
      error instanceof Error ? error.message : String(error),
    )
  }

  let reopenResult: Awaited<ReturnType<typeof runReopenCommand>>
  let reopenState: CodexRepeatedSoakStateSnapshot
  try {
    reopenResult = await runReopenCommand(
      resolved.teamName,
      resolved.agentName,
      {
        maxIterations: resolved.maxIterationsPerLaunch,
        pollIntervalMs: resolved.pollIntervalMs,
      },
      options,
    )
    if (!reopenResult.success) {
      throw new Error(`Reopen failed: ${reopenResult.message}`)
    }
    invariant(
      reopenResult.message.includes('(existing-session)'),
      `Reopen output did not indicate an existing session: ${reopenResult.message}`,
    )

    reopenState = await captureStateSnapshot(
      resolved.teamName,
      resolved.agentName,
      options,
    )
    invariant(
      validateIdleAgentState(reopenState, resolved.agentName) === null,
      validateIdleAgentState(reopenState, resolved.agentName) ??
        'invalid reopen agent state',
    )
    invariant(
      validateTaskProgress(reopenState, createdTaskIds, 3) === null,
      validateTaskProgress(reopenState, createdTaskIds, 3) ??
        'invalid reopen task state',
    )
    invariant(
      validateSessionSemantics(
        reopenState,
        resumeSession.sessionId,
        resumeSession.reopenedAt.length,
      ) === null,
      validateSessionSemantics(
        reopenState,
        resumeSession.sessionId,
        resumeSession.reopenedAt.length,
      ) ?? 'invalid reopen session state',
    )
    invariant(
      reopenState.transcriptEntryCount >= spawnState.transcriptEntryCount,
      'Transcript entry count should not move backwards across soak steps',
    )
  } catch (error) {
    throw new SoakStepError(
      'reopen',
      iteration,
      error instanceof Error ? error.message : String(error),
    )
  }

  return {
    iteration,
    createdTaskIds,
    spawn: {
      step: 'spawn',
      commandMessage: spawnResult.message,
      state: spawnState,
    },
    resume: {
      step: 'resume',
      commandMessage: resumeResult.message,
      state: resumeState,
    },
    reopen: {
      step: 'reopen',
      commandMessage: reopenResult.message,
      state: reopenState,
    },
  }
}

export async function runCodexRepeatedSoak(
  input: CodexRepeatedSoakOptions = {},
): Promise<CodexRepeatedSoakResult> {
  const resolved = await resolveCodexRepeatedSoakOptions(input)
  const preflight = await runCodexRepeatedSoakPreflight(resolved)
  const options: TeamCoreOptions = { rootDir: resolved.rootDir }
  const iterationResults: CodexRepeatedSoakIterationResult[] = []

  const buildFailureResult = async (
    step: CodexRepeatedSoakFailureSnapshot['step'],
    message: string,
    iteration?: number,
  ): Promise<CodexRepeatedSoakResult> => {
    const state =
      step === 'preflight'
        ? undefined
        : await captureStateSnapshot(
            resolved.teamName,
            resolved.agentName,
            options,
          ).catch(() => undefined)

    const failureSnapshotPath = await writeFailureSnapshot(resolved.artifactDir, {
      createdAt: new Date().toISOString(),
      preflight,
      teamName: resolved.teamName,
      agentName: resolved.agentName,
      rootDir: resolved.rootDir,
      iteration,
      step,
      message,
      state,
    })

    const failureResult: CodexRepeatedSoakResult = {
      success: false,
      teamName: resolved.teamName,
      agentName: resolved.agentName,
      rootDir: resolved.rootDir,
      artifactDir: resolved.artifactDir,
      preflight,
      iterations: iterationResults,
      failureMessage: message,
      failureSnapshotPath,
    }
    failureResult.summaryArtifactPath = await writeSummaryArtifact(
      resolved.artifactDir,
      buildSummaryArtifact(resolved, failureResult),
    )
    return failureResult
  }

  if (!preflight.success) {
    return buildFailureResult('preflight', preflight.issues.join('\n'))
  }

  const initResult = await runInitCommand(resolved.teamName, options).catch(error => ({
    success: false,
    message: error instanceof Error ? error.message : String(error),
  }))
  if (!initResult.success) {
    return buildFailureResult('init', initResult.message)
  }

  for (let iteration = 1; iteration <= resolved.iterations; iteration += 1) {
    try {
      const iterationResult = await runIteration(
        iteration,
        resolved,
        options,
      )
      iterationResults.push(iterationResult)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failedStep =
        error instanceof SoakStepError ? error.step : 'spawn'
      const failedIteration =
        error instanceof SoakStepError ? error.iteration : iteration
      if (!resolved.continueOnFailure) {
        return buildFailureResult(failedStep, message, failedIteration)
      }
      return buildFailureResult(failedStep, message, failedIteration)
    }
  }

  const cleanupResult = await runCleanupCommand(
    resolved.teamName,
    {
      removeInactiveMembers: false,
    },
    options,
  )

  if (!cleanupResult.success) {
    return buildFailureResult('cleanup', cleanupResult.message)
  }

  const successResult: CodexRepeatedSoakResult = {
    success: true,
    teamName: resolved.teamName,
    agentName: resolved.agentName,
    rootDir: resolved.rootDir,
    artifactDir: resolved.artifactDir,
    preflight,
    iterations: iterationResults,
    cleanupMessage: cleanupResult.message,
  }
  successResult.summaryArtifactPath = await writeSummaryArtifact(
    resolved.artifactDir,
    buildSummaryArtifact(resolved, successResult),
  )
  return successResult
}

export function renderCodexRepeatedSoakSummary(
  result: CodexRepeatedSoakResult,
): string {
  if (!result.success) {
    return [
      'Codex repeated soak: FAILED',
      `team=${result.teamName}`,
      `agent=${result.agentName}`,
      `rootDir=${result.rootDir}`,
      `failure=${result.failureMessage ?? 'unknown failure'}`,
      result.summaryArtifactPath
        ? `summary=${result.summaryArtifactPath}`
        : 'summary=n/a',
      result.failureSnapshotPath
        ? `snapshot=${result.failureSnapshotPath}`
        : 'snapshot=n/a',
    ].join('\n')
  }

  return [
    'Codex repeated soak: PASSED',
    `team=${result.teamName}`,
    `agent=${result.agentName}`,
    `rootDir=${result.rootDir}`,
    `iterations=${result.iterations.length}`,
    `summary=${result.summaryArtifactPath ?? 'n/a'}`,
    `cleanup=${result.cleanupMessage ?? 'n/a'}`,
  ].join('\n')
}

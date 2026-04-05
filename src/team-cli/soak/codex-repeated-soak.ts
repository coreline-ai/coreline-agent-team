import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, resolve, join, dirname } from 'node:path'
import {
  createTask,
  getAgentDisplayInfo,
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

export type CodexRepeatedSoakStepName = 'spawn' | 'resume' | 'reopen'
export type CodexRepeatedSoakFailureStep =
  | 'preflight'
  | 'init'
  | CodexRepeatedSoakStepName
  | 'cleanup'

export type CodexRepeatedSoakOptions = {
  rootDir?: string
  cwd?: string
  teamName?: string
  agentName?: string
  runLabel?: string
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

export type CodexRepeatedSoakFailurePatternCode =
  | 'attach_snapshot_missing'
  | 'agent_status_missing'
  | 'heartbeat_stale'
  | 'unexpected_active_worker'
  | 'orphan_open_task'
  | 'task_completion_mismatch'
  | 'session_transition_mismatch'
  | 'reopen_count_mismatch'
  | 'transcript_rollback'

export type CodexRepeatedSoakFailurePattern = {
  code: CodexRepeatedSoakFailurePatternCode
  message: string
  step: CodexRepeatedSoakFailureStep
  iteration?: number
}

export type CodexRepeatedSoakVerificationCheckCode =
  | 'attach_snapshot_recorded'
  | 'agent_returns_idle'
  | 'tracked_tasks_settled'
  | 'session_transition_consistent'
  | 'transcript_progress_monotonic'

export type CodexRepeatedSoakVerificationCheck = {
  code: CodexRepeatedSoakVerificationCheckCode
  passed: boolean
  message: string
}

export type CodexRepeatedSoakVerification = {
  step: CodexRepeatedSoakStepName
  passed: boolean
  checks: CodexRepeatedSoakVerificationCheck[]
  failurePatterns: CodexRepeatedSoakFailurePattern[]
}

export type CodexRepeatedSoakVerificationSummary = {
  stepsChecked: number
  checksRun: number
  checksFailed: number
  failingChecks: Array<{
    iteration?: number
    step: CodexRepeatedSoakStepName
    code: CodexRepeatedSoakVerificationCheckCode
    message: string
  }>
  failurePatternCounts: Partial<
    Record<CodexRepeatedSoakFailurePatternCode, number>
  >
}

export type CodexRepeatedSoakSummaryArtifact = {
  createdAt: string
  success: boolean
  teamName: string
  agentName: string
  runLabel?: string
  rootDir: string
  artifactDir: string
  iterationsRequested: number
  iterationsCompleted: number
  summaryArchivePath?: string
  historyManifestPath?: string
  latestAttachOutput?: string
  latestStatusOutput?: string
  latestTasksOutput?: string
  cleanupMessage?: string
  failureMessage?: string
  failureSnapshotPath?: string
  failurePatterns: CodexRepeatedSoakFailurePattern[]
  verificationSummary: CodexRepeatedSoakVerificationSummary
}

export type CodexRepeatedSoakReleaseGateName =
  | 'permission'
  | 'runtime'
  | 'bridge'

export type CodexRepeatedSoakReleaseGate = {
  name: CodexRepeatedSoakReleaseGateName
  description: string
  minIterations: number
}

export type CodexRepeatedSoakGateBlockerCode =
  | 'insufficient_iterations'
  | 'run_failed'
  | 'checks_failed'
  | 'failure_patterns_detected'
  | 'failure_snapshot_present'

export type CodexRepeatedSoakGateBlocker = {
  code: CodexRepeatedSoakGateBlockerCode
  message: string
}

export type CodexRepeatedSoakGateEvaluation = {
  passed: boolean
  gate: CodexRepeatedSoakReleaseGate
  summary: CodexRepeatedSoakSummaryArtifact
  summaryPath?: string
  historyManifestPath?: string
  historyRunCount?: number
  selectedRunLabel?: string
  blockers: CodexRepeatedSoakGateBlocker[]
}

export type CodexRepeatedSoakStepResult = {
  step: CodexRepeatedSoakStepName
  commandMessage: string
  state: CodexRepeatedSoakStateSnapshot
  verification: CodexRepeatedSoakVerification
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
  runLabel?: string
  rootDir: string
  iteration?: number
  step: CodexRepeatedSoakFailureStep
  message: string
  state?: CodexRepeatedSoakStateSnapshot
  verification?: CodexRepeatedSoakVerification
  failurePatterns: CodexRepeatedSoakFailurePattern[]
}

export type CodexRepeatedSoakResult = {
  success: boolean
  teamName: string
  agentName: string
  runLabel?: string
  rootDir: string
  artifactDir: string
  preflight: CodexRepeatedSoakPreflight
  iterations: CodexRepeatedSoakIterationResult[]
  cleanupMessage?: string
  failureMessage?: string
  failureSnapshotPath?: string
  summaryArtifactPath?: string
  summaryArchivePath?: string
  historyManifestPath?: string
  historyRunCount?: number
  failurePatterns: CodexRepeatedSoakFailurePattern[]
  verificationSummary: CodexRepeatedSoakVerificationSummary
}

export type CodexRepeatedSoakHistoryEntry = {
  createdAt: string
  runLabel?: string
  success: boolean
  teamName: string
  agentName: string
  iterationsRequested: number
  iterationsCompleted: number
  summaryPath: string
  failureSnapshotPath?: string
  failurePatternCodes: CodexRepeatedSoakFailurePatternCode[]
  checksFailed: number
}

export type CodexRepeatedSoakHistoryManifest = {
  updatedAt: string
  artifactDir: string
  latestSummaryPath: string
  runs: CodexRepeatedSoakHistoryEntry[]
}

export type ResolveCodexRepeatedSoakSummarySelectionInput = {
  summaryPath?: string
  historyManifestPath?: string
  runLabel?: string
}

export type ResolvedCodexRepeatedSoakSummarySelection = {
  summary: CodexRepeatedSoakSummaryArtifact
  summaryPath: string
  historyManifestPath?: string
  historyRunCount?: number
  selectedRunLabel?: string
}

type ResolvedCodexRepeatedSoakOptions = {
  rootDir: string
  cwd: string
  teamName: string
  agentName: string
  runLabel?: string
  prompt: string
  model?: string
  iterations: number
  maxIterationsPerLaunch: number
  pollIntervalMs?: number
  codexExecutablePath?: string
  artifactDir: string
  continueOnFailure: boolean
}

type CodexRepeatedSoakValidationResult = {
  passed: boolean
  message: string
  failurePatterns: CodexRepeatedSoakFailurePattern[]
}

const RELEASE_GATES: Record<
  CodexRepeatedSoakReleaseGateName,
  CodexRepeatedSoakReleaseGate
> = {
  permission: {
    name: 'permission',
    description:
      'permission / approval / operator surface 변경용 최소 gate (real soak 3 iteration)',
    minIterations: 3,
  },
  runtime: {
    name: 'runtime',
    description:
      'runtime / session / task / recovery 변경용 최소 gate (real soak 5 iteration)',
    minIterations: 5,
  },
  bridge: {
    name: 'bridge',
    description:
      'bridge / subprocess / reopen semantics 변경용 강화 gate (real soak 10 iteration)',
    minIterations: 10,
  },
}

export type AnalyzeCodexRepeatedSoakStepVerificationInput = {
  iteration: number
  step: CodexRepeatedSoakStepName
  commandMessage: string
  state: CodexRepeatedSoakStateSnapshot
  agentName: string
  createdTaskIds: string[]
  expectedCompleted: number
  previousSessionId?: string
  expectedCurrentSessionId?: string
  previousReopenCount?: number
  expectedCommandMarker?: '(new-session)' | '(existing-session)'
  previousTranscriptEntryCount?: number
}

class SoakStepError extends Error {
  constructor(
    readonly step: CodexRepeatedSoakFailureStep,
    readonly iteration: number,
    message: string,
    readonly state?: CodexRepeatedSoakStateSnapshot,
    readonly verification?: CodexRepeatedSoakVerification,
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

function sanitizeRunLabel(label?: string): string | undefined {
  const trimmed = label?.trim()
  if (!trimmed) {
    return undefined
  }

  return trimmed
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function createArtifactStamp(createdAt: string): string {
  return createdAt.replace(/[:.]/g, '-')
}

function buildSummaryArtifactPaths(
  artifactDir: string,
  createdAt: string,
  runLabel?: string,
): {
  latestSummaryPath: string
  summaryArchivePath: string
  historyManifestPath: string
} {
  const latestSummaryPath = join(artifactDir, 'latest-summary.json')
  const stamp = createArtifactStamp(createdAt)
  const labelSuffix = runLabel ? `-${runLabel}` : ''

  return {
    latestSummaryPath,
    summaryArchivePath: join(artifactDir, `summary-${stamp}${labelSuffix}.json`),
    historyManifestPath: join(artifactDir, 'history.json'),
  }
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
    runLabel: sanitizeRunLabel(input.runLabel),
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
): Promise<{
  latestSummaryPath: string
  summaryArchivePath: string
  historyManifestPath: string
}> {
  await mkdir(artifactDir, { recursive: true })
  const paths = buildSummaryArtifactPaths(
    artifactDir,
    artifact.createdAt,
    artifact.runLabel,
  )
  await writeFile(
    paths.latestSummaryPath,
    `${JSON.stringify(artifact, null, 2)}\n`,
    'utf8',
  )
  await writeFile(
    paths.summaryArchivePath,
    `${JSON.stringify(artifact, null, 2)}\n`,
    'utf8',
  )
  return paths
}

async function readHistoryManifest(
  filePath: string,
): Promise<CodexRepeatedSoakHistoryManifest | undefined> {
  if (!existsSync(filePath)) {
    return undefined
  }

  try {
    return JSON.parse(
      await readFile(filePath, 'utf8'),
    ) as CodexRepeatedSoakHistoryManifest
  } catch {
    return undefined
  }
}

export async function readCodexRepeatedSoakHistoryManifest(
  filePath: string,
): Promise<CodexRepeatedSoakHistoryManifest> {
  const manifest = await readHistoryManifest(filePath)
  if (!manifest) {
    throw new Error(`Unable to read soak history manifest: ${filePath}`)
  }
  return manifest
}

export async function resolveCodexRepeatedSoakSummarySelection(
  input: ResolveCodexRepeatedSoakSummarySelectionInput,
): Promise<ResolvedCodexRepeatedSoakSummarySelection> {
  if (input.summaryPath && input.historyManifestPath) {
    throw new Error('Use either summaryPath or historyManifestPath, not both.')
  }

  if (!input.summaryPath && !input.historyManifestPath) {
    throw new Error('Missing summary selection. Provide summaryPath or historyManifestPath.')
  }

  if (input.summaryPath) {
    const summary = await readCodexRepeatedSoakSummaryArtifact(input.summaryPath)
    return {
      summary,
      summaryPath: input.summaryPath,
      selectedRunLabel: summary.runLabel,
    }
  }

  const historyManifestPath = input.historyManifestPath!
  const manifest = await readCodexRepeatedSoakHistoryManifest(historyManifestPath)
  const selectedEntry = input.runLabel
    ? manifest.runs.find(entry => entry.runLabel === input.runLabel)
    : manifest.runs[0]

  if (!selectedEntry) {
    if (input.runLabel) {
      throw new Error(
        `Run label "${input.runLabel}" was not found in soak history: ${historyManifestPath}`,
      )
    }
    throw new Error(`No soak history runs were found in: ${historyManifestPath}`)
  }

  const summary = await readCodexRepeatedSoakSummaryArtifact(selectedEntry.summaryPath)
  return {
    summary,
    summaryPath: selectedEntry.summaryPath,
    historyManifestPath,
    historyRunCount: manifest.runs.length,
    selectedRunLabel: selectedEntry.runLabel ?? summary.runLabel,
  }
}

async function writeHistoryManifest(
  filePath: string,
  summary: CodexRepeatedSoakSummaryArtifact,
  latestSummaryPath: string,
): Promise<{ path: string; runCount: number }> {
  await mkdir(dirname(filePath), { recursive: true })
  const current =
    (await readHistoryManifest(filePath)) ??
    ({
      updatedAt: summary.createdAt,
      artifactDir: summary.artifactDir,
      latestSummaryPath,
      runs: [],
    } satisfies CodexRepeatedSoakHistoryManifest)

  const nextEntry: CodexRepeatedSoakHistoryEntry = {
    createdAt: summary.createdAt,
    runLabel: summary.runLabel,
    success: summary.success,
    teamName: summary.teamName,
    agentName: summary.agentName,
    iterationsRequested: summary.iterationsRequested,
    iterationsCompleted: summary.iterationsCompleted,
    summaryPath: summary.summaryArchivePath ?? latestSummaryPath,
    failureSnapshotPath: summary.failureSnapshotPath,
    failurePatternCodes: summary.failurePatterns.map(pattern => pattern.code),
    checksFailed: summary.verificationSummary.checksFailed,
  }

  const nextManifest: CodexRepeatedSoakHistoryManifest = {
    updatedAt: summary.createdAt,
    artifactDir: summary.artifactDir,
    latestSummaryPath,
    runs: [...current.runs, nextEntry].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    ),
  }

  await writeFile(filePath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8')
  return {
    path: filePath,
    runCount: nextManifest.runs.length,
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

export async function readCodexRepeatedSoakSummaryArtifact(
  filePath: string,
): Promise<CodexRepeatedSoakSummaryArtifact> {
  return JSON.parse(
    await readFile(filePath, 'utf8'),
  ) as CodexRepeatedSoakSummaryArtifact
}

export function getCodexRepeatedSoakReleaseGate(
  name: CodexRepeatedSoakReleaseGateName,
): CodexRepeatedSoakReleaseGate {
  return RELEASE_GATES[name]
}

export function evaluateCodexRepeatedSoakReleaseGate(
  summary: CodexRepeatedSoakSummaryArtifact,
  gateInput: CodexRepeatedSoakReleaseGateName | CodexRepeatedSoakReleaseGate,
  context: Omit<
    CodexRepeatedSoakGateEvaluation,
    'passed' | 'gate' | 'summary' | 'blockers'
  > = {},
): CodexRepeatedSoakGateEvaluation {
  const gate =
    typeof gateInput === 'string'
      ? getCodexRepeatedSoakReleaseGate(gateInput)
      : gateInput

  const blockers: CodexRepeatedSoakGateBlocker[] = []

  if (summary.iterationsCompleted < gate.minIterations) {
    blockers.push({
      code: 'insufficient_iterations',
      message:
        `Gate "${gate.name}" requires at least ${gate.minIterations} completed iterations ` +
        `but summary recorded ${summary.iterationsCompleted}.`,
    })
  }

  if (!summary.success) {
    blockers.push({
      code: 'run_failed',
      message: summary.failureMessage
        ? `Soak run failed: ${summary.failureMessage}`
        : 'Soak run did not succeed.',
    })
  }

  if (summary.verificationSummary.checksFailed > 0) {
    blockers.push({
      code: 'checks_failed',
      message:
        `Verification checks failed: ${summary.verificationSummary.checksFailed}/` +
        `${summary.verificationSummary.checksRun}.`,
    })
  }

  if (summary.failurePatterns.length > 0) {
    blockers.push({
      code: 'failure_patterns_detected',
      message:
        `Failure patterns detected: ${summary.failurePatterns.map(pattern => pattern.code).join(', ')}.`,
    })
  }

  if (summary.failureSnapshotPath) {
    blockers.push({
      code: 'failure_snapshot_present',
      message: `Failure snapshot present: ${summary.failureSnapshotPath}`,
    })
  }

  return {
    passed: blockers.length === 0,
    gate,
    summary,
    summaryPath: context.summaryPath,
    historyManifestPath: context.historyManifestPath,
    historyRunCount: context.historyRunCount,
    selectedRunLabel: context.selectedRunLabel,
    blockers,
  }
}

export function renderCodexRepeatedSoakGateEvaluation(
  evaluation: CodexRepeatedSoakGateEvaluation,
): string {
  if (evaluation.passed) {
    return [
      'Codex repeated soak gate: PASSED',
      `gate=${evaluation.gate.name}`,
      `label=${evaluation.selectedRunLabel ?? evaluation.summary.runLabel ?? 'n/a'}`,
      `required_iterations>=${evaluation.gate.minIterations}`,
      `iterations=${evaluation.summary.iterationsCompleted}/${evaluation.summary.iterationsRequested}`,
      `checks_failed=${evaluation.summary.verificationSummary.checksFailed}/${evaluation.summary.verificationSummary.checksRun}`,
      `patterns=${evaluation.summary.failurePatterns.length}`,
      `summary_success=${evaluation.summary.success ? 'yes' : 'no'}`,
      `summary=${evaluation.summaryPath ?? join(evaluation.summary.artifactDir, 'latest-summary.json')}`,
      evaluation.historyManifestPath
        ? `history=${evaluation.historyManifestPath}`
        : 'history=n/a',
      evaluation.historyRunCount !== undefined
        ? `history_runs=${evaluation.historyRunCount}`
        : 'history_runs=n/a',
    ].join('\n')
  }

  return [
    'Codex repeated soak gate: FAILED',
    `gate=${evaluation.gate.name}`,
    `label=${evaluation.selectedRunLabel ?? evaluation.summary.runLabel ?? 'n/a'}`,
    `required_iterations>=${evaluation.gate.minIterations}`,
    `iterations=${evaluation.summary.iterationsCompleted}/${evaluation.summary.iterationsRequested}`,
    `checks_failed=${evaluation.summary.verificationSummary.checksFailed}/${evaluation.summary.verificationSummary.checksRun}`,
    `patterns=${evaluation.summary.failurePatterns.length}`,
    `summary_success=${evaluation.summary.success ? 'yes' : 'no'}`,
    `summary=${evaluation.summaryPath ?? join(evaluation.summary.artifactDir, 'latest-summary.json')}`,
    evaluation.historyManifestPath
      ? `history=${evaluation.historyManifestPath}`
      : 'history=n/a',
    evaluation.historyRunCount !== undefined
      ? `history_runs=${evaluation.historyRunCount}`
      : 'history_runs=n/a',
    `blockers=${evaluation.blockers.map(blocker => blocker.code).join(',')}`,
    ...evaluation.blockers.map(blocker => `- ${blocker.message}`),
  ].join('\n')
}

function findAgentStatus(
  state: CodexRepeatedSoakStateSnapshot,
  agentName: string,
): AgentStatus | undefined {
  return state.agentStatuses.find(status => status.name === agentName)
}

function createFailurePattern(
  code: CodexRepeatedSoakFailurePatternCode,
  message: string,
  step: CodexRepeatedSoakFailureStep,
  iteration?: number,
): CodexRepeatedSoakFailurePattern {
  return {
    code,
    message,
    step,
    iteration,
  }
}

function getTrackedTasks(
  state: CodexRepeatedSoakStateSnapshot,
  createdTaskIds: string[],
): TeamTask[] {
  const trackedTaskIds = new Set(createdTaskIds)
  return state.tasks.filter(task => trackedTaskIds.has(task.id))
}

function validateAttachSnapshot(
  state: CodexRepeatedSoakStateSnapshot,
  step: CodexRepeatedSoakStepName,
  iteration: number,
): CodexRepeatedSoakValidationResult {
  if (/Attached to team/.test(state.attachOutput)) {
    return {
      passed: true,
      message: 'Attach snapshot recorded',
      failurePatterns: [],
    }
  }

  const message =
    `Attach snapshot missing after ${step} step: ${state.attachOutput || 'empty output'}`
  return {
    passed: false,
    message,
    failurePatterns: [
      createFailurePattern(
        'attach_snapshot_missing',
        message,
        step,
        iteration,
      ),
    ],
  }
}

function validateIdleAgentState(
  state: CodexRepeatedSoakStateSnapshot,
  agentName: string,
  step: CodexRepeatedSoakStepName,
  iteration: number,
): CodexRepeatedSoakValidationResult {
  const status = findAgentStatus(state, agentName)
  if (!status) {
    const message = `Agent "${agentName}" was not found in status output`
    return {
      passed: false,
      message,
      failurePatterns: [
        createFailurePattern('agent_status_missing', message, step, iteration),
      ],
    }
  }

  const display = getAgentDisplayInfo(status)
  const failurePatterns: CodexRepeatedSoakFailurePattern[] = []
  let primaryMessage: string | undefined

  if (display.state === 'stale') {
    const message = `Agent "${agentName}" heartbeat went stale after bounded command execution`
    failurePatterns.push(
      createFailurePattern('heartbeat_stale', message, step, iteration),
    )
    primaryMessage ??= message
  }

  if (status.isActive === true || status.status !== 'idle') {
    const message =
      status.isActive === true
        ? `Agent "${agentName}" is still active after bounded command execution`
        : `Agent "${agentName}" should be idle but was ${status.status}`
    failurePatterns.push(
      createFailurePattern(
        'unexpected_active_worker',
        message,
        step,
        iteration,
      ),
    )
    primaryMessage ??= message
  }

  if (status.currentTasks.length > 0) {
    const message = `Agent "${agentName}" still owns open tasks: ${status.currentTasks.join(',')}`
    failurePatterns.push(
      createFailurePattern('orphan_open_task', message, step, iteration),
    )
    primaryMessage ??= message
  }

  if (failurePatterns.length > 0) {
    return {
      passed: false,
      message: primaryMessage ?? 'Agent did not return to an idle state',
      failurePatterns,
    }
  }

  return {
    passed: true,
    message: `Agent "${agentName}" returned to idle with no open tasks`,
    failurePatterns: [],
  }
}

function validateTaskProgress(
  state: CodexRepeatedSoakStateSnapshot,
  createdTaskIds: string[],
  expectedCompleted: number,
  step: CodexRepeatedSoakStepName,
  iteration: number,
): CodexRepeatedSoakValidationResult {
  const trackedTasks = getTrackedTasks(state, createdTaskIds)
  const completedCount = trackedTasks.filter(
    task => task.status === 'completed',
  ).length
  const pendingCount = trackedTasks.filter(task => task.status === 'pending').length
  const inProgressCount = trackedTasks.filter(
    task => task.status === 'in_progress',
  ).length
  const ownedOpenTasks = trackedTasks.filter(
    task => task.status !== 'completed' && task.owner,
  )

  let taskCompletionMessage: string | undefined
  if (trackedTasks.length !== createdTaskIds.length) {
    taskCompletionMessage =
      `Expected ${createdTaskIds.length} tracked tasks but found ${trackedTasks.length}`
  } else if (completedCount !== expectedCompleted) {
    taskCompletionMessage =
      `Expected ${expectedCompleted} completed tracked tasks but found ${completedCount}`
  } else if (pendingCount !== createdTaskIds.length - expectedCompleted) {
    taskCompletionMessage =
      `Expected ${createdTaskIds.length - expectedCompleted} pending tracked tasks but found ${pendingCount}`
  }

  let orphanMessage: string | undefined
  if (inProgressCount !== 0) {
    orphanMessage = `Expected no tracked tasks in progress but found ${inProgressCount}`
  } else if (ownedOpenTasks.length > 0) {
    orphanMessage =
      `Tracked tasks retained owners after bounded execution: ${ownedOpenTasks.map(task => `${task.id}:${task.owner}`).join(',')}`
  }

  const failurePatterns: CodexRepeatedSoakFailurePattern[] = []
  if (taskCompletionMessage) {
    failurePatterns.push(
      createFailurePattern(
        'task_completion_mismatch',
        taskCompletionMessage,
        step,
        iteration,
      ),
    )
  }
  if (orphanMessage) {
    failurePatterns.push(
      createFailurePattern('orphan_open_task', orphanMessage, step, iteration),
    )
  }

  if (failurePatterns.length > 0) {
    return {
      passed: false,
      message:
        taskCompletionMessage ??
        orphanMessage ??
        'Tracked tasks did not settle as expected',
      failurePatterns,
    }
  }

  return {
    passed: true,
    message: `Tracked tasks settled with ${expectedCompleted}/${createdTaskIds.length} completed`,
    failurePatterns: [],
  }
}

function validateSessionSemantics(
  step: CodexRepeatedSoakStepName,
  iteration: number,
  commandMessage: string,
  state: CodexRepeatedSoakStateSnapshot,
  expectedCurrentSessionId?: string,
  previousSessionId?: string,
  previousReopenCount?: number,
  expectedCommandMarker?: '(new-session)' | '(existing-session)',
): CodexRepeatedSoakValidationResult {
  const latest = state.sessionRecords[0]
  let transitionMessage: string | undefined
  let reopenMessage: string | undefined

  if (!latest) {
    transitionMessage = 'No session records were found for the soak agent'
  }

  if (
    expectedCommandMarker &&
    !commandMessage.includes(expectedCommandMarker)
  ) {
    transitionMessage ??=
      expectedCommandMarker === '(new-session)'
        ? `Resume output did not indicate a new session: ${commandMessage}`
        : `Reopen output did not indicate an existing session: ${commandMessage}`
  }

  if (
    latest &&
    previousSessionId !== undefined &&
    latest.sessionId === previousSessionId
  ) {
    transitionMessage ??=
      'Resume should create a new session but reused the previous session ID'
  }

  if (
    latest &&
    expectedCurrentSessionId !== undefined &&
    latest.sessionId !== expectedCurrentSessionId
  ) {
    transitionMessage ??=
      `Expected latest session ${expectedCurrentSessionId} but found ${latest.sessionId}`
  }

  if (
    latest &&
    previousReopenCount !== undefined &&
    latest.reopenedAt.length <= previousReopenCount
  ) {
    reopenMessage =
      `Expected reopen count to grow beyond ${previousReopenCount} but found ${latest.reopenedAt.length}`
  }

  const failurePatterns: CodexRepeatedSoakFailurePattern[] = []
  if (transitionMessage) {
    failurePatterns.push(
      createFailurePattern(
        'session_transition_mismatch',
        transitionMessage,
        step,
        iteration,
      ),
    )
  }
  if (reopenMessage) {
    failurePatterns.push(
      createFailurePattern(
        'reopen_count_mismatch',
        reopenMessage,
        step,
        iteration,
      ),
    )
  }

  if (failurePatterns.length > 0) {
    return {
      passed: false,
      message:
        transitionMessage ??
        reopenMessage ??
        'Session semantics did not match the expected soak transition',
      failurePatterns,
    }
  }

  return {
    passed: true,
    message: 'Session semantics matched the expected transition',
    failurePatterns: [],
  }
}

function validateTranscriptProgress(
  step: CodexRepeatedSoakStepName,
  iteration: number,
  state: CodexRepeatedSoakStateSnapshot,
  previousTranscriptEntryCount?: number,
): CodexRepeatedSoakValidationResult {
  if (previousTranscriptEntryCount === undefined) {
    return {
      passed: true,
      message: 'Transcript baseline established',
      failurePatterns: [],
    }
  }

  if (state.transcriptEntryCount < previousTranscriptEntryCount) {
    const message =
      'Transcript entry count should not move backwards across soak steps'
    return {
      passed: false,
      message,
      failurePatterns: [
        createFailurePattern('transcript_rollback', message, step, iteration),
      ],
    }
  }

  return {
    passed: true,
    message: 'Transcript entry count remained monotonic',
    failurePatterns: [],
  }
}

export function analyzeCodexRepeatedSoakStepVerification(
  input: AnalyzeCodexRepeatedSoakStepVerificationInput,
): CodexRepeatedSoakVerification {
  const attachValidation = validateAttachSnapshot(
    input.state,
    input.step,
    input.iteration,
  )
  const agentValidation = validateIdleAgentState(
    input.state,
    input.agentName,
    input.step,
    input.iteration,
  )
  const taskValidation = validateTaskProgress(
    input.state,
    input.createdTaskIds,
    input.expectedCompleted,
    input.step,
    input.iteration,
  )
  const sessionValidation = validateSessionSemantics(
    input.step,
    input.iteration,
    input.commandMessage,
    input.state,
    input.expectedCurrentSessionId,
    input.previousSessionId,
    input.previousReopenCount,
    input.expectedCommandMarker,
  )
  const transcriptValidation = validateTranscriptProgress(
    input.step,
    input.iteration,
    input.state,
    input.previousTranscriptEntryCount,
  )

  const checks: CodexRepeatedSoakVerificationCheck[] = [
    {
      code: 'attach_snapshot_recorded',
      passed: attachValidation.passed,
      message: attachValidation.message,
    },
    {
      code: 'agent_returns_idle',
      passed: agentValidation.passed,
      message: agentValidation.message,
    },
    {
      code: 'tracked_tasks_settled',
      passed: taskValidation.passed,
      message: taskValidation.message,
    },
    {
      code: 'session_transition_consistent',
      passed: sessionValidation.passed,
      message: sessionValidation.message,
    },
    {
      code: 'transcript_progress_monotonic',
      passed: transcriptValidation.passed,
      message: transcriptValidation.message,
    },
  ]

  const failurePatterns = [
    ...attachValidation.failurePatterns,
    ...agentValidation.failurePatterns,
    ...taskValidation.failurePatterns,
    ...sessionValidation.failurePatterns,
    ...transcriptValidation.failurePatterns,
  ]

  return {
    step: input.step,
    passed: checks.every(check => check.passed),
    checks,
    failurePatterns,
  }
}

function collectStepVerifications(
  iterations: CodexRepeatedSoakIterationResult[],
  failureContext?: {
    iteration?: number
    verification: CodexRepeatedSoakVerification
  },
): Array<{
  iteration?: number
  verification: CodexRepeatedSoakVerification
}> {
  const collected: Array<{
    iteration?: number
    verification: CodexRepeatedSoakVerification
  }> = iterations.flatMap(iteration => [
    { iteration: iteration.iteration, verification: iteration.spawn.verification },
    { iteration: iteration.iteration, verification: iteration.resume.verification },
    { iteration: iteration.iteration, verification: iteration.reopen.verification },
  ])

  if (failureContext) {
    collected.push(failureContext)
  }

  return collected
}

export function summarizeCodexRepeatedSoakVerification(
  iterations: CodexRepeatedSoakIterationResult[],
  failureContext?: {
    iteration?: number
    verification: CodexRepeatedSoakVerification
  },
): {
  failurePatterns: CodexRepeatedSoakFailurePattern[]
  verificationSummary: CodexRepeatedSoakVerificationSummary
} {
  const verifications = collectStepVerifications(iterations, failureContext)
  const failurePatterns = verifications.flatMap(
    item => item.verification.failurePatterns,
  )
  const failurePatternCounts: Partial<
    Record<CodexRepeatedSoakFailurePatternCode, number>
  > = {}
  for (const pattern of failurePatterns) {
    failurePatternCounts[pattern.code] =
      (failurePatternCounts[pattern.code] ?? 0) + 1
  }

  const failingChecks = verifications.flatMap(item =>
    item.verification.checks
      .filter(check => check.passed === false)
      .map(check => ({
        iteration: item.iteration,
        step: item.verification.step,
        code: check.code,
        message: check.message,
      })),
  )

  return {
    failurePatterns,
    verificationSummary: {
      stepsChecked: verifications.length,
      checksRun: verifications.reduce(
        (total, item) => total + item.verification.checks.length,
        0,
      ),
      checksFailed: failingChecks.length,
      failingChecks,
      failurePatternCounts,
    },
  }
}

function buildSummaryArtifact(
  resolved: ResolvedCodexRepeatedSoakOptions,
  result: Pick<
    CodexRepeatedSoakResult,
    | 'success'
    | 'teamName'
    | 'agentName'
    | 'runLabel'
    | 'rootDir'
    | 'artifactDir'
    | 'iterations'
    | 'cleanupMessage'
    | 'failureMessage'
    | 'failureSnapshotPath'
    | 'failurePatterns'
    | 'verificationSummary'
  >,
): CodexRepeatedSoakSummaryArtifact {
  const createdAt = new Date().toISOString()
  const artifactPaths = buildSummaryArtifactPaths(
    result.artifactDir,
    createdAt,
    result.runLabel,
  )
  const latestIteration = result.iterations[result.iterations.length - 1]
  const latestState = latestIteration?.reopen.state ?? latestIteration?.resume.state ?? latestIteration?.spawn.state

  return {
    createdAt,
    success: result.success,
    teamName: result.teamName,
    agentName: result.agentName,
    runLabel: result.runLabel,
    rootDir: result.rootDir,
    artifactDir: result.artifactDir,
    iterationsRequested: resolved.iterations,
    iterationsCompleted: result.iterations.length,
    summaryArchivePath: artifactPaths.summaryArchivePath,
    historyManifestPath: artifactPaths.historyManifestPath,
    latestAttachOutput: latestState?.attachOutput,
    latestStatusOutput: latestState?.statusOutput,
    latestTasksOutput: latestState?.tasksOutput,
    cleanupMessage: result.cleanupMessage,
    failureMessage: result.failureMessage,
    failureSnapshotPath: result.failureSnapshotPath,
    failurePatterns: result.failurePatterns,
    verificationSummary: result.verificationSummary,
  }
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

function throwOnFailedVerification(
  step: CodexRepeatedSoakStepName,
  iteration: number,
  state: CodexRepeatedSoakStateSnapshot,
  verification: CodexRepeatedSoakVerification,
): void {
  if (verification.passed) {
    return
  }

  throw new SoakStepError(
    step,
    iteration,
    verification.checks.find(check => check.passed === false)?.message ??
      `invalid ${step} state`,
    state,
    verification,
  )
}

async function runIteration(
  iteration: number,
  resolved: ResolvedCodexRepeatedSoakOptions,
  options: TeamCoreOptions,
): Promise<CodexRepeatedSoakIterationResult> {
  const createdTaskIds = await createIterationTasks(iteration, resolved.teamName, options)

  let spawnResult: Awaited<ReturnType<typeof runSpawnCommand>> | undefined
  let spawnState: CodexRepeatedSoakStateSnapshot | undefined
  let spawnVerification: CodexRepeatedSoakVerification | undefined
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
    spawnVerification = analyzeCodexRepeatedSoakStepVerification({
      iteration,
      step: 'spawn',
      commandMessage: spawnResult.message,
      state: spawnState,
      agentName: resolved.agentName,
      createdTaskIds,
      expectedCompleted: 1,
    })
    throwOnFailedVerification('spawn', iteration, spawnState, spawnVerification)

    spawnSession = spawnState.sessionRecords[0]
    invariant(spawnSession, 'Spawn did not create a session record')
  } catch (error) {
    if (error instanceof SoakStepError) {
      throw error
    }
    throw new SoakStepError(
      'spawn',
      iteration,
      error instanceof Error ? error.message : String(error),
      spawnState,
      spawnVerification,
    )
  }

  let resumeResult: Awaited<ReturnType<typeof runResumeCommand>> | undefined
  let resumeState: CodexRepeatedSoakStateSnapshot | undefined
  let resumeVerification: CodexRepeatedSoakVerification | undefined
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

    resumeState = await captureStateSnapshot(
      resolved.teamName,
      resolved.agentName,
      options,
    )
    resumeVerification = analyzeCodexRepeatedSoakStepVerification({
      iteration,
      step: 'resume',
      commandMessage: resumeResult.message,
      state: resumeState,
      agentName: resolved.agentName,
      createdTaskIds,
      expectedCompleted: 2,
      previousSessionId: spawnSession.sessionId,
      expectedCommandMarker: '(new-session)',
      previousTranscriptEntryCount: spawnState.transcriptEntryCount,
    })
    throwOnFailedVerification('resume', iteration, resumeState, resumeVerification)

    resumeSession = resumeState.sessionRecords[0]
    invariant(resumeSession, 'Resume did not create a latest session record')
  } catch (error) {
    if (error instanceof SoakStepError) {
      throw error
    }
    throw new SoakStepError(
      'resume',
      iteration,
      error instanceof Error ? error.message : String(error),
      resumeState,
      resumeVerification,
    )
  }

  let reopenResult: Awaited<ReturnType<typeof runReopenCommand>> | undefined
  let reopenState: CodexRepeatedSoakStateSnapshot | undefined
  let reopenVerification: CodexRepeatedSoakVerification | undefined
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

    reopenState = await captureStateSnapshot(
      resolved.teamName,
      resolved.agentName,
      options,
    )
    reopenVerification = analyzeCodexRepeatedSoakStepVerification({
      iteration,
      step: 'reopen',
      commandMessage: reopenResult.message,
      state: reopenState,
      agentName: resolved.agentName,
      createdTaskIds,
      expectedCompleted: 3,
      expectedCurrentSessionId: resumeSession.sessionId,
      previousReopenCount: resumeSession.reopenedAt.length,
      expectedCommandMarker: '(existing-session)',
      previousTranscriptEntryCount: resumeState.transcriptEntryCount,
    })
    throwOnFailedVerification('reopen', iteration, reopenState, reopenVerification)
  } catch (error) {
    if (error instanceof SoakStepError) {
      throw error
    }
    throw new SoakStepError(
      'reopen',
      iteration,
      error instanceof Error ? error.message : String(error),
      reopenState,
      reopenVerification,
    )
  }

  invariant(spawnResult, 'spawnResult should be defined after successful soak iteration')
  invariant(spawnState, 'spawnState should be defined after successful soak iteration')
  invariant(spawnVerification, 'spawnVerification should be defined after successful soak iteration')
  invariant(resumeResult, 'resumeResult should be defined after successful soak iteration')
  invariant(resumeState, 'resumeState should be defined after successful soak iteration')
  invariant(resumeVerification, 'resumeVerification should be defined after successful soak iteration')
  invariant(reopenResult, 'reopenResult should be defined after successful soak iteration')
  invariant(reopenState, 'reopenState should be defined after successful soak iteration')
  invariant(reopenVerification, 'reopenVerification should be defined after successful soak iteration')

  return {
    iteration,
    createdTaskIds,
    spawn: {
      step: 'spawn',
      commandMessage: spawnResult.message,
      state: spawnState,
      verification: spawnVerification,
    },
    resume: {
      step: 'resume',
      commandMessage: resumeResult.message,
      state: resumeState,
      verification: resumeVerification,
    },
    reopen: {
      step: 'reopen',
      commandMessage: reopenResult.message,
      state: reopenState,
      verification: reopenVerification,
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

  const buildFailureResult = async (failure: {
    step: CodexRepeatedSoakFailureStep
    message: string
    iteration?: number
    state?: CodexRepeatedSoakStateSnapshot
    verification?: CodexRepeatedSoakVerification
  }): Promise<CodexRepeatedSoakResult> => {
    const state =
      failure.state ??
      (failure.step === 'preflight'
        ? undefined
        : await captureStateSnapshot(
            resolved.teamName,
            resolved.agentName,
            options,
          ).catch(() => undefined))
    const { failurePatterns, verificationSummary } =
      summarizeCodexRepeatedSoakVerification(
        iterationResults,
        failure.verification
          ? {
              iteration: failure.iteration,
              verification: failure.verification,
            }
          : undefined,
      )

    const failureSnapshotPath = await writeFailureSnapshot(resolved.artifactDir, {
      createdAt: new Date().toISOString(),
      preflight,
      teamName: resolved.teamName,
      agentName: resolved.agentName,
      runLabel: resolved.runLabel,
      rootDir: resolved.rootDir,
      iteration: failure.iteration,
      step: failure.step,
      message: failure.message,
      state,
      verification: failure.verification,
      failurePatterns,
    })

    const failureResult: CodexRepeatedSoakResult = {
      success: false,
      teamName: resolved.teamName,
      agentName: resolved.agentName,
      runLabel: resolved.runLabel,
      rootDir: resolved.rootDir,
      artifactDir: resolved.artifactDir,
      preflight,
      iterations: iterationResults,
      failureMessage: failure.message,
      failureSnapshotPath,
      failurePatterns,
      verificationSummary,
    }
    const summaryArtifact = buildSummaryArtifact(resolved, failureResult)
    const summaryPaths = await writeSummaryArtifact(
      resolved.artifactDir,
      summaryArtifact,
    )
    failureResult.summaryArtifactPath = summaryPaths.latestSummaryPath
    failureResult.summaryArchivePath = summaryPaths.summaryArchivePath
    const historyManifest = await writeHistoryManifest(
      summaryPaths.historyManifestPath,
      summaryArtifact,
      summaryPaths.latestSummaryPath,
    )
    failureResult.historyManifestPath = historyManifest.path
    failureResult.historyRunCount = historyManifest.runCount
    return failureResult
  }

  if (!preflight.success) {
    return buildFailureResult({
      step: 'preflight',
      message: preflight.issues.join('\n'),
    })
  }

  const initResult = await runInitCommand(resolved.teamName, options).catch(error => ({
    success: false,
    message: error instanceof Error ? error.message : String(error),
  }))
  if (!initResult.success) {
    return buildFailureResult({
      step: 'init',
      message: initResult.message,
    })
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
        return buildFailureResult({
          step: failedStep,
          message,
          iteration: failedIteration,
          state: error instanceof SoakStepError ? error.state : undefined,
          verification:
            error instanceof SoakStepError ? error.verification : undefined,
        })
      }
      return buildFailureResult({
        step: failedStep,
        message,
        iteration: failedIteration,
        state: error instanceof SoakStepError ? error.state : undefined,
        verification:
          error instanceof SoakStepError ? error.verification : undefined,
      })
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
    return buildFailureResult({
      step: 'cleanup',
      message: cleanupResult.message,
    })
  }

  const { failurePatterns, verificationSummary } =
    summarizeCodexRepeatedSoakVerification(iterationResults)

  const successResult: CodexRepeatedSoakResult = {
    success: true,
    teamName: resolved.teamName,
    agentName: resolved.agentName,
    runLabel: resolved.runLabel,
    rootDir: resolved.rootDir,
    artifactDir: resolved.artifactDir,
    preflight,
    iterations: iterationResults,
    cleanupMessage: cleanupResult.message,
    failurePatterns,
    verificationSummary,
  }
  const summaryArtifact = buildSummaryArtifact(resolved, successResult)
  const summaryPaths = await writeSummaryArtifact(
    resolved.artifactDir,
    summaryArtifact,
  )
  successResult.summaryArtifactPath = summaryPaths.latestSummaryPath
  successResult.summaryArchivePath = summaryPaths.summaryArchivePath
  const historyManifest = await writeHistoryManifest(
    summaryPaths.historyManifestPath,
    summaryArtifact,
    summaryPaths.latestSummaryPath,
  )
  successResult.historyManifestPath = historyManifest.path
  successResult.historyRunCount = historyManifest.runCount
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
      `label=${result.runLabel ?? 'n/a'}`,
      `rootDir=${result.rootDir}`,
      `failure=${result.failureMessage ?? 'unknown failure'}`,
      `checks_failed=${result.verificationSummary.checksFailed}/${result.verificationSummary.checksRun}`,
      `patterns=${result.failurePatterns.map(pattern => pattern.code).join(',') || 'none'}`,
      result.summaryArtifactPath
        ? `summary=${result.summaryArtifactPath}`
        : 'summary=n/a',
      result.summaryArchivePath
        ? `summary_archive=${result.summaryArchivePath}`
        : 'summary_archive=n/a',
      result.historyManifestPath
        ? `history=${result.historyManifestPath}`
        : 'history=n/a',
      `history_runs=${result.historyRunCount ?? 'n/a'}`,
      result.failureSnapshotPath
        ? `snapshot=${result.failureSnapshotPath}`
        : 'snapshot=n/a',
    ].join('\n')
  }

  return [
    'Codex repeated soak: PASSED',
    `team=${result.teamName}`,
    `agent=${result.agentName}`,
    `label=${result.runLabel ?? 'n/a'}`,
    `rootDir=${result.rootDir}`,
    `iterations=${result.iterations.length}`,
    `checks=${result.verificationSummary.checksRun - result.verificationSummary.checksFailed}/${result.verificationSummary.checksRun}`,
    `patterns=${result.failurePatterns.length}`,
    `summary=${result.summaryArtifactPath ?? 'n/a'}`,
    `summary_archive=${result.summaryArchivePath ?? 'n/a'}`,
    `history=${result.historyManifestPath ?? 'n/a'}`,
    `history_runs=${result.historyRunCount ?? 'n/a'}`,
    `cleanup=${result.cleanupMessage ?? 'n/a'}`,
  ].join('\n')
}

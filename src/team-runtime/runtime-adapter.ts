import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import {
  appendTranscriptEntry,
  closeTeamSession,
  createTranscriptEntry,
  getTaskListIdForTeam,
  isShutdownRequest,
  getRecentTranscriptContext,
  inferTaskScopedPaths,
  normalizeTaskStatus,
  readUnreadMessages,
  setMemberActive,
  setMemberRuntimeState,
  touchMemberHeartbeat,
  unassignTeammateTasks,
  updateTeamSessionProgress,
} from '../team-core/index.js'
import { createCodexCliRuntimeTurnBridge } from './codex-cli-bridge.js'
import { runInProcessTeammate } from './in-process-runner.js'
import { createUpstreamCliRuntimeTurnBridge } from './upstream-cli-bridge.js'
import type {
  RuntimeAdapter,
  RuntimeAdapterContext,
  RuntimeAdapterLoopOptions,
  RuntimeLoopResult,
  RuntimeSpawnResult,
  RuntimeTeammateConfig,
  RuntimeTurnBridge,
  RuntimeTurnInput,
  RuntimeTurnResult,
  RuntimeWorkExecutor,
  RuntimeWorkItem,
} from './types.js'

const TEAM_LEAD_NAME = 'team-lead'
const ACTIVE_TURN_HEARTBEAT_INTERVAL_MS = 500
const MAX_RUNTIME_EVIDENCE_FILES = 16
const PROMPT_SUPPORT_MAX_FILES = 2
const PROMPT_SUPPORT_MAX_LINES = 120
const PROMPT_SUPPORT_MAX_CHARS = 8_000

export type LocalRuntimeAdapterOptions = {
  bridge?: RuntimeTurnBridge
  loopOptions?: RuntimeAdapterLoopOptions
}

function isImplementationTeammate(name: string): boolean {
  return /^(frontend|backend|testing|database|devops|mobile|security)(?:$|[-@])/.test(
    name,
  )
}

function isGlobLikeScope(scopePath: string): boolean {
  return scopePath.includes('*')
}

function trimPromptSupportContent(content: string): string {
  const lines = content.split('\n')
  const truncatedLines =
    lines.length > PROMPT_SUPPORT_MAX_LINES
      ? [...lines.slice(0, PROMPT_SUPPORT_MAX_LINES), '... [truncated]']
      : lines
  const joined = truncatedLines.join('\n')
  if (joined.length <= PROMPT_SUPPORT_MAX_CHARS) {
    return joined
  }
  return `${joined.slice(0, PROMPT_SUPPORT_MAX_CHARS)}\n... [truncated]`
}

async function renderPromptSupportSnapshot(
  cwd: string,
  relativePath: string,
): Promise<string | null> {
  try {
    const content = await readFile(join(cwd, relativePath), 'utf8')
    return [
      `### ${relativePath}`,
      '```text',
      trimPromptSupportContent(content),
      '```',
    ].join('\n')
  } catch {
    return null
  }
}

async function buildPromptSupportContext(
  config: RuntimeTeammateConfig,
  workItem: RuntimeWorkItem,
): Promise<string> {
  if (workItem.kind !== 'task' || !isImplementationTeammate(config.name)) {
    return ''
  }

  const { scopedPaths } = inferTaskScopedPaths(workItem.task)
  const preferredReferenceFiles = ['docs/implementation-contract.md']
  const candidateFiles = [
    ...preferredReferenceFiles,
    ...scopedPaths.filter(scopePath => !isGlobLikeScope(scopePath)),
  ]

  const uniqueFiles: string[] = []
  for (const candidateFile of candidateFiles) {
    if (!uniqueFiles.includes(candidateFile)) {
      uniqueFiles.push(candidateFile)
    }
    if (uniqueFiles.length >= PROMPT_SUPPORT_MAX_FILES) {
      break
    }
  }

  const snapshots = (
    await Promise.all(
      uniqueFiles.map(filePath =>
        renderPromptSupportSnapshot(config.cwd, filePath),
      ),
    )
  ).filter((value): value is string => value !== null)

  if (snapshots.length === 0) {
    return ''
  }

  return [
    '## Provided File Snapshots',
    'Use these snapshots as the default source for this turn. Edit the current scoped starter file in place before exploring unrelated files.',
    '',
    ...snapshots,
  ].join('\n')
}

function resolveLoopOptions(
  config: RuntimeTeammateConfig,
  context: RuntimeAdapterContext,
  defaults?: RuntimeAdapterLoopOptions,
): RuntimeAdapterLoopOptions {
  return {
    maxIterations:
      config.runtimeOptions?.maxIterations ??
      context.loopOptions?.maxIterations ??
      defaults?.maxIterations,
    pollIntervalMs:
      config.runtimeOptions?.pollIntervalMs ??
      context.loopOptions?.pollIntervalMs ??
      defaults?.pollIntervalMs,
  }
}

function getTranscriptWorkItemContent(workItem: RuntimeWorkItem): string {
  if (workItem.kind === 'task') {
    return `Task #${workItem.task.id}: ${workItem.task.subject}\n${workItem.task.description}`
  }
  if (workItem.kind === 'leader_message') {
    return `Leader message from ${workItem.message.from}: ${workItem.message.text}`
  }
  if (workItem.kind === 'peer_message') {
    return `Peer message from ${workItem.message.from}: ${workItem.message.text}`
  }
  return `Shutdown request ${workItem.request.requestId}: ${workItem.request.reason ?? 'No reason provided.'}`
}

function summarizeTrackedWorkItem(workItem: RuntimeWorkItem): string {
  return getTranscriptWorkItemContent(workItem)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

async function executeTrackedTurn(
  bridge: RuntimeTurnBridge,
  input: RuntimeTurnInput,
): Promise<RuntimeTurnResult | void> {
  const startedAt = Date.now()
  const { config, coreOptions } = input.context
  const turnAbortController = new AbortController()
  const abortSignal = AbortSignal.any([
    input.context.runtimeContext.abortController.signal,
    turnAbortController.signal,
  ])

  await setMemberRuntimeState(
    config.teamName,
    config.name,
    {
      currentWorkKind: input.workItem.kind,
      currentTaskId:
        input.workItem.kind === 'task' ? input.workItem.task.id : undefined,
      currentWorkSummary: summarizeTrackedWorkItem(input.workItem),
      turnStartedAt: startedAt,
      lastHeartbeatAt: startedAt,
    },
    coreOptions,
  )

  const heartbeatTimer = setInterval(() => {
    void touchMemberHeartbeat(
      config.teamName,
      config.name,
      Date.now(),
      coreOptions,
    ).catch(() => {})

    if (input.workItem.kind === 'shutdown_request' || abortSignal.aborted) {
      return
    }

    void readUnreadMessages(
      config.teamName,
      config.name,
      coreOptions,
    )
      .then(messages => {
        const hasPendingShutdown = messages.some(
          message => isShutdownRequest(message.text) !== null,
        )
        if (hasPendingShutdown) {
          turnAbortController.abort()
        }
      })
      .catch(() => {})
  }, ACTIVE_TURN_HEARTBEAT_INTERVAL_MS)
  heartbeatTimer.unref?.()

  try {
    return await bridge.executeTurn({
      ...input,
      abortSignal,
    })
  } finally {
    clearInterval(heartbeatTimer)
    const settledAt = Date.now()
    await setMemberRuntimeState(
      config.teamName,
      config.name,
      {
        currentWorkKind: undefined,
        currentTaskId: undefined,
        currentWorkSummary: undefined,
        turnStartedAt: undefined,
        lastTurnEndedAt: settledAt,
        lastHeartbeatAt: settledAt,
      },
      coreOptions,
    )
  }
}

function normalizeTurnResultForWorkItem(
  workItem: RuntimeWorkItem,
  result: RuntimeTurnResult | undefined,
): RuntimeTurnResult | undefined {
  if (!result) {
    return result
  }

  const summary =
    result.summary ??
    result.assistantSummary ??
    result.assistantResponse?.slice(0, 120)

  if (workItem.kind !== 'task') {
    return {
      ...result,
      summary,
      stop: undefined,
    }
  }

  const normalizedResultTaskStatus = normalizeTaskStatus(result.taskStatus)

  const taskStatus =
    normalizedResultTaskStatus ??
    ((result.completedTaskId === workItem.task.id ||
      (result.completedTaskId === undefined &&
        result.completedStatus !== undefined))
      ? 'completed'
      : undefined)

  return {
    ...result,
    summary,
    stop: undefined,
    taskStatus,
    completedTaskId:
      result.completedTaskId ??
      (taskStatus === 'completed' ? workItem.task.id : undefined),
  }
}

async function collectRecentFilesRecursively(
  baseDir: string,
  cwd: string,
  sinceMs: number,
  bucket: Set<string>,
): Promise<void> {
  let entries
  try {
    entries = await readdir(baseDir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (bucket.size >= MAX_RUNTIME_EVIDENCE_FILES) {
      return
    }
    const absolutePath = join(baseDir, entry.name)
    if (entry.isDirectory()) {
      await collectRecentFilesRecursively(absolutePath, cwd, sinceMs, bucket)
      continue
    }
    try {
      const info = await stat(absolutePath)
      if (info.isFile() && info.mtimeMs >= sinceMs) {
        bucket.add(relative(cwd, absolutePath) || entry.name)
      }
    } catch {
      // best effort
    }
  }
}

async function collectScopedRuntimeEvidence(
  config: RuntimeTeammateConfig,
  workItem: RuntimeWorkItem,
  sinceMs: number,
): Promise<string[]> {
  if (workItem.kind !== 'task') {
    return []
  }

  const { scopedPaths } = inferTaskScopedPaths(workItem.task)
  const recentFiles = new Set<string>()

  for (const scopePath of scopedPaths) {
    if (recentFiles.size >= MAX_RUNTIME_EVIDENCE_FILES) {
      break
    }

    if (scopePath.endsWith('/**')) {
      const directoryPath = join(config.cwd, scopePath.slice(0, -3))
      await collectRecentFilesRecursively(
        directoryPath,
        config.cwd,
        sinceMs,
        recentFiles,
      )
      continue
    }

    const filePath = join(config.cwd, scopePath)
    try {
      const info = await stat(filePath)
      if (info.isFile() && info.mtimeMs >= sinceMs) {
        recentFiles.add(relative(config.cwd, filePath) || scopePath)
      }
    } catch {
      // best effort
    }
  }

  return [...recentFiles]
}

async function attachRuntimeEvidence(
  config: RuntimeTeammateConfig,
  workItem: RuntimeWorkItem,
  result: RuntimeTurnResult | undefined,
  sinceMs: number,
): Promise<RuntimeTurnResult | undefined> {
  if (!result || workItem.kind !== 'task') {
    return result
  }

  const recentFiles = await collectScopedRuntimeEvidence(
    config,
    workItem,
    sinceMs,
  )
  if (recentFiles.length === 0) {
    return result
  }

  const taskMetadata = {
    ...(result.taskMetadata ?? {}),
    runtimeEvidence: {
      source: 'filesystem-scan',
      observedAt: new Date().toISOString(),
      recentFiles,
    },
  }

  const summary = result.summary
    ? `${result.summary} (evidence: ${recentFiles.join(', ')})`
    : `Runtime evidence captured: ${recentFiles.join(', ')}`

  return {
    ...result,
    summary,
    taskMetadata,
  }
}

async function recoverTurnFromRuntimeEvidence(
  config: RuntimeTeammateConfig,
  workItem: RuntimeWorkItem,
  sinceMs: number,
  error: unknown,
): Promise<RuntimeTurnResult | undefined> {
  if (workItem.kind !== 'task') {
    return undefined
  }

  const recentFiles = await collectScopedRuntimeEvidence(
    config,
    workItem,
    sinceMs,
  )
  if (recentFiles.length === 0) {
    return undefined
  }

  const errorMessage =
    error instanceof Error ? error.message : String(error)

  return {
    summary:
      `Recovered task completion from runtime evidence after interruption: ` +
      recentFiles.join(', '),
    taskStatus: 'completed',
    completedTaskId: workItem.task.id,
    completedStatus: 'resolved',
    taskMetadata: {
      ...(workItem.task.metadata && typeof workItem.task.metadata === 'object'
        ? workItem.task.metadata
        : {}),
      runtimeEvidence: {
        source: 'filesystem-scan',
        observedAt: new Date().toISOString(),
        recentFiles,
      },
      runtimeOutcome: {
        classification: 'completed-with-evidence',
        errorMessage,
      },
    },
  }
}

async function buildTurnPrompt(
  config: RuntimeTeammateConfig,
  workItem: RuntimeWorkItem,
  coreOptions: RuntimeAdapterContext['coreOptions'],
): Promise<string> {
  const transcriptLimit =
    workItem.kind === 'task' && isImplementationTeammate(config.name)
      ? 2
      : 8
  const transcriptContext = await getRecentTranscriptContext(
    config.teamName,
    config.name,
    coreOptions ?? {},
    {
      limit: transcriptLimit,
    },
  )
  const basePrompt = renderWorkItemPrompt(config, workItem)
  const promptSupportContext = await buildPromptSupportContext(config, workItem)
  const sessionHeader =
    config.sessionId !== undefined
      ? [
          '# Session Context',
          `Session ID: ${config.sessionId}`,
          `Reopened: ${config.reopenSession === true ? 'yes' : 'no'}`,
        ].join('\n')
      : ''
  return [sessionHeader, transcriptContext, promptSupportContext, basePrompt]
    .filter(section => section.length > 0)
    .join('\n\n')
}

function toWorkExecutor(bridge: RuntimeTurnBridge): RuntimeWorkExecutor {
  return async (workItem, context) => {
    const turnStartedAt = Date.now()
    const turnPrompt = await buildTurnPrompt(
      context.config,
      workItem,
      context.coreOptions,
    )
    const turnInput: RuntimeTurnInput = {
      prompt: turnPrompt,
      workItem,
      context,
    }

    if (context.config.sessionId) {
      await appendTranscriptEntry(
        context.config.teamName,
        context.config.name,
        createTranscriptEntry({
          sessionId: context.config.sessionId,
          agentName: context.config.name,
          role: 'work_item',
          content: getTranscriptWorkItemContent(workItem),
        }),
        context.coreOptions,
      )
    }

    let rawResult: RuntimeTurnResult | undefined
    try {
      rawResult = normalizeTurnResultForWorkItem(
        workItem,
        (await executeTrackedTurn(bridge, turnInput)) ?? undefined,
      )
    } catch (error) {
      const recoveredResult = await recoverTurnFromRuntimeEvidence(
        context.config,
        workItem,
        turnStartedAt,
        error,
      )
      if (!recoveredResult) {
        throw error
      }
      rawResult = recoveredResult
    }
    const result = await attachRuntimeEvidence(
      context.config,
      workItem,
      rawResult,
      turnStartedAt,
    )
    if (
      context.config.sessionId &&
      !result?.assistantResponse &&
      result?.summary
    ) {
      await appendTranscriptEntry(
        context.config.teamName,
        context.config.name,
        createTranscriptEntry({
          sessionId: context.config.sessionId,
          agentName: context.config.name,
          role: 'assistant',
          content: result.summary,
        }),
        context.coreOptions,
      )
    }
    if (context.config.sessionId) {
      await updateTeamSessionProgress(
        context.config.teamName,
        context.config.name,
        context.config.sessionId,
        {
          lastWorkSummary: result?.summary,
          lastWorkItemKind: workItem.kind,
          lastTaskId: workItem.kind === 'task' ? workItem.task.id : undefined,
        },
        context.coreOptions,
      )
    }
    if (result?.assistantResponse) {
      await context.sendMessage(
        result.sendTo ?? TEAM_LEAD_NAME,
        result.assistantResponse,
        result.assistantSummary ?? result.summary,
      )
    }

    return result
  }
}

async function settleMemberActivity(
  config: RuntimeTeammateConfig,
  context: RuntimeAdapterContext,
  stopReason?: RuntimeLoopResult['stopReason'],
): Promise<void> {
  if (stopReason !== 'shutdown') {
    await unassignTeammateTasks(
      getTaskListIdForTeam(config.teamName),
      context.runtimeContext.agentId,
      config.name,
      'terminated',
      context.coreOptions,
    )
  }

  await setMemberRuntimeState(
    config.teamName,
    config.name,
    {
      lastExitAt: Date.now(),
      lastExitReason: stopReason,
      lastHeartbeatAt: Date.now(),
    },
    context.coreOptions,
  )
  if (config.sessionId) {
    await closeTeamSession(
      config.teamName,
      config.name,
      config.sessionId,
      {
        lastExitReason: stopReason,
      },
      context.coreOptions,
    )
  }
  await setMemberActive(
    config.teamName,
    config.name,
    false,
    context.coreOptions,
  )
}

export function formatAgentId(name: string, teamName: string): string {
  return `${name}@${teamName}`
}

export function renderWorkItemPrompt(
  config: RuntimeTeammateConfig,
  workItem: RuntimeWorkItem,
): string {
  const header = [
    '# Agent Team Work Item',
    `Team: ${config.teamName}`,
    `Teammate: ${config.name}`,
    '',
    '## Base Instructions',
    config.prompt,
    '',
    '## Execution Rule',
    'Complete only the current work item in this turn. If base instructions mention broader deliverables, defer them until they appear as separate tasks.',
    'Edit the currently scoped starter file in place before rewriting broader project structure.',
    'If the scoped starter file already satisfies most of the current work item, keep edits minimal and return a completion summary instead of broadening scope.',
    '',
    '## Current Work',
  ]

  if (workItem.kind === 'task') {
    return [
      ...header,
      `Task #${workItem.task.id}: ${workItem.task.subject}`,
      workItem.task.description,
    ].join('\n')
  }

  if (workItem.kind === 'leader_message') {
    return [
      ...header,
      `Leader message from ${workItem.message.from}:`,
      workItem.message.text,
    ].join('\n')
  }

  if (workItem.kind === 'peer_message') {
    return [
      ...header,
      `Peer message from ${workItem.message.from}:`,
      workItem.message.text,
    ].join('\n')
  }

  return [
    ...header,
    `Shutdown request ${workItem.request.requestId} from ${workItem.request.from}`,
    workItem.request.reason ?? 'No reason provided.',
  ].join('\n')
}

export function createNoopRuntimeAdapter(): RuntimeAdapter {
  return {
    async startTeammate(
      config: RuntimeTeammateConfig,
      _context: RuntimeAdapterContext,
    ): Promise<RuntimeSpawnResult> {
      const agentId = formatAgentId(config.name, config.teamName)
      return {
        success: true,
        agentId,
        handle: {
          agentId,
          async stop(): Promise<void> {
            return
          },
          async join(): Promise<void> {
            return
          },
        },
      }
    },
  }
}

export function createMockRuntimeAdapter(
  onStart: (
    config: RuntimeTeammateConfig,
    context: RuntimeAdapterContext,
  ) => Promise<RuntimeSpawnResult> | RuntimeSpawnResult,
): RuntimeAdapter {
  return {
    async startTeammate(
      config: RuntimeTeammateConfig,
      context: RuntimeAdapterContext,
    ): Promise<RuntimeSpawnResult> {
      return onStart(config, context)
    },
  }
}

export function createFunctionRuntimeTurnBridge(
  executeTurn: (
    input: RuntimeTurnInput,
  ) => Promise<RuntimeTurnResult | void> | RuntimeTurnResult | void,
): RuntimeTurnBridge {
  return {
    async executeTurn(input: RuntimeTurnInput): Promise<RuntimeTurnResult | void> {
      return executeTurn(input)
    },
  }
}

export function createEchoRuntimeTurnBridge(options?: {
  completeTasks?: boolean
  respondToMessages?: boolean
}): RuntimeTurnBridge {
  return createFunctionRuntimeTurnBridge(async input => {
    if (input.workItem.kind === 'shutdown_request') {
      return {
        summary: `Accepted shutdown request ${input.workItem.request.requestId}`,
        shutdown: {
          approved: true,
        },
        stop: true,
      }
    }

    if (input.workItem.kind === 'task') {
      return {
        summary: `Picked up task #${input.workItem.task.id}: ${input.workItem.task.subject}`,
        taskStatus: options?.completeTasks ? 'completed' : 'in_progress',
        completedTaskId: options?.completeTasks ? input.workItem.task.id : undefined,
        completedStatus: options?.completeTasks ? 'resolved' : undefined,
      }
    }

    if (options?.respondToMessages) {
      return {
        summary: `Acknowledged message from ${input.workItem.message.from}`,
        assistantResponse: `Received: ${input.workItem.message.text}`,
        assistantSummary: `Ack from ${input.context.config.name}`,
      }
    }

    return {
      summary: `Processed message from ${input.workItem.message.from}`,
    }
  })
}

export function createLocalRuntimeAdapter(
  options: LocalRuntimeAdapterOptions = {},
): RuntimeAdapter {
  const bridge =
    options.bridge ??
    createEchoRuntimeTurnBridge({
      completeTasks: true,
      respondToMessages: true,
    })

  return {
    async startTeammate(
      config: RuntimeTeammateConfig,
      context: RuntimeAdapterContext,
    ): Promise<RuntimeSpawnResult> {
      const agentId = formatAgentId(config.name, config.teamName)
      const loopOptions = resolveLoopOptions(config, context, options.loopOptions)
      const workHandler = toWorkExecutor(bridge)

      let loopResult: RuntimeLoopResult | void

      const loopPromise = runInProcessTeammate(config, {
        runtimeContext: context.runtimeContext,
        coreOptions: context.coreOptions,
        workHandler,
        ...loopOptions,
      }).then(async result => {
        loopResult = result
        context.runtimeContext.abortController.abort()
        await settleMemberActivity(config, context, result.stopReason)
        return result
      })

      return {
        success: true,
        agentId,
        handle: {
          agentId,
          async stop(): Promise<void> {
            context.runtimeContext.abortController.abort()
            await loopPromise
          },
          async join(): Promise<RuntimeLoopResult | void> {
            return loopResult ?? loopPromise
          },
        },
      }
    },
  }
}

export function createAdapterForRuntimeKind(
  config: RuntimeTeammateConfig,
): RuntimeAdapter {
  if (config.runtimeKind === 'codex-cli') {
    return createLocalRuntimeAdapter({
      bridge: createCodexCliRuntimeTurnBridge({
        executablePath: config.codexExecutablePath,
      }),
    })
  }

  if (config.runtimeKind === 'upstream') {
    return createLocalRuntimeAdapter({
      bridge: createUpstreamCliRuntimeTurnBridge({
        executablePath: config.upstreamExecutablePath,
      }),
    })
  }

  return createLocalRuntimeAdapter()
}

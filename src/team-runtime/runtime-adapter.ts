import {
  appendTranscriptEntry,
  closeTeamSession,
  createTranscriptEntry,
  getRecentTranscriptContext,
  setMemberActive,
  setMemberRuntimeState,
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

export type LocalRuntimeAdapterOptions = {
  bridge?: RuntimeTurnBridge
  loopOptions?: RuntimeAdapterLoopOptions
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
    }
  }

  const taskStatus =
    result.taskStatus ??
    ((result.completedTaskId === workItem.task.id ||
      (result.completedTaskId === undefined &&
        result.completedStatus !== undefined))
      ? 'completed'
      : undefined)

  return {
    ...result,
    summary,
    taskStatus,
    completedTaskId:
      result.completedTaskId ??
      (taskStatus === 'completed' ? workItem.task.id : undefined),
  }
}

async function buildTurnPrompt(
  config: RuntimeTeammateConfig,
  workItem: RuntimeWorkItem,
  coreOptions: RuntimeAdapterContext['coreOptions'],
): Promise<string> {
  const transcriptContext = await getRecentTranscriptContext(
    config.teamName,
    config.name,
    coreOptions ?? {},
    {
      limit: 8,
    },
  )
  const basePrompt = renderWorkItemPrompt(config, workItem)
  const sessionHeader =
    config.sessionId !== undefined
      ? [
          '# Session Context',
          `Session ID: ${config.sessionId}`,
          `Reopened: ${config.reopenSession === true ? 'yes' : 'no'}`,
        ].join('\n')
      : ''
  return [sessionHeader, transcriptContext, basePrompt]
    .filter(section => section.length > 0)
    .join('\n\n')
}

function toWorkExecutor(bridge: RuntimeTurnBridge): RuntimeWorkExecutor {
  return async (workItem, context) => {
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

    const result = normalizeTurnResultForWorkItem(
      workItem,
      (await bridge.executeTurn(turnInput)) ?? undefined,
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
  const bridge = options.bridge ?? createEchoRuntimeTurnBridge()

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
        extraArgs: config.codexArgs,
      }),
    })
  }

  if (config.runtimeKind === 'upstream') {
    return createLocalRuntimeAdapter({
      bridge: createUpstreamCliRuntimeTurnBridge({
        executablePath: config.upstreamExecutablePath,
        extraArgs: config.upstreamArgs,
      }),
    })
  }

  return createLocalRuntimeAdapter()
}

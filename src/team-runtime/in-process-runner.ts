import {
  claimTask,
  createPermissionRequestRecord,
  createIdleNotification,
  createPermissionRequestMessage,
  createTranscriptEntry,
  createPlanApprovalRequestMessage,
  createSandboxPermissionRequestMessage,
  createShutdownApprovedMessage,
  createShutdownRejectedMessage,
  getTask,
  getPersistedPermissionDecision,
  getTaskListIdForTeam,
  isModeSetRequest,
  isPermissionResponse,
  isPlanApprovalResponse,
  isSandboxPermissionResponse,
  isShutdownRequest,
  isTeamPermissionUpdate,
  listTasks,
  parseStructuredMessage,
  readUnreadMessages,
  setMemberActive,
  setMemberMode,
  touchMemberHeartbeat,
  unassignTeammateTasks,
  updateTask,
  appendTranscriptEntry,
  writePendingPermissionRequest,
  writeToMailbox,
  type IdleNotificationMessage,
  type PermissionResponseMessage,
  type PlanApprovalResponseMessage,
  type SandboxPermissionResponseMessage,
  type TaskStatus,
  type TeamCoreOptions,
  type TeamStructuredMessage,
  type TeamTask,
  type TeammateMessage,
} from '../team-core/index.js'
import {
  runWithRuntimeContext,
  type TeamRuntimeContext,
} from './context.js'
import {
  markMailboxMessageAsRead,
  pollForMailboxResponse,
} from './poll-mailbox.js'
import type {
  RuntimeLoopResult,
  RuntimeTeammateConfig,
  RuntimeWorkExecutor,
  RuntimeWorkExecutorContext,
  RuntimeWorkExecutorResult,
  RuntimeWorkItem,
} from './types.js'

const TEAM_LEAD_NAME = 'team-lead'
const DEFAULT_POLL_INTERVAL_MS = 50

export type InProcessRunnerState = {
  isIdle: boolean
}

export type InProcessRunnerIterationOptions = {
  runtimeContext: TeamRuntimeContext
  coreOptions?: TeamCoreOptions
  workHandler?: RuntimeWorkExecutor
  state?: InProcessRunnerState
  taskUpdateImpl?: typeof updateTask
}

export type InProcessRunnerIterationResult = {
  workItem: RuntimeWorkItem | null
  idleNotificationSent: boolean
  stopRequested: boolean
  summary?: string
}

export type InProcessRunnerLoopOptions = InProcessRunnerIterationOptions & {
  maxIterations?: number
  pollIntervalMs?: number
}

export function createInProcessRunnerState(): InProcessRunnerState {
  return {
    isIdle: false,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

async function markMessageAsRead(
  teamName: string,
  agentName: string,
  message: TeammateMessage,
  options: TeamCoreOptions,
): Promise<void> {
  await markMailboxMessageAsRead(
    teamName,
    agentName,
    message,
    options,
  )
}

async function acknowledgeWorkItemMessage(
  config: RuntimeTeammateConfig,
  workItem: RuntimeWorkItem,
  coreOptions: TeamCoreOptions,
): Promise<void> {
  if (workItem.kind === 'task') {
    return
  }

  await markMessageAsRead(
    config.teamName,
    config.name,
    workItem.message,
    coreOptions,
  )
}

function getDefaultSummary(workItem: RuntimeWorkItem): string {
  if (workItem.kind === 'task') {
    return `Claimed task #${workItem.task.id}: ${workItem.task.subject}`
  }
  if (workItem.kind === 'leader_message') {
    return `Processed leader message from ${workItem.message.from}`
  }
  if (workItem.kind === 'peer_message') {
    return `Processed peer message from ${workItem.message.from}`
  }
  return `Accepted shutdown request ${workItem.request.requestId}`
}

function createHandlerContext(
  config: RuntimeTeammateConfig,
  runtimeContext: TeamRuntimeContext,
  coreOptions: TeamCoreOptions,
): RuntimeWorkExecutorContext {
  return {
    config,
    runtimeContext,
    coreOptions,
    async sendMessage(
      recipient: string,
      text: string,
      summary?: string,
    ): Promise<void> {
      await writeToMailbox(
        config.teamName,
        recipient,
        {
          from: config.name,
          text,
          timestamp: new Date().toISOString(),
          summary: summary ?? text.slice(0, 64),
        },
        coreOptions,
      )
      if (config.sessionId) {
        await appendTranscriptEntry(
          config.teamName,
          config.name,
          createTranscriptEntry({
            sessionId: config.sessionId,
            agentName: config.name,
            role: 'assistant',
            content: text,
            metadata: {
              recipient,
              summary,
            },
          }),
          coreOptions,
        )
      }
    },
    async requestPlanApproval(input): Promise<PlanApprovalResponseMessage> {
      return requestPlanApproval(config, {
        runtimeContext,
        coreOptions,
        ...input,
      })
    },
    async requestPermission(input): Promise<PermissionResponseMessage> {
      return requestPermissionApproval(config, {
        runtimeContext,
        coreOptions,
        ...input,
      })
    },
    async requestSandboxPermission(
      input,
    ): Promise<SandboxPermissionResponseMessage> {
      return requestSandboxPermissionApproval(config, {
        runtimeContext,
        coreOptions,
        ...input,
      })
    },
  }
}

async function runDefaultWorkHandler(
  workItem: RuntimeWorkItem,
): Promise<RuntimeWorkExecutorResult> {
  if (workItem.kind === 'shutdown_request') {
    return {
      summary: getDefaultSummary(workItem),
      shutdown: {
        approved: true,
      },
      stop: true,
    }
  }

  return {
    summary: getDefaultSummary(workItem),
  }
}

export async function requestPlanApproval(
  config: RuntimeTeammateConfig,
  input: {
    runtimeContext: TeamRuntimeContext
    coreOptions?: TeamCoreOptions
    requestId?: string
    planFilePath: string
    planContent: string
    pollIntervalMs?: number
  },
): Promise<PlanApprovalResponseMessage> {
  const coreOptions = input.coreOptions ?? {}
  const requestId =
    input.requestId ??
    `${config.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const requestMessage = createPlanApprovalRequestMessage({
    from: config.name,
    requestId,
    planFilePath: input.planFilePath,
    planContent: input.planContent,
  })

  await writeToMailbox(
    config.teamName,
    TEAM_LEAD_NAME,
    {
      from: config.name,
      text: JSON.stringify(requestMessage),
      timestamp: requestMessage.timestamp,
      summary: `Plan approval request ${requestId}`,
    },
    coreOptions,
  )

  const pollIntervalMs = input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  return pollForMailboxResponse({
    config,
    runtimeContext: input.runtimeContext,
    coreOptions,
    pollIntervalMs,
    requestId,
    waitLabel: 'Plan approval',
    matcher: message => {
      const parsed = isPlanApprovalResponse(message.text)
      return parsed?.requestId === requestId ? parsed : null
    },
  })
}

export async function requestPermissionApproval(
  config: RuntimeTeammateConfig,
  input: {
    runtimeContext: TeamRuntimeContext
    coreOptions?: TeamCoreOptions
    request_id?: string
    tool_name: string
    tool_use_id: string
    description: string
    input: Record<string, unknown>
    permission_suggestions?: unknown[]
    pollIntervalMs?: number
  },
): Promise<PermissionResponseMessage> {
  const coreOptions = input.coreOptions ?? {}
  const requestId =
    input.request_id ??
    `${config.name}-perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const requestMessage = createPermissionRequestMessage({
    request_id: requestId,
    agent_id: input.runtimeContext.agentId,
    tool_name: input.tool_name,
    tool_use_id: input.tool_use_id,
    description: input.description,
    input: input.input,
    permission_suggestions: input.permission_suggestions,
  })

  const persistedDecision = await getPersistedPermissionDecision(
    config.teamName,
    input.tool_name,
    input.input,
    coreOptions,
  )
  if (persistedDecision?.behavior === 'allow') {
    return {
      type: 'permission_response',
      request_id: requestId,
      subtype: 'success',
      response: {
        updated_input: input.input,
        permission_updates: [persistedDecision.update],
      },
    }
  }

  if (persistedDecision?.behavior === 'deny') {
    return {
      type: 'permission_response',
      request_id: requestId,
      subtype: 'error',
      error: `Denied by stored team permission rule for ${input.tool_name}`,
    }
  }

  await writePendingPermissionRequest(
    createPermissionRequestRecord({
      id: requestId,
      teamName: config.teamName,
      workerId: input.runtimeContext.agentId,
      workerName: config.name,
      workerColor: config.color,
      toolName: input.tool_name,
      toolUseId: input.tool_use_id,
      description: input.description,
      input: input.input,
      permissionSuggestions: input.permission_suggestions,
    }),
    coreOptions,
  )

  await writeToMailbox(
    config.teamName,
    TEAM_LEAD_NAME,
    {
      from: config.name,
      text: JSON.stringify(requestMessage),
      timestamp: new Date().toISOString(),
      summary: `Permission request ${requestId}`,
    },
    coreOptions,
  )

  const pollIntervalMs = input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  return pollForMailboxResponse({
    config,
    runtimeContext: input.runtimeContext,
    coreOptions,
    pollIntervalMs,
    requestId,
    waitLabel: 'Permission',
    matcher: message => {
      const parsed = isPermissionResponse(message.text)
      return parsed?.request_id === requestId ? parsed : null
    },
  })
}

export async function requestSandboxPermissionApproval(
  config: RuntimeTeammateConfig,
  input: {
    runtimeContext: TeamRuntimeContext
    coreOptions?: TeamCoreOptions
    requestId?: string
    host: string
    workerColor?: string
    pollIntervalMs?: number
  },
): Promise<SandboxPermissionResponseMessage> {
  const coreOptions = input.coreOptions ?? {}
  const requestId =
    input.requestId ??
    `${config.name}-sandbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const requestMessage = createSandboxPermissionRequestMessage({
    requestId,
    workerId: input.runtimeContext.agentId,
    workerName: config.name,
    workerColor: input.workerColor ?? config.color,
    host: input.host,
  })

  await writeToMailbox(
    config.teamName,
    TEAM_LEAD_NAME,
    {
      from: config.name,
      text: JSON.stringify(requestMessage),
      timestamp: new Date().toISOString(),
      summary: `Sandbox permission ${requestId}`,
    },
    coreOptions,
  )

  const pollIntervalMs = input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  return pollForMailboxResponse({
    config,
    runtimeContext: input.runtimeContext,
    coreOptions,
    pollIntervalMs,
    requestId,
    waitLabel: 'Sandbox permission',
    matcher: message => {
      const parsed = isSandboxPermissionResponse(message.text)
      return parsed?.requestId === requestId ? parsed : null
    },
  })
}

export async function resolveNextWorkItem(
  config: RuntimeTeammateConfig,
  runtimeContext: TeamRuntimeContext,
  coreOptions: TeamCoreOptions = {},
  dependencies: {
    taskUpdateImpl?: typeof updateTask
  } = {},
): Promise<RuntimeWorkItem | null> {
  const taskUpdateImpl = dependencies.taskUpdateImpl ?? updateTask
  const unreadMessages = await readUnreadMessages(
    config.teamName,
    config.name,
    coreOptions,
  )

  const shutdownMessage = unreadMessages.find(
    message => isShutdownRequest(message.text) !== null,
  )
  if (shutdownMessage) {
    return {
      kind: 'shutdown_request',
      message: shutdownMessage,
      request: isShutdownRequest(shutdownMessage.text)!,
    }
  }

  const leaderMessage = unreadMessages.find(
    message => message.from === TEAM_LEAD_NAME,
  )
  if (leaderMessage) {
    return {
      kind: 'leader_message',
      message: leaderMessage,
      structured: parseStructuredMessage(leaderMessage.text),
    }
  }

  const peerMessage = unreadMessages[0]
  if (peerMessage) {
    return {
      kind: 'peer_message',
      message: peerMessage,
      structured: parseStructuredMessage(peerMessage.text),
    }
  }

  const taskListId = getTaskListIdForTeam(config.teamName)
  const tasks = await listTasks(taskListId, coreOptions)
  for (const task of tasks) {
    if (task.status !== 'pending') {
      continue
    }
    if (
      task.owner &&
      task.owner !== runtimeContext.agentId &&
      task.owner !== config.name
    ) {
      continue
    }

    const claimResult = await claimTask(
      taskListId,
      task.id,
      runtimeContext.agentId,
      {
        checkAgentBusy: true,
      },
      coreOptions,
    )

    if (claimResult.success) {
      let claimedTask: TeamTask
      try {
        claimedTask =
          (await taskUpdateImpl(
            taskListId,
            task.id,
            {
              status: 'in_progress',
            },
            coreOptions,
          )) ??
          claimResult.task ??
          task
      } catch {
        // Rollback: unclaim the task so other agents can pick it up
        await updateTask(
          taskListId,
          task.id,
          { status: 'pending', owner: undefined },
          coreOptions,
        ).catch(() => undefined)
        continue
      }

      return {
        kind: 'task',
        task: claimedTask,
      }
    }

    if (claimResult.reason === 'agent_busy') {
      return null
    }
  }

  return null
}

export async function sendIdleNotification(
  config: RuntimeTeammateConfig,
  input: {
    runtimeContext: TeamRuntimeContext
    coreOptions?: TeamCoreOptions
    summary?: string
    idleReason?: IdleNotificationMessage['idleReason']
    completedTaskId?: string
    completedStatus?: IdleNotificationMessage['completedStatus']
    failureReason?: string
  },
): Promise<void> {
  const idleMessage = createIdleNotification(config.name, {
    summary: input.summary,
    idleReason: input.idleReason,
    completedTaskId: input.completedTaskId,
    completedStatus: input.completedStatus,
    failureReason: input.failureReason,
  })

  await writeToMailbox(
    config.teamName,
    TEAM_LEAD_NAME,
    {
      from: config.name,
      text: JSON.stringify(idleMessage),
      timestamp: idleMessage.timestamp,
      summary: idleMessage.summary ?? `${config.name} is idle`,
    },
    input.coreOptions ?? {},
  )
}

async function handleShutdownWorkItem(
  config: RuntimeTeammateConfig,
  workItem: Extract<RuntimeWorkItem, { kind: 'shutdown_request' }>,
  handlerResult: RuntimeWorkExecutorResult | undefined,
  runtimeContext: TeamRuntimeContext,
  coreOptions: TeamCoreOptions,
): Promise<InProcessRunnerIterationResult> {
  const shutdownDecision = handlerResult?.shutdown ?? {
    approved: true,
  }

  if (shutdownDecision.approved) {
    const shutdownApproved = createShutdownApprovedMessage({
      requestId: workItem.request.requestId,
      from: config.name,
      backendType: config.backendType ?? 'in-process',
    })

    await writeToMailbox(
      config.teamName,
      TEAM_LEAD_NAME,
      {
        from: config.name,
        text: JSON.stringify(shutdownApproved),
        timestamp: shutdownApproved.timestamp,
        summary: `Shutdown approved for ${config.name}`,
      },
      coreOptions,
    )

    await unassignTeammateTasks(
      getTaskListIdForTeam(config.teamName),
      runtimeContext.agentId,
      config.name,
      'shutdown',
      coreOptions,
    )
    await acknowledgeWorkItemMessage(config, workItem, coreOptions)
    await setMemberActive(config.teamName, config.name, false, coreOptions)
    runtimeContext.abortController.abort()

    return {
      workItem,
      idleNotificationSent: false,
      stopRequested: true,
      summary:
        handlerResult?.summary ??
        `Shutdown approved for ${config.name}`,
    }
  }

  const shutdownRejected = createShutdownRejectedMessage({
    requestId: workItem.request.requestId,
    from: config.name,
    reason: shutdownDecision.reason ?? 'Shutdown rejected by worker',
  })

  await writeToMailbox(
    config.teamName,
    TEAM_LEAD_NAME,
    {
      from: config.name,
      text: JSON.stringify(shutdownRejected),
      timestamp: shutdownRejected.timestamp,
      summary: `Shutdown rejected for ${config.name}`,
    },
    coreOptions,
  )

  await sendIdleNotification(config, {
    runtimeContext,
    coreOptions,
    summary: handlerResult?.summary ?? shutdownRejected.reason,
    idleReason: handlerResult?.idleReason ?? 'available',
    failureReason: handlerResult?.failureReason,
  })
  await acknowledgeWorkItemMessage(config, workItem, coreOptions)

  return {
    workItem,
    idleNotificationSent: true,
    stopRequested: Boolean(handlerResult?.stop),
    summary: handlerResult?.summary ?? shutdownRejected.reason,
  }
}

export async function runInProcessTeammateOnce(
  config: RuntimeTeammateConfig,
  options: InProcessRunnerIterationOptions,
): Promise<InProcessRunnerIterationResult> {
  const coreOptions = options.coreOptions ?? {}
  const state = options.state ?? createInProcessRunnerState()
  const runtimeContext = options.runtimeContext
  const workHandler = options.workHandler ?? runDefaultWorkHandler
  const handlerContext = createHandlerContext(config, runtimeContext, coreOptions)

  return runWithRuntimeContext(runtimeContext, async () => {
    await touchMemberHeartbeat(
      config.teamName,
      config.name,
      Date.now(),
      coreOptions,
    )

    const workItem = await resolveNextWorkItem(
      config,
      runtimeContext,
      coreOptions,
      {
        taskUpdateImpl: options.taskUpdateImpl,
      },
    )

    if (!workItem) {
      if (!state.isIdle) {
        await sendIdleNotification(config, {
          runtimeContext,
          coreOptions,
          summary: `${config.name} is available for more work`,
          idleReason: 'available',
        })
        state.isIdle = true
        return {
          workItem: null,
          idleNotificationSent: true,
          stopRequested: false,
          summary: `${config.name} is available for more work`,
        }
      }

      return {
        workItem: null,
        idleNotificationSent: false,
        stopRequested: false,
      }
    }

    state.isIdle = false

    if (
      workItem.kind === 'leader_message' &&
      workItem.structured !== null &&
      isModeSetRequest(workItem.message.text) !== null
    ) {
      const modeRequest = isModeSetRequest(workItem.message.text)!
      await setMemberMode(config.teamName, config.name, modeRequest.mode, coreOptions)
      await sendIdleNotification(config, {
        runtimeContext,
        coreOptions,
        summary: `${config.name} updated permission mode to ${modeRequest.mode}`,
        idleReason: 'available',
      })
      await acknowledgeWorkItemMessage(config, workItem, coreOptions)
      state.isIdle = true
      return {
        workItem,
        idleNotificationSent: true,
        stopRequested: false,
        summary: `${config.name} updated permission mode to ${modeRequest.mode}`,
      }
    }

    if (
      workItem.kind === 'leader_message' &&
      workItem.structured !== null &&
      isTeamPermissionUpdate(workItem.message.text) !== null
    ) {
      const permissionUpdate = isTeamPermissionUpdate(workItem.message.text)!
      await sendIdleNotification(config, {
        runtimeContext,
        coreOptions,
        summary: `${config.name} received team permission update for ${permissionUpdate.toolName}`,
        idleReason: 'available',
      })
      await acknowledgeWorkItemMessage(config, workItem, coreOptions)
      state.isIdle = true
      return {
        workItem,
        idleNotificationSent: true,
        stopRequested: false,
        summary: `${config.name} received team permission update for ${permissionUpdate.toolName}`,
      }
    }

    const handlerResult = (await workHandler(workItem, handlerContext)) ?? undefined

    if (workItem.kind === 'shutdown_request') {
      state.isIdle = !handlerResult?.stop
      return handleShutdownWorkItem(
        config,
        workItem,
        handlerResult,
        runtimeContext,
        coreOptions,
      )
    }

    if (workItem.kind === 'task' && handlerResult?.taskStatus) {
      await updateTask(
        getTaskListIdForTeam(config.teamName),
        workItem.task.id,
        {
          status: handlerResult.taskStatus,
          owner:
            handlerResult.taskStatus === 'pending'
              ? undefined
              : workItem.task.owner,
          metadata: handlerResult.taskMetadata,
        },
        coreOptions,
      )
    }

    const summary = handlerResult?.summary ?? getDefaultSummary(workItem)
    const completedTaskId =
      handlerResult?.completedTaskId ??
      (workItem.kind === 'task' && handlerResult?.taskStatus === 'completed'
        ? workItem.task.id
        : undefined)
    const completedStatus =
      handlerResult?.completedStatus ??
      (workItem.kind === 'task' && handlerResult?.taskStatus === 'completed'
        ? 'resolved'
        : undefined)

    if (workItem.kind !== 'task' && completedTaskId) {
      const completedTask = await getTask(
        getTaskListIdForTeam(config.teamName),
        completedTaskId,
        coreOptions,
      )

      if (
        completedTask &&
        (completedTask.owner === undefined ||
          completedTask.owner === runtimeContext.agentId ||
          completedTask.owner === config.name)
      ) {
        await updateTask(
          getTaskListIdForTeam(config.teamName),
          completedTaskId,
          {
            status: 'completed',
            owner: completedTask.owner ?? runtimeContext.agentId,
            metadata: handlerResult?.taskMetadata,
          },
          coreOptions,
        )
      }
    }

    await sendIdleNotification(config, {
      runtimeContext,
      coreOptions,
      summary,
      idleReason: handlerResult?.idleReason ?? 'available',
      completedTaskId,
      completedStatus,
      failureReason: handlerResult?.failureReason,
    })
    await acknowledgeWorkItemMessage(config, workItem, coreOptions)

    state.isIdle = true
    return {
      workItem,
      idleNotificationSent: true,
      stopRequested: Boolean(handlerResult?.stop),
      summary,
    }
  })
}

async function handleRunnerFailure(
  config: RuntimeTeammateConfig,
  runtimeContext: TeamRuntimeContext,
  coreOptions: TeamCoreOptions,
  error: unknown,
): Promise<void> {
  await unassignTeammateTasks(
    getTaskListIdForTeam(config.teamName),
    runtimeContext.agentId,
    config.name,
    'terminated',
    coreOptions,
  )
  await setMemberActive(config.teamName, config.name, false, coreOptions)
  runtimeContext.abortController.abort()

  await sendIdleNotification(config, {
    runtimeContext,
    coreOptions,
    summary: `${config.name} failed while processing work`,
    idleReason: 'failed',
    failureReason: error instanceof Error ? error.message : String(error),
  })
}

export async function runInProcessTeammate(
  config: RuntimeTeammateConfig,
  options: InProcessRunnerLoopOptions,
): Promise<RuntimeLoopResult> {
  const coreOptions = options.coreOptions ?? {}
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const state = options.state ?? createInProcessRunnerState()

  let iterations = 0
  let processedWorkItems = 0
  let idleNotifications = 0

  try {
    while (!options.runtimeContext.abortController.signal.aborted) {
      if (options.maxIterations !== undefined && iterations >= options.maxIterations) {
        return {
          iterations,
          processedWorkItems,
          idleNotifications,
          stopReason: 'completed',
        }
      }

      const iterationResult = await runInProcessTeammateOnce(config, {
        runtimeContext: options.runtimeContext,
        coreOptions,
        workHandler: options.workHandler,
        state,
      })

      iterations += 1
      if (iterationResult.workItem) {
        processedWorkItems += 1
      }
      if (iterationResult.idleNotificationSent) {
        idleNotifications += 1
      }
      if (iterationResult.stopRequested) {
        return {
          iterations,
          processedWorkItems,
          idleNotifications,
          stopReason:
            iterationResult.workItem?.kind === 'shutdown_request'
              ? 'shutdown'
              : 'completed',
        }
      }
      if (!iterationResult.workItem) {
        await sleep(pollIntervalMs)
      }
    }
  } catch (error) {
    await handleRunnerFailure(
      config,
      options.runtimeContext,
      coreOptions,
      error,
    )
    return {
      iterations,
      processedWorkItems,
      idleNotifications: idleNotifications + 1,
      stopReason: 'aborted',
    }
  }

  return {
    iterations,
    processedWorkItems,
    idleNotifications,
    stopReason: 'aborted',
  }
}

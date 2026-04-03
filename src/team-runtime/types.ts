import type {
  IdleNotificationMessage,
  PermissionResponseMessage,
  PlanApprovalResponseMessage,
  SandboxPermissionResponseMessage,
  ShutdownRequestMessage,
  TaskStatus,
  TeamBackendType,
  TeamCoreOptions,
  TeamMember,
  TeamWorkerLaunchCommand,
  TeamWorkerLaunchMode,
  TeamRuntimeKind,
  TeamStructuredMessage,
  TeamTask,
  TeammateMessage,
} from '../team-core/index.js'
import type { TeamRuntimeContext } from './context.js'

export type RuntimeAdapterLoopOptions = {
  maxIterations?: number
  pollIntervalMs?: number
}

export type RuntimeTeammateConfig = {
  name: string
  teamName: string
  prompt: string
  cwd: string
  color?: string
  model?: string
  sessionId?: string
  backendType?: TeamBackendType
  runtimeKind?: TeamRuntimeKind
  reopenSession?: boolean
  planModeRequired?: boolean
  runtimeOptions?: RuntimeAdapterLoopOptions
  codexExecutablePath?: string
  codexArgs?: string[]
  upstreamExecutablePath?: string
  upstreamArgs?: string[]
  launchCommand?: TeamWorkerLaunchCommand
  launchMode?: TeamWorkerLaunchMode
}

export type RuntimeLoopResult = {
  iterations: number
  processedWorkItems: number
  idleNotifications: number
  stopReason: 'completed' | 'aborted' | 'shutdown'
}

export type RuntimeTeammateHandle = {
  agentId: string
  stop(): Promise<void>
  join?(): Promise<RuntimeLoopResult | void>
}

export type RuntimeSpawnResult = {
  success: boolean
  agentId: string
  handle?: RuntimeTeammateHandle
  error?: string
}

export type RuntimeAdapterContext = {
  coreOptions?: TeamCoreOptions
  runtimeContext: TeamRuntimeContext
  loopOptions?: RuntimeAdapterLoopOptions
}

export type RuntimeAdapter = {
  startTeammate(
    config: RuntimeTeammateConfig,
    context: RuntimeAdapterContext,
  ): Promise<RuntimeSpawnResult>
}

export type RuntimeMemberRecord = TeamMember

export type RuntimeWorkItem =
  | {
      kind: 'shutdown_request'
      message: TeammateMessage
      request: ShutdownRequestMessage
    }
  | {
      kind: 'leader_message'
      message: TeammateMessage
      structured: TeamStructuredMessage | null
    }
  | {
      kind: 'peer_message'
      message: TeammateMessage
      structured: TeamStructuredMessage | null
    }
  | {
      kind: 'task'
      task: TeamTask
    }

export type RuntimeWorkExecutorResult = {
  summary?: string
  idleReason?: IdleNotificationMessage['idleReason']
  completedTaskId?: string
  completedStatus?: IdleNotificationMessage['completedStatus']
  failureReason?: string
  taskStatus?: TaskStatus
  taskMetadata?: Record<string, unknown>
  shutdown?: {
    approved: boolean
    reason?: string
  }
  stop?: boolean
}

export type RuntimeWorkExecutorContext = {
  config: RuntimeTeammateConfig
  coreOptions: TeamCoreOptions
  runtimeContext: TeamRuntimeContext
  sendMessage(
    recipient: string,
    text: string,
    summary?: string,
  ): Promise<void>
  requestPlanApproval(input: {
    requestId?: string
    planFilePath: string
    planContent: string
    pollIntervalMs?: number
  }): Promise<PlanApprovalResponseMessage>
  requestPermission(input: {
    request_id?: string
    tool_name: string
    tool_use_id: string
    description: string
    input: Record<string, unknown>
    permission_suggestions?: unknown[]
    pollIntervalMs?: number
  }): Promise<PermissionResponseMessage>
  requestSandboxPermission(input: {
    requestId?: string
    host: string
    workerColor?: string
    pollIntervalMs?: number
  }): Promise<SandboxPermissionResponseMessage>
}

export type RuntimeWorkExecutor = (
  workItem: RuntimeWorkItem,
  context: RuntimeWorkExecutorContext,
) => Promise<RuntimeWorkExecutorResult | void>

export type RuntimeTurnInput = {
  prompt: string
  workItem: RuntimeWorkItem
  context: RuntimeWorkExecutorContext
}

export type RuntimeTurnResult = RuntimeWorkExecutorResult & {
  assistantResponse?: string
  assistantSummary?: string
  sendTo?: string
}

export type RuntimeTurnBridge = {
  executeTurn(input: RuntimeTurnInput): Promise<RuntimeTurnResult | void>
}

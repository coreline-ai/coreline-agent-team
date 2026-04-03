export type TeamCoreOptions = {
  rootDir?: string
}

export type TeamBackendType = 'in-process'

export type TeamRuntimeKind = 'local' | 'codex-cli' | 'upstream'

export type TeamWorkerLaunchMode = 'attached' | 'detached'

export type TeamWorkerLaunchCommand = 'spawn' | 'resume' | 'reopen'

export type TeamWorkerLifecycle = 'bounded'

export type TeamPermissionMode =
  | 'default'
  | 'plan'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'auto'

export type TeamAllowedPath = {
  path: string
  toolName: string
  addedBy: string
  addedAt: number
}

export type TeamPermissionRuleMatch = {
  inputContains?: string
  commandContains?: string
  cwdPrefix?: string
  pathPrefix?: string
  hostEquals?: string
}

export type TeamPermissionRule = {
  toolName: string
  ruleContent?: string
  match?: TeamPermissionRuleMatch
}

export type TeamPermissionUpdate = {
  type: 'addRules'
  rules: TeamPermissionRule[]
  behavior: 'allow' | 'deny' | 'ask'
  destination: 'session'
}

export type TeamPermissionState = {
  rules: TeamPermissionRule[]
  updates: TeamPermissionUpdate[]
  updatedAt?: number
}

export type PersistentPermissionRequestStatus =
  | 'pending'
  | 'approved'
  | 'rejected'

export type TeamPermissionRequestRecord = {
  id: string
  teamName: string
  workerId: string
  workerName: string
  workerColor?: string
  toolName: string
  toolUseId: string
  description: string
  input: Record<string, unknown>
  permissionSuggestions: unknown[]
  status: PersistentPermissionRequestStatus
  resolvedBy?: 'leader' | 'worker'
  resolvedAt?: number
  feedback?: string
  updatedInput?: Record<string, unknown>
  permissionUpdates?: TeamPermissionUpdate[]
  createdAt: number
}

export type TeamTranscriptEntryRole =
  | 'work_item'
  | 'assistant'
  | 'system'
  | 'event'

export type TeamTranscriptEntry = {
  id: string
  sessionId: string
  agentName: string
  role: TeamTranscriptEntryRole
  content: string
  createdAt: number
  metadata?: Record<string, unknown>
}

export type TeamSessionRecord = {
  sessionId: string
  agentName: string
  runtimeKind?: TeamRuntimeKind
  cwd: string
  prompt: string
  model?: string
  status: 'open' | 'closed'
  createdAt: number
  lastOpenedAt: number
  reopenedAt: number[]
  closedAt?: number
  lastExitReason?: string
  lastWorkSummary?: string
  lastWorkItemKind?: TeamWorkItemKind
  lastTaskId?: string
}

export type TeamSessionState = {
  agentName: string
  currentSessionId?: string
  sessions: TeamSessionRecord[]
  updatedAt: number
}

export type TeamWorkItemKind =
  | 'task'
  | 'leader_message'
  | 'peer_message'
  | 'shutdown_request'

export type TeamMemberRuntimeState = {
  runtimeKind?: TeamRuntimeKind
  processId?: number
  launchMode?: TeamWorkerLaunchMode
  launchCommand?: TeamWorkerLaunchCommand
  lifecycle?: TeamWorkerLifecycle
  stdoutLogPath?: string
  stderrLogPath?: string
  prompt?: string
  cwd?: string
  model?: string
  sessionId?: string
  lastSessionId?: string
  reopenCount?: number
  planModeRequired?: boolean
  startedAt?: number
  lastHeartbeatAt?: number
  currentWorkKind?: TeamWorkItemKind
  currentTaskId?: string
  currentWorkSummary?: string
  turnStartedAt?: number
  lastTurnEndedAt?: number
  lastExitAt?: number
  lastExitReason?: string
  maxIterations?: number
  pollIntervalMs?: number
  codexExecutablePath?: string
  codexArgs?: string[]
  upstreamExecutablePath?: string
  upstreamArgs?: string[]
  metadata?: Record<string, unknown>
}

export type TeamMember = {
  agentId: string
  name: string
  agentType?: string
  model?: string
  color?: string
  joinedAt: number
  cwd: string
  subscriptions: string[]
  worktreePath?: string
  sessionId?: string
  backendType?: TeamBackendType
  isActive?: boolean
  mode?: TeamPermissionMode
  runtimeState?: TeamMemberRuntimeState
}

export type TeamFile = {
  name: string
  description?: string
  createdAt: number
  leadAgentId: string
  leadSessionId?: string
  hiddenPaneIds?: string[]
  teamAllowedPaths?: TeamAllowedPath[]
  permissionState?: TeamPermissionState
  members: TeamMember[]
}

export type CreateTeamInput = {
  teamName: string
  leadAgentId: string
  description?: string
  leadSessionId?: string
  leadMember: Omit<TeamMember, 'agentId' | 'joinedAt'> & {
    name: string
  }
}

export type TeamMemberMatcher = {
  agentId?: string
  name?: string
}

export type TeammateMessage = {
  from: string
  text: string
  timestamp: string
  read: boolean
  color?: string
  summary?: string
}

export type WriteMailboxMessage = Omit<TeammateMessage, 'read'>

export type IdleNotificationMessage = {
  type: 'idle_notification'
  from: string
  timestamp: string
  idleReason?: 'available' | 'interrupted' | 'failed'
  summary?: string
  completedTaskId?: string
  completedStatus?: 'resolved' | 'blocked' | 'failed'
  failureReason?: string
}

export type PlanApprovalRequestMessage = {
  type: 'plan_approval_request'
  from: string
  timestamp: string
  planFilePath: string
  planContent: string
  requestId: string
}

export type PlanApprovalResponseMessage = {
  type: 'plan_approval_response'
  requestId: string
  approved: boolean
  feedback?: string
  timestamp: string
  permissionMode?: TeamPermissionMode
}

export type PermissionRequestMessage = {
  type: 'permission_request'
  request_id: string
  agent_id: string
  tool_name: string
  tool_use_id: string
  description: string
  input: Record<string, unknown>
  permission_suggestions: unknown[]
}

export type PermissionResponseMessage =
  | {
      type: 'permission_response'
      request_id: string
      subtype: 'success'
      response?: {
        updated_input?: Record<string, unknown>
        permission_updates?: TeamPermissionUpdate[]
      }
    }
  | {
      type: 'permission_response'
      request_id: string
      subtype: 'error'
      error: string
    }

export type SandboxPermissionRequestMessage = {
  type: 'sandbox_permission_request'
  requestId: string
  workerId: string
  workerName: string
  workerColor?: string
  hostPattern: {
    host: string
  }
  createdAt: number
}

export type SandboxPermissionResponseMessage = {
  type: 'sandbox_permission_response'
  requestId: string
  host: string
  allow: boolean
  timestamp: string
}

export type ShutdownRequestMessage = {
  type: 'shutdown_request'
  requestId: string
  from: string
  reason?: string
  timestamp: string
}

export type ShutdownApprovedMessage = {
  type: 'shutdown_approved'
  requestId: string
  from: string
  timestamp: string
  paneId?: string
  backendType?: TeamBackendType
}

export type ShutdownRejectedMessage = {
  type: 'shutdown_rejected'
  requestId: string
  from: string
  reason: string
  timestamp: string
}

export type TeamPermissionUpdateMessage = {
  type: 'team_permission_update'
  permissionUpdate: TeamPermissionUpdate
  directoryPath: string
  toolName: string
}

export type ModeSetRequestMessage = {
  type: 'mode_set_request'
  mode: TeamPermissionMode
  from: string
}

export type TeamStructuredMessage =
  | IdleNotificationMessage
  | PlanApprovalRequestMessage
  | PlanApprovalResponseMessage
  | PermissionRequestMessage
  | PermissionResponseMessage
  | SandboxPermissionRequestMessage
  | SandboxPermissionResponseMessage
  | ShutdownRequestMessage
  | ShutdownApprovedMessage
  | ShutdownRejectedMessage
  | TeamPermissionUpdateMessage
  | ModeSetRequestMessage

export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export type TeamTask = {
  id: string
  subject: string
  description: string
  activeForm?: string
  owner?: string
  status: TaskStatus
  blocks: string[]
  blockedBy: string[]
  metadata?: Record<string, unknown>
}

export type CreateTaskInput = Omit<TeamTask, 'id'>

export type UpdateTaskInput = Partial<Omit<TeamTask, 'id'>> & {
  metadata?: Record<string, unknown>
}

export type ClaimTaskOptions = {
  checkAgentBusy?: boolean
}

export type ClaimTaskResult = {
  success: boolean
  reason?:
    | 'task_not_found'
    | 'already_claimed'
    | 'already_resolved'
    | 'blocked'
    | 'agent_busy'
  task?: TeamTask
  busyWithTasks?: string[]
  blockedByTasks?: string[]
}

export type AgentStatus = {
  agentId: string
  name: string
  agentType?: string
  status: 'idle' | 'busy'
  currentTasks: string[]
  isActive?: boolean
  mode?: TeamPermissionMode
  runtimeKind?: TeamRuntimeKind
  processId?: number
  launchMode?: TeamWorkerLaunchMode
  launchCommand?: TeamWorkerLaunchCommand
  lifecycle?: TeamWorkerLifecycle
  stdoutLogPath?: string
  stderrLogPath?: string
  stdoutTail?: string[]
  stderrTail?: string[]
  startedAt?: number
  lastHeartbeatAt?: number
  currentWorkKind?: TeamWorkItemKind
  currentTaskId?: string
  currentWorkSummary?: string
  turnStartedAt?: number
  lastTurnEndedAt?: number
  lastExitAt?: number
  lastExitReason?: string
  sessionId?: string
  lastSessionId?: string
}

export type UnassignTasksResult = {
  unassignedTasks: Array<{
    id: string
    subject: string
  }>
  notificationMessage: string
}

export type CleanupOrphanedTasksResult = {
  cleanedTaskIds: string[]
  notificationMessage: string
}

import type {
  AgentStatus,
  AgentLogSnapshot,
  PermissionRulePreset,
  TaskGuardrailWarning,
  TeamCostWarning,
  TeamCoreOptions,
  TeamFile,
  TeamPermissionRequestRecord,
  TeamTask,
  TeamTranscriptEntry,
  TeamRuntimeKind,
} from '../team-core/index.js'

export type TeamListItem = {
  name: string
  description?: string
  createdAt: number
  memberCount: number
  resultState: 'running' | 'completed' | 'attention' | 'pending'
  pendingApprovals: number
  activeWorkerCount: number
  executingWorkerCount: number
  staleWorkerCount: number
  unreadLeaderMessages: number
  taskCounts: {
    total: number
    pending: number
    inProgress: number
    completed: number
  }
  attentionReasons: string[]
}

export type DashboardActivityItem = {
  id: string
  from: string
  text: string
  createdAt: number
  unread: boolean
  kind:
    | 'idle'
    | 'message'
    | 'permission_request'
    | 'plan_request'
    | 'sandbox_request'
    | 'shutdown_request'
    | 'permission_update'
}

export type PermissionApprovalItem = {
  id: string
  kind: 'permission'
  requestId: string
  recipientName: string
  workerName: string
  toolName: string
  description: string
  createdAt: number
  request: TeamPermissionRequestRecord
}

export type PlanApprovalItem = {
  id: string
  kind: 'plan'
  requestId: string
  recipientName: string
  workerName: string
  planFilePath: string
  planContent: string
  createdAt: number
}

export type SandboxApprovalItem = {
  id: string
  kind: 'sandbox'
  requestId: string
  recipientName: string
  workerName: string
  host: string
  createdAt: number
}

export type DashboardApprovalItem =
  | PermissionApprovalItem
  | PlanApprovalItem
  | SandboxApprovalItem

export type LoadDashboardInput = {
  selectedAgentName?: string
  transcriptLimit?: number
  activityLimit?: number
  logTailLines?: number
  logTailBytes?: number
}

export type DashboardLogViewer = {
  agentName?: string
  snapshots: AgentLogSnapshot[]
}

export type TeamDashboard = {
  team: TeamFile
  statuses: AgentStatus[]
  tasks: TeamTask[]
  taskCounts: {
    pending: number
    inProgress: number
    completed: number
  }
  guardrailWarnings: TaskGuardrailWarning[]
  costWarnings: TeamCostWarning[]
  activity: DashboardActivityItem[]
  approvals: DashboardApprovalItem[]
  transcriptAgentName?: string
  transcriptEntries: TeamTranscriptEntry[]
  logViewer?: DashboardLogViewer
  unreadLeaderMessages: number
  rootDir?: string
}

export type OperatorActionResult = {
  success: boolean
  message: string
}

export type CreateTeamOperatorInput = {
  teamName: string
}

export type CreateTaskOperatorInput = {
  teamName: string
  subject: string
  description: string
}

export type SendLeaderMessageInput = {
  teamName: string
  recipient: string
  message: string
}

export type SpawnTeammateOperatorInput = {
  teamName: string
  agentName: string
  prompt: string
  cwd?: string
  color?: string
  model?: string
  runtimeKind?: TeamRuntimeKind
  planModeRequired?: boolean
  maxIterations?: number
  pollIntervalMs?: number
  codexExecutablePath?: string
  upstreamExecutablePath?: string
}

export type ResumeTeammateOperatorInput = {
  teamName: string
  agentName: string
  maxIterations?: number
  pollIntervalMs?: number
}

export type ShutdownTeammateOperatorInput = {
  teamName: string
  recipient: string
  reason?: string
}

export type ApprovalDecisionInput = {
  teamName: string
  requestId: string
  recipientName: string
  persistDecision?: boolean
  rulePreset?: PermissionRulePreset
  ruleContent?: string
  commandContains?: string
  cwdPrefix?: string
  pathPrefix?: string
  hostEquals?: string
}

export type DenyPermissionDecisionInput = ApprovalDecisionInput & {
  errorMessage: string
}

export type ApproveSandboxDecisionInput = {
  teamName: string
  requestId: string
  recipientName: string
  host: string
}

export type PlanDecisionInput = {
  teamName: string
  requestId: string
  recipientName: string
  feedback?: string
}

export type OperatorContext = TeamCoreOptions

import type {
  IdleNotificationMessage,
  PlanApprovalRequestMessage,
  PlanApprovalResponseMessage,
  PermissionRequestMessage,
  PermissionResponseMessage,
  SandboxPermissionRequestMessage,
  SandboxPermissionResponseMessage,
  ShutdownApprovedMessage,
  ShutdownRejectedMessage,
  ShutdownRequestMessage,
  TeamPermissionUpdate,
  TeamPermissionMode,
  TeamPermissionUpdateMessage,
  TeamStructuredMessage,
  ModeSetRequestMessage,
} from './types.js'

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null
}

function hasString(record: JsonRecord, key: string): record is JsonRecord {
  return typeof record[key] === 'string'
}

function hasBoolean(record: JsonRecord, key: string): record is JsonRecord {
  return typeof record[key] === 'boolean'
}

function hasNumber(record: JsonRecord, key: string): record is JsonRecord {
  return typeof record[key] === 'number'
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function isTeamPermissionMode(value: unknown): value is TeamPermissionMode {
  return (
    value === 'default' ||
    value === 'plan' ||
    value === 'acceptEdits' ||
    value === 'bypassPermissions' ||
    value === 'auto'
  )
}

export function createIdleNotification(
  from: string,
  options?: Omit<IdleNotificationMessage, 'type' | 'from' | 'timestamp'>,
): IdleNotificationMessage {
  return {
    type: 'idle_notification',
    from,
    timestamp: new Date().toISOString(),
    ...options,
  }
}

export function createPlanApprovalRequestMessage(params: {
  from: string
  planFilePath: string
  planContent: string
  requestId: string
}): PlanApprovalRequestMessage {
  return {
    type: 'plan_approval_request',
    from: params.from,
    timestamp: new Date().toISOString(),
    planFilePath: params.planFilePath,
    planContent: params.planContent,
    requestId: params.requestId,
  }
}

export function createPlanApprovalResponseMessage(params: {
  requestId: string
  approved: boolean
  feedback?: string
  permissionMode?: TeamPermissionMode
}): PlanApprovalResponseMessage {
  return {
    type: 'plan_approval_response',
    requestId: params.requestId,
    approved: params.approved,
    feedback: params.feedback,
    timestamp: new Date().toISOString(),
    permissionMode: params.permissionMode,
  }
}

export function createPermissionRequestMessage(params: {
  request_id: string
  agent_id: string
  tool_name: string
  tool_use_id: string
  description: string
  input: Record<string, unknown>
  permission_suggestions?: unknown[]
}): PermissionRequestMessage {
  return {
    type: 'permission_request',
    request_id: params.request_id,
    agent_id: params.agent_id,
    tool_name: params.tool_name,
    tool_use_id: params.tool_use_id,
    description: params.description,
    input: params.input,
    permission_suggestions: params.permission_suggestions ?? [],
  }
}

export function createPermissionResponseMessage(params: {
  request_id: string
  subtype: 'success' | 'error'
  error?: string
  updated_input?: Record<string, unknown>
  permission_updates?: TeamPermissionUpdate[]
}): PermissionResponseMessage {
  if (params.subtype === 'error') {
    return {
      type: 'permission_response',
      request_id: params.request_id,
      subtype: 'error',
      error: params.error ?? 'Permission denied',
    }
  }

  return {
    type: 'permission_response',
    request_id: params.request_id,
    subtype: 'success',
    response: {
      updated_input: params.updated_input,
      permission_updates: params.permission_updates,
    },
  }
}

export function createSandboxPermissionRequestMessage(params: {
  requestId: string
  workerId: string
  workerName: string
  workerColor?: string
  host: string
}): SandboxPermissionRequestMessage {
  return {
    type: 'sandbox_permission_request',
    requestId: params.requestId,
    workerId: params.workerId,
    workerName: params.workerName,
    workerColor: params.workerColor,
    hostPattern: {
      host: params.host,
    },
    createdAt: Date.now(),
  }
}

export function createSandboxPermissionResponseMessage(params: {
  requestId: string
  host: string
  allow: boolean
}): SandboxPermissionResponseMessage {
  return {
    type: 'sandbox_permission_response',
    requestId: params.requestId,
    host: params.host,
    allow: params.allow,
    timestamp: new Date().toISOString(),
  }
}

export function createShutdownRequestMessage(params: {
  requestId: string
  from: string
  reason?: string
}): ShutdownRequestMessage {
  return {
    type: 'shutdown_request',
    requestId: params.requestId,
    from: params.from,
    reason: params.reason,
    timestamp: new Date().toISOString(),
  }
}

export function createShutdownApprovedMessage(params: {
  requestId: string
  from: string
  paneId?: string
  backendType?: ShutdownApprovedMessage['backendType']
}): ShutdownApprovedMessage {
  return {
    type: 'shutdown_approved',
    requestId: params.requestId,
    from: params.from,
    timestamp: new Date().toISOString(),
    paneId: params.paneId,
    backendType: params.backendType,
  }
}

export function createShutdownRejectedMessage(params: {
  requestId: string
  from: string
  reason: string
}): ShutdownRejectedMessage {
  return {
    type: 'shutdown_rejected',
    requestId: params.requestId,
    from: params.from,
    reason: params.reason,
    timestamp: new Date().toISOString(),
  }
}

export function createTeamPermissionUpdateMessage(params: {
  permissionUpdate: TeamPermissionUpdate
  directoryPath: string
  toolName: string
}): TeamPermissionUpdateMessage {
  return {
    type: 'team_permission_update',
    permissionUpdate: params.permissionUpdate,
    directoryPath: params.directoryPath,
    toolName: params.toolName,
  }
}

export function createModeSetRequestMessage(params: {
  mode: TeamPermissionMode
  from: string
}): ModeSetRequestMessage {
  return {
    type: 'mode_set_request',
    mode: params.mode,
    from: params.from,
  }
}

export function isIdleNotification(
  messageText: string,
): IdleNotificationMessage | null {
  const parsed = tryParseJson(messageText)
  if (!isRecord(parsed) || parsed.type !== 'idle_notification') {
    return null
  }
  if (!hasString(parsed, 'from') || !hasString(parsed, 'timestamp')) {
    return null
  }
  return parsed as IdleNotificationMessage
}

export function isPlanApprovalRequest(
  messageText: string,
): PlanApprovalRequestMessage | null {
  const parsed = tryParseJson(messageText)
  if (!isRecord(parsed) || parsed.type !== 'plan_approval_request') {
    return null
  }
  if (
    !hasString(parsed, 'from') ||
    !hasString(parsed, 'timestamp') ||
    !hasString(parsed, 'planFilePath') ||
    !hasString(parsed, 'planContent') ||
    !hasString(parsed, 'requestId')
  ) {
    return null
  }
  return parsed as PlanApprovalRequestMessage
}

export function isPlanApprovalResponse(
  messageText: string,
): PlanApprovalResponseMessage | null {
  const parsed = tryParseJson(messageText)
  if (!isRecord(parsed) || parsed.type !== 'plan_approval_response') {
    return null
  }
  if (
    !hasString(parsed, 'requestId') ||
    typeof parsed.approved !== 'boolean' ||
    !hasString(parsed, 'timestamp')
  ) {
    return null
  }
  if (
    parsed.permissionMode !== undefined &&
    !isTeamPermissionMode(parsed.permissionMode)
  ) {
    return null
  }
  return parsed as PlanApprovalResponseMessage
}

export function isPermissionRequest(
  messageText: string,
): PermissionRequestMessage | null {
  const parsed = tryParseJson(messageText)
  if (!isRecord(parsed) || parsed.type !== 'permission_request') {
    return null
  }
  if (
    !hasString(parsed, 'request_id') ||
    !hasString(parsed, 'agent_id') ||
    !hasString(parsed, 'tool_name') ||
    !hasString(parsed, 'tool_use_id') ||
    !hasString(parsed, 'description')
  ) {
    return null
  }
  if (
    !Array.isArray(parsed.permission_suggestions) ||
    !isRecord(parsed.input)
  ) {
    return null
  }
  return parsed as PermissionRequestMessage
}

export function isPermissionResponse(
  messageText: string,
): PermissionResponseMessage | null {
  const parsed = tryParseJson(messageText)
  if (!isRecord(parsed) || parsed.type !== 'permission_response') {
    return null
  }
  if (
    !hasString(parsed, 'request_id') ||
    !hasString(parsed, 'subtype')
  ) {
    return null
  }
  if (parsed.subtype === 'success') {
    return parsed as PermissionResponseMessage
  }
  if (parsed.subtype === 'error' && hasString(parsed, 'error')) {
    return parsed as PermissionResponseMessage
  }
  return null
}

export function isSandboxPermissionRequest(
  messageText: string,
): SandboxPermissionRequestMessage | null {
  const parsed = tryParseJson(messageText)
  if (!isRecord(parsed) || parsed.type !== 'sandbox_permission_request') {
    return null
  }
  if (
    !hasString(parsed, 'requestId') ||
    !hasString(parsed, 'workerId') ||
    !hasString(parsed, 'workerName') ||
    !hasNumber(parsed, 'createdAt') ||
    !isRecord(parsed.hostPattern) ||
    typeof parsed.hostPattern.host !== 'string'
  ) {
    return null
  }
  return parsed as SandboxPermissionRequestMessage
}

export function isSandboxPermissionResponse(
  messageText: string,
): SandboxPermissionResponseMessage | null {
  const parsed = tryParseJson(messageText)
  if (!isRecord(parsed) || parsed.type !== 'sandbox_permission_response') {
    return null
  }
  if (
    !hasString(parsed, 'requestId') ||
    !hasString(parsed, 'host') ||
    !hasBoolean(parsed, 'allow') ||
    !hasString(parsed, 'timestamp')
  ) {
    return null
  }
  return parsed as SandboxPermissionResponseMessage
}

export function isShutdownRequest(
  messageText: string,
): ShutdownRequestMessage | null {
  const parsed = tryParseJson(messageText)
  if (!isRecord(parsed) || parsed.type !== 'shutdown_request') {
    return null
  }
  if (
    !hasString(parsed, 'requestId') ||
    !hasString(parsed, 'from') ||
    !hasString(parsed, 'timestamp')
  ) {
    return null
  }
  return parsed as ShutdownRequestMessage
}

export function isShutdownApproved(
  messageText: string,
): ShutdownApprovedMessage | null {
  const parsed = tryParseJson(messageText)
  if (!isRecord(parsed) || parsed.type !== 'shutdown_approved') {
    return null
  }
  if (
    !hasString(parsed, 'requestId') ||
    !hasString(parsed, 'from') ||
    !hasString(parsed, 'timestamp')
  ) {
    return null
  }
  return parsed as ShutdownApprovedMessage
}

export function isShutdownRejected(
  messageText: string,
): ShutdownRejectedMessage | null {
  const parsed = tryParseJson(messageText)
  if (!isRecord(parsed) || parsed.type !== 'shutdown_rejected') {
    return null
  }
  if (
    !hasString(parsed, 'requestId') ||
    !hasString(parsed, 'from') ||
    !hasString(parsed, 'reason') ||
    !hasString(parsed, 'timestamp')
  ) {
    return null
  }
  return parsed as ShutdownRejectedMessage
}

export function isTeamPermissionUpdate(
  messageText: string,
): TeamPermissionUpdateMessage | null {
  const parsed = tryParseJson(messageText)
  if (!isRecord(parsed) || parsed.type !== 'team_permission_update') {
    return null
  }
  if (
    !hasString(parsed, 'directoryPath') ||
    !hasString(parsed, 'toolName') ||
    !isRecord(parsed.permissionUpdate)
  ) {
    return null
  }
  return parsed as TeamPermissionUpdateMessage
}

export function isModeSetRequest(
  messageText: string,
): ModeSetRequestMessage | null {
  const parsed = tryParseJson(messageText)
  if (!isRecord(parsed) || parsed.type !== 'mode_set_request') {
    return null
  }
  if (
    !hasString(parsed, 'from') ||
    !isTeamPermissionMode(parsed.mode)
  ) {
    return null
  }
  return parsed as ModeSetRequestMessage
}

export function parseStructuredMessage(
  messageText: string,
): TeamStructuredMessage | null {
  return (
    isIdleNotification(messageText) ??
    isPlanApprovalRequest(messageText) ??
    isPlanApprovalResponse(messageText) ??
    isPermissionRequest(messageText) ??
    isPermissionResponse(messageText) ??
    isSandboxPermissionRequest(messageText) ??
    isSandboxPermissionResponse(messageText) ??
    isShutdownRequest(messageText) ??
    isShutdownApproved(messageText) ??
    isShutdownRejected(messageText) ??
    isTeamPermissionUpdate(messageText) ??
    isModeSetRequest(messageText)
  )
}

export function isStructuredProtocolMessage(messageText: string): boolean {
  return parseStructuredMessage(messageText) !== null
}

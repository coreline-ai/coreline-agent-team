import { isCompletedTaskStatus } from './task-status.js'
import type { CreateTaskInput, TeamTask } from './types.js'

const KNOWN_ROOT_FILES = new Set([
  'package.json',
  'README.md',
  'tsconfig.json',
  'render.yaml',
  'pnpm-lock.yaml',
  'bun.lockb',
])

const PATH_PATTERNS = [
  /\bdocs(?:\/[A-Za-z0-9._-]+)*(?:\/|(?:\.[A-Za-z0-9._-]+))?\b/g,
  /\bfrontend(?:\/[A-Za-z0-9._-]+)*(?:\/|(?:\.[A-Za-z0-9._-]+))?\b/g,
  /\bbackend(?:\/[A-Za-z0-9._-]+)*(?:\/|(?:\.[A-Za-z0-9._-]+))?\b/g,
  /\bsrc(?:\/[A-Za-z0-9._-]+)*(?:\/|(?:\.[A-Za-z0-9._-]+))?\b/g,
  /\btests(?:\/[A-Za-z0-9._-]+)*(?:\/|(?:\.[A-Za-z0-9._-]+))?\b/g,
  /\b(?:package\.json|README\.md|tsconfig\.json|render\.yaml|pnpm-lock\.yaml|bun\.lockb)\b/g,
]

type GuardrailMetadata = {
  ownership?: {
    scopedPaths?: string[]
    scopeSource?: 'metadata' | 'content' | 'owner'
  }
}

export type TaskScopeSource = 'metadata' | 'content' | 'owner' | 'none'

export type TaskGuardrailTaskInfo = {
  taskId: string
  scopedPaths: string[]
  scopeSource: TaskScopeSource
  topLevelAreas: string[]
  isUnscoped: boolean
  spansMultipleAreas: boolean
}

export type TaskGuardrailWarningCode =
  | 'unscoped_task'
  | 'multi_area_task'
  | 'overlapping_scope'

export type TaskGuardrailWarning = {
  code: TaskGuardrailWarningCode
  message: string
  taskIds: string[]
  scopedPaths: string[]
}

export type TaskGuardrailReport = {
  tasks: Record<string, TaskGuardrailTaskInfo>
  warnings: TaskGuardrailWarning[]
}

type IndexedScopeEntry = {
  task: TeamTask
  scopePath: string
}

function normalizeScopePath(value: string): string | undefined {
  const trimmed = value.trim().replace(/[),.;:]+$/g, '')
  if (!trimmed) {
    return undefined
  }
  if (trimmed === 'root' || trimmed === '.' || trimmed === './') {
    return 'root/**'
  }

  const normalized = trimmed.replace(/^\.\/+/, '').replace(/\/+/g, '/')
  if (normalized.endsWith('/**')) {
    const base = normalized.slice(0, -3).replace(/\/+$/, '')
    return base.length > 0 ? `${base}/**` : 'root/**'
  }
  if (KNOWN_ROOT_FILES.has(normalized)) {
    return normalized
  }
  if (normalized.endsWith('/')) {
    const base = normalized.replace(/\/+$/, '')
    return base.length > 0 ? `${base}/**` : 'root/**'
  }

  const basename = normalized.split('/').at(-1) ?? normalized
  if (!basename.includes('.')) {
    return `${normalized}/**`
  }

  return normalized
}

function getTaskGuardrailMetadata(
  task: Pick<TeamTask, 'metadata'>,
): GuardrailMetadata | undefined {
  if (!task.metadata || typeof task.metadata !== 'object') {
    return undefined
  }
  return task.metadata as GuardrailMetadata
}

function getMetadataScopedPaths(
  task: Pick<TeamTask, 'metadata'>,
): string[] {
  const metadata = getTaskGuardrailMetadata(task)
  const scopedPaths = metadata?.ownership?.scopedPaths
  if (!Array.isArray(scopedPaths)) {
    return []
  }

  return [...new Set(
    scopedPaths
      .filter((value): value is string => typeof value === 'string')
      .map(value => normalizeScopePath(value))
      .filter((value): value is string => value !== undefined),
  )]
}

function extractExplicitScopedPaths(text: string): string[] {
  const candidates = new Set<string>()

  for (const pattern of PATH_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const candidate = normalizeScopePath(match[0])
      if (candidate) {
        candidates.add(candidate)
      }
    }
  }

  return [...candidates]
}

function inferOwnerScopedPaths(owner: string | undefined): string[] {
  if (!owner) {
    return []
  }
  if (/^frontend(?:@|$)/.test(owner)) {
    return ['frontend/**']
  }
  if (/^backend(?:@|$)/.test(owner)) {
    return ['backend/**']
  }
  if (/^(planner|search)(?:@|$)/.test(owner)) {
    return ['docs/**']
  }
  if (/^reviewer(?:@|$)/.test(owner)) {
    return ['docs/review.md']
  }
  return []
}

export function inferTaskScopedPaths(task: Pick<
  TeamTask,
  'description' | 'metadata' | 'owner' | 'subject'
>): {
  scopedPaths: string[]
  scopeSource: TaskScopeSource
} {
  const metadataScopedPaths = getMetadataScopedPaths(task)
  if (metadataScopedPaths.length > 0) {
    return {
      scopedPaths: metadataScopedPaths,
      scopeSource: 'metadata',
    }
  }

  const contentScopedPaths = extractExplicitScopedPaths(
    `${task.subject}\n${task.description}`,
  )
  if (contentScopedPaths.length > 0) {
    return {
      scopedPaths: contentScopedPaths,
      scopeSource: 'content',
    }
  }

  const ownerScopedPaths = inferOwnerScopedPaths(task.owner)
  if (ownerScopedPaths.length > 0) {
    return {
      scopedPaths: ownerScopedPaths,
      scopeSource: 'owner',
    }
  }

  return {
    scopedPaths: [],
    scopeSource: 'none',
  }
}

function getTopLevelArea(scopePath: string): string {
  if (scopePath === 'root/**') {
    return 'root'
  }
  const normalized = scopePath.endsWith('/**')
    ? scopePath.slice(0, -3)
    : scopePath
  return normalized.split('/')[0] ?? normalized
}

function isDirectoryScope(scopePath: string): boolean {
  return scopePath.endsWith('/**')
}

function getDirectoryBase(scopePath: string): string {
  return isDirectoryScope(scopePath) ? scopePath.slice(0, -3) : scopePath
}

function getAncestorDirectoryKeys(scopePath: string): string[] {
  if (scopePath === 'root/**') {
    return ['root/**']
  }

  const basePath = getDirectoryBase(scopePath)
  const segments = basePath.split('/')
  const keys = ['root/**']

  if (!isDirectoryScope(scopePath)) {
    segments.pop()
  }

  for (let index = 0; index < segments.length; index += 1) {
    const nextBase = segments.slice(0, index + 1).join('/')
    if (nextBase.length > 0) {
      keys.push(`${nextBase}/**`)
    }
  }

  return [...new Set(keys)]
}

function scopesOverlap(left: string, right: string): boolean {
  if (left === right) {
    return true
  }
  if (left === 'root/**' || right === 'root/**') {
    return true
  }

  const leftDirectory = isDirectoryScope(left)
  const rightDirectory = isDirectoryScope(right)
  const leftBase = getDirectoryBase(left)
  const rightBase = getDirectoryBase(right)

  if (leftDirectory && rightDirectory) {
    return (
      leftBase === rightBase ||
      leftBase.startsWith(`${rightBase}/`) ||
      rightBase.startsWith(`${leftBase}/`)
    )
  }
  if (leftDirectory) {
    return right === leftBase || right.startsWith(`${leftBase}/`)
  }
  if (rightDirectory) {
    return left === rightBase || left.startsWith(`${rightBase}/`)
  }
  return false
}

function hasDependencyLink(left: TeamTask, right: TeamTask): boolean {
  return (
    left.blocks.includes(right.id) ||
    left.blockedBy.includes(right.id) ||
    right.blocks.includes(left.id) ||
    right.blockedBy.includes(left.id)
  )
}

function hasDifferentOwnership(left: TeamTask, right: TeamTask): boolean {
  if (!left.owner || !right.owner) {
    return true
  }
  return left.owner !== right.owner
}

function createTaskInfo(task: TeamTask): TaskGuardrailTaskInfo {
  const { scopedPaths, scopeSource } = inferTaskScopedPaths(task)
  const topLevelAreas = [...new Set(scopedPaths.map(getTopLevelArea))]

  return {
    taskId: task.id,
    scopedPaths,
    scopeSource,
    topLevelAreas,
    isUnscoped: scopedPaths.length === 0,
    spansMultipleAreas: topLevelAreas.length > 1,
  }
}

function createGuardrailMetadata(input: {
  scopedPaths: string[]
  scopeSource: Exclude<TaskScopeSource, 'none'>
  metadata?: Record<string, unknown>
}): Record<string, unknown> {
  const nextMetadata = {
    ...(input.metadata ?? {}),
  }

  nextMetadata.ownership = {
    ...((typeof nextMetadata.ownership === 'object' &&
    nextMetadata.ownership !== null)
      ? (nextMetadata.ownership as Record<string, unknown>)
      : {}),
    scopedPaths: input.scopedPaths,
    scopeSource: input.scopeSource,
  }

  return nextMetadata
}

export function decorateTaskInputWithGuardrails(
  task: CreateTaskInput,
): CreateTaskInput {
  const inferred = inferTaskScopedPaths(task)
  if (inferred.scopeSource === 'none' || inferred.scopedPaths.length === 0) {
    return task
  }

  return {
    ...task,
    metadata: createGuardrailMetadata({
      scopedPaths: inferred.scopedPaths,
      scopeSource: inferred.scopeSource,
      metadata: task.metadata,
    }),
  }
}

export function analyzeTaskGuardrails(
  tasks: readonly TeamTask[],
  maxWarnings = 8,
): TaskGuardrailReport {
  const openTasks = tasks.filter(task => !isCompletedTaskStatus(task.status))
  const taskInfos = Object.fromEntries(
    openTasks.map(task => [task.id, createTaskInfo(task)]),
  ) satisfies Record<string, TaskGuardrailTaskInfo>
  const warnings: TaskGuardrailWarning[] = []
  const seenOverlapKeys = new Set<string>()
  const indexedDirectoryEntries = new Map<string, IndexedScopeEntry[]>()
  const indexedFileEntriesByExactPath = new Map<string, IndexedScopeEntry[]>()
  const indexedFileEntriesByDirectoryKey = new Map<string, IndexedScopeEntry[]>()

  function pushIndexedEntry(
    index: Map<string, IndexedScopeEntry[]>,
    key: string,
    entry: IndexedScopeEntry,
  ): void {
    const existing = index.get(key)
    if (existing) {
      existing.push(entry)
      return
    }
    index.set(key, [entry])
  }

  function maybeAddOverlapWarning(
    left: TeamTask,
    right: TeamTask,
    overlappingScopes: string[],
  ): void {
    if (warnings.length >= maxWarnings) {
      return
    }
    if (!hasDifferentOwnership(left, right) || hasDependencyLink(left, right)) {
      return
    }

    const pairKey = [left.id, right.id].sort((a, b) => Number(a) - Number(b)).join(':')
    if (seenOverlapKeys.has(pairKey)) {
      return
    }
    seenOverlapKeys.add(pairKey)

    const uniqueScopes = [...new Set(overlappingScopes)]
    warnings.push({
      code: 'overlapping_scope',
      taskIds: [left.id, right.id],
      scopedPaths: uniqueScopes,
      message:
        `Tasks #${left.id} and #${right.id} both touch ${uniqueScopes.join(', ')} without dependency ordering; split files or add blockedBy.`,
    })
  }

  for (const task of openTasks) {
    if (warnings.length >= maxWarnings) {
      break
    }
    const info = taskInfos[task.id]
    if (info.isUnscoped) {
      warnings.push({
        code: 'unscoped_task',
        taskIds: [task.id],
        scopedPaths: [],
        message:
          `Task #${task.id} has no clear file ownership; add scoped paths like frontend/, backend/, docs/plan.md.`,
      })
      continue
    }
    if (info.spansMultipleAreas) {
      warnings.push({
        code: 'multi_area_task',
        taskIds: [task.id],
        scopedPaths: info.scopedPaths,
        message:
          `Task #${task.id} spans multiple areas (${info.topLevelAreas.join(', ')}); split it into narrower tasks to reduce file collisions.`,
      })
    }
  }

  for (const task of openTasks) {
    if (warnings.length >= maxWarnings) {
      break
    }
    const info = taskInfos[task.id]
    if (info.isUnscoped) {
      continue
    }

    for (const scopePath of info.scopedPaths) {
      const ancestorDirectoryKeys = getAncestorDirectoryKeys(scopePath)

      for (const directoryKey of ancestorDirectoryKeys) {
        const priorDirectoryEntries = indexedDirectoryEntries.get(directoryKey) ?? []
        for (const priorEntry of priorDirectoryEntries) {
          if (!scopesOverlap(scopePath, priorEntry.scopePath)) {
            continue
          }
          maybeAddOverlapWarning(task, priorEntry.task, [
            scopePath,
            priorEntry.scopePath,
          ])
          if (warnings.length >= maxWarnings) {
            break
          }
        }
        if (warnings.length >= maxWarnings) {
          break
        }
      }

      if (warnings.length >= maxWarnings) {
        break
      }

      if (isDirectoryScope(scopePath)) {
        const priorFileEntries =
          indexedFileEntriesByDirectoryKey.get(scopePath) ?? []
        for (const priorEntry of priorFileEntries) {
          maybeAddOverlapWarning(task, priorEntry.task, [
            scopePath,
            priorEntry.scopePath,
          ])
          if (warnings.length >= maxWarnings) {
            break
          }
        }
      } else {
        const priorExactEntries =
          indexedFileEntriesByExactPath.get(scopePath) ?? []
        for (const priorEntry of priorExactEntries) {
          maybeAddOverlapWarning(task, priorEntry.task, [
            scopePath,
            priorEntry.scopePath,
          ])
          if (warnings.length >= maxWarnings) {
            break
          }
        }
      }

      if (isDirectoryScope(scopePath)) {
        const entry = { task, scopePath }
        for (const directoryKey of ancestorDirectoryKeys) {
          pushIndexedEntry(indexedDirectoryEntries, directoryKey, entry)
        }
        continue
      }

      const entry = { task, scopePath }
      pushIndexedEntry(indexedFileEntriesByExactPath, scopePath, entry)
      for (const directoryKey of ancestorDirectoryKeys) {
        pushIndexedEntry(indexedFileEntriesByDirectoryKey, directoryKey, entry)
      }
    }
  }

  return {
    tasks: taskInfos,
    warnings,
  }
}

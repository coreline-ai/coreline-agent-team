import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { pathExists } from '../../team-core/index.js'

export type SummaryResultState = 'running' | 'completed' | 'attention' | 'pending'

export function classifySummaryState(input: {
  totalTasks: number
  pendingTasks: number
  inProgressTasks: number
  completedTasks: number
  activeMembers: number
  failureCount: number
}): SummaryResultState {
  if (input.totalTasks > 0 && input.completedTasks === input.totalTasks) {
    return 'completed'
  }
  if (input.activeMembers > 0 || input.inProgressTasks > 0) {
    return 'running'
  }
  if (input.failureCount > 0) {
    return 'attention'
  }
  return 'pending'
}

async function collectWorkspaceFiles(
  workspacePath: string,
  currentPath: string,
  depth: number,
  maxDepth: number,
  files: string[],
  limit: number,
): Promise<void> {
  if (files.length >= limit || depth > maxDepth) {
    return
  }

  const entries = await readdir(currentPath, { withFileTypes: true })
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (files.length >= limit) {
      return
    }

    if (
      entry.name === '.agent-team' ||
      entry.name === '.git' ||
      entry.name === 'node_modules'
    ) {
      continue
    }

    const absolutePath = join(currentPath, entry.name)
    if (entry.isFile()) {
      files.push(relative(workspacePath, absolutePath) || entry.name)
      continue
    }

    if (entry.isDirectory()) {
      await collectWorkspaceFiles(
        workspacePath,
        absolutePath,
        depth + 1,
        maxDepth,
        files,
        limit,
      )
    }
  }
}

export async function listWorkspaceFiles(
  workspacePath: string,
  limit = 12,
): Promise<string[]> {
  if (!(await pathExists(workspacePath))) {
    return []
  }

  const files: string[] = []
  await collectWorkspaceFiles(workspacePath, workspacePath, 0, 2, files, limit)
  return files
}

export type WorkspacePreview = {
  path: string
  content: string
}

const previewPriority = [
  'docs/review.md',
  'docs/plan.md',
  'docs/architecture.md',
  'docs/research.md',
  'docs/backend-api.md',
  'README.md',
  'frontend/README.md',
  'backend/README.md',
  'docs/goal.md',
] as const

function truncatePreviewContent(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  const lines = normalized.split('\n').slice(0, 8)
  const joined = lines.join('\n')
  if (joined.length <= 480 && lines.length === normalized.split('\n').length) {
    return joined
  }
  return `${joined.slice(0, 480).trimEnd()}\n…`
}

function selectPreviewFile(files: readonly string[]): string | undefined {
  for (const candidate of previewPriority) {
    if (files.includes(candidate)) {
      return candidate
    }
  }

  return files.find(file => /\.(md|txt|json|tsx?|jsx?|css|scss|html)$/i.test(file))
}

export async function readWorkspacePreview(
  workspacePath: string,
  files: readonly string[],
): Promise<WorkspacePreview | undefined> {
  const previewPath = selectPreviewFile(files)
  if (!previewPath) {
    return undefined
  }

  const absolutePath = join(workspacePath, previewPath)
  if (!(await pathExists(absolutePath))) {
    return undefined
  }

  try {
    const content = await readFile(absolutePath, 'utf8')
    return {
      path: previewPath,
      content: truncatePreviewContent(content),
    }
  } catch {
    return undefined
  }
}

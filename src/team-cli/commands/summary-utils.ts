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
  limit = 24,
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
  headline?: string
  excerpt: string
  content: string
}

export type WorkspaceFileCategory = 'docs' | 'frontend' | 'backend' | 'other'

export type WorkspaceFileCategoryCounts = Record<WorkspaceFileCategory, number>

export type WorkspaceFileSummary = {
  total: number
  featuredFiles: string[]
  hiddenCount: number
  categoryCounts: WorkspaceFileCategoryCounts
  overview: string
}

const previewPriority = [
  'docs/review.md',
  'docs/plan.md',
  'docs/architecture.md',
  'docs/research.md',
  'docs/backend-api.md',
  'docs/goal.md',
  'README.md',
  'frontend/README.md',
  'frontend/package.json',
  'backend/README.md',
  'backend/package.json',
  'package.json',
] as const

const previewPriorityIndex = new Map<string, number>(
  previewPriority.map((candidate, index) => [candidate, index]),
)

function getWorkspaceFileCategory(file: string): WorkspaceFileCategory {
  if (file.startsWith('docs/')) {
    return 'docs'
  }
  if (file.startsWith('frontend/')) {
    return 'frontend'
  }
  if (file.startsWith('backend/')) {
    return 'backend'
  }
  return 'other'
}

function getWorkspaceFileScore(file: string): number {
  const exactPriority = previewPriorityIndex.get(file)
  if (exactPriority !== undefined) {
    return exactPriority
  }

  const lower = file.toLowerCase()
  let score = 1_000

  const category = getWorkspaceFileCategory(file)
  if (category === 'docs') {
    score -= 300
  } else if (category === 'frontend') {
    score -= 200
  } else if (category === 'backend') {
    score -= 150
  }

  if (/readme\.md$/.test(lower)) {
    score -= 120
  }
  if (/(review|plan|architecture|research|goal)\.md$/.test(lower)) {
    score -= 140
  }
  if (/package\.json$/.test(lower)) {
    score -= 90
  }
  if (/(app|main|index)\.(tsx?|jsx?)$/.test(lower)) {
    score -= 60
  }
  if (/\.(md|txt)$/.test(lower)) {
    score -= 40
  }

  return score
}

export function prioritizeWorkspaceFiles(
  files: readonly string[],
): string[] {
  return [...files].sort((left, right) => {
    const scoreDiff = getWorkspaceFileScore(left) - getWorkspaceFileScore(right)
    if (scoreDiff !== 0) {
      return scoreDiff
    }
    return left.localeCompare(right)
  })
}

export function summarizeWorkspaceFiles(
  files: readonly string[],
  displayLimit = 6,
): WorkspaceFileSummary {
  const categoryCounts: WorkspaceFileCategoryCounts = {
    docs: 0,
    frontend: 0,
    backend: 0,
    other: 0,
  }

  for (const file of files) {
    categoryCounts[getWorkspaceFileCategory(file)] += 1
  }

  const prioritized = prioritizeWorkspaceFiles(files)
  const featuredFiles = prioritized.slice(0, displayLimit)
  const hiddenCount = Math.max(0, prioritized.length - featuredFiles.length)
  const overview = [
    `total=${prioritized.length}`,
    `docs=${categoryCounts.docs}`,
    `frontend=${categoryCounts.frontend}`,
    `backend=${categoryCounts.backend}`,
    `other=${categoryCounts.other}`,
  ].join(' ')

  return {
    total: prioritized.length,
    featuredFiles,
    hiddenCount,
    categoryCounts,
    overview,
  }
}

function truncatePreviewContent(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  const lines = normalized.split('\n').slice(0, 10)
  const joined = lines.join('\n')
  if (joined.length <= 640 && lines.length === normalized.split('\n').length) {
    return joined
  }
  return `${joined.slice(0, 640).trimEnd()}\n…`
}

function stripMarkdownHeading(line: string): string {
  return line.replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim()
}

function extractPreviewHeadline(content: string): string | undefined {
  for (const line of content.replace(/\r\n/g, '\n').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }

    if (trimmed.startsWith('#')) {
      const heading = stripMarkdownHeading(trimmed)
      if (heading.length > 0) {
        return heading
      }
    }

    return stripMarkdownHeading(trimmed)
  }

  return undefined
}

function extractPreviewExcerpt(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n')
  const excerpt = normalized
    .split('\n')
    .map(line => stripMarkdownHeading(line))
    .find(line => line.length > 0)

  if (!excerpt) {
    return ''
  }

  if (excerpt.length <= 160) {
    return excerpt
  }

  return `${excerpt.slice(0, 159)}…`
}

function selectPreviewFile(files: readonly string[]): string | undefined {
  return prioritizeWorkspaceFiles(files).find(file =>
    /\.(md|txt|json|tsx?|jsx?|css|scss|html)$/i.test(file),
  )
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
    const truncatedContent = truncatePreviewContent(content)
    return {
      path: previewPath,
      headline: extractPreviewHeadline(content),
      excerpt: extractPreviewExcerpt(content),
      content: truncatedContent,
    }
  } catch {
    return undefined
  }
}

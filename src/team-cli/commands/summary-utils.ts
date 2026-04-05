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
  state: { scanTruncated: boolean },
): Promise<void> {
  if (files.length >= limit || depth > maxDepth) {
    if (files.length >= limit) {
      state.scanTruncated = true
    }
    return
  }

  const entries = await readdir(currentPath, { withFileTypes: true })
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (files.length >= limit) {
      state.scanTruncated = true
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
        state,
      )
    }
  }
}

export const DEFAULT_WORKSPACE_FILE_SCAN_LIMIT = 24
export const DEFAULT_WORKSPACE_FILE_DISPLAY_LIMIT = 6
export const DEFAULT_WORKSPACE_PREVIEW_MAX_LINES = 12
export const DEFAULT_WORKSPACE_PREVIEW_MAX_CHARS = 800

export type WorkspaceFileSnapshot = {
  files: string[]
  scanLimit: number
  scanTruncated: boolean
}

export async function listWorkspaceFileSnapshot(
  workspacePath: string,
  limit = DEFAULT_WORKSPACE_FILE_SCAN_LIMIT,
): Promise<WorkspaceFileSnapshot> {
  if (!(await pathExists(workspacePath))) {
    return {
      files: [],
      scanLimit: limit,
      scanTruncated: false,
    }
  }

  const files: string[] = []
  const state = { scanTruncated: false }
  await collectWorkspaceFiles(
    workspacePath,
    workspacePath,
    0,
    2,
    files,
    limit,
    state,
  )
  return {
    files,
    scanLimit: limit,
    scanTruncated: state.scanTruncated,
  }
}

export async function listWorkspaceFiles(
  workspacePath: string,
  limit = DEFAULT_WORKSPACE_FILE_SCAN_LIMIT,
): Promise<string[]> {
  return (await listWorkspaceFileSnapshot(workspacePath, limit)).files
}

export type WorkspacePreview = {
  path: string
  headline?: string
  excerpt: string
  content: string
  contentTruncated: boolean
  hiddenLineCount: number
  selectionKind: 'priority' | 'signal'
  sourceTruncated: boolean
}

export type WorkspaceFileCategory = 'docs' | 'frontend' | 'backend' | 'other'

export type WorkspaceFileCategoryCounts = Record<WorkspaceFileCategory, number>

export type WorkspaceFileSummary = {
  total: number
  featuredFiles: string[]
  hiddenCount: number
  categoryCounts: WorkspaceFileCategoryCounts
  overview: string
  scanLimit?: number
  scanTruncated: boolean
  overflowLabel?: string
}

const previewPriority = [
  'docs/review.md',
  'docs/summary.md',
  'docs/final.md',
  'docs/final-summary.md',
  'docs/handoff.md',
  'docs/plan.md',
  'docs/architecture.md',
  'docs/research.md',
  'docs/backend-api.md',
  'docs/goal.md',
  'README.md',
  'docs/README.md',
  'index.html',
  'frontend/README.md',
  'frontend/src/app.tsx',
  'frontend/src/main.tsx',
  'frontend/src/app.jsx',
  'frontend/src/main.jsx',
  'frontend/package.json',
  'backend/README.md',
  'backend/src/app.ts',
  'backend/src/main.ts',
  'backend/src/app.js',
  'backend/src/main.js',
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

  if (/(^|\/)(app|main|index)\.(tsx?|jsx?)$/.test(lower)) {
    score -= 140
  }
  if (/(review|summary|report|handoff|architecture|research|goal|overview|final|notes)\.md$/.test(lower)) {
    score -= 130
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
  if (/\.(ya?ml|json|md|txt|tsx?|jsx?|html|css|scss)$/.test(lower)) {
    score -= 30
  }
  if (/\.(md|txt)$/.test(lower)) {
    score -= 40
  }
  if (
    /(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/.test(lower)
  ) {
    score += 220
  }
  if (
    /(^|\/)(dist|build|coverage|fixtures?|mocks?|snapshots?)\//.test(lower) ||
    /\.(spec|test)\.(tsx?|jsx?)$/.test(lower) ||
    /\.map$/.test(lower)
  ) {
    score += 180
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

function normalizeWorkspaceFileInput(
  input: readonly string[] | WorkspaceFileSnapshot,
): WorkspaceFileSnapshot {
  if (isWorkspaceFileSnapshot(input)) {
    return input
  }

  return {
    files: [...input],
    scanLimit: input.length,
    scanTruncated: false,
  }
}

function isWorkspaceFileSnapshot(
  input: readonly string[] | WorkspaceFileSnapshot,
): input is WorkspaceFileSnapshot {
  return !Array.isArray(input)
}

export function summarizeWorkspaceFiles(
  input: readonly string[] | WorkspaceFileSnapshot,
  displayLimit = DEFAULT_WORKSPACE_FILE_DISPLAY_LIMIT,
): WorkspaceFileSummary {
  const snapshot = normalizeWorkspaceFileInput(input)
  const files = snapshot.files
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
    overview: snapshot.scanTruncated
      ? [
          `total>=${prioritized.length}`,
          `docs=${categoryCounts.docs}`,
          `frontend=${categoryCounts.frontend}`,
          `backend=${categoryCounts.backend}`,
          `other=${categoryCounts.other}`,
        ].join(' ')
      : overview,
    scanLimit: snapshot.scanTruncated ? snapshot.scanLimit : undefined,
    scanTruncated: snapshot.scanTruncated,
    overflowLabel: snapshot.scanTruncated
      ? `showing first ${snapshot.scanLimit} discovered files`
      : undefined,
  }
}

export function getWorkspaceGeneratedCountLabel(
  summary: WorkspaceFileSummary,
): string {
  return summary.scanTruncated ? `${summary.total}+` : String(summary.total)
}

export function getWorkspaceHiddenFilesLabel(
  summary: WorkspaceFileSummary,
): string | undefined {
  if (summary.hiddenCount <= 0) {
    return undefined
  }
  return summary.scanTruncated
    ? `+${summary.hiddenCount} more discovered files not shown`
    : `+${summary.hiddenCount} more files`
}

export function getWorkspacePreviewTrimmedLabel(
  preview: WorkspacePreview,
): string | undefined {
  if (!preview.contentTruncated) {
    return undefined
  }
  if (preview.hiddenLineCount > 0) {
    return `trimmed=${preview.hiddenLineCount} more line(s) hidden`
  }
  return 'trimmed=preview content shortened'
}

function truncatePreviewContent(content: string): {
  content: string
  contentTruncated: boolean
  hiddenLineCount: number
} {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  if (normalized.length === 0) {
    return {
      content: '',
      contentTruncated: false,
      hiddenLineCount: 0,
    }
  }

  const allLines = normalized.split('\n')
  const lines = allLines.slice(0, DEFAULT_WORKSPACE_PREVIEW_MAX_LINES)
  let joined = lines.join('\n').trimEnd()
  let contentTruncated = allLines.length > lines.length
  if (joined.length > DEFAULT_WORKSPACE_PREVIEW_MAX_CHARS) {
    joined = joined.slice(0, DEFAULT_WORKSPACE_PREVIEW_MAX_CHARS).trimEnd()
    contentTruncated = true
  }

  return {
    content: contentTruncated ? `${joined}\n…` : joined,
    contentTruncated,
    hiddenLineCount: Math.max(0, allLines.length - lines.length),
  }
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
  const headline = extractPreviewHeadline(content)
  const excerpt = normalized
    .split('\n')
    .map(line => stripMarkdownHeading(line))
    .find(line => line.length > 0 && (headline === undefined || line !== headline))

  if (!excerpt) {
    return headline ?? ''
  }

  if (excerpt.length <= 160) {
    return excerpt
  }

  return `${excerpt.slice(0, 159)}…`
}

function selectPreviewFile(
  files: readonly string[],
): { path: string; selectionKind: 'priority' | 'signal' } | undefined {
  const prioritized = prioritizeWorkspaceFiles(files)
  const path = prioritized.find(file =>
    /\.(md|txt|json|tsx?|jsx?|css|scss|html)$/i.test(file),
  )
  if (!path) {
    return undefined
  }

  return {
    path,
    selectionKind: previewPriorityIndex.has(path) ? 'priority' : 'signal',
  }
}

export async function readWorkspacePreview(
  workspacePath: string,
  input: readonly string[] | WorkspaceFileSnapshot,
): Promise<WorkspacePreview | undefined> {
  const snapshot = normalizeWorkspaceFileInput(input)
  const previewSelection = selectPreviewFile(snapshot.files)
  if (!previewSelection) {
    return undefined
  }

  const absolutePath = join(workspacePath, previewSelection.path)
  if (!(await pathExists(absolutePath))) {
    return undefined
  }

  try {
    const content = await readFile(absolutePath, 'utf8')
    const truncatedContent = truncatePreviewContent(content)
    return {
      path: previewSelection.path,
      headline: extractPreviewHeadline(content),
      excerpt: extractPreviewExcerpt(content),
      content: truncatedContent.content,
      contentTruncated: truncatedContent.contentTruncated,
      hiddenLineCount: truncatedContent.hiddenLineCount,
      selectionKind: previewSelection.selectionKind,
      sourceTruncated: snapshot.scanTruncated,
    }
  } catch {
    return undefined
  }
}

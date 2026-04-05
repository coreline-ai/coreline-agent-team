import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import test from 'node:test'
import {
  listWorkspaceFileSnapshot,
  prioritizeWorkspaceFiles,
  readWorkspacePreview,
  summarizeWorkspaceFiles,
} from '../../src/team-cli/commands/summary-utils.js'
import { createTempDir } from '../test-helpers.js'

test('prioritizeWorkspaceFiles promotes high-signal docs and app files', () => {
  const prioritized = prioritizeWorkspaceFiles([
    'backend/README.md',
    'frontend/package.json',
    'package.json',
    'docs/plan.md',
    'frontend/src/app.tsx',
    'docs/review.md',
  ])

  assert.deepEqual(prioritized.slice(0, 4), [
    'docs/review.md',
    'docs/plan.md',
    'frontend/src/app.tsx',
    'frontend/package.json',
  ])
})

test('summarizeWorkspaceFiles reports category counts and hidden file count', () => {
  const summary = summarizeWorkspaceFiles(
    [
      'docs/review.md',
      'docs/plan.md',
      'docs/research.md',
      'frontend/README.md',
      'frontend/package.json',
      'backend/README.md',
      'package.json',
    ],
    4,
  )

  assert.equal(summary.total, 7)
  assert.deepEqual(summary.categoryCounts, {
    docs: 3,
    frontend: 2,
    backend: 1,
    other: 1,
  })
  assert.deepEqual(summary.featuredFiles, [
    'docs/review.md',
    'docs/plan.md',
    'docs/research.md',
    'frontend/README.md',
  ])
  assert.equal(summary.hiddenCount, 3)
  assert.equal(summary.overview, 'total=7 docs=3 frontend=2 backend=1 other=1')
  assert.equal(summary.scanTruncated, false)
})

test('readWorkspacePreview extracts a headline and excerpt from the selected preview file', async t => {
  const workspace = await createTempDir(t)
  await mkdir(`${workspace}/docs`, { recursive: true })
  await writeFile(
    `${workspace}/docs/review.md`,
    '# Review Summary\n\nProject skeleton is ready for handoff.\nAdditional notes follow.\n',
    'utf8',
  )
  await writeFile(`${workspace}/package.json`, '{}\n', 'utf8')

  const preview = await readWorkspacePreview(workspace, [
    'package.json',
    'docs/review.md',
  ])

  assert.equal(preview?.path, 'docs/review.md')
  assert.equal(preview?.headline, 'Review Summary')
  assert.equal(preview?.excerpt, 'Project skeleton is ready for handoff.')
  assert.equal(preview?.selectionKind, 'priority')
  assert.equal(preview?.contentTruncated, false)
  assert.equal(preview?.sourceTruncated, false)
  assert.match(preview?.content ?? '', /Project skeleton is ready for handoff\./)
})

test('listWorkspaceFileSnapshot marks large workspaces as truncated and summary carries the metadata', async t => {
  const workspace = await createTempDir(t)
  await mkdir(`${workspace}/docs`, { recursive: true })

  for (let index = 0; index < 26; index += 1) {
    await writeFile(
      `${workspace}/docs/file-${String(index).padStart(2, '0')}.md`,
      `# File ${index}\n`,
      'utf8',
    )
  }

  const snapshot = await listWorkspaceFileSnapshot(workspace, 24)
  const summary = summarizeWorkspaceFiles(snapshot, 6)

  assert.equal(snapshot.files.length, 24)
  assert.equal(snapshot.scanLimit, 24)
  assert.equal(snapshot.scanTruncated, true)
  assert.equal(summary.scanTruncated, true)
  assert.equal(summary.scanLimit, 24)
  assert.equal(summary.overflowLabel, 'showing first 24 discovered files')
})

test('readWorkspacePreview favors high-signal summary docs over low-signal generated files', async t => {
  const workspace = await createTempDir(t)
  await mkdir(`${workspace}/docs`, { recursive: true })
  await mkdir(`${workspace}/frontend/src/generated`, { recursive: true })
  await writeFile(
    `${workspace}/docs/final-summary.md`,
    '# Final Summary\n\nThe delivery is ready for review.\n',
    'utf8',
  )
  await writeFile(
    `${workspace}/frontend/src/generated/routes.ts`,
    'export const routes = []\n',
    'utf8',
  )
  await writeFile(`${workspace}/package-lock.json`, '{}\n', 'utf8')

  const preview = await readWorkspacePreview(workspace, [
    'frontend/src/generated/routes.ts',
    'package-lock.json',
    'docs/final-summary.md',
  ])

  assert.equal(preview?.path, 'docs/final-summary.md')
  assert.equal(preview?.headline, 'Final Summary')
  assert.equal(preview?.selectionKind, 'priority')
})

test('readWorkspacePreview reports truncation metadata for long preview content', async t => {
  const workspace = await createTempDir(t)
  await mkdir(`${workspace}/docs`, { recursive: true })
  await writeFile(
    `${workspace}/docs/review.md`,
    Array.from({ length: 18 }, (_, index) => `Line ${index + 1}`).join('\n'),
    'utf8',
  )

  const preview = await readWorkspacePreview(workspace, ['docs/review.md'])

  assert.equal(preview?.contentTruncated, true)
  assert.equal(preview?.hiddenLineCount, 6)
  assert.match(preview?.content ?? '', /\n…$/)
})

import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import test from 'node:test'
import {
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
    'frontend/package.json',
    'backend/README.md',
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
  assert.equal(preview?.excerpt, 'Review Summary')
  assert.match(preview?.content ?? '', /Project skeleton is ready for handoff\./)
})

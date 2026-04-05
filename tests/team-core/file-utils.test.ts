import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import {
  readBoundedTail,
  readJsonFile,
  writeFileAtomically,
  writeJsonFile,
  writeTextFile,
} from '../../src/team-core/index.js'
import { createTempDir } from '../test-helpers.js'

test('writeFileAtomically overwrites files without leaving temp artifacts behind', async t => {
  const rootDir = await createTempDir(t)
  const path = join(rootDir, 'sample.txt')

  await writeFileAtomically(path, 'first')
  await writeFileAtomically(path, 'second')

  assert.equal(await readFile(path, 'utf8'), 'second')
  assert.deepEqual(await readdir(rootDir), ['sample.txt'])
})

test('writeJsonFile and writeTextFile use atomic writes for persisted content', async t => {
  const rootDir = await createTempDir(t)
  const jsonPath = join(rootDir, 'sample.json')
  const textPath = join(rootDir, 'sample.log')

  await writeJsonFile(jsonPath, {
    team: 'alpha',
    status: 'ready',
  })
  await writeTextFile(textPath, 'hello world')

  assert.deepEqual(await readJsonFile(jsonPath, {}), {
    team: 'alpha',
    status: 'ready',
  })
  assert.equal(await readFile(textPath, 'utf8'), 'hello world')
  assert.deepEqual((await readdir(rootDir)).sort(), ['sample.json', 'sample.log'])
})

test('readBoundedTail returns only the trailing window and reports truncation', async t => {
  const rootDir = await createTempDir(t)
  const path = join(rootDir, 'worker.log')

  await writeTextFile(
    path,
    [
      'line-1',
      'line-2',
      'line-3',
      'line-4',
      'line-5',
      'line-6',
    ].join('\n'),
  )

  const result = await readBoundedTail(path, {
    maxLines: 2,
    maxBytes: 24,
  })

  assert.equal(result.state, 'ok')
  assert.deepEqual(result.lines, ['line-5', 'line-6'])
  assert.equal(result.truncated, true)
  assert.ok(result.bytesRead <= 256)
})

test('readBoundedTail reports missing, empty, and unreadable paths explicitly', async t => {
  const rootDir = await createTempDir(t)
  const emptyPath = join(rootDir, 'empty.log')
  const unreadablePath = rootDir

  await writeTextFile(emptyPath, '')

  const missing = await readBoundedTail(join(rootDir, 'missing.log'))
  const empty = await readBoundedTail(emptyPath)
  const unreadable = await readBoundedTail(unreadablePath)

  assert.equal(missing.state, 'missing')
  assert.deepEqual(missing.lines, [])
  assert.equal(empty.state, 'empty')
  assert.deepEqual(empty.lines, [])
  assert.equal(unreadable.state, 'unreadable')
  assert.ok(unreadable.error)
})

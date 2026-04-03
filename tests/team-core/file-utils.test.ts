import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import {
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

import assert from 'node:assert/strict'
import test from 'node:test'
import { readJsonFile } from '../../src/team-core/index.js'

function createBusyError(): Error & { code: string } {
  const error = new Error('resource busy') as Error & { code: string }
  error.code = 'EBUSY'
  return error
}

test('readJsonFile retries on EBUSY and eventually succeeds', async () => {
  let attempts = 0

  const result = await readJsonFile(
    '/virtual/config.json',
    null,
    {
      readFileImpl: (async () => {
        attempts += 1
        if (attempts < 3) {
          throw createBusyError()
        }
        return '{"ok":true}'
      }) as unknown as typeof import('node:fs/promises').readFile,
    },
  )

  assert.deepEqual(result, { ok: true })
  assert.equal(attempts, 3)
})

test('readJsonFile throws after three consecutive EBUSY errors', async () => {
  let attempts = 0

  await assert.rejects(
    readJsonFile(
      '/virtual/config.json',
      null,
      {
        readFileImpl: (async () => {
          attempts += 1
          throw createBusyError()
        }) as unknown as typeof import('node:fs/promises').readFile,
      },
    ),
    error => (error as NodeJS.ErrnoException).code === 'EBUSY',
  )

  assert.equal(attempts, 3)
})

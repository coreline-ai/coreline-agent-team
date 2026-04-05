import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import test from 'node:test'
import {
  createRuntimeContext,
  pollForMailboxResponse,
} from '../../src/team-runtime/index.js'
import { getInboxPath } from '../../src/team-core/index.js'
import { createTempOptions } from '../test-helpers.js'

test('pollForMailboxResponse throws after repeated unread mailbox errors', async t => {
  const options = await createTempOptions(t)
  const inboxPath = getInboxPath('alpha team', 'researcher', options)
  await mkdir(dirname(inboxPath), { recursive: true })
  await writeFile(inboxPath, '{ not valid json', 'utf8')

  await assert.rejects(
    pollForMailboxResponse({
      config: {
        teamName: 'alpha team',
        name: 'researcher',
      },
      runtimeContext: createRuntimeContext({
        agentId: 'researcher@alpha team',
        agentName: 'researcher',
        teamName: 'alpha team',
      }),
      coreOptions: options,
      matcher: () => null,
      pollIntervalMs: 1,
      maxPollErrors: 3,
      maxPollBackoffMs: 1,
      requestId: 'poll-error-1',
      waitLabel: 'Permission',
    }),
    /3 consecutive errors/,
  )
})

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendTranscriptEntry,
  buildTranscriptContext,
  clearTranscript,
  createTeam,
  createTranscriptEntry,
  readTranscriptEntries,
} from '../../src/team-core/index.js'
import { createTempOptions } from '../test-helpers.js'

test('transcript store appends entries and builds a recent context block', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'

  await createTeam(
    {
      teamName: 'alpha team',
      leadAgentId: 'team-lead@alpha team',
      leadMember: {
        name: 'team-lead',
        agentType: 'team-lead',
        cwd,
        subscriptions: [],
      },
    },
    options,
  )

  await appendTranscriptEntry(
    'alpha team',
    'researcher',
    createTranscriptEntry({
      sessionId: 'session-1',
      agentName: 'researcher',
      role: 'work_item',
      content: 'Task #1: Investigate issue',
    }),
    options,
  )
  await appendTranscriptEntry(
    'alpha team',
    'researcher',
    createTranscriptEntry({
      sessionId: 'session-1',
      agentName: 'researcher',
      role: 'assistant',
      content: 'Done with task #1',
    }),
    options,
  )

  const entries = await readTranscriptEntries('alpha team', 'researcher', options)
  const context = buildTranscriptContext(entries, {
    limit: 4,
  })

  assert.equal(entries.length, 2)
  assert.match(context, /Recent Transcript Context/)
  assert.match(context, /\[work_item\]/)
  assert.match(context, /\[assistant\]/)

  await clearTranscript('alpha team', 'researcher', options)
  assert.equal(
    (await readTranscriptEntries('alpha team', 'researcher', options)).length,
    0,
  )
})

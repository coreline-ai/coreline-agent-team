import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendTranscriptEntry,
  createTeam,
  createTranscriptEntry,
} from '../../src/team-core/index.js'
import { runTranscriptCommand } from '../../src/team-cli/commands/transcript.js'
import { createTempOptions } from '../test-helpers.js'

test('runTranscriptCommand renders recent transcript entries for a teammate', async t => {
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

  const result = await runTranscriptCommand(
    'alpha team',
    'researcher',
    5,
    options,
  )

  assert.match(result.message, /Transcript for researcher/)
  assert.match(result.message, /\[work_item\]/)
  assert.match(result.message, /Done with task #1/)
})

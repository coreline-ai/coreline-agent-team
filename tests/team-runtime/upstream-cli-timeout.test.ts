import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createRuntimeContext,
  executeUpstreamCliTurn,
  type RuntimeTurnInput,
} from '../../src/team-runtime/index.js'
import { createExecutableFile, createTempDir } from '../test-helpers.js'

function createTurnInput(cwd: string): RuntimeTurnInput {
  return {
    prompt: 'Task #1: Investigate issue',
    workItem: {
      kind: 'task',
      task: {
        id: '1',
        subject: 'Investigate issue',
        description: 'Review the failing build',
        status: 'pending',
        blocks: [],
        blockedBy: [],
      },
    },
    context: {
      config: {
        name: 'researcher',
        teamName: 'alpha team',
        prompt: 'Investigate the failure',
        cwd,
      },
      coreOptions: {},
      runtimeContext: createRuntimeContext({
        agentId: 'researcher@alpha team',
        agentName: 'researcher',
        teamName: 'alpha team',
      }),
      async sendMessage(): Promise<void> {
        return
      },
      async requestPlanApproval() {
        throw new Error('not used')
      },
      async requestPermission() {
        throw new Error('not used')
      },
      async requestSandboxPermission() {
        throw new Error('not used')
      },
    },
  }
}

test('executeUpstreamCliTurn returns exit code 124 on timeout', async t => {
  const cwd = await createTempDir(t)
  const executablePath = await createExecutableFile(
    t,
    'upstream-timeout.cjs',
    [
      '#!/usr/bin/env node',
      'setTimeout(() => {}, 10_000)',
    ].join('\n'),
  )

  const result = await executeUpstreamCliTurn(createTurnInput(cwd), {
    executablePath,
    timeoutMs: 50,
  })

  assert.equal(result.exitCode, 124)
})

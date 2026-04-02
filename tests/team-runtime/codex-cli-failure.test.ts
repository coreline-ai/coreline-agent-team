import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createCodexCliRuntimeTurnBridge,
  createFunctionRuntimeTurnBridge,
  createRuntimeContext,
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
        throw new Error('unused')
      },
      async requestPermission() {
        throw new Error('unused')
      },
      async requestSandboxPermission() {
        throw new Error('unused')
      },
    },
  }
}

test('Codex CLI bridge returns a failed task result when the subprocess exits nonzero', async t => {
  const cwd = await createTempDir(t)
  const executablePath = await createExecutableFile(
    t,
    'codex-failure.cjs',
    [
      '#!/usr/bin/env node',
      "process.stderr.write('codex bridge failed')",
      'process.exit(2)',
    ].join('\n'),
  )

  const bridge = createCodexCliRuntimeTurnBridge({
    executablePath,
  })

  const result = await bridge.executeTurn(createTurnInput(cwd))

  assert.equal(result?.idleReason, 'failed')
  assert.equal(result?.taskStatus, 'pending')
  assert.match(result?.failureReason ?? '', /codex bridge failed/)
})

test('Codex CLI bridge can fall back to another turn bridge after failure', async t => {
  const cwd = await createTempDir(t)
  const executablePath = await createExecutableFile(
    t,
    'codex-failure-with-fallback.cjs',
    [
      '#!/usr/bin/env node',
      "process.stderr.write('unavailable')",
      'process.exit(1)',
    ].join('\n'),
  )

  const fallbackBridge = createFunctionRuntimeTurnBridge(async () => ({
    summary: 'fallback executed',
    assistantResponse: 'handled by fallback bridge',
    taskStatus: 'completed',
    completedTaskId: '1',
    completedStatus: 'resolved',
  }))

  const bridge = createCodexCliRuntimeTurnBridge({
    executablePath,
    fallbackBridge,
  })

  const result = await bridge.executeTurn(createTurnInput(cwd))

  assert.equal(result?.summary, 'fallback executed')
  assert.equal(result?.assistantResponse, 'handled by fallback bridge')
  assert.equal(result?.taskStatus, 'completed')
})

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createRuntimeContext,
  executeCodexCliTurn,
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

test('executeCodexCliTurn returns exit code 124 on timeout', async t => {
  const cwd = await createTempDir(t)
  const executablePath = await createExecutableFile(
    t,
    'codex-timeout.cjs',
    [
      '#!/usr/bin/env node',
      'setTimeout(() => {}, 10_000)',
    ].join('\n'),
  )

  const result = await executeCodexCliTurn(createTurnInput(cwd), {
    executablePath,
    timeoutMs: 50,
  })

  assert.equal(result.exitCode, 124)
})

test('executeCodexCliTurn truncates stdout when it exceeds maxOutputBytes', async t => {
  const cwd = await createTempDir(t)
  const executablePath = await createExecutableFile(
    t,
    'codex-stdout-overflow.cjs',
    [
      '#!/usr/bin/env node',
      "process.stdin.resume()",
      "process.stdin.on('end', () => {",
      "  for (let index = 0; index < 10; index += 1) {",
      "    process.stdout.write('x'.repeat(256))",
      '  }',
      '})',
    ].join('\n'),
  )

  const result = await executeCodexCliTurn(createTurnInput(cwd), {
    executablePath,
    maxOutputBytes: 1024,
  })

  assert.equal(result.exitCode, 0)
  assert.ok(result.stdout.length <= 1024)
  assert.ok(256 * 10 > result.stdout.length)
})

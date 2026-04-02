import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildCodexCliArgs,
  buildCodexOutputSchema,
  createCodexCliRuntimeTurnBridge,
  createRuntimeContext,
  type RuntimeTurnInput,
} from '../../src/team-runtime/index.js'
import { createExecutableFile, createTempDir } from '../test-helpers.js'

function createTurnInput(cwd: string, model = 'gpt-5.4'): RuntimeTurnInput {
  return {
    prompt: [
      '# Agent Team Work Item',
      '## Current Work',
      'Task #1: Investigate issue',
    ].join('\n'),
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
        model,
        codexArgs: ['--config', 'model_reasoning_effort=high'],
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
        throw new Error('not used in codex cli bridge test')
      },
      async requestPermission() {
        throw new Error('not used in codex cli bridge test')
      },
      async requestSandboxPermission() {
        throw new Error('not used in codex cli bridge test')
      },
    },
  }
}

test('buildCodexCliArgs includes model, cwd, output schema, and extra args', async t => {
  const cwd = await createTempDir(t)
  const input = createTurnInput(cwd)

  const args = buildCodexCliArgs(
    input,
    '/tmp/last-message.txt',
    '/tmp/schema.json',
    {
      extraArgs: ['--dangerously-bypass-approvals-and-sandbox'],
    },
  )

  assert.deepEqual(args.slice(0, 4), ['exec', '-', '--color', 'never'])
  assert.equal(args.includes('-C'), true)
  assert.equal(args.includes(cwd), true)
  assert.equal(args.includes('-m'), true)
  assert.equal(args.includes('gpt-5.4'), true)
  assert.equal(args.includes('--output-schema'), true)
  assert.equal(args.includes('/tmp/schema.json'), true)
  assert.equal(args.includes('--config'), true)
  assert.equal(args.includes('model_reasoning_effort=high'), true)
  assert.equal(
    args.includes('--dangerously-bypass-approvals-and-sandbox'),
    true,
  )
})

test('buildCodexOutputSchema follows the strict all-properties-required contract expected by Codex CLI', () => {
  const schema = buildCodexOutputSchema() as {
    properties: Record<string, unknown>
    required: string[]
  }
  const shutdown = schema.properties.shutdown as {
    required: string[]
  }

  assert.deepEqual(
    schema.required,
    [
      'summary',
      'assistantResponse',
      'assistantSummary',
      'sendTo',
      'taskStatus',
      'completedTaskId',
      'completedStatus',
      'failureReason',
      'stop',
      'shutdown',
    ],
  )
  assert.deepEqual(shutdown.required, ['approved', 'reason'])
})

test('createCodexCliRuntimeTurnBridge parses structured JSON output from a CLI turn', async t => {
  const cwd = await createTempDir(t)
  const executablePath = await createExecutableFile(
    t,
    'codex-success.cjs',
    [
      '#!/usr/bin/env node',
      "const fs = require('node:fs')",
      "let stdin = ''",
      "process.stdin.setEncoding('utf8')",
      "process.stdin.on('data', chunk => { stdin += chunk })",
      "process.stdin.on('end', () => {",
      "  const args = process.argv.slice(2)",
      "  const outputIndex = args.indexOf('-o')",
      "  const modelIndex = args.indexOf('-m')",
      "  const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null",
      "  const model = modelIndex >= 0 ? args[modelIndex + 1] : 'missing'",
      "  const payload = {",
      "    summary: `handled ${stdin.includes('Task #1') ? 'task' : 'message'}`,",
      "    assistantResponse: `model=${model}` ,",
      "    assistantSummary: stdin.split('\\n')[0],",
      "    taskStatus: 'completed',",
      "    completedTaskId: '1',",
      "    completedStatus: 'resolved'",
      '  }',
      "  fs.writeFileSync(outputPath, JSON.stringify(payload))",
      '})',
      'process.stdin.resume()',
    ].join('\n'),
  )

  const input = createTurnInput(cwd)
  const bridge = createCodexCliRuntimeTurnBridge({
    executablePath,
  })

  const result = await bridge.executeTurn(input)

  assert.equal(result?.summary, 'handled task')
  assert.equal(result?.assistantResponse, 'model=gpt-5.4')
  assert.equal(result?.taskStatus, 'completed')
  assert.equal(result?.completedTaskId, '1')
  assert.equal(result?.completedStatus, 'resolved')
})

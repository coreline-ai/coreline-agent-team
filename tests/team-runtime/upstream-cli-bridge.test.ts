import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildUpstreamCliArgs,
  createFunctionRuntimeTurnBridge,
  createRuntimeContext,
  createUpstreamCliRuntimeTurnBridge,
  type RuntimeTurnInput,
} from '../../src/team-runtime/index.js'
import { createExecutableFile, createTempDir } from '../test-helpers.js'

function createTurnInput(cwd: string): RuntimeTurnInput {
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
        model: 'sonnet',
        sessionId: '11111111-1111-4111-8111-111111111111',
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
        throw new Error('not used in upstream cli bridge test')
      },
      async requestPermission() {
        throw new Error('not used in upstream cli bridge test')
      },
      async requestSandboxPermission() {
        throw new Error('not used in upstream cli bridge test')
      },
    },
  }
}

test('buildUpstreamCliArgs includes print mode, schema, model, session id, and prompt', async t => {
  const cwd = await createTempDir(t)
  const input = createTurnInput(cwd)

  const args = buildUpstreamCliArgs(input, {
    extraArgs: ['--debug', 'api'],
  })

  assert.equal(args.includes('-p'), true)
  assert.equal(args.includes('--bare'), false)
  assert.equal(args.includes('--output-format'), true)
  assert.equal(args.includes('json'), true)
  assert.equal(args.includes('--json-schema'), true)
  assert.equal(args.includes('--model'), true)
  assert.equal(args.includes('sonnet'), true)
  assert.equal(args.includes('--session-id'), true)
  assert.equal(
    args.includes('11111111-1111-4111-8111-111111111111'),
    true,
  )
  assert.equal(args.includes('--debug'), true)
  assert.equal(args.at(-1)?.includes('Task #1'), true)
})

test('createUpstreamCliRuntimeTurnBridge parses structured JSON output from a CLI turn', async t => {
  const cwd = await createTempDir(t)
  const executablePath = await createExecutableFile(
    t,
    'upstream-success.cjs',
    [
      '#!/usr/bin/env node',
      "const args = process.argv.slice(2)",
      "const prompt = args[args.length - 1]",
      'const payload = {',
      "  summary: prompt.includes('Task #1') ? 'handled upstream task' : 'handled upstream message',",
      "  assistantResponse: 'completed via upstream cli',",
      "  assistantSummary: 'upstream cli bridge',",
      "  taskStatus: 'completed',",
      "  completedTaskId: '1',",
      "  completedStatus: 'resolved'",
      '}',
      "process.stdout.write(JSON.stringify(payload) + '\\n')",
    ].join('\n'),
  )

  const bridge = createUpstreamCliRuntimeTurnBridge({
    executablePath,
  })
  const result = await bridge.executeTurn(createTurnInput(cwd))

  assert.equal(result?.summary, 'handled upstream task')
  assert.equal(result?.assistantResponse, 'completed via upstream cli')
  assert.equal(result?.taskStatus, 'completed')
  assert.equal(result?.completedTaskId, '1')
})

test('createUpstreamCliRuntimeTurnBridge parses structured_output envelopes from the real CLI JSON response', async t => {
  const cwd = await createTempDir(t)
  const executablePath = await createExecutableFile(
    t,
    'upstream-structured-output-success.cjs',
    [
      '#!/usr/bin/env node',
      'const payload = {',
      "  type: 'result',",
      "  subtype: 'success',",
      "  result: '',",
      "  structured_output: {",
      "    summary: 'handled upstream task',",
      "    assistantResponse: 'completed via structured output',",
      "    assistantSummary: 'upstream cli envelope',",
      "    taskStatus: 'completed',",
      "    completedTaskId: '1',",
      "    completedStatus: 'resolved'",
      '  }',
      '}',
      "process.stdout.write(JSON.stringify(payload) + '\\n')",
    ].join('\n'),
  )

  const bridge = createUpstreamCliRuntimeTurnBridge({
    executablePath,
  })
  const result = await bridge.executeTurn(createTurnInput(cwd))

  assert.equal(result?.summary, 'handled upstream task')
  assert.equal(result?.assistantResponse, 'completed via structured output')
  assert.equal(result?.taskStatus, 'completed')
  assert.equal(result?.completedTaskId, '1')
})

test('Upstream CLI bridge returns an interrupted failure result when abort terminates the turn', async t => {
  const cwd = await createTempDir(t)
  const executablePath = await createExecutableFile(
    t,
    'upstream-bridge-abortable.cjs',
    [
      '#!/usr/bin/env node',
      "process.on('SIGTERM', () => {})",
      "setInterval(() => {}, 1_000)",
    ].join('\n'),
  )

  const bridge = createUpstreamCliRuntimeTurnBridge({
    executablePath,
    timeoutMs: 5_000,
    terminationGraceMs: 50,
  })
  const abortController = new AbortController()

  setTimeout(() => {
    abortController.abort()
  }, 100)

  const result = await bridge.executeTurn({
    ...createTurnInput(cwd),
    abortSignal: abortController.signal,
  })

  assert.equal(result?.idleReason, 'failed')
  assert.equal(result?.taskStatus, 'pending')
  assert.equal(result?.summary, 'Upstream CLI interrupted for researcher')
  assert.match(
    result?.failureReason ?? '',
    /interrupted before the turn completed/,
  )
})

test('Upstream CLI bridge can fall back to another turn bridge after failure', async t => {
  const cwd = await createTempDir(t)
  const executablePath = await createExecutableFile(
    t,
    'upstream-bridge-failure-with-fallback.cjs',
    [
      '#!/usr/bin/env node',
      "process.stderr.write('upstream unavailable')",
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

  const bridge = createUpstreamCliRuntimeTurnBridge({
    executablePath,
    fallbackBridge,
  })

  const result = await bridge.executeTurn(createTurnInput(cwd))

  assert.equal(result?.summary, 'fallback executed')
  assert.equal(result?.assistantResponse, 'handled by fallback bridge')
  assert.equal(result?.taskStatus, 'completed')
})

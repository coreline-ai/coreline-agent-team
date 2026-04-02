import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createTask,
  createTeam,
  getTask,
  getTaskListIdForTeam,
} from '../../src/team-core/index.js'
import { runCli } from '../../src/team-cli/run-cli.js'
import { createExecutableFile, createTempDir } from '../test-helpers.js'

async function withCapturedConsole(
  work: () => Promise<number>,
): Promise<{ exitCode: number; logs: string[]; errors: string[] }> {
  const logs: string[] = []
  const errors: string[] = []
  const originalLog = console.log
  const originalError = console.error
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '))
  }
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '))
  }

  try {
    const exitCode = await work()
    return { exitCode, logs, errors }
  } finally {
    console.log = originalLog
    console.error = originalError
  }
}

test('runCli spawn supports the upstream runtime and completes a task through the bridge', async t => {
  const homeDir = await createTempDir(t)
  const projectDir = await createTempDir(t)
  const executablePath = await createExecutableFile(
    t,
    'upstream-cli-spawn-success.cjs',
    [
      '#!/usr/bin/env node',
      'const payload = {',
      "  type: 'result',",
      "  subtype: 'success',",
      "  result: '',",
      "  structured_output: {",
      "    summary: 'upstream task complete',",
      "    assistantResponse: 'completed via upstream cli',",
      "    assistantSummary: 'upstream cli bridge',",
      "    taskStatus: 'completed',",
      "    completedTaskId: '1',",
      "    completedStatus: 'resolved'",
      '  }',
      '}',
      "process.stdout.write(JSON.stringify(payload) + '\\n')",
    ].join('\n'),
  )

  const originalHome = process.env.HOME
  process.env.HOME = homeDir
  t.after(() => {
    process.env.HOME = originalHome
  })

  await createTeam({
    teamName: 'alpha team',
    leadAgentId: 'team-lead@alpha team',
    leadMember: {
      name: 'team-lead',
      agentType: 'team-lead',
      cwd: projectDir,
      subscriptions: [],
    },
  })

  await createTask(getTaskListIdForTeam('alpha team'), {
    subject: 'Investigate issue',
    description: 'Review the failing build',
    status: 'pending',
    blocks: [],
    blockedBy: [],
  })

  const result = await withCapturedConsole(() =>
    runCli([
      'spawn',
      'alpha team',
      'researcher',
      '--prompt',
      'Investigate the failure',
      '--cwd',
      projectDir,
      '--runtime',
      'upstream',
      '--model',
      'sonnet',
      '--upstream-executable',
      executablePath,
      '--max-iterations',
      '1',
    ]),
  )

  assert.equal(result.exitCode, 0)
  assert.equal(result.errors.length, 0)
  assert.match(result.logs.join('\n'), /Spawned researcher/)

  const task = await getTask(getTaskListIdForTeam('alpha team'), '1')
  assert.equal(task?.status, 'completed')
  assert.equal(task?.owner, 'researcher@alpha team')
})

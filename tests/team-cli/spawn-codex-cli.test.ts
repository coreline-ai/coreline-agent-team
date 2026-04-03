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

test('runCli spawn supports the codex-cli runtime and completes a task through the bridge', async t => {
  const homeDir = await createTempDir(t)
  const projectDir = await createTempDir(t)
  const executablePath = await createExecutableFile(
    t,
    'codex-cli-spawn-success.cjs',
    [
      '#!/usr/bin/env node',
      "const fs = require('node:fs')",
      "let stdin = ''",
      "process.stdin.setEncoding('utf8')",
      "process.stdin.on('data', chunk => { stdin += chunk })",
      "process.stdin.on('end', () => {",
      "  const args = process.argv.slice(2)",
      "  const fullAutoCount = args.filter(arg => arg === '--full-auto').length",
      "  if (fullAutoCount > 1) {",
      "    process.stderr.write(`duplicated --full-auto: ${fullAutoCount}`)",
      '    process.exit(2)',
      '    return',
      '  }',
      "  const outputPath = args[args.indexOf('-o') + 1]",
      "  const payload = {",
      "    summary: stdin.includes('Task #1') ? 'codex cli task complete' : 'missing task context',",
      "    assistantResponse: 'completed via codex cli',",
      "    assistantSummary: 'codex cli bridge',",
      "    taskStatus: 'completed',",
      "    completedTaskId: '1',",
      "    completedStatus: 'resolved'",
      '  }',
      "  fs.writeFileSync(outputPath, JSON.stringify(payload))",
      '})',
      'process.stdin.resume()',
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
      'codex-cli',
      '--model',
      'gpt-5.4',
      '--codex-arg',
      '--full-auto',
      '--codex-executable',
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

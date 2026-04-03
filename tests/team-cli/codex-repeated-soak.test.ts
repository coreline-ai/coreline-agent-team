import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  getTaskListIdForTeam,
  listSessionRecords,
  listTasks,
} from '../../src/team-core/index.js'
import {
  runCodexRepeatedSoak,
  type CodexRepeatedSoakFailureSnapshot,
} from '../../src/team-cli/soak/codex-repeated-soak.js'
import { createExecutableFile, createTempDir } from '../test-helpers.js'

test('runCodexRepeatedSoak completes repeated spawn/resume/reopen cycles through the codex bridge', async t => {
  const rootDir = await createTempDir(t)
  const cwd = await createTempDir(t)
  const executablePath = await createExecutableFile(
    t,
    'codex-soak-success.cjs',
    [
      '#!/usr/bin/env node',
      "const fs = require('node:fs')",
      "const args = process.argv.slice(2)",
      "const outputPath = args[args.indexOf('-o') + 1]",
      "let stdin = ''",
      "process.stdin.setEncoding('utf8')",
      "process.stdin.on('data', chunk => { stdin += chunk })",
      "process.stdin.on('end', () => {",
      "  const taskMatch = stdin.match(/Task #(\\d+):/)",
      "  const taskId = taskMatch ? taskMatch[1] : 'unknown'",
      "  const payload = {",
      "    summary: `completed task ${taskId}`,",
      "    assistantSummary: `completed task ${taskId}`,",
      "    taskStatus: 'completed',",
      "    completedTaskId: taskId,",
      "    completedStatus: 'resolved'",
      '  }',
      '  fs.writeFileSync(outputPath, JSON.stringify(payload))',
      '})',
      'process.stdin.resume()',
    ].join('\n'),
  )

  const result = await runCodexRepeatedSoak({
    rootDir,
    cwd,
    iterations: 2,
    codexExecutablePath: executablePath,
    model: 'gpt-5.4-mini',
  })

  assert.equal(result.success, true)
  assert.equal(result.iterations.length, 2)
  assert.equal(result.failureSnapshotPath, undefined)
  assert.ok(result.summaryArtifactPath)

  for (const iteration of result.iterations) {
    assert.match(iteration.spawn.commandMessage, /Spawned researcher/)
    assert.match(iteration.resume.commandMessage, /\(new-session\)/)
    assert.match(iteration.reopen.commandMessage, /\(existing-session\)/)
    assert.match(iteration.spawn.state.attachOutput, /Attached to team/)
    assert.match(iteration.reopen.state.attachOutput, /Attached to team/)
    assert.match(iteration.reopen.state.statusOutput, /researcher \[idle\]/)
    assert.match(iteration.reopen.state.statusOutput, /active=no/)
  }

  const summary = JSON.parse(
    await readFile(result.summaryArtifactPath!, 'utf8'),
  ) as {
    success: boolean
    iterationsRequested: number
    iterationsCompleted: number
    latestAttachOutput?: string
  }
  assert.equal(summary.success, true)
  assert.equal(summary.iterationsRequested, 2)
  assert.equal(summary.iterationsCompleted, 2)
  assert.match(summary.latestAttachOutput ?? '', /Attached to team/)

  const tasks = await listTasks(getTaskListIdForTeam(result.teamName), {
    rootDir,
  })
  assert.equal(tasks.length, 6)
  assert.equal(
    tasks.filter(task => task.status === 'completed').length,
    6,
  )

  const sessions = await listSessionRecords(result.teamName, result.agentName, {
    rootDir,
  })
  assert.equal(sessions.length, 4)
})

test('runCodexRepeatedSoak writes a failure snapshot when the codex subprocess fails to complete tasks', async t => {
  const rootDir = await createTempDir(t)
  const cwd = await createTempDir(t)
  const executablePath = await createExecutableFile(
    t,
    'codex-soak-failure.cjs',
    [
      '#!/usr/bin/env node',
      "process.stderr.write('codex unavailable')",
      'process.exit(2)',
    ].join('\n'),
  )

  const result = await runCodexRepeatedSoak({
    rootDir,
    cwd,
    iterations: 1,
    codexExecutablePath: executablePath,
  })

  assert.equal(result.success, false)
  assert.ok(result.failureSnapshotPath)
  assert.ok(result.summaryArtifactPath)

  const snapshot = JSON.parse(
    await readFile(result.failureSnapshotPath!, 'utf8'),
  ) as CodexRepeatedSoakFailureSnapshot

  assert.equal(snapshot.step, 'spawn')
  assert.equal(snapshot.iteration, 1)
  assert.match(snapshot.message, /Expected 1 completed tracked tasks/)
  assert.match(snapshot.state?.attachOutput ?? '', /Attached to team/)
  assert.match(snapshot.state?.tasksOutput ?? '', /\[pending\]/)
  assert.match(snapshot.state?.statusOutput ?? '', /researcher \[idle\]/)

  const summary = JSON.parse(
    await readFile(result.summaryArtifactPath!, 'utf8'),
  ) as {
    success: boolean
    failureMessage?: string
    failureSnapshotPath?: string
  }
  assert.equal(summary.success, false)
  assert.match(summary.failureMessage ?? '', /Expected 1 completed tracked tasks/)
  assert.equal(summary.failureSnapshotPath, result.failureSnapshotPath)
})

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import {
  getTaskListIdForTeam,
  listSessionRecords,
  listTasks,
} from '../../src/team-core/index.js'
import {
  analyzeCodexRepeatedSoakStepVerification,
  evaluateCodexRepeatedSoakReleaseGate,
  renderCodexRepeatedSoakSummary,
  resolveCodexRepeatedSoakSummarySelection,
  runCodexRepeatedSoak,
  type CodexRepeatedSoakSummaryArtifact,
  type CodexRepeatedSoakFailurePatternCode,
  type CodexRepeatedSoakFailureSnapshot,
} from '../../src/team-cli/soak/codex-repeated-soak.js'
import { createExecutableFile, createTempDir } from '../test-helpers.js'

test('runCodexRepeatedSoak completes repeated spawn/resume/reopen cycles through the codex bridge', async t => {
  const rootDir = await createTempDir(t)
  const cwd = await createTempDir(t)
  const runLabel = 'runtime-rc-1'
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
    runLabel,
    iterations: 2,
    codexExecutablePath: executablePath,
    model: 'gpt-5.4-mini',
  })

  assert.equal(result.success, true)
  assert.equal(result.iterations.length, 2)
  assert.equal(result.failureSnapshotPath, undefined)
  assert.ok(result.summaryArtifactPath)
  assert.ok(result.summaryArchivePath)
  assert.ok(result.historyManifestPath)
  assert.equal(result.historyRunCount, 1)
  assert.equal(result.runLabel, runLabel)
  assert.equal(result.failurePatterns.length, 0)
  assert.equal(result.verificationSummary.stepsChecked, 6)
  assert.equal(result.verificationSummary.checksFailed, 0)

  for (const iteration of result.iterations) {
    assert.match(iteration.spawn.commandMessage, /Spawned researcher/)
    assert.match(iteration.resume.commandMessage, /\(new-session\)/)
    assert.match(iteration.reopen.commandMessage, /\(existing-session\)/)
    assert.match(iteration.spawn.state.attachOutput, /Attached to team/)
    assert.match(iteration.reopen.state.attachOutput, /Attached to team/)
    assert.match(iteration.reopen.state.statusOutput, /researcher \[idle\]/)
    assert.match(iteration.reopen.state.statusOutput, /active=no/)
    assert.equal(iteration.spawn.verification.passed, true)
    assert.equal(iteration.resume.verification.passed, true)
    assert.equal(iteration.reopen.verification.passed, true)
  }

  const summary = JSON.parse(
    await readFile(result.summaryArtifactPath!, 'utf8'),
  ) as {
    runLabel?: string
    success: boolean
    iterationsRequested: number
    iterationsCompleted: number
    summaryArchivePath?: string
    historyManifestPath?: string
    latestAttachOutput?: string
    failurePatterns: unknown[]
    verificationSummary: {
      stepsChecked: number
      checksRun: number
      checksFailed: number
    }
  }
  assert.equal(summary.success, true)
  assert.equal(summary.runLabel, runLabel)
  assert.equal(summary.iterationsRequested, 2)
  assert.equal(summary.iterationsCompleted, 2)
  assert.equal(summary.summaryArchivePath, result.summaryArchivePath)
  assert.equal(summary.historyManifestPath, result.historyManifestPath)
  assert.match(summary.latestAttachOutput ?? '', /Attached to team/)
  assert.equal(summary.failurePatterns.length, 0)
  assert.equal(summary.verificationSummary.stepsChecked, 6)
  assert.equal(summary.verificationSummary.checksFailed, 0)
  assert.equal(summary.verificationSummary.checksRun, 30)

  const archivedSummary = JSON.parse(
    await readFile(result.summaryArchivePath!, 'utf8'),
  ) as {
    runLabel?: string
    success: boolean
  }
  assert.equal(archivedSummary.success, true)
  assert.equal(archivedSummary.runLabel, runLabel)

  const history = JSON.parse(
    await readFile(result.historyManifestPath!, 'utf8'),
  ) as {
    latestSummaryPath: string
    runs: Array<{
      runLabel?: string
      success: boolean
      summaryPath: string
      checksFailed: number
    }>
  }
  assert.equal(history.latestSummaryPath, result.summaryArtifactPath)
  assert.equal(history.runs.length, 1)
  assert.equal(history.runs[0]?.runLabel, runLabel)
  assert.equal(history.runs[0]?.success, true)
  assert.equal(history.runs[0]?.summaryPath, result.summaryArchivePath)
  assert.equal(history.runs[0]?.checksFailed, 0)

  const rendered = renderCodexRepeatedSoakSummary(result)
  assert.match(rendered, /label=runtime-rc-1/)
  assert.match(rendered, /history_runs=1/)

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
  const runLabel = 'bridge-rc-failure'
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
    runLabel,
    iterations: 1,
    codexExecutablePath: executablePath,
  })

  assert.equal(result.success, false)
  assert.ok(result.failureSnapshotPath)
  assert.ok(result.summaryArtifactPath)
  assert.ok(result.summaryArchivePath)
  assert.ok(result.historyManifestPath)
  assert.equal(result.historyRunCount, 1)
  assert.equal(result.runLabel, runLabel)

  const snapshot = JSON.parse(
    await readFile(result.failureSnapshotPath!, 'utf8'),
  ) as CodexRepeatedSoakFailureSnapshot

  assert.equal(snapshot.step, 'spawn')
  assert.equal(snapshot.iteration, 1)
  assert.match(snapshot.message, /Expected 1 completed tracked tasks/)
  assert.match(snapshot.state?.attachOutput ?? '', /Attached to team/)
  assert.match(snapshot.state?.tasksOutput ?? '', /\[pending\]/)
  assert.match(snapshot.state?.statusOutput ?? '', /researcher \[idle\]/)
  assert.deepEqual(
    snapshot.failurePatterns.map(pattern => pattern.code),
    ['task_completion_mismatch'],
  )
  assert.equal(snapshot.verification?.checks.some(check => check.passed === false), true)

  const summary = JSON.parse(
    await readFile(result.summaryArtifactPath!, 'utf8'),
  ) as {
    runLabel?: string
    summaryArchivePath?: string
    historyManifestPath?: string
    success: boolean
    failureMessage?: string
    failureSnapshotPath?: string
    failurePatterns: Array<{ code: CodexRepeatedSoakFailurePatternCode }>
    verificationSummary: {
      checksFailed: number
      failurePatternCounts: Partial<
        Record<CodexRepeatedSoakFailurePatternCode, number>
      >
    }
  }
  assert.equal(summary.success, false)
  assert.equal(summary.runLabel, runLabel)
  assert.equal(summary.summaryArchivePath, result.summaryArchivePath)
  assert.equal(summary.historyManifestPath, result.historyManifestPath)
  assert.match(summary.failureMessage ?? '', /Expected 1 completed tracked tasks/)
  assert.equal(summary.failureSnapshotPath, result.failureSnapshotPath)
  assert.deepEqual(
    summary.failurePatterns.map(pattern => pattern.code),
    ['task_completion_mismatch'],
  )
  assert.equal(summary.verificationSummary.checksFailed, 1)
  assert.equal(
    summary.verificationSummary.failurePatternCounts.task_completion_mismatch,
    1,
  )

  const history = JSON.parse(
    await readFile(result.historyManifestPath!, 'utf8'),
  ) as {
    runs: Array<{
      runLabel?: string
      success: boolean
      summaryPath: string
      failureSnapshotPath?: string
      failurePatternCodes: CodexRepeatedSoakFailurePatternCode[]
      checksFailed: number
    }>
  }
  assert.equal(history.runs.length, 1)
  assert.equal(history.runs[0]?.runLabel, runLabel)
  assert.equal(history.runs[0]?.success, false)
  assert.equal(history.runs[0]?.summaryPath, result.summaryArchivePath)
  assert.equal(history.runs[0]?.failureSnapshotPath, result.failureSnapshotPath)
  assert.deepEqual(history.runs[0]?.failurePatternCodes, [
    'task_completion_mismatch',
  ])
  assert.equal(history.runs[0]?.checksFailed, 1)

  const rendered = renderCodexRepeatedSoakSummary(result)
  assert.match(rendered, /label=bridge-rc-failure/)
  assert.match(rendered, /history_runs=1/)
})

test('runCodexRepeatedSoak appends archived summaries to history manifest across labeled runs', async t => {
  const rootDir = await createTempDir(t)
  const cwd = await createTempDir(t)
  const executablePath = await createExecutableFile(
    t,
    'codex-soak-history.cjs',
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
      "  fs.writeFileSync(outputPath, JSON.stringify({ taskStatus: 'completed', completedTaskId: taskId, completedStatus: 'resolved' }))",
      '})',
      'process.stdin.resume()',
    ].join('\n'),
  )

  const first = await runCodexRepeatedSoak({
    rootDir,
    cwd,
    teamName: 'alpha',
    runLabel: 'rc-a',
    iterations: 1,
    codexExecutablePath: executablePath,
  })
  const second = await runCodexRepeatedSoak({
    rootDir,
    cwd,
    teamName: 'beta',
    runLabel: 'rc-b',
    iterations: 1,
    codexExecutablePath: executablePath,
  })

  assert.equal(first.success, true)
  assert.equal(second.success, true)
  assert.equal(first.historyManifestPath, second.historyManifestPath)

  const history = JSON.parse(
    await readFile(second.historyManifestPath!, 'utf8'),
  ) as {
    latestSummaryPath: string
    runs: Array<{
      runLabel?: string
      teamName: string
      summaryPath: string
    }>
  }

  assert.equal(history.latestSummaryPath, second.summaryArtifactPath)
  assert.equal(history.runs.length, 2)
  assert.equal(history.runs[0]?.runLabel, 'rc-b')
  assert.equal(history.runs[0]?.teamName, 'beta')
  assert.equal(history.runs[0]?.summaryPath, second.summaryArchivePath)
  assert.equal(history.runs[1]?.runLabel, 'rc-a')
  assert.equal(history.runs[1]?.teamName, 'alpha')
  assert.equal(history.runs[1]?.summaryPath, first.summaryArchivePath)
})

test('resolveCodexRepeatedSoakSummarySelection can load the latest or labeled archived summary from history', async t => {
  const rootDir = await createTempDir(t)
  const historyManifestPath = join(rootDir, 'history.json')
  const summaryAPath = join(rootDir, 'summary-a.json')
  const summaryBPath = join(rootDir, 'summary-b.json')

  const summaryA: CodexRepeatedSoakSummaryArtifact = {
    createdAt: '2026-04-05T12:00:00.000Z',
    success: true,
    teamName: 'alpha',
    agentName: 'researcher',
    runLabel: 'rc-a',
    rootDir,
    artifactDir: rootDir,
    iterationsRequested: 5,
    iterationsCompleted: 5,
    latestAttachOutput: 'Attached to team "alpha"',
    failurePatterns: [],
    verificationSummary: {
      stepsChecked: 15,
      checksRun: 75,
      checksFailed: 0,
      failingChecks: [],
      failurePatternCounts: {},
    },
  }
  const summaryB: CodexRepeatedSoakSummaryArtifact = {
    ...summaryA,
    createdAt: '2026-04-05T12:05:00.000Z',
    teamName: 'beta',
    runLabel: 'rc-b',
  }

  await writeFile(summaryAPath, `${JSON.stringify(summaryA, null, 2)}\n`, 'utf8')
  await writeFile(summaryBPath, `${JSON.stringify(summaryB, null, 2)}\n`, 'utf8')
  await writeFile(
    historyManifestPath,
    `${JSON.stringify(
      {
        updatedAt: summaryB.createdAt,
        artifactDir: rootDir,
        latestSummaryPath: join(rootDir, 'latest-summary.json'),
        runs: [
          {
            createdAt: summaryB.createdAt,
            runLabel: 'rc-b',
            success: true,
            teamName: 'beta',
            agentName: 'researcher',
            iterationsRequested: 5,
            iterationsCompleted: 5,
            summaryPath: summaryBPath,
            failurePatternCodes: [],
            checksFailed: 0,
          },
          {
            createdAt: summaryA.createdAt,
            runLabel: 'rc-a',
            success: true,
            teamName: 'alpha',
            agentName: 'researcher',
            iterationsRequested: 5,
            iterationsCompleted: 5,
            summaryPath: summaryAPath,
            failurePatternCodes: [],
            checksFailed: 0,
          },
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  const latestSelection = await resolveCodexRepeatedSoakSummarySelection({
    historyManifestPath,
  })
  assert.equal(latestSelection.summaryPath, summaryBPath)
  assert.equal(latestSelection.selectedRunLabel, 'rc-b')
  assert.equal(latestSelection.historyRunCount, 2)

  const labeledSelection = await resolveCodexRepeatedSoakSummarySelection({
    historyManifestPath,
    runLabel: 'rc-a',
  })
  assert.equal(labeledSelection.summaryPath, summaryAPath)
  assert.equal(labeledSelection.selectedRunLabel, 'rc-a')
  assert.equal(labeledSelection.summary.teamName, 'alpha')
})

test('analyzeCodexRepeatedSoakStepVerification classifies reopen and transcript failure patterns', () => {
  const verification = analyzeCodexRepeatedSoakStepVerification({
    iteration: 3,
    step: 'reopen',
    commandMessage: 'Reopened researcher without session marker',
    agentName: 'researcher',
    createdTaskIds: ['task-1'],
    expectedCompleted: 1,
    expectedCurrentSessionId: 'session-expected',
    previousReopenCount: 1,
    previousTranscriptEntryCount: 5,
    state: {
      attachOutput: 'Attached to team "alpha"',
      statusOutput: 'researcher [idle]',
      tasksOutput: 'task-1 [completed]',
      transcriptOutput: 'Transcript entries: 2',
      agentStatuses: [
        {
          agentId: 'agent-1',
          name: 'researcher',
          status: 'idle',
          currentTasks: [],
          isActive: false,
        },
      ],
      tasks: [
        {
          id: 'task-1',
          subject: 'demo',
          description: 'demo',
          status: 'completed',
          blocks: [],
          blockedBy: [],
        },
      ],
      sessionRecords: [
        {
          sessionId: 'session-actual',
          agentName: 'researcher',
          cwd: '/tmp/workspace',
          prompt: 'demo',
          status: 'closed',
          createdAt: 1,
          lastOpenedAt: 2,
          reopenedAt: [3],
        },
      ],
      transcriptEntryCount: 2,
    },
    expectedCommandMarker: '(existing-session)',
  })

  assert.equal(verification.passed, false)
  assert.deepEqual(
    verification.failurePatterns.map(pattern => pattern.code),
    [
      'session_transition_mismatch',
      'reopen_count_mismatch',
      'transcript_rollback',
    ],
  )
  assert.equal(
    verification.checks.find(check => check.code === 'session_transition_consistent')
      ?.passed,
    false,
  )
  assert.equal(
    verification.checks.find(check => check.code === 'transcript_progress_monotonic')
      ?.passed,
    false,
  )
})

test('evaluateCodexRepeatedSoakReleaseGate enforces iteration and failure blockers', () => {
  const passingSummary: CodexRepeatedSoakSummaryArtifact = {
    createdAt: new Date().toISOString(),
    success: true,
    teamName: 'alpha',
    agentName: 'researcher',
    rootDir: '/tmp/root',
    artifactDir: '/tmp/root/soak-artifacts',
    iterationsRequested: 5,
    iterationsCompleted: 5,
    latestAttachOutput: 'Attached to team "alpha"',
    latestStatusOutput: 'researcher [idle]',
    latestTasksOutput: 'task-1 [completed]',
    failurePatterns: [],
    verificationSummary: {
      stepsChecked: 15,
      checksRun: 75,
      checksFailed: 0,
      failingChecks: [],
      failurePatternCounts: {},
    },
  }

  const passingEvaluation = evaluateCodexRepeatedSoakReleaseGate(
    passingSummary,
    'runtime',
  )
  assert.equal(passingEvaluation.passed, true)
  assert.equal(passingEvaluation.gate.minIterations, 5)
  assert.equal(passingEvaluation.blockers.length, 0)

  const failingEvaluation = evaluateCodexRepeatedSoakReleaseGate(
    {
      ...passingSummary,
      success: false,
      iterationsRequested: 10,
      iterationsCompleted: 3,
      failureMessage: 'Expected 2 completed tracked tasks',
      failureSnapshotPath: '/tmp/root/soak-artifacts/failure-1.json',
      failurePatterns: [
        {
          code: 'task_completion_mismatch',
          message: 'Expected 2 completed tracked tasks',
          step: 'resume',
          iteration: 1,
        },
      ],
      verificationSummary: {
        ...passingSummary.verificationSummary,
        checksFailed: 1,
        failingChecks: [
          {
            iteration: 1,
            step: 'resume',
            code: 'tracked_tasks_settled',
            message: 'Expected 2 completed tracked tasks',
          },
        ],
        failurePatternCounts: {
          task_completion_mismatch: 1,
        },
      },
    },
    'bridge',
  )

  assert.equal(failingEvaluation.passed, false)
  assert.deepEqual(
    failingEvaluation.blockers.map(blocker => blocker.code),
    [
      'insufficient_iterations',
      'run_failed',
      'checks_failed',
      'failure_patterns_detected',
      'failure_snapshot_present',
    ],
  )
})

test('check-codex-repeated-soak script exits non-zero when a release gate is not satisfied', async t => {
  const rootDir = await createTempDir(t)
  const summaryPath = join(rootDir, 'latest-summary.json')

  const summary: CodexRepeatedSoakSummaryArtifact = {
    createdAt: new Date().toISOString(),
    success: true,
    teamName: 'alpha',
    agentName: 'researcher',
    rootDir,
    artifactDir: join(rootDir, 'soak-artifacts'),
    iterationsRequested: 3,
    iterationsCompleted: 3,
    latestAttachOutput: 'Attached to team "alpha"',
    latestStatusOutput: 'researcher [idle]',
    latestTasksOutput: 'task-1 [completed]',
    failurePatterns: [],
    verificationSummary: {
      stepsChecked: 9,
      checksRun: 45,
      checksFailed: 0,
      failingChecks: [],
      failurePatternCounts: {},
    },
  }

  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')

  const result = spawnSync(
    'node',
    ['scripts/check-codex-repeated-soak.mjs', '--summary', summaryPath, '--gate', 'runtime'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  )

  assert.equal(result.status, 1)
  assert.match(result.stdout, /Codex repeated soak gate: FAILED/)
  assert.match(result.stdout, /insufficient_iterations/)
})

test('check-codex-repeated-soak script can evaluate a labeled run from history manifest', async t => {
  const rootDir = await createTempDir(t)
  const historyManifestPath = join(rootDir, 'history.json')
  const summaryAPath = join(rootDir, 'summary-a.json')
  const summaryBPath = join(rootDir, 'summary-b.json')

  const summaryA: CodexRepeatedSoakSummaryArtifact = {
    createdAt: '2026-04-05T12:00:00.000Z',
    success: true,
    teamName: 'alpha',
    agentName: 'researcher',
    runLabel: 'rc-a',
    rootDir,
    artifactDir: join(rootDir, 'soak-artifacts'),
    iterationsRequested: 3,
    iterationsCompleted: 3,
    failurePatterns: [],
    verificationSummary: {
      stepsChecked: 9,
      checksRun: 45,
      checksFailed: 0,
      failingChecks: [],
      failurePatternCounts: {},
    },
  }
  const summaryB: CodexRepeatedSoakSummaryArtifact = {
    ...summaryA,
    createdAt: '2026-04-05T12:10:00.000Z',
    runLabel: 'rc-b',
    teamName: 'beta',
    iterationsRequested: 5,
    iterationsCompleted: 5,
  }

  await writeFile(summaryAPath, `${JSON.stringify(summaryA, null, 2)}\n`, 'utf8')
  await writeFile(summaryBPath, `${JSON.stringify(summaryB, null, 2)}\n`, 'utf8')
  await writeFile(
    historyManifestPath,
    `${JSON.stringify(
      {
        updatedAt: summaryB.createdAt,
        artifactDir: join(rootDir, 'soak-artifacts'),
        latestSummaryPath: join(rootDir, 'soak-artifacts', 'latest-summary.json'),
        runs: [
          {
            createdAt: summaryB.createdAt,
            runLabel: 'rc-b',
            success: true,
            teamName: 'beta',
            agentName: 'researcher',
            iterationsRequested: 5,
            iterationsCompleted: 5,
            summaryPath: summaryBPath,
            failurePatternCodes: [],
            checksFailed: 0,
          },
          {
            createdAt: summaryA.createdAt,
            runLabel: 'rc-a',
            success: true,
            teamName: 'alpha',
            agentName: 'researcher',
            iterationsRequested: 3,
            iterationsCompleted: 3,
            summaryPath: summaryAPath,
            failurePatternCodes: [],
            checksFailed: 0,
          },
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  const result = spawnSync(
    'node',
    [
      'scripts/check-codex-repeated-soak.mjs',
      '--history',
      historyManifestPath,
      '--run-label',
      'rc-a',
      '--gate',
      'permission',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  )

  assert.equal(result.status, 0)
  assert.match(result.stdout, /Codex repeated soak gate: PASSED/)
  assert.match(result.stdout, /label=rc-a/)
  assert.match(result.stdout, /history_runs=2/)
  assert.match(result.stdout, new RegExp(`summary=${summaryAPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
})

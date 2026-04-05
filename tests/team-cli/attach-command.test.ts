import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import {
  createIdleNotification,
  createTask,
  createTeam,
  getWorkerStderrLogPath,
  getWorkerStdoutLogPath,
  updateTask,
  upsertTeamMember,
  writeToMailbox,
} from '../../src/team-core/index.js'
import { getTaskListIdForTeam } from '../../src/team-core/paths.js'
import { runAttachCommand } from '../../src/team-cli/commands/attach.js'
import { runCli } from '../../src/team-cli/run-cli.js'
import { createTempDir, createTempOptions } from '../test-helpers.js'

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

test('runAttachCommand summarizes team status, recent activity, and generated files', async t => {
  const options = await createTempOptions(t)
  const workspace = await createTempDir(t)

  await createTeam(
    {
      teamName: 'shopping mall demo',
      leadAgentId: 'team-lead@shopping mall demo',
      description: '쇼핑몰 만들어줘',
      leadMember: {
        name: 'team-lead',
        agentType: 'team-lead',
        cwd: workspace,
        subscriptions: [],
      },
    },
    options,
  )

  await upsertTeamMember(
    'shopping mall demo',
    {
      agentId: 'planner@shopping mall demo',
      name: 'planner',
      agentType: 'planner',
      cwd: workspace,
      subscriptions: [],
      joinedAt: Date.now(),
      backendType: 'in-process',
      isActive: false,
      runtimeState: {
        runtimeKind: 'codex-cli',
      },
    },
    options,
  )

  const frontendStdoutLogPath = getWorkerStdoutLogPath(
    'shopping mall demo',
    'frontend',
    options,
  )
  const frontendStderrLogPath = getWorkerStderrLogPath(
    'shopping mall demo',
    'frontend',
    options,
  )
  await mkdir(dirname(frontendStdoutLogPath), { recursive: true })

  await writeFile(
    frontendStdoutLogPath,
    'frontend booted\nwaiting on backend contract\n',
    'utf8',
  )
  await writeFile(
    frontendStderrLogPath,
    'contract mismatch\nmissing backend contract\n',
    'utf8',
  )

  await upsertTeamMember(
    'shopping mall demo',
    {
      agentId: 'frontend@shopping mall demo',
      name: 'frontend',
      agentType: 'frontend',
      cwd: workspace,
      subscriptions: [],
      joinedAt: Date.now(),
      backendType: 'in-process',
      isActive: true,
      runtimeState: {
        runtimeKind: 'codex-cli',
        processId: process.pid,
        launchMode: 'detached',
        launchCommand: 'spawn',
        lifecycle: 'bounded',
        startedAt: Date.now() - 30_000,
        currentWorkKind: 'task',
        currentTaskId: '2',
        turnStartedAt: Date.now() - 4_000,
        lastHeartbeatAt: Date.now() - 1_000,
      },
    },
    options,
  )

  const taskListId = getTaskListIdForTeam('shopping mall demo')
  const task1 = await createTask(
    taskListId,
    {
      subject: 'Plan the product implementation',
      description: 'Create plan docs',
      status: 'pending',
      owner: 'planner@shopping mall demo',
      blocks: [],
      blockedBy: [],
    },
    options,
  )
  await updateTask(
    taskListId,
    task1.id,
    { status: 'completed' },
    options,
  )

  const task2 = await createTask(
    taskListId,
    {
      subject: 'Implement the frontend application',
      description: 'Create UI',
      status: 'pending',
      owner: 'frontend@shopping mall demo',
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  await mkdir(join(workspace, 'docs'), { recursive: true })
  await writeFile(join(workspace, 'docs', 'plan.md'), '# Plan\n', 'utf8')
  await writeFile(join(workspace, 'docs', 'architecture.md'), '# Architecture\n', 'utf8')
  await writeFile(join(workspace, 'docs', 'research.md'), '# Research\n', 'utf8')
  await mkdir(join(workspace, 'frontend'), { recursive: true })
  await writeFile(join(workspace, 'frontend', 'README.md'), '# Frontend\n', 'utf8')
  await writeFile(join(workspace, 'frontend', 'package.json'), '{}\n', 'utf8')
  await mkdir(join(workspace, 'backend'), { recursive: true })
  await writeFile(join(workspace, 'backend', 'README.md'), '# Backend\n', 'utf8')
  await writeFile(join(workspace, 'package.json'), '{}\n', 'utf8')

  await writeToMailbox(
    'shopping mall demo',
    'team-lead',
    {
      from: 'planner',
      text: JSON.stringify(
        createIdleNotification('planner', {
          summary: 'planned architecture and milestones',
          completedTaskId: task1.id,
          completedStatus: 'resolved',
        }),
      ),
      timestamp: new Date().toISOString(),
      summary: 'planner completed task',
    },
    options,
  )

  await writeToMailbox(
    'shopping mall demo',
    'team-lead',
    {
      from: 'frontend',
      text: JSON.stringify(
        createIdleNotification('frontend', {
          idleReason: 'failed',
          summary: 'frontend blocked',
          failureReason: 'missing backend contract',
        }),
      ),
      timestamp: new Date().toISOString(),
      summary: 'frontend failed',
    },
    options,
  )

  const result = await runAttachCommand('shopping mall demo', options)

  assert.equal(result.success, true)
  assert.match(result.message, /Attached to team "shopping mall demo"/)
  assert.match(result.message, /goal=쇼핑몰 만들어줘/)
  assert.match(result.message, new RegExp(`workspace=${workspace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  assert.match(result.message, /result=running/)
  assert.match(result.message, /tasks: total=2 pending=0 in_progress=1 completed=1/)
  assert.match(result.message, /live: executing=1 settling=0 stale=0/)
  assert.match(result.message, /- planner \[idle\] active=no runtime=codex-cli worker=attached launch=spawn lifecycle=n\/a pid=n\/a started=n\/a state=idle/)
  assert.match(
    result.message,
    new RegExp(`- frontend \\[busy\\] active=yes runtime=codex-cli worker=detached launch=spawn lifecycle=bounded pid=${process.pid} stdout_log=.*frontend\\.stdout\\.log stderr_log=.*frontend\\.stderr\\.log started=.* state=executing-turn work=task#${task2.id} turn_age=.*stderr_tail=contract mismatch \\| missing backend contract`),
  )
  assert.match(result.message, /\[planner\] completed task #1: planned architecture and milestones/)
  assert.match(result.message, /\[frontend\] failed: missing backend contract/)
  assert.match(result.message, /generated files:/)
  assert.match(result.message, /- summary: total=7 docs=3 frontend=2 backend=1 other=1/)
  assert.match(result.message, /- docs\/plan\.md/)
  assert.match(result.message, /- docs\/architecture\.md/)
  assert.match(result.message, /- docs\/research\.md/)
  assert.match(result.message, /- frontend\/README\.md/)
  assert.match(result.message, /- frontend\/package\.json/)
  assert.match(result.message, /- backend\/README\.md/)
  assert.match(result.message, /- \+1 more files/)
  assert.match(result.message, /preview: docs\/plan\.md/)
  assert.match(result.message, /preview_selection=priority/)
  assert.match(result.message, /preview_headline=Plan/)
  assert.match(result.message, /preview_excerpt=Plan/)
  assert.match(result.message, /next commands:/)
  assert.match(result.message, /agent-team --root-dir/)
  assert.match(result.message, /attach "shopping mall demo"/)
})

test('runAttachCommand surfaces truncated generated file summaries and preview metadata for large outputs', async t => {
  const options = await createTempOptions(t)
  const workspace = await createTempDir(t)
  const teamName = 'large-preview-team'

  await createTeam(
    {
      teamName,
      leadAgentId: `team-lead@${teamName}`,
      description: 'large output preview polish',
      leadMember: {
        name: 'team-lead',
        agentType: 'team-lead',
        cwd: workspace,
        subscriptions: [],
      },
    },
    options,
  )

  await mkdir(join(workspace, 'docs'), { recursive: true })
  await writeFile(
    join(
      workspace,
      'docs',
      'final-summary.md',
    ),
    `# Final Summary\n\n${Array.from({ length: 18 }, (_, index) => `Ready for release line ${index + 1}.`).join('\n')}\n`,
    'utf8',
  )

  for (let index = 0; index < 29; index += 1) {
    await writeFile(
      join(workspace, 'docs', `zz-file-${String(index).padStart(2, '0')}.md`),
      `# File ${index}\n`,
      'utf8',
    )
  }

  const result = await runAttachCommand(teamName, options)

  assert.equal(result.success, true)
  assert.match(result.message, /generated files:/)
  assert.match(result.message, /- summary: total>=24 docs=24 frontend=0 backend=0 other=0/)
  assert.match(result.message, /- showing first 24 discovered files/)
  assert.match(result.message, /- \+18 more discovered files not shown/)
  assert.match(result.message, /preview: docs\/final-summary\.md/)
  assert.match(result.message, /preview_selection=priority/)
  assert.match(result.message, /preview_headline=Final Summary/)
  assert.match(result.message, /preview_excerpt=Ready for release line 1\./)
  assert.match(result.message, /preview_scan=showing first 24 discovered files/)
  assert.match(result.message, /preview_trimmed=8 more line\(s\) hidden/)
})

test('runAttachCommand without a team lists available teams', async t => {
  const options = await createTempOptions(t)

  await createTeam(
    {
      teamName: 'alpha team',
      leadAgentId: 'team-lead@alpha team',
      leadMember: {
        name: 'team-lead',
        agentType: 'team-lead',
        cwd: '/tmp/project',
        subscriptions: [],
      },
    },
    options,
  )

  const result = await runAttachCommand(undefined, options)

  assert.equal(result.success, true)
  assert.match(result.message, /Available teams:/)
  assert.match(result.message, /- alpha team/)
  assert.match(result.message, /agent-team --root-dir/)
  assert.match(result.message, /attach <team-name>/)
})

test('runCli dispatches attach command and prints the summary', async t => {
  const options = await createTempOptions(t)

  await createTeam(
    {
      teamName: 'alpha team',
      leadAgentId: 'team-lead@alpha team',
      description: '쇼핑몰 만들어줘',
      leadMember: {
        name: 'team-lead',
        agentType: 'team-lead',
        cwd: '/tmp/project',
        subscriptions: [],
      },
    },
    options,
  )

  const output = await withCapturedConsole(() =>
    runCli(['--root-dir', options.rootDir!, 'attach', 'alpha team']),
  )

  assert.equal(output.exitCode, 0)
  assert.equal(output.errors.length, 0)
  assert.match(output.logs.join('\n'), /Attached to team "alpha team"/)
})

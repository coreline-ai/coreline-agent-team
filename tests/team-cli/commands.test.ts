import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createTask,
  createTeam,
  getTask,
  isPlanApprovalResponse,
  getWorkerStderrLogPath,
  isShutdownRequest,
  readMailbox,
  upsertTeamMember,
} from '../../src/team-core/index.js'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getTaskListIdForTeam } from '../../src/team-core/paths.js'
import { runApprovePlanCommand } from '../../src/team-cli/commands/approve-plan.js'
import { runInitCommand } from '../../src/team-cli/commands/init.js'
import { runLogsCommand } from '../../src/team-cli/commands/logs.js'
import { runRejectPlanCommand } from '../../src/team-cli/commands/reject-plan.js'
import { runSendCommand } from '../../src/team-cli/commands/send.js'
import { runShutdownCommand } from '../../src/team-cli/commands/shutdown.js'
import { runSpawnCommand } from '../../src/team-cli/commands/spawn.js'
import { runStatusCommand } from '../../src/team-cli/commands/status.js'
import { runTaskCreateCommand } from '../../src/team-cli/commands/task-create.js'
import { runTaskUpdateCommand } from '../../src/team-cli/commands/task-update.js'
import { runTasksCommand } from '../../src/team-cli/commands/tasks.js'
import { runCli } from '../../src/team-cli/run-cli.js'
import { createTempOptions } from '../test-helpers.js'

test('CLI commands provide a basic headless workflow', async t => {
  const options = await createTempOptions(t)

  const init = await runInitCommand('alpha team', options)
  assert.match(init.message, /Created team "alpha team"/)

  await createTask(
    getTaskListIdForTeam('alpha team'),
    {
      subject: 'Investigate issue',
      description: 'Look into the failing build',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  const tasks = await runTasksCommand('alpha team', options)
  assert.match(tasks.message, /#1 \[pending\] Investigate issue/)

  const send = await runSendCommand(
    'alpha team',
    'researcher',
    'Please take a look',
    options,
  )
  assert.match(send.message, /Message sent/)
  assert.equal((await readMailbox('alpha team', 'researcher', options)).length, 1)
})

test('CLI commands cover task, status, shutdown, and plan approval flows', async t => {
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
  await upsertTeamMember(
    'alpha team',
    {
      agentId: 'researcher@alpha team',
      name: 'researcher',
      agentType: 'researcher',
      cwd: '/tmp/project',
      subscriptions: [],
      joinedAt: Date.now(),
      backendType: 'in-process',
    },
    options,
  )

  const created = await runTaskCreateCommand(
    'alpha team',
    'Investigate',
    'Review the failing build',
    options,
  )
  assert.match(created.message, /Created task #1/)

  const updated = await runTaskUpdateCommand(
    'alpha team',
    '1',
    'in_progress',
    'researcher@alpha team',
    options,
  )
  assert.match(updated.message, /Updated task #1 to in_progress/)

  const status = await runStatusCommand('alpha team', options)
  assert.match(status.message, /researcher \[busy\]/)

  const shutdown = await runShutdownCommand(
    'alpha team',
    'researcher',
    'work complete',
    options,
  )
  assert.match(shutdown.message, /Shutdown request sent/)
  const shutdownMailbox = await readMailbox('alpha team', 'researcher', options)
  assert.equal(
    isShutdownRequest(shutdownMailbox.at(-1)?.text ?? '')?.type,
    'shutdown_request',
  )

  const approved = await runApprovePlanCommand(
    'alpha team',
    'researcher',
    'plan-1',
    options,
  )
  assert.match(approved.message, /Plan approved/)

  const rejected = await runRejectPlanCommand(
    'alpha team',
    'researcher',
    'plan-2',
    'Need more detail',
    options,
  )
  assert.match(rejected.message, /Plan rejected/)

  const planMailbox = await readMailbox('alpha team', 'researcher', options)
  const parsedPlanMessages = planMailbox
    .map(message => isPlanApprovalResponse(message.text))
    .filter(message => message !== null)
  assert.equal(parsedPlanMessages.length, 2)
  assert.equal(parsedPlanMessages[0]?.approved, true)
  assert.equal(parsedPlanMessages[1]?.approved, false)
})

test('task creation and listing surface file-collision guardrail warnings', async t => {
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

  const firstTask = await runTaskCreateCommand(
    'alpha team',
    'Implement app shell',
    'Touch frontend/ and backend/ in one task.',
    options,
  )
  assert.match(firstTask.message, /Guardrails:/)
  assert.match(firstTask.message, /split it into narrower tasks/i)

  const secondTask = await runTaskCreateCommand(
    'alpha team',
    'Refine frontend shell',
    'Also update frontend/ while another task is active.',
    options,
  )

  const tasks = await runTasksCommand('alpha team', options)
  assert.match(secondTask.message, /Guardrails:/)
  assert.match(tasks.message, /scoped=frontend\/\*\*, backend\/\*\*/)
  assert.match(tasks.message, /Guardrails:/)
})

test('send command warns when the same leader message fans out broadly', async t => {
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

  for (const agentName of ['a', 'b', 'c', 'd']) {
    await upsertTeamMember(
      'alpha team',
      {
        agentId: `${agentName}@alpha team`,
        name: agentName,
        agentType: agentName,
        cwd: '/tmp/project',
        subscriptions: [],
        joinedAt: Date.now(),
        backendType: 'in-process',
      },
      options,
    )
  }

  await runSendCommand('alpha team', 'a', 'broadcast:phase-1', options)
  await runSendCommand('alpha team', 'b', 'broadcast:phase-1', options)
  await runSendCommand('alpha team', 'c', 'broadcast:phase-1', options)
  const result = await runSendCommand(
    'alpha team',
    'd',
    'broadcast:phase-1',
    options,
  )

  assert.match(result.message, /Message sent to d/)
  assert.match(result.message, /Cost: Recent leader message fan-out reached 4 recipients/)
})

test('logs command renders a bounded read-only stderr surface', async t => {
  const options = await createTempOptions(t)
  const cwd = '/tmp/project'

  await createTeam(
    {
      teamName: 'alpha team',
      leadAgentId: 'team-lead@alpha team',
      leadMember: {
        name: 'team-lead',
        agentType: 'team-lead',
        cwd,
        subscriptions: [],
      },
    },
    options,
  )

  await upsertTeamMember(
    'alpha team',
    {
      agentId: 'researcher@alpha team',
      name: 'researcher',
      agentType: 'researcher',
      cwd,
      subscriptions: [],
      joinedAt: Date.now(),
      backendType: 'in-process',
      isActive: false,
      runtimeState: {
        runtimeKind: 'codex-cli',
        processId: 777,
        launchMode: 'detached',
        launchCommand: 'spawn',
        lifecycle: 'bounded',
        prompt: 'Inspect stderr',
        cwd,
      },
    },
    options,
  )

  const stderrLogPath = getWorkerStderrLogPath('alpha team', 'researcher', options)
  await mkdir(dirname(stderrLogPath), { recursive: true })
  await writeFile(
    stderrLogPath,
    ['line-1', 'line-2', 'line-3', 'line-4'].join('\n'),
    'utf8',
  )

  const logs = await runLogsCommand(
    'alpha team',
    'researcher',
    {
      stream: 'stderr',
      lines: 2,
      bytes: 20,
    },
    options,
  )

  assert.equal(logs.success, true)
  assert.match(logs.message, /Logs: team=alpha team agent=researcher stream=stderr/)
  assert.match(logs.message, /- stderr: path=.*researcher\.stderr\.log state=ok/)
  assert.match(logs.message, /truncated=yes/)
  assert.match(logs.message, /  line-3/)
  assert.match(logs.message, /  line-4/)
  assert.doesNotMatch(logs.message, /  line-1/)
})

test('spawn command runs a one-shot in-process worker loop', async t => {
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

  await createTask(
    getTaskListIdForTeam('alpha team'),
    {
      subject: 'Investigate issue',
      description: 'Review the failing build',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  const spawned = await runSpawnCommand(
    'alpha team',
    'researcher',
    {
      prompt: 'Investigate the failure',
      maxIterations: 1,
    },
    options,
  )

  assert.match(spawned.message, /Spawned researcher/)

  const task = await getTask(getTaskListIdForTeam('alpha team'), '1', options)
  assert.equal(task?.status, 'completed')
  assert.equal(task?.owner, 'researcher@alpha team')
})

test('status after a one-shot local worker does not report an inactive teammate as busy', async t => {
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

  await createTask(
    getTaskListIdForTeam('alpha team'),
    {
      subject: 'Investigate issue',
      description: 'Review the failing build',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  await runSpawnCommand(
    'alpha team',
    'researcher',
    {
      prompt: 'Investigate the failure',
      maxIterations: 1,
    },
    options,
  )

  const status = await runStatusCommand('alpha team', options)
  assert.match(status.message, /researcher \[idle\]/)
  assert.match(status.message, /active=no/)
  assert.doesNotMatch(status.message, /researcher \[busy\]/)
})

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

test('runCli supports global --root-dir across commands', async t => {
  const options = await createTempOptions(t)
  const rootDir = options.rootDir ?? '/tmp/agent-team'

  const init = await withCapturedConsole(() =>
    runCli(['--root-dir', rootDir, 'init', 'cli root team']),
  )
  assert.equal(init.exitCode, 0)
  assert.match(init.logs.join('\n'), /Created team "cli root team"/)

  const status = await withCapturedConsole(() =>
    runCli(['status', 'cli root team', '--root-dir', rootDir]),
  )
  assert.equal(status.exitCode, 0)
  assert.match(status.logs.join('\n'), /Team: cli root team/)
})

test('runCli preserves help output and unknown-command handling after dispatch refactor', async () => {
  const help = await withCapturedConsole(() => runCli(['help']))
  assert.equal(help.exitCode, 0)
  assert.match(help.logs.join('\n'), /^Usage:/)
  assert.match(help.logs.join('\n'), /approve-permission/)

  const unknown = await withCapturedConsole(() => runCli(['not-a-command']))
  assert.equal(unknown.exitCode, 1)
  assert.match(unknown.errors.join('\n'), /Unknown command: not-a-command/)
})

test('runCli rejects unsupported runtime kinds that are outside the active surface', async () => {
  const result = await withCapturedConsole(() =>
    runCli([
      'spawn',
      'alpha team',
      'researcher',
      '--prompt',
      'Handle the task list',
      '--runtime',
      'command',
    ]),
  )

  assert.equal(result.exitCode, 1)
  assert.match(result.errors.join('\n'), /Invalid value for --runtime: command/)
})

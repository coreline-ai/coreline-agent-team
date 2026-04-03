import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import {
  getDefaultWorkspacePath,
  listTasks,
  readMailbox,
  readTeamFile,
} from '../../src/team-core/index.js'
import { getTaskListIdForTeam } from '../../src/team-core/paths.js'
import { runRunCommand } from '../../src/team-cli/commands/run.js'
import { createTempDir, createTempOptions } from '../test-helpers.js'

test('run command bootstraps a software-factory team, workspace, tasks, and background launches', async t => {
  const options = await createTempOptions(t)
  const workspace = await createTempDir(t)
  const launchedArgs: string[][] = []

  const result = await runRunCommand(
    {
      goal: '쇼핑몰 만들어줘',
      teamName: 'shopping-mall-demo',
      workspace,
      runtimeKind: 'codex-cli',
      model: 'gpt-5.4-mini',
      codexArgs: ['--profile', 'dev'],
      maxIterations: 12,
      pollIntervalMs: 150,
    },
    options,
    {
      now: () => 1_775_171_101,
      async launchBackgroundAgentTeamCommand(cliArgs) {
        launchedArgs.push(cliArgs)
        return {
          success: true,
          pid: launchedArgs.length,
          command: 'node',
          args: cliArgs,
        }
      },
    },
  )

  assert.equal(result.success, true)
  assert.match(result.message, /Started software-factory team "shopping-mall-demo"/)
  assert.match(result.message, /workspace=/)
  assert.match(result.message, /launched=5/)
  assert.match(result.message, /Attach:/)
  assert.match(result.message, /Watch:/)
  assert.match(result.message, /TUI:/)
  assert.match(result.message, /agent-team --root-dir/)
  assert.doesNotMatch(result.message, /dist\/src\/team-cli\/bin\.js/)

  const teamFile = await readTeamFile('shopping-mall-demo', options)
  assert.equal(teamFile?.description, '쇼핑몰 만들어줘')
  assert.equal(teamFile?.leadAgentId, 'team-lead@shopping-mall-demo')

  const goalFile = await readFile(join(workspace, 'docs', 'goal.md'), 'utf8')
  assert.match(goalFile, /쇼핑몰 만들어줘/)
  assert.match(goalFile, /software-factory/)

  const runMetadata = JSON.parse(
    await readFile(join(workspace, '.agent-team', 'run.json'), 'utf8'),
  ) as {
    goal: string
    teamName: string
    preset: string
    runtimeKind: string
    workspacePath: string
  }
  assert.equal(runMetadata.goal, '쇼핑몰 만들어줘')
  assert.equal(runMetadata.teamName, 'shopping-mall-demo')
  assert.equal(runMetadata.preset, 'software-factory')
  assert.equal(runMetadata.runtimeKind, 'codex-cli')
  assert.equal(runMetadata.workspacePath, workspace)

  const tasks = await listTasks(getTaskListIdForTeam('shopping-mall-demo'), options)
  assert.equal(tasks.length, 5)
  assert.deepEqual(
    tasks.map(task => task.owner),
    [
      'planner@shopping-mall-demo',
      'search@shopping-mall-demo',
      'frontend@shopping-mall-demo',
      'backend@shopping-mall-demo',
      'reviewer@shopping-mall-demo',
    ],
  )
  assert.deepEqual(tasks[4]?.blockedBy, ['1', '2', '3', '4'])

  for (const agent of ['planner', 'search', 'frontend', 'backend', 'reviewer']) {
    const mailbox = await readMailbox('shopping-mall-demo', agent, options)
    assert.equal(mailbox.length, 1)
    assert.match(mailbox[0]?.text ?? '', /Goal:/)
  }

  assert.equal(launchedArgs.length, 5)
  assert.deepEqual(
    launchedArgs.map(args => args[args.indexOf('spawn') + 2]),
    ['planner', 'search', 'frontend', 'backend', 'reviewer'],
  )
  for (const args of launchedArgs) {
    assert.ok(args.includes('spawn'))
    assert.ok(args.includes('--runtime'))
    assert.ok(args.includes('codex-cli'))
    assert.ok(args.includes('--model'))
    assert.ok(args.includes('gpt-5.4-mini'))
    assert.ok(args.includes('--cwd'))
    assert.ok(args.includes(workspace))
    assert.ok(args.includes('--max-iterations'))
    assert.ok(args.includes('12'))
    assert.ok(args.includes('--poll-interval'))
    assert.ok(args.includes('150'))
    assert.ok(args.includes('--codex-arg'))
    assert.ok(args.includes('--full-auto'))
    assert.ok(args.includes('--profile'))
    assert.ok(args.includes('dev'))
  }
})

test('run command defaults workspace under root-dir workspaces when none is provided', async t => {
  const options = await createTempOptions(t)
  const launchedArgs: string[][] = []

  const result = await runRunCommand(
    {
      goal: '기본 경로 테스트',
      teamName: 'default-workspace-team',
      runtimeKind: 'codex-cli',
      model: 'gpt-5.4-mini',
    },
    options,
    {
      now: () => 1_775_171_102,
      async launchBackgroundAgentTeamCommand(cliArgs) {
        launchedArgs.push(cliArgs)
        return {
          success: true,
          pid: launchedArgs.length,
          command: 'node',
          args: cliArgs,
        }
      },
    },
  )

  assert.equal(result.success, true)

  const expectedWorkspace = getDefaultWorkspacePath(
    'default-workspace-team',
    options,
  )
  const goalFile = await readFile(join(expectedWorkspace, 'docs', 'goal.md'), 'utf8')
  assert.match(goalFile, /기본 경로 테스트/)

  const runMetadata = JSON.parse(
    await readFile(join(expectedWorkspace, '.agent-team', 'run.json'), 'utf8'),
  ) as {
    workspacePath: string
  }
  assert.equal(runMetadata.workspacePath, expectedWorkspace)
  assert.match(result.message, /workspace=/)

  for (const args of launchedArgs) {
    assert.ok(args.includes('--cwd'))
    assert.ok(args.includes(expectedWorkspace))
  }
})

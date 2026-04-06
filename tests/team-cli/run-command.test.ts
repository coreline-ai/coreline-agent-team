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
import {
  analyzeGoalForRoles,
  parseRolesString,
} from '../../src/team-cli/presets/index.js'
import { createTempDir, createTempOptions } from '../test-helpers.js'

test('run command bootstraps a software-factory team with explicit roles', async t => {
  const options = await createTempOptions(t)
  const workspace = await createTempDir(t)
  const launchedArgs: string[][] = []

  const result = await runRunCommand(
    {
      goal: '쇼핑몰 만들어줘',
      teamName: 'shopping-mall-demo',
      workspace,
      roles: ['planner', 'search', 'frontend', 'backend', 'reviewer'],
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
      roles: ['planner', 'search', 'frontend', 'backend', 'reviewer'],
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

test('analyzeGoalForRoles selects frontend+backend for web app goals', () => {
  const roles = analyzeGoalForRoles('Build a web dashboard with REST API')
  assert.ok(roles.includes('planner'))
  assert.ok(roles.includes('frontend'))
  assert.ok(roles.includes('backend'))
  assert.ok(roles.includes('reviewer'))
  assert.equal(roles[0], 'planner')
  assert.equal(roles[roles.length - 1], 'reviewer')
})

test('analyzeGoalForRoles selects database role when DB keywords present', () => {
  const roles = analyzeGoalForRoles('Design a PostgreSQL database schema for user management')
  assert.ok(roles.includes('planner'))
  assert.ok(roles.includes('database'))
  assert.ok(roles.includes('reviewer'))
})

test('analyzeGoalForRoles selects mobile role for mobile app goals', () => {
  const roles = analyzeGoalForRoles('Build a React Native mobile app')
  assert.ok(roles.includes('planner'))
  assert.ok(roles.includes('mobile'))
  assert.ok(roles.includes('reviewer'))
})

test('analyzeGoalForRoles selects devops role for deployment goals', () => {
  const roles = analyzeGoalForRoles('Set up Docker and Kubernetes deployment pipeline')
  assert.ok(roles.includes('planner'))
  assert.ok(roles.includes('devops'))
  assert.ok(roles.includes('reviewer'))
})

test('analyzeGoalForRoles selects security role for auth goals', () => {
  const roles = analyzeGoalForRoles('Implement OAuth authentication system')
  assert.ok(roles.includes('planner'))
  assert.ok(roles.includes('security'))
  assert.ok(roles.includes('reviewer'))
})

test('analyzeGoalForRoles selects testing role for QA goals', () => {
  const roles = analyzeGoalForRoles('Write end-to-end tests with Playwright')
  assert.ok(roles.includes('planner'))
  assert.ok(roles.includes('testing'))
  assert.ok(roles.includes('reviewer'))
})

test('analyzeGoalForRoles falls back to search+frontend+backend for generic goals', () => {
  const roles = analyzeGoalForRoles('Make something cool')
  assert.deepEqual(roles, ['planner', 'search', 'frontend', 'backend', 'reviewer'])
})

test('analyzeGoalForRoles selects frontend+backend for full-stack keyword', () => {
  const roles = analyzeGoalForRoles('Full-stack app with PostgreSQL and Docker')
  assert.ok(roles.includes('planner'))
  assert.ok(roles.includes('frontend'))
  assert.ok(roles.includes('backend'))
  assert.ok(roles.includes('database'))
  assert.ok(roles.includes('devops'))
  assert.ok(roles.includes('reviewer'))
  assert.equal(roles.length, 6)
})

test('analyzeGoalForRoles selects multiple roles for complex goals', () => {
  const roles = analyzeGoalForRoles(
    'Build a full-stack web app with React frontend, Express API backend, PostgreSQL database, Docker deployment, and E2E testing',
  )
  assert.ok(roles.includes('planner'))
  assert.ok(roles.includes('frontend'))
  assert.ok(roles.includes('backend'))
  assert.ok(roles.includes('database'))
  assert.ok(roles.includes('devops'))
  assert.ok(roles.includes('testing'))
  assert.ok(roles.includes('reviewer'))
  assert.ok(roles.length >= 7)
})

test('analyzeGoalForRoles handles compound Korean keywords', () => {
  const roles = analyzeGoalForRoles('쇼핑몰 만들어줘')
  assert.ok(roles.includes('frontend'))
  assert.ok(roles.includes('backend'))
  assert.ok(roles.includes('database'))
})

test('analyzeGoalForRoles handles fullstack variant spellings', () => {
  for (const variant of ['fullstack', 'full stack', 'full-stack', '풀스택']) {
    const roles = analyzeGoalForRoles(`Build a ${variant} application`)
    assert.ok(roles.includes('frontend'), `"${variant}" should imply frontend`)
    assert.ok(roles.includes('backend'), `"${variant}" should imply backend`)
  }
})

test('analyzeGoalForRoles handles Korean keywords', () => {
  const roles = analyzeGoalForRoles('프론트엔드 웹 페이지 만들어줘')
  assert.ok(roles.includes('frontend'))
})

test('parseRolesString parses valid comma-separated roles', () => {
  const roles = parseRolesString('frontend,backend,database')
  assert.ok(roles !== null)
  assert.ok(roles.includes('planner'))
  assert.ok(roles.includes('frontend'))
  assert.ok(roles.includes('backend'))
  assert.ok(roles.includes('database'))
  assert.ok(roles.includes('reviewer'))
  assert.equal(roles[0], 'planner')
  assert.equal(roles[roles.length - 1], 'reviewer')
})

test('parseRolesString returns null for invalid roles', () => {
  assert.equal(parseRolesString('frontend,invalid_role'), null)
  assert.equal(parseRolesString(''), null)
})

test('run command with dynamic goal-based roles spawns only matched agents', async t => {
  const options = await createTempOptions(t)
  const workspace = await createTempDir(t)
  const launchedArgs: string[][] = []

  const result = await runRunCommand(
    {
      goal: 'Build a React frontend dashboard',
      teamName: 'frontend-only-team',
      workspace,
      runtimeKind: 'codex-cli',
    },
    options,
    {
      now: () => 1_775_171_103,
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

  const agentNames = launchedArgs.map(args => args[args.indexOf('spawn') + 2])
  assert.ok(agentNames.includes('planner'))
  assert.ok(agentNames.includes('frontend'))
  assert.ok(agentNames.includes('reviewer'))
  // backend should NOT be included since goal only mentions frontend/React
  assert.ok(!agentNames.includes('backend'))
  assert.ok(!agentNames.includes('database'))

  const tasks = await listTasks(getTaskListIdForTeam('frontend-only-team'), options)
  assert.ok(tasks.length < 5, `Expected fewer than 5 agents, got ${tasks.length}`)
})

test('run command with --roles override uses exactly the specified roles', async t => {
  const options = await createTempOptions(t)
  const workspace = await createTempDir(t)
  const launchedArgs: string[][] = []

  const result = await runRunCommand(
    {
      goal: 'Build anything',
      teamName: 'custom-roles-team',
      workspace,
      roles: ['planner', 'database', 'devops', 'reviewer'],
      runtimeKind: 'codex-cli',
    },
    options,
    {
      now: () => 1_775_171_104,
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
  assert.equal(launchedArgs.length, 4)

  const agentNames = launchedArgs.map(args => args[args.indexOf('spawn') + 2])
  assert.deepEqual(agentNames, ['planner', 'database', 'devops', 'reviewer'])

  const tasks = await listTasks(getTaskListIdForTeam('custom-roles-team'), options)
  assert.equal(tasks.length, 4)
  assert.deepEqual(
    tasks.map(task => task.owner),
    [
      'planner@custom-roles-team',
      'database@custom-roles-team',
      'devops@custom-roles-team',
      'reviewer@custom-roles-team',
    ],
  )
})

import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
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
  assert.equal(tasks.length, 12)
  assert.deepEqual(
    tasks.map(task => task.owner),
    [
      'planner@shopping-mall-demo',
      'planner@shopping-mall-demo',
      'planner@shopping-mall-demo',
      'planner@shopping-mall-demo',
      'search@shopping-mall-demo',
      'frontend@shopping-mall-demo',
      'frontend@shopping-mall-demo',
      'frontend@shopping-mall-demo',
      'backend@shopping-mall-demo',
      'backend@shopping-mall-demo',
      'backend@shopping-mall-demo',
      'reviewer@shopping-mall-demo',
    ],
  )
  assert.deepEqual(tasks[1]?.blockedBy, ['1'])
  assert.deepEqual(tasks[2]?.blockedBy, ['2'])
  assert.deepEqual(tasks[3]?.blockedBy, ['3'])
  assert.deepEqual(tasks[4]?.blockedBy, ['4'])
  assert.deepEqual(tasks[5]?.blockedBy, ['4', '5'])
  assert.deepEqual(tasks[6]?.blockedBy, ['4', '6'])
  assert.deepEqual(tasks[7]?.blockedBy, ['4', '7'])
  assert.deepEqual(tasks[8]?.blockedBy, ['4', '8'])
  assert.deepEqual(tasks[9]?.blockedBy, ['4', '9'])
  assert.deepEqual(tasks[10]?.blockedBy, ['4', '10'])
  assert.deepEqual(tasks[11]?.blockedBy, ['4', '1', '2', '3', '5', '6', '7', '8', '9', '10', '11'])

  for (const agent of ['planner', 'search', 'frontend', 'backend', 'reviewer']) {
    const mailbox = await readMailbox('shopping-mall-demo', agent, options)
    assert.equal(mailbox.length, 0)
  }

  assert.equal(launchedArgs.length, 5)
  assert.deepEqual(
    launchedArgs.map(args => args[args.indexOf('spawn') + 2]),
    ['planner', 'search', 'frontend', 'backend', 'reviewer'],
  )
  const launchedArgsByAgent = new Map(
    launchedArgs.map(args => [args[args.indexOf('spawn') + 2]!, args]),
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
    assert.ok(args.includes('--poll-interval'))
    assert.ok(args.includes('150'))
    assert.ok(args.includes('--codex-arg'))
    assert.ok(args.includes('--full-auto'))
    assert.ok(args.includes('--profile'))
    assert.ok(args.includes('dev'))
  }
  assert.equal(
    launchedArgsByAgent
      .get('planner')
      ?.[launchedArgsByAgent.get('planner')!.indexOf('--max-iterations') + 1],
    '12',
  )
  for (const agent of ['search', 'frontend', 'backend', 'reviewer']) {
    const agentArgs = launchedArgsByAgent.get(agent)
    assert.ok(agentArgs)
    const maxIterations = Number(
      agentArgs?.[agentArgs.indexOf('--max-iterations') + 1],
    )
    assert.ok(maxIterations > 12)
  }
})

test('run command creates planner-first decomposed tasks for implementation roles', async t => {
  const options = await createTempOptions(t)
  const workspace = await createTempDir(t)

  const result = await runRunCommand(
    {
      goal: 'Build a chatbot with frontend, backend, and tests',
      teamName: 'planner-first-team',
      workspace,
      roles: ['planner', 'frontend', 'backend', 'testing', 'reviewer'],
      runtimeKind: 'codex-cli',
    },
    options,
    {
      now: () => 1_775_171_111,
      async launchBackgroundAgentTeamCommand() {
        return {
          success: true,
          pid: 1,
          command: 'node',
          args: [],
        }
      },
    },
  )

  assert.equal(result.success, true)

  const tasks = await listTasks(getTaskListIdForTeam('planner-first-team'), options)
  assert.deepEqual(
    tasks.map(task => task.subject),
    [
      'Freeze the implementation contract',
      'Write the implementation plan',
      'Write the architecture notes',
      'Write the task breakdown',
      'Create frontend HTML shell',
      'Create frontend interaction script',
      'Create frontend styles',
      'Create backend route module',
      'Create backend server entry',
      'Document backend API',
      'Write contract tests',
      'Write scenario and persona tests',
      'Document testing strategy',
      'Review and summarize the outputs',
    ],
  )
  assert.deepEqual(tasks[1]?.blockedBy, ['1'])
  assert.deepEqual(tasks[2]?.blockedBy, ['2'])
  assert.deepEqual(tasks[3]?.blockedBy, ['3'])
  assert.deepEqual(tasks[4]?.blockedBy, ['4'])
  assert.deepEqual(tasks[5]?.blockedBy, ['4', '5'])
  assert.deepEqual(tasks[6]?.blockedBy, ['4', '6'])
  assert.deepEqual(tasks[7]?.blockedBy, ['4', '7'])
  assert.deepEqual(tasks[8]?.blockedBy, ['4', '8'])
  assert.deepEqual(tasks[9]?.blockedBy, ['4', '9'])
  assert.deepEqual(tasks[10]?.blockedBy, ['4', '10'])
  assert.deepEqual(tasks[11]?.blockedBy, ['4', '11'])
  assert.deepEqual(tasks[12]?.blockedBy, ['4', '12'])
  assert.deepEqual(tasks[13]?.blockedBy, ['4', '1', '2', '3', '5', '6', '7', '8', '9', '10', '11', '12', '13'])
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

test('run command can target a remote-root transport and pane backend', async t => {
  const localOptions = await createTempOptions(t)
  const remoteRootDir = await createTempDir(t)
  const launchedArgs: string[][] = []

  const result = await runRunCommand(
    {
      goal: 'Build a deterministic chatbot MVP',
      teamName: 'remote-pane-team',
      roles: ['planner', 'reviewer'],
      runtimeKind: 'local',
      backendType: 'pane',
      transportKind: 'remote-root',
      remoteRootDir,
    },
    localOptions,
    {
      now: () => 1_775_171_120,
      async launchBackgroundAgentTeamCommand(cliArgs) {
        launchedArgs.push(cliArgs)
        return {
          success: true,
          pid: launchedArgs.length,
          command: '/usr/bin/script',
          args: cliArgs,
          backendType: 'pane',
          transportKind: 'remote-root',
          paneId: `pty:${launchedArgs.length}`,
        }
      },
    },
  )

  assert.equal(result.success, true)
  assert.match(result.message, /backend=pane/)
  assert.match(result.message, /transport=remote-root/)
  assert.match(result.message, new RegExp(remoteRootDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  const remoteOptions = { rootDir: remoteRootDir }
  const teamFile = await readTeamFile('remote-pane-team', remoteOptions)
  assert.equal(teamFile?.description, 'Build a deterministic chatbot MVP')
  const expectedWorkspace = getDefaultWorkspacePath('remote-pane-team', remoteOptions)
  const goalFile = await readFile(join(expectedWorkspace, 'docs', 'goal.md'), 'utf8')
  assert.match(goalFile, /Build a deterministic chatbot MVP/)
  for (const args of launchedArgs) {
    assert.ok(args.includes('--backend'))
    assert.ok(args.includes('pane'))
    assert.ok(args.includes('--transport'))
    assert.ok(args.includes('remote-root'))
    assert.ok(args.includes('--remote-root-dir'))
    assert.ok(args.includes(remoteRootDir))
    assert.equal(args[1], remoteRootDir)
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
  assert.equal(tasks.length, 8)
  assert.deepEqual(
    tasks.map(task => task.subject),
    [
      'Freeze the implementation contract',
      'Write the implementation plan',
      'Write the architecture notes',
      'Write the task breakdown',
      'Create frontend HTML shell',
      'Create frontend interaction script',
      'Create frontend styles',
      'Review and summarize the outputs',
    ],
  )
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
  assert.equal(tasks.length, 9)
  assert.deepEqual(
    tasks.map(task => task.owner),
    [
      'planner@custom-roles-team',
      'planner@custom-roles-team',
      'planner@custom-roles-team',
      'planner@custom-roles-team',
      'database@custom-roles-team',
      'database@custom-roles-team',
      'devops@custom-roles-team',
      'devops@custom-roles-team',
      'reviewer@custom-roles-team',
    ],
  )
})

test('run command bootstraps implementation-contract from existing metadata files', async t => {
  const options = await createTempOptions(t)
  const workspace = await createTempDir(t)
  await mkdir(join(workspace, 'docs'), { recursive: true })
  await writeFile(
    join(workspace, 'docs', 'chatbot-metadata.md'),
    '# Metadata\\n\\n- endpoint: /api/chat\\n',
    'utf8',
  )

  const result = await runRunCommand(
    {
      goal: 'Build a deterministic chatbot MVP',
      teamName: 'metadata-bootstrap-team',
      workspace,
      roles: ['planner', 'frontend', 'backend', 'testing', 'reviewer'],
      runtimeKind: 'codex-cli',
    },
    options,
    {
      now: () => 1_775_171_105,
      async launchBackgroundAgentTeamCommand() {
        return {
          success: true,
          pid: 1,
          command: 'node',
          args: [],
        }
      },
    },
  )

  assert.equal(result.success, true)

  const implementationContract = await readFile(
    join(workspace, 'docs', 'implementation-contract.md'),
    'utf8',
  )
  const planDoc = await readFile(
    join(workspace, 'docs', 'plan.md'),
    'utf8',
  )
  const architectureDoc = await readFile(
    join(workspace, 'docs', 'architecture.md'),
    'utf8',
  )
  const taskBreakdownDoc = await readFile(
    join(workspace, 'docs', 'task-breakdown.md'),
    'utf8',
  )
  assert.match(implementationContract, /Generated during runtime bootstrap/)
  assert.match(implementationContract, /docs\/chatbot-metadata\.md/)
  assert.match(planDoc, /Generated during runtime bootstrap/)
  assert.match(architectureDoc, /Generated during runtime bootstrap/)
  assert.match(taskBreakdownDoc, /Generated during runtime bootstrap/)

  const tasks = await listTasks(getTaskListIdForTeam('metadata-bootstrap-team'), options)
  assert.equal(tasks[0]?.subject, 'Freeze the implementation contract')
  assert.equal(tasks[0]?.status, 'completed')
  assert.equal(tasks[1]?.status, 'completed')
  assert.equal(tasks[2]?.status, 'completed')
  assert.equal(tasks[3]?.status, 'completed')
  assert.deepEqual(tasks[4]?.blockedBy, ['4'])
})

test('run command honors a prebuilt planner bundle without metadata files', async t => {
  const options = await createTempOptions(t)
  const workspace = await createTempDir(t)
  await mkdir(join(workspace, 'docs'), { recursive: true })
  await writeFile(
    join(workspace, 'docs', 'implementation-contract.md'),
    '# Implementation Contract\\n\\nPrebuilt contract\\n',
    'utf8',
  )
  await writeFile(
    join(workspace, 'docs', 'plan.md'),
    '# Implementation Plan\\n\\nPrebuilt plan\\n',
    'utf8',
  )
  await writeFile(
    join(workspace, 'docs', 'architecture.md'),
    '# Architecture Notes\\n\\nPrebuilt architecture\\n',
    'utf8',
  )
  await writeFile(
    join(workspace, 'docs', 'task-breakdown.md'),
    '# Task Breakdown\\n\\nPrebuilt breakdown\\n',
    'utf8',
  )

  const launchedArgs: string[][] = []
  const result = await runRunCommand(
    {
      goal: 'Build a deterministic chatbot MVP',
      teamName: 'prebuilt-planner-bundle-team',
      workspace,
      roles: ['planner', 'frontend', 'backend', 'testing', 'reviewer'],
      runtimeKind: 'codex-cli',
    },
    options,
    {
      now: () => 1_775_171_107,
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
  assert.match(result.message, /skipped=planner/)

  const tasks = await listTasks(getTaskListIdForTeam('prebuilt-planner-bundle-team'), options)
  for (const task of tasks) {
    assert.equal(task?.status, 'completed')
  }
  assert.equal(launchedArgs.length, 0)
  const frontendIndex = await readFile(
    join(workspace, 'frontend', 'index.html'),
    'utf8',
  )
  const backendRouter = await readFile(
    join(workspace, 'backend', 'router.mjs'),
    'utf8',
  )
  const contractTest = await readFile(
    join(workspace, 'tests', 'contract.test.mjs'),
    'utf8',
  )
  assert.match(frontendIndex, /Deterministic Chatbot MVP|Starter scaffold generated during runtime bootstrap|<main id=\"app\"><\/main>/)
  assert.match(backendRouter, /Starter scaffold generated during runtime bootstrap/)
  assert.ok(
    contractTest.includes('GET /health returns ok contract') ||
      contractTest.includes('Starter scaffold generated during runtime bootstrap'),
  )
  const reviewDoc = await readFile(
    join(workspace, 'docs', 'review.md'),
    'utf8',
  )
  assert.match(reviewDoc, /Final Verdict/)
  assert.match(reviewDoc, /pass-with-notes/)
})

test('run command treats existing planner docs as readiness even without metadata files', async t => {
  const options = await createTempOptions(t)
  const workspace = await createTempDir(t)
  await mkdir(join(workspace, 'docs'), { recursive: true })
  await writeFile(
    join(workspace, 'docs', 'implementation-contract.md'),
    '# Implementation Contract\\n\\nPrebuilt contract\\n',
    'utf8',
  )
  await writeFile(
    join(workspace, 'docs', 'plan.md'),
    '# Implementation Plan\\n\\nPrebuilt plan\\n',
    'utf8',
  )

  const launchedArgs: string[][] = []
  const result = await runRunCommand(
    {
      goal: 'Build a deterministic chatbot MVP',
      teamName: 'partial-planner-bundle-team',
      workspace,
      roles: ['planner', 'reviewer'],
      runtimeKind: 'codex-cli',
      maxIterations: 1,
      pollIntervalMs: 200,
    },
    options,
    {
      now: () => 1_775_171_108,
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
  const tasks = await listTasks(getTaskListIdForTeam('partial-planner-bundle-team'), options)
  assert.equal(tasks[0]?.status, 'completed')
  assert.equal(tasks[1]?.status, 'completed')
  assert.equal(tasks[2]?.status, 'pending')
  assert.equal(tasks[3]?.status, 'pending')

  const plannerArgs = launchedArgs.find(
    args => args[args.indexOf('spawn') + 2] === 'planner',
  )
  assert.ok(plannerArgs)
  const plannerMaxIterations = Number(
    plannerArgs?.[plannerArgs.indexOf('--max-iterations') + 1],
  )
  assert.equal(plannerMaxIterations, 6)
})

test('run command scales staged wait budgets for later implementation roles and reviewer', async t => {
  const options = await createTempOptions(t)
  const workspace = await createTempDir(t)
  await mkdir(join(workspace, 'docs'), { recursive: true })
  await writeFile(
    join(workspace, 'docs', 'implementation-contract.md'),
    '# Implementation Contract\n\nPrebuilt contract\n',
    'utf8',
  )
  await writeFile(
    join(workspace, 'docs', 'plan.md'),
    '# Implementation Plan\n\nPrebuilt plan\n',
    'utf8',
  )
  await writeFile(
    join(workspace, 'docs', 'architecture.md'),
    '# Architecture Notes\n\nPrebuilt architecture\n',
    'utf8',
  )
  await writeFile(
    join(workspace, 'docs', 'task-breakdown.md'),
    '# Task Breakdown\n\nPrebuilt breakdown\n',
    'utf8',
  )

  const launchedArgs: string[][] = []
  const result = await runRunCommand(
    {
      goal: 'Build a full-stack dashboard MVP',
      teamName: 'serial-wait-budget-team',
      workspace,
      roles: ['planner', 'frontend', 'backend', 'testing', 'reviewer'],
      runtimeKind: 'codex-cli',
      maxIterations: 1,
      pollIntervalMs: 200,
    },
    options,
    {
      now: () => 1_775_171_109,
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
  assert.match(result.message, /skipped=planner/)

  const maxIterationsByAgent = new Map(
    launchedArgs.map(args => [
      args[args.indexOf('spawn') + 2],
      Number(args[args.indexOf('--max-iterations') + 1]),
    ]),
  )

  const frontendIterations = maxIterationsByAgent.get('frontend')
  const backendIterations = maxIterationsByAgent.get('backend')
  const testingIterations = maxIterationsByAgent.get('testing')
  const reviewerIterations = maxIterationsByAgent.get('reviewer')

  assert.ok(frontendIterations !== undefined)
  assert.ok(backendIterations !== undefined)
  assert.ok(testingIterations !== undefined)
  assert.ok(reviewerIterations !== undefined)
  assert.ok(frontendIterations! < backendIterations!)
  assert.ok(backendIterations! < testingIterations!)
  assert.ok(testingIterations! < reviewerIterations!)
})

test('run command skips planner launch when metadata bootstrap already satisfies planner readiness', async t => {
  const options = await createTempOptions(t)
  const workspace = await createTempDir(t)
  await mkdir(join(workspace, 'docs'), { recursive: true })
  await writeFile(
    join(workspace, 'docs', 'chatbot-metadata.md'),
    '# Metadata\\n\\n- endpoint: /api/chat\\n',
    'utf8',
  )

  const launchedArgs: string[][] = []
  const result = await runRunCommand(
    {
      goal: 'Build a deterministic chatbot MVP',
      teamName: 'planner-iteration-budget-team',
      workspace,
      roles: ['planner', 'reviewer'],
      runtimeKind: 'codex-cli',
      maxIterations: 1,
      pollIntervalMs: 200,
    },
    options,
    {
      now: () => 1_775_171_106,
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
  assert.match(result.message, /skipped=planner/)
  assert.equal(
    launchedArgs.some(
      args => args[args.indexOf('spawn') + 2] === 'planner',
    ),
    false,
  )
})

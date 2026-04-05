import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createTeam,
  upsertTeamMember,
} from '../../src/team-core/index.js'
import { createOperatorLifecycleActions } from '../../src/team-operator/actions.js'
import { createTempOptions } from '../test-helpers.js'

async function createTeamWithStoredRuntimeMember(
  options: { rootDir?: string },
  input: {
    teamName: string
    agentName: string
    isActive?: boolean
    runtimeKind?: 'local' | 'codex-cli' | 'upstream'
    sessionId?: string
    lastSessionId?: string
    maxIterations?: number
    pollIntervalMs?: number
    omitLoopMetadata?: boolean
  },
): Promise<void> {
  const cwd = options.rootDir ?? '/tmp/project'

  await createTeam(
    {
      teamName: input.teamName,
      leadAgentId: `team-lead@${input.teamName}`,
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
    input.teamName,
    {
      agentId: `${input.agentName}@${input.teamName}`,
      name: input.agentName,
      agentType: input.agentName,
      cwd,
      subscriptions: [],
      joinedAt: Date.now(),
      backendType: 'in-process',
      isActive: input.isActive ?? false,
      runtimeState: {
        runtimeKind: input.runtimeKind ?? 'codex-cli',
        prompt: 'Investigate parser regressions',
        cwd,
        sessionId: input.sessionId,
        lastSessionId: input.lastSessionId,
        ...(!input.omitLoopMetadata
          ? {
              maxIterations: input.maxIterations ?? 23,
              pollIntervalMs: input.pollIntervalMs ?? 650,
            }
          : {}),
      },
    },
    options,
  )
}

test('createOperatorLifecycleActions spawns bounded background workers with the expected runtime message', async () => {
  let capturedArgs: string[] | undefined

  const actions = createOperatorLifecycleActions({
    async launchBackgroundAgentTeamCommand(cliArgs) {
      capturedArgs = cliArgs
      return {
        success: true,
        pid: 4242,
        command: process.execPath,
        args: cliArgs,
      }
    },
  })

  const result = await actions.spawnTeammate({
    teamName: 'alpha-team',
    agentName: 'researcher',
    prompt: 'Help with the parser regression',
    cwd: '/tmp/project',
    runtimeKind: 'codex-cli',
    maxIterations: 12,
    pollIntervalMs: 700,
  })

  assert.equal(result.success, true)
  assert.match(result.message, /Started background worker researcher/)
  assert.match(result.message, /runtime=codex-cli/)
  assert.match(result.message, /lifecycle=bounded/)
  assert.match(result.message, /maxIterations=12/)
  assert.match(result.message, /pollIntervalMs=700/)
  assert.match(result.message, /pid=4242/)
  assert.deepEqual(capturedArgs, [
    'spawn',
    'alpha-team',
    'researcher',
    '--prompt',
    'Help with the parser regression',
    '--cwd',
    '/tmp/project',
    '--max-iterations',
    '12',
    '--poll-interval',
    '700',
    '--runtime',
    'codex-cli',
  ])
})

test('createOperatorLifecycleActions resumes an inactive teammate into a new session', async t => {
  const options = await createTempOptions(t)
  await createTeamWithStoredRuntimeMember(options, {
    teamName: 'alpha-team',
    agentName: 'researcher',
    runtimeKind: 'upstream',
    sessionId: 'session-current',
    lastSessionId: 'session-last',
  })

  let capturedArgs: string[] | undefined
  const actions = createOperatorLifecycleActions({
    async launchBackgroundAgentTeamCommand(cliArgs) {
      capturedArgs = cliArgs
      return {
        success: true,
        pid: 5252,
        command: process.execPath,
        args: cliArgs,
      }
    },
  })

  const result = await actions.resumeTeammate(
    {
      teamName: 'alpha-team',
      agentName: 'researcher',
    },
    options,
  )

  assert.equal(result.success, true)
  assert.match(result.message, /Resumed background worker researcher/)
  assert.match(result.message, /runtime=upstream/)
  assert.match(result.message, /session=new-session/)
  assert.match(result.message, /lifecycle=bounded/)
  assert.match(result.message, /maxIterations=23/)
  assert.match(result.message, /pollIntervalMs=650/)
  assert.match(result.message, /pid=5252/)
  assert.deepEqual(capturedArgs, [
    '--root-dir',
    options.rootDir!,
    'resume',
    'alpha-team',
    'researcher',
    '--max-iterations',
    '23',
    '--poll-interval',
    '650',
  ])
})

test('createOperatorLifecycleActions reopens an inactive teammate into the existing session', async t => {
  const options = await createTempOptions(t)
  await createTeamWithStoredRuntimeMember(options, {
    teamName: 'alpha-team',
    agentName: 'researcher',
    runtimeKind: 'codex-cli',
    sessionId: 'session-current',
  })

  let capturedArgs: string[] | undefined
  const actions = createOperatorLifecycleActions({
    async launchBackgroundAgentTeamCommand(cliArgs) {
      capturedArgs = cliArgs
      return {
        success: true,
        pid: 6262,
        command: process.execPath,
        args: cliArgs,
      }
    },
  })

  const result = await actions.reopenTeammate(
    {
      teamName: 'alpha-team',
      agentName: 'researcher',
    },
    options,
  )

  assert.equal(result.success, true)
  assert.match(result.message, /Reopened background worker researcher/)
  assert.match(result.message, /runtime=codex-cli/)
  assert.match(result.message, /session=existing-session/)
  assert.match(result.message, /lifecycle=bounded/)
  assert.match(result.message, /pid=6262/)
  assert.deepEqual(capturedArgs, [
    '--root-dir',
    options.rootDir!,
    'reopen',
    'alpha-team',
    'researcher',
    '--max-iterations',
    '23',
    '--poll-interval',
    '650',
  ])
})

test('createOperatorLifecycleActions applies injected loop defaults to resume when stored metadata omits them', async t => {
  const options = await createTempOptions(t)
  await createTeamWithStoredRuntimeMember(options, {
    teamName: 'alpha-team',
    agentName: 'researcher',
    runtimeKind: 'local',
    sessionId: 'session-current',
    omitLoopMetadata: true,
  })

  let capturedArgs: string[] | undefined
  const actions = createOperatorLifecycleActions({
    resolveBackgroundLoopOptions() {
      return {
        maxIterations: 3,
        pollIntervalMs: 33,
      }
    },
    async launchBackgroundAgentTeamCommand(cliArgs) {
      capturedArgs = cliArgs
      return {
        success: true,
        command: process.execPath,
        args: cliArgs,
      }
    },
  })

  const result = await actions.resumeTeammate(
    {
      teamName: 'alpha-team',
      agentName: 'researcher',
    },
    options,
  )

  assert.equal(result.success, true)
  assert.match(result.message, /maxIterations=3/)
  assert.match(result.message, /pollIntervalMs=33/)
  assert.deepEqual(capturedArgs, [
    '--root-dir',
    options.rootDir!,
    'resume',
    'alpha-team',
    'researcher',
    '--max-iterations',
    '3',
    '--poll-interval',
    '33',
  ])
})

test('createOperatorLifecycleActions blocks reopen when the teammate has no reopenable session metadata', async t => {
  const options = await createTempOptions(t)
  await createTeamWithStoredRuntimeMember(options, {
    teamName: 'alpha-team',
    agentName: 'researcher',
    sessionId: undefined,
    lastSessionId: undefined,
  })

  let launchCalls = 0
  const actions = createOperatorLifecycleActions({
    async launchBackgroundAgentTeamCommand(cliArgs) {
      launchCalls += 1
      return {
        success: true,
        command: process.execPath,
        args: cliArgs,
      }
    },
  })

  const result = await actions.reopenTeammate(
    {
      teamName: 'alpha-team',
      agentName: 'researcher',
    },
    options,
  )

  assert.equal(result.success, false)
  assert.equal(
    result.message,
    'researcher does not have reopenable session metadata',
  )
  assert.equal(launchCalls, 0)
})

test('createOperatorLifecycleActions blocks resume when the teammate is already active', async t => {
  const options = await createTempOptions(t)
  await createTeamWithStoredRuntimeMember(options, {
    teamName: 'alpha-team',
    agentName: 'researcher',
    isActive: true,
    sessionId: 'session-current',
  })

  let launchCalls = 0
  const actions = createOperatorLifecycleActions({
    async launchBackgroundAgentTeamCommand(cliArgs) {
      launchCalls += 1
      return {
        success: true,
        command: process.execPath,
        args: cliArgs,
      }
    },
  })

  const result = await actions.resumeTeammate(
    {
      teamName: 'alpha-team',
      agentName: 'researcher',
    },
    options,
  )

  assert.equal(result.success, false)
  assert.equal(result.message, 'researcher is already active')
  assert.equal(launchCalls, 0)
})

test('createOperatorLifecycleActions warns when spawning beyond the recommended team size', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'

  await createTeam(
    {
      teamName: 'alpha-team',
      leadAgentId: 'team-lead@alpha-team',
      leadMember: {
        name: 'team-lead',
        agentType: 'team-lead',
        cwd,
        subscriptions: [],
      },
    },
    options,
  )

  for (const agentName of ['a', 'b', 'c', 'd', 'e']) {
    await upsertTeamMember(
      'alpha-team',
      {
        agentId: `${agentName}@alpha-team`,
        name: agentName,
        agentType: agentName,
        cwd,
        subscriptions: [],
        joinedAt: Date.now(),
        backendType: 'in-process',
      },
      options,
    )
  }

  const actions = createOperatorLifecycleActions({
    async launchBackgroundAgentTeamCommand(cliArgs) {
      return {
        success: true,
        pid: 4343,
        command: process.execPath,
        args: cliArgs,
      }
    },
  })

  const result = await actions.spawnTeammate(
    {
      teamName: 'alpha-team',
      agentName: 'f',
      prompt: 'Help with the parser regression',
      cwd,
      runtimeKind: 'codex-cli',
    },
    options,
  )

  assert.equal(result.success, true)
  assert.match(result.message, /Started background worker f/)
  assert.match(result.message, /Cost: Team has 6 teammates/)
})

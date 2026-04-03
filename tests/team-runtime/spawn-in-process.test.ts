import assert from 'node:assert/strict'
import test from 'node:test'
import { createTeam, readTeamFile } from '../../src/team-core/index.js'
import { createMockRuntimeAdapter } from '../../src/team-runtime/runtime-adapter.js'
import { spawnInProcessTeammate } from '../../src/team-runtime/spawn-in-process.js'
import { createTempOptions } from '../test-helpers.js'

test('spawnInProcessTeammate registers a member and exposes runtime context to the adapter', async t => {
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

  let seenAgentId: string | undefined
  const adapter = createMockRuntimeAdapter(async (_config, context) => {
    seenAgentId = context.runtimeContext.agentId
    return {
      success: true,
      agentId: context.runtimeContext.agentId,
    }
  })

  const result = await spawnInProcessTeammate(
    {
      name: 'researcher',
      teamName: 'alpha team',
      prompt: 'Investigate the failure',
      cwd: '/tmp/project',
    },
    options,
    adapter,
  )

  assert.equal(result.success, true)
  assert.equal(result.agentId, 'researcher@alpha team')
  assert.equal(seenAgentId, 'researcher@alpha team')

  const stored = await readTeamFile('alpha team', options)
  const teammate = stored?.members.find(member => member.name === 'researcher')
  assert.equal(teammate?.isActive, true)

  await result.handle?.stop()

  const stopped = await readTeamFile('alpha team', options)
  assert.equal(
    stopped?.members.find(member => member.name === 'researcher')?.isActive,
    false,
  )
})

test('spawnInProcessTeammate cleans up a new member when adapter startup fails', async t => {
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

  const adapter = createMockRuntimeAdapter(async config => ({
    success: false,
    agentId: `${config.name}@${config.teamName}`,
    error: 'startup failed',
  }))

  const result = await spawnInProcessTeammate(
    {
      name: 'reviewer',
      teamName: 'alpha team',
      prompt: 'Review the patch',
      cwd: '/tmp/project',
    },
    options,
    adapter,
  )

  assert.equal(result.success, false)
  assert.equal(result.error, 'startup failed')

  const stored = await readTeamFile('alpha team', options)
  assert.equal(stored?.members.some(member => member.name === 'reviewer'), false)
})

test('spawnInProcessTeammate stores launch visibility metadata for detached workers', async t => {
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

  const previousLaunchMode = process.env.AGENT_TEAM_LAUNCH_MODE
  process.env.AGENT_TEAM_LAUNCH_MODE = 'detached'
  t.after(() => {
    if (previousLaunchMode === undefined) {
      delete process.env.AGENT_TEAM_LAUNCH_MODE
      return
    }
    process.env.AGENT_TEAM_LAUNCH_MODE = previousLaunchMode
  })

  const adapter = createMockRuntimeAdapter(async (_config, context) => ({
    success: true,
    agentId: context.runtimeContext.agentId,
  }))

  const result = await spawnInProcessTeammate(
    {
      name: 'researcher',
      teamName: 'alpha team',
      prompt: 'Investigate the failure',
      cwd: '/tmp/project',
      runtimeKind: 'codex-cli',
      launchCommand: 'resume',
    },
    options,
    adapter,
  )

  assert.equal(result.success, true)

  const stored = await readTeamFile('alpha team', options)
  const teammate = stored?.members.find(member => member.name === 'researcher')
  assert.equal(teammate?.runtimeState?.processId, process.pid)
  assert.equal(teammate?.runtimeState?.launchMode, 'detached')
  assert.equal(teammate?.runtimeState?.launchCommand, 'resume')
  assert.equal(teammate?.runtimeState?.lifecycle, 'bounded')
  assert.ok(teammate?.runtimeState?.startedAt !== undefined)

  await result.handle?.stop()
})

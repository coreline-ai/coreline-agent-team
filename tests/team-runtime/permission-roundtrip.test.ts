import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getTeamPermissionState,
  createModeSetRequestMessage,
  createTeam,
  getTeamMember,
  isPermissionRequest,
  isSandboxPermissionRequest,
  readPendingPermissionRequests,
  readResolvedPermissionRequests,
  readMailbox,
  upsertTeamMember,
  writeToMailbox,
} from '../../src/team-core/index.js'
import { runApprovePermissionCommand } from '../../src/team-cli/commands/approve-permission.js'
import { runApproveSandboxCommand } from '../../src/team-cli/commands/approve-sandbox.js'
import { runDenyPermissionCommand } from '../../src/team-cli/commands/deny-permission.js'
import {
  createRuntimeContext,
  requestPermissionApproval,
  requestSandboxPermissionApproval,
  runInProcessTeammateOnce,
} from '../../src/team-runtime/index.js'
import { createTempOptions, sleep } from '../test-helpers.js'

async function createTeamWithWorker(
  options: Awaited<ReturnType<typeof createTempOptions>>,
  cwd: string,
): Promise<void> {
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
      isActive: true,
      mode: 'default',
    },
    options,
  )
}

function createWorkerRuntimeContext() {
  return createRuntimeContext({
    agentId: 'researcher@alpha team',
    agentName: 'researcher',
    teamName: 'alpha team',
  })
}

test('requestPermissionApproval sends a structured request and waits for leader approval', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'
  await createTeamWithWorker(options, cwd)

  const runtimeContext = createWorkerRuntimeContext()
  const responsePromise = requestPermissionApproval(
    {
      name: 'researcher',
      teamName: 'alpha team',
      prompt: 'Need permission',
      cwd,
    },
    {
      runtimeContext,
      coreOptions: options,
      request_id: 'perm-1',
      tool_name: 'exec_command',
      tool_use_id: 'tool-1',
      description: 'Need shell access',
      input: {
        cmd: 'pwd',
      },
      pollIntervalMs: 5,
    },
  )

  let requestSeen = false
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const leaderMailbox = await readMailbox('alpha team', 'team-lead', options)
    requestSeen = leaderMailbox.some(
      message => isPermissionRequest(message.text)?.request_id === 'perm-1',
    )
    if (requestSeen) {
      break
    }
    await sleep(5)
  }

  assert.equal(requestSeen, true)

  await runApprovePermissionCommand('alpha team', 'researcher', 'perm-1', options)
  const response = await responsePromise

  assert.equal(response.type, 'permission_response')
  assert.equal(response.subtype, 'success')
})

test('requestPermissionApproval can auto-allow from persisted team permission updates', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'
  await createTeamWithWorker(options, cwd)

  const runtimeContext = createWorkerRuntimeContext()
  const firstApprovalPromise = requestPermissionApproval(
    {
      name: 'researcher',
      teamName: 'alpha team',
      prompt: 'Need shell access',
      cwd,
    },
    {
      runtimeContext,
      coreOptions: options,
      request_id: 'perm-persist-1',
      tool_name: 'exec_command',
      tool_use_id: 'tool-1',
      description: 'Need shell access',
      input: {
        cmd: 'pwd',
        cwd,
      },
      pollIntervalMs: 5,
    },
  )

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((await readPendingPermissionRequests('alpha team', options)).length > 0) {
      break
    }
    await sleep(5)
  }

  await runApprovePermissionCommand(
    'alpha team',
    'researcher',
    'perm-persist-1',
    {
      persistDecision: true,
      ruleContent: 'pwd',
    },
    options,
  )

  const firstResponse = await firstApprovalPromise
  assert.equal(firstResponse.subtype, 'success')
  assert.equal((await readResolvedPermissionRequests('alpha team', options)).length, 1)
  assert.equal((await getTeamPermissionState('alpha team', options))?.updates.length, 1)

  const leaderMailboxBefore = await readMailbox('alpha team', 'team-lead', options)
  const secondResponse = await requestPermissionApproval(
    {
      name: 'researcher',
      teamName: 'alpha team',
      prompt: 'Need shell access again',
      cwd,
    },
    {
      runtimeContext: createWorkerRuntimeContext(),
      coreOptions: options,
      request_id: 'perm-persist-2',
      tool_name: 'exec_command',
      tool_use_id: 'tool-2',
      description: 'Need shell access again',
      input: {
        cmd: 'pwd',
        cwd,
      },
      pollIntervalMs: 5,
    },
  )
  const leaderMailboxAfter = await readMailbox('alpha team', 'team-lead', options)

  assert.equal(secondResponse.subtype, 'success')
  assert.equal(
    leaderMailboxAfter.filter(
      message => isPermissionRequest(message.text)?.request_id === 'perm-persist-2',
    ).length,
    0,
  )
  assert.equal(leaderMailboxAfter.length, leaderMailboxBefore.length)
})

test('requestPermissionApproval can auto-deny from a persisted structured rule', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'
  await createTeamWithWorker(options, cwd)

  const runtimeContext = createWorkerRuntimeContext()
  const firstRequestPromise = requestPermissionApproval(
    {
      name: 'researcher',
      teamName: 'alpha team',
      prompt: 'Need shell access',
      cwd,
    },
    {
      runtimeContext,
      coreOptions: options,
      request_id: 'perm-deny-1',
      tool_name: 'exec_command',
      tool_use_id: 'tool-deny-1',
      description: 'Need shell access',
      input: {
        cmd: 'rm -rf tmp',
        cwd,
      },
      pollIntervalMs: 5,
    },
  )

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((await readPendingPermissionRequests('alpha team', options)).length > 0) {
      break
    }
    await sleep(5)
  }

  await runDenyPermissionCommand(
    'alpha team',
    'researcher',
    'perm-deny-1',
    {
      errorMessage: 'Denied by stored rule',
      persistDecision: true,
      commandContains: 'rm -rf',
      cwdPrefix: cwd,
    },
    options,
  )

  const firstResponse = await firstRequestPromise
  assert.equal(firstResponse.subtype, 'error')

  const leaderMailboxBefore = await readMailbox('alpha team', 'team-lead', options)
  const secondResponse = await requestPermissionApproval(
    {
      name: 'researcher',
      teamName: 'alpha team',
      prompt: 'Need shell access again',
      cwd,
    },
    {
      runtimeContext: createWorkerRuntimeContext(),
      coreOptions: options,
      request_id: 'perm-deny-2',
      tool_name: 'exec_command',
      tool_use_id: 'tool-deny-2',
      description: 'Need shell access again',
      input: {
        cmd: 'rm -rf tmp/cache',
        cwd,
      },
      pollIntervalMs: 5,
    },
  )
  const leaderMailboxAfter = await readMailbox('alpha team', 'team-lead', options)

  assert.equal(secondResponse.subtype, 'error')
  assert.match(secondResponse.error, /Denied by stored team permission rule/)
  assert.equal(leaderMailboxAfter.length, leaderMailboxBefore.length)
})

test('requestSandboxPermissionApproval waits for sandbox approval round-trip', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'
  await createTeamWithWorker(options, cwd)

  const runtimeContext = createWorkerRuntimeContext()
  const responsePromise = requestSandboxPermissionApproval(
    {
      name: 'researcher',
      teamName: 'alpha team',
      prompt: 'Need host access',
      cwd,
      color: 'cyan',
    },
    {
      runtimeContext,
      coreOptions: options,
      requestId: 'sandbox-1',
      host: 'example.com',
      pollIntervalMs: 5,
    },
  )

  let requestSeen = false
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const leaderMailbox = await readMailbox('alpha team', 'team-lead', options)
    requestSeen = leaderMailbox.some(
      message => isSandboxPermissionRequest(message.text)?.requestId === 'sandbox-1',
    )
    if (requestSeen) {
      break
    }
    await sleep(5)
  }

  assert.equal(requestSeen, true)

  await runApproveSandboxCommand(
    'alpha team',
    'researcher',
    'sandbox-1',
    'example.com',
    options,
  )
  const response = await responsePromise

  assert.equal(response.requestId, 'sandbox-1')
  assert.equal(response.allow, true)
})

test('runInProcessTeammateOnce consumes mode_set_request and updates teammate mode', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'
  await createTeamWithWorker(options, cwd)

  const modeRequest = createModeSetRequestMessage({
    from: 'team-lead',
    mode: 'acceptEdits',
  })
  await writeToMailbox(
    'alpha team',
    'researcher',
    {
      from: 'team-lead',
      text: JSON.stringify(modeRequest),
      timestamp: new Date().toISOString(),
      summary: 'mode update',
    },
    options,
  )

  const result = await runInProcessTeammateOnce(
    {
      name: 'researcher',
      teamName: 'alpha team',
      prompt: 'Need host access',
      cwd,
    },
    {
      runtimeContext: createWorkerRuntimeContext(),
      coreOptions: options,
    },
  )

  const member = await getTeamMember('alpha team', { name: 'researcher' }, options)
  assert.equal(result.workItem?.kind, 'leader_message')
  assert.equal(member?.mode, 'acceptEdits')
})

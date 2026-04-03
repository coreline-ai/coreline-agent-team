import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createPermissionRequestRecord,
  createTeam,
  getTeamPermissionState,
  getTeamMember,
  isModeSetRequest,
  isPermissionResponse,
  isSandboxPermissionResponse,
  readPendingPermissionRequests,
  readMailbox,
  readResolvedPermissionRequests,
  upsertTeamMember,
  writePendingPermissionRequest,
} from '../../src/team-core/index.js'
import { runApprovePermissionCommand } from '../../src/team-cli/commands/approve-permission.js'
import { runApproveSandboxCommand } from '../../src/team-cli/commands/approve-sandbox.js'
import { runDenyPermissionCommand } from '../../src/team-cli/commands/deny-permission.js'
import { runDenySandboxCommand } from '../../src/team-cli/commands/deny-sandbox.js'
import { runPermissionsCommand } from '../../src/team-cli/commands/permissions.js'
import { runSetModeCommand } from '../../src/team-cli/commands/set-mode.js'
import { runCli } from '../../src/team-cli/run-cli.js'
import { createTempOptions } from '../test-helpers.js'

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

test('permission CLI commands write structured approve and deny responses', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'

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
    },
    options,
  )

  await runApprovePermissionCommand('alpha team', 'researcher', 'perm-1', options)
  await runDenyPermissionCommand(
    'alpha team',
    'researcher',
    'perm-2',
    'Denied by lead',
    options,
  )
  await runApproveSandboxCommand(
    'alpha team',
    'researcher',
    'sandbox-1',
    'example.com',
    options,
  )
  await runDenySandboxCommand(
    'alpha team',
    'researcher',
    'sandbox-2',
    'example.org',
    options,
  )

  const mailbox = await readMailbox('alpha team', 'researcher', options)
  const permissionResponses = mailbox
    .map(message => isPermissionResponse(message.text))
    .filter(message => message !== null)
  const sandboxResponses = mailbox
    .map(message => isSandboxPermissionResponse(message.text))
    .filter(message => message !== null)

  assert.equal(permissionResponses.length, 2)
  assert.equal(permissionResponses[0]?.subtype, 'success')
  assert.equal(permissionResponses[1]?.subtype, 'error')
  assert.equal(sandboxResponses.length, 2)
  assert.equal(sandboxResponses[0]?.allow, true)
  assert.equal(sandboxResponses[1]?.allow, false)
})

test('set-mode command updates the teammate and emits a mode_set_request', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'

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
      mode: 'default',
    },
    options,
  )

  const result = await runSetModeCommand(
    'alpha team',
    'researcher',
    'plan',
    options,
  )

  assert.match(result.message, /Set researcher mode to plan/)

  const mailbox = await readMailbox('alpha team', 'researcher', options)
  const modeRequest = mailbox
    .map(message => isModeSetRequest(message.text))
    .find(message => message !== null)
  const member = await getTeamMember('alpha team', { name: 'researcher' }, options)

  assert.equal(modeRequest?.mode, 'plan')
  assert.equal(member?.mode, 'plan')
})

test('approve-permission can persist an allow rule and permissions command reports stored state', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'

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
      mode: 'default',
    },
    options,
  )

  await writePendingPermissionRequest(
    createPermissionRequestRecord({
      id: 'perm-remember-1',
      teamName: 'alpha team',
      workerId: 'researcher@alpha team',
      workerName: 'researcher',
      toolName: 'exec_command',
      toolUseId: 'tool-1',
      description: 'Need shell access',
      input: {
        cmd: 'pwd',
        cwd,
      },
    }),
    options,
  )

  const result = await runApprovePermissionCommand(
    'alpha team',
    'researcher',
    'perm-remember-1',
    {
      persistDecision: true,
      ruleContent: 'pwd',
    },
    options,
  )

  assert.match(result.message, /Persisted allow rule applied/)
  assert.equal((await readPendingPermissionRequests('alpha team', options)).length, 0)
  assert.equal((await readResolvedPermissionRequests('alpha team', options)).length, 1)
  assert.equal((await getTeamPermissionState('alpha team', options))?.rules.length, 1)

  const rules = await runPermissionsCommand('alpha team', 'rules', options)
  assert.match(rules.message, /exec_command/)
  assert.match(rules.message, /contains=pwd/)
})

test('deny-permission can persist a structured deny rule and rules output includes match details', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'

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
      mode: 'default',
    },
    options,
  )

  await writePendingPermissionRequest(
    createPermissionRequestRecord({
      id: 'perm-deny-remember-1',
      teamName: 'alpha team',
      workerId: 'researcher@alpha team',
      workerName: 'researcher',
      toolName: 'exec_command',
      toolUseId: 'tool-1',
      description: 'Need shell access',
      input: {
        cmd: 'rm -rf tmp',
        cwd,
      },
    }),
    options,
  )

  const result = await runDenyPermissionCommand(
    'alpha team',
    'researcher',
    'perm-deny-remember-1',
    {
      errorMessage: 'Denied by lead',
      persistDecision: true,
      commandContains: 'rm -rf',
      cwdPrefix: cwd,
    },
    options,
  )

  assert.match(result.message, /Persisted deny rule applied/)
  const rules = await runPermissionsCommand('alpha team', 'rules', options)
  assert.match(rules.message, /\[1\] deny exec_command/)
  assert.match(rules.message, /command~rm -rf/)
  assert.match(rules.message, /cwd\^=/)
})

test('runCli dispatches permission decision commands with persisted rule flags', async t => {
  const options = await createTempOptions(t)
  const rootDir = options.rootDir ?? '/tmp/agent-team'
  const cwd = rootDir

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
      mode: 'default',
    },
    options,
  )

  await writePendingPermissionRequest(
    createPermissionRequestRecord({
      id: 'perm-cli-approve-1',
      teamName: 'alpha team',
      workerId: 'researcher@alpha team',
      workerName: 'researcher',
      toolName: 'exec_command',
      toolUseId: 'tool-1',
      description: 'Need shell access',
      input: {
        cmd: 'pwd',
        cwd,
      },
    }),
    options,
  )
  await writePendingPermissionRequest(
    createPermissionRequestRecord({
      id: 'perm-cli-deny-1',
      teamName: 'alpha team',
      workerId: 'researcher@alpha team',
      workerName: 'researcher',
      toolName: 'exec_command',
      toolUseId: 'tool-2',
      description: 'Need shell access',
      input: {
        cmd: 'rm -rf tmp',
        cwd,
      },
    }),
    options,
  )

  const approve = await withCapturedConsole(() =>
    runCli([
      '--root-dir',
      rootDir,
      'approve-permission',
      'alpha team',
      'researcher',
      'perm-cli-approve-1',
      '--persist',
      '--rule',
      'pwd',
      '--match-cwd-prefix',
      cwd,
    ]),
  )
  const deny = await withCapturedConsole(() =>
    runCli([
      '--root-dir',
      rootDir,
      'deny-permission',
      'alpha team',
      'researcher',
      'perm-cli-deny-1',
      'Denied by lead',
      '--persist',
      '--match-command',
      'rm -rf',
      '--match-cwd-prefix',
      cwd,
    ]),
  )

  assert.equal(approve.exitCode, 0)
  assert.equal(deny.exitCode, 0)
  assert.match(approve.logs.join('\n'), /Persisted allow rule applied/)
  assert.match(deny.logs.join('\n'), /Persisted deny rule applied/)

  const rules = await runPermissionsCommand('alpha team', 'rules', options)
  assert.match(rules.message, /contains=pwd/)
  assert.match(rules.message, /command~rm -rf/)
  assert.match(rules.message, /cwd\^=/)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createModeSetRequestMessage,
  createPermissionRequestMessage,
  createPermissionResponseMessage,
  createSandboxPermissionRequestMessage,
  createSandboxPermissionResponseMessage,
  createTeamPermissionUpdateMessage,
  isModeSetRequest,
  isPermissionRequest,
  isPermissionResponse,
  isSandboxPermissionRequest,
  isSandboxPermissionResponse,
  isStructuredProtocolMessage,
  isTeamPermissionUpdate,
} from '../../src/team-core/index.js'

test('permission protocol creators round-trip through their structured parsers', async () => {
  const permissionRequest = createPermissionRequestMessage({
    request_id: 'perm-1',
    agent_id: 'researcher@alpha team',
    tool_name: 'exec_command',
    tool_use_id: 'tool-1',
    description: 'Need shell access',
    input: {
      cmd: 'pwd',
    },
  })
  const permissionResponse = createPermissionResponseMessage({
    request_id: 'perm-1',
    subtype: 'success',
    updated_input: {
      cmd: 'pwd',
    },
  })
  const sandboxRequest = createSandboxPermissionRequestMessage({
    requestId: 'sandbox-1',
    workerId: 'researcher@alpha team',
    workerName: 'researcher',
    host: 'example.com',
  })
  const sandboxResponse = createSandboxPermissionResponseMessage({
    requestId: 'sandbox-1',
    host: 'example.com',
    allow: true,
  })
  const permissionUpdate = createTeamPermissionUpdateMessage({
    directoryPath: '/tmp/project',
    toolName: 'exec_command',
    permissionUpdate: {
      type: 'addRules',
      rules: [
        {
          toolName: 'exec_command',
          ruleContent: 'allow pwd',
        },
      ],
      behavior: 'allow',
      destination: 'session',
    },
  })
  const modeRequest = createModeSetRequestMessage({
    from: 'team-lead',
    mode: 'plan',
  })

  assert.equal(
    isPermissionRequest(JSON.stringify(permissionRequest))?.tool_name,
    'exec_command',
  )
  assert.equal(
    isPermissionResponse(JSON.stringify(permissionResponse))?.subtype,
    'success',
  )
  assert.equal(
    isSandboxPermissionRequest(JSON.stringify(sandboxRequest))?.hostPattern.host,
    'example.com',
  )
  assert.equal(
    isSandboxPermissionResponse(JSON.stringify(sandboxResponse))?.allow,
    true,
  )
  assert.equal(
    isTeamPermissionUpdate(JSON.stringify(permissionUpdate))?.toolName,
    'exec_command',
  )
  assert.equal(
    isModeSetRequest(JSON.stringify(modeRequest))?.mode,
    'plan',
  )
  assert.equal(isStructuredProtocolMessage(JSON.stringify(permissionRequest)), true)
  assert.equal(isStructuredProtocolMessage(JSON.stringify(modeRequest)), true)
})

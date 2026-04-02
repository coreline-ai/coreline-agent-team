import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearMailbox,
  createIdleNotification,
  createPlanApprovalRequestMessage,
  createPlanApprovalResponseMessage,
  createShutdownApprovedMessage,
  createShutdownRejectedMessage,
  createShutdownRequestMessage,
  isIdleNotification,
  isPlanApprovalRequest,
  isPlanApprovalResponse,
  isShutdownApproved,
  isShutdownRejected,
  isShutdownRequest,
  isStructuredProtocolMessage,
  markMessageAsReadByIndex,
  markMessagesAsRead,
  markMessagesAsReadByPredicate,
  readMailbox,
  readUnreadMessages,
  writeToMailbox,
} from '../../src/team-core/index.js'
import { createTempOptions } from '../test-helpers.js'

test('mailbox stores, reads, and marks messages as read', async t => {
  const options = await createTempOptions(t)

  await writeToMailbox(
    'alpha team',
    'researcher',
    {
      from: 'team-lead',
      text: 'hello',
      timestamp: new Date().toISOString(),
      summary: 'hello',
    },
    options,
  )
  await writeToMailbox(
    'alpha team',
    'researcher',
    {
      from: 'team-lead',
      text: 'second',
      timestamp: new Date().toISOString(),
      summary: 'second',
    },
    options,
  )

  assert.equal((await readUnreadMessages('alpha team', 'researcher', options)).length, 2)
  assert.equal(
    await markMessageAsReadByIndex('alpha team', 'researcher', 0, options),
    true,
  )
  assert.equal((await readUnreadMessages('alpha team', 'researcher', options)).length, 1)

  await markMessagesAsReadByPredicate(
    'alpha team',
    'researcher',
    message => message.summary === 'second',
    options,
  )
  assert.equal((await readUnreadMessages('alpha team', 'researcher', options)).length, 0)

  await writeToMailbox(
    'alpha team',
    'researcher',
    {
      from: 'team-lead',
      text: 'third',
      timestamp: new Date().toISOString(),
      summary: 'third',
    },
    options,
  )
  await markMessagesAsRead('alpha team', 'researcher', options)
  assert.equal(
    (await readMailbox('alpha team', 'researcher', options)).every(message => message.read),
    true,
  )

  await clearMailbox('alpha team', 'researcher', options)
  assert.equal((await readMailbox('alpha team', 'researcher', options)).length, 0)
})

test('mailbox writes are lock-safe under concurrent appends', async t => {
  const options = await createTempOptions(t)

  await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      writeToMailbox(
        'alpha team',
        'researcher',
        {
          from: 'worker',
          text: `msg-${index}`,
          timestamp: new Date().toISOString(),
          summary: `msg-${index}`,
        },
        options,
      ),
    ),
  )

  const mailbox = await readMailbox('alpha team', 'researcher', options)
  assert.equal(mailbox.length, 10)
  assert.equal(new Set(mailbox.map(message => message.text)).size, 10)
})

test('structured protocol helpers create and parse supported messages', () => {
  const idle = createIdleNotification('researcher', {
    idleReason: 'available',
    completedTaskId: '12',
  })
  const shutdownRequest = createShutdownRequestMessage({
    requestId: 'req-1',
    from: 'team-lead',
    reason: 'done',
  })
  const shutdownApproved = createShutdownApprovedMessage({
    requestId: 'req-1',
    from: 'researcher',
    backendType: 'in-process',
  })
  const shutdownRejected = createShutdownRejectedMessage({
    requestId: 'req-2',
    from: 'researcher',
    reason: 'still working',
  })
  const approvalRequest = createPlanApprovalRequestMessage({
    requestId: 'plan-1',
    from: 'researcher',
    planFilePath: '/tmp/plan.md',
    planContent: '# plan',
  })
  const approvalResponse = createPlanApprovalResponseMessage({
    requestId: 'plan-1',
    approved: true,
    permissionMode: 'default',
  })

  assert.equal(isIdleNotification(JSON.stringify(idle))?.type, 'idle_notification')
  assert.equal(
    isShutdownRequest(JSON.stringify(shutdownRequest))?.type,
    'shutdown_request',
  )
  assert.equal(
    isShutdownApproved(JSON.stringify(shutdownApproved))?.type,
    'shutdown_approved',
  )
  assert.equal(
    isShutdownRejected(JSON.stringify(shutdownRejected))?.type,
    'shutdown_rejected',
  )
  assert.equal(
    isPlanApprovalRequest(JSON.stringify(approvalRequest))?.type,
    'plan_approval_request',
  )
  assert.equal(
    isPlanApprovalResponse(JSON.stringify(approvalResponse))?.type,
    'plan_approval_response',
  )
  assert.equal(isStructuredProtocolMessage(JSON.stringify(approvalResponse)), true)
  assert.equal(isStructuredProtocolMessage('plain text'), false)
})

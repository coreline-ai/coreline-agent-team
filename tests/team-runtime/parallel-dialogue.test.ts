import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createTask,
  createTeam,
  getTaskListIdForTeam,
  listTasks,
  readMailbox,
  readTranscriptEntries,
} from '../../src/team-core/index.js'
import {
  createFunctionRuntimeTurnBridge,
  createLocalRuntimeAdapter,
  spawnInProcessTeammate,
} from '../../src/team-runtime/index.js'
import { createTempOptions } from '../test-helpers.js'

function createBarrier(target: number) {
  let count = 0
  let released = false
  let release!: () => void
  const promise = new Promise<void>(resolve => {
    release = () => {
      if (!released) {
        released = true
        resolve()
      }
    }
  })

  return {
    async wait(): Promise<void> {
      count += 1
      if (count >= target) {
        release()
      }
      await promise
    },
  }
}

async function createTeamOnly(
  teamName: string,
  options: Awaited<ReturnType<typeof createTempOptions>>,
): Promise<void> {
  const cwd = options.rootDir ?? '/tmp/project'

  await createTeam(
    {
      teamName,
      leadAgentId: `team-lead@${teamName}`,
      leadMember: {
        name: 'team-lead',
        agentType: 'team-lead',
        cwd,
        subscriptions: [],
      },
    },
    options,
  )
}

async function createSequentialTasks(
  teamName: string,
  count: number,
  options: Awaited<ReturnType<typeof createTempOptions>>,
  prefix: string,
): Promise<void> {
  const taskListId = getTaskListIdForTeam(teamName)
  for (let index = 1; index <= count; index += 1) {
    await createTask(
      taskListId,
      {
        subject: `${prefix} ${index}`,
        description: `${prefix} description ${index}`,
        status: 'pending',
        blocks: [],
        blockedBy: [],
      },
      options,
    )
  }
}

async function spawnAgents(
  teamName: string,
  agentNames: string[],
  adapter: ReturnType<typeof createLocalRuntimeAdapter>,
  options: Awaited<ReturnType<typeof createTempOptions>>,
  runtimeOptions: {
    maxIterations: number
    pollIntervalMs: number
  },
): Promise<Array<Awaited<ReturnType<typeof spawnInProcessTeammate>>>> {
  const cwd = options.rootDir ?? '/tmp/project'
  const results: Array<Awaited<ReturnType<typeof spawnInProcessTeammate>>> = []

  for (const agentName of agentNames) {
    const result = await spawnInProcessTeammate(
      {
        name: agentName,
        teamName,
        prompt: `Participate in ${teamName}`,
        cwd,
        runtimeOptions,
      },
      options,
      adapter,
    )
    assert.equal(result.success, true)
    results.push(result)
  }

  return results
}

function countPeerMessages(
  mailbox: Awaited<ReturnType<typeof readMailbox>>,
): number {
  return mailbox.filter(message => message.from !== 'team-lead').length
}

test('five-agent dialogue case 1: ring round-trip completes bidirectional peer conversations', async t => {
  const options = await createTempOptions(t)
  const teamName = 'parallel-ring-team'
  const agents = ['alpha', 'bravo', 'charlie', 'delta', 'echo']
  const barrier = createBarrier(agents.length)

  await createTeamOnly(teamName, options)
  await createSequentialTasks(teamName, agents.length, options, 'Ring task')

  const nextAgent = (agentName: string) =>
    agents[(agents.indexOf(agentName) + 1) % agents.length]!
  const previousAgent = (agentName: string) =>
    agents[(agents.indexOf(agentName) - 1 + agents.length) % agents.length]!

  const adapter = createLocalRuntimeAdapter({
    bridge: createFunctionRuntimeTurnBridge(async input => {
      const agentName = input.context.config.name

      if (input.workItem.kind === 'task') {
        await barrier.wait()
        await input.context.sendMessage(
          nextAgent(agentName),
          `ring:${agentName}`,
          `ring ${agentName}`,
        )

        return {
          summary: `${agentName} completed ring task ${input.workItem.task.id}`,
          taskStatus: 'completed',
          completedTaskId: input.workItem.task.id,
          completedStatus: 'resolved',
        }
      }

      if (input.workItem.kind === 'peer_message') {
        const text = input.workItem.message.text
        if (text.startsWith('ring:')) {
          await input.context.sendMessage(
            input.workItem.message.from,
            `ack:${agentName}`,
            `ack ${agentName}`,
          )
          return {
            summary: `${agentName} acknowledged ring from ${input.workItem.message.from}`,
          }
        }

        if (text.startsWith('ack:')) {
          return {
            summary: `${agentName} received ack from ${input.workItem.message.from}`,
          }
        }
      }

      return {
        summary: `${agentName} had no additional work`,
      }
    }),
  })

  const results = await spawnAgents(teamName, agents, adapter, options, {
    maxIterations: 10,
    pollIntervalMs: 10,
  })
  const loopResults = await Promise.all(results.map(result => result.handle?.join?.()))

  const tasks = await listTasks(getTaskListIdForTeam(teamName), options)
  assert.equal(tasks.filter(task => task.status === 'completed').length, 5)

  for (const loopResult of loopResults) {
    assert.equal(loopResult?.stopReason, 'completed')
  }

  for (const agentName of agents) {
    const mailbox = await readMailbox(teamName, agentName, options)
    const transcriptEntries = await readTranscriptEntries(teamName, agentName, options)
    const peerWorkItems = transcriptEntries.filter(
      entry =>
        entry.role === 'work_item' &&
        entry.content.startsWith('Peer message from '),
    )

    assert.equal(countPeerMessages(mailbox), 2)
    assert.ok(peerWorkItems.length >= 1)
    assert.ok(
      mailbox.some(
        message =>
          message.from === previousAgent(agentName) &&
          message.text.startsWith('ring:'),
      ),
    )
    assert.ok(
      mailbox.some(
        message =>
          message.from === nextAgent(agentName) &&
          message.text.startsWith('ack:'),
      ),
    )
    assert.ok(
      peerWorkItems.some(entry =>
        entry.content.includes(`Peer message from ${previousAgent(agentName)}: ring:`),
      ),
    )
  }
})

test('five-agent dialogue case 2: fan-out and fan-in coordination creates multi-hop peer conversations', async t => {
  const options = await createTempOptions(t)
  const teamName = 'parallel-fanout-team'
  const agents = [
    'coordinator',
    'analyst-a',
    'analyst-b',
    'reviewer',
    'summarizer',
  ]
  let reviewedCount = 0

  await createTeamOnly(teamName, options)
  await createSequentialTasks(teamName, 1, options, 'Coordinator task')

  const adapter = createLocalRuntimeAdapter({
    bridge: createFunctionRuntimeTurnBridge(async input => {
      const agentName = input.context.config.name

      if (input.workItem.kind === 'task') {
        assert.equal(agentName, 'coordinator')

        for (const recipient of agents.filter(name => name !== 'coordinator')) {
          await input.context.sendMessage(
            recipient,
            'broadcast:phase-1',
            `broadcast to ${recipient}`,
          )
        }

        return {
          summary: 'coordinator broadcasted phase-1',
          taskStatus: 'completed',
          completedTaskId: input.workItem.task.id,
          completedStatus: 'resolved',
        }
      }

      if (input.workItem.kind !== 'peer_message') {
        return {
          summary: `${agentName} had no additional work`,
        }
      }

      const text = input.workItem.message.text
      if (agentName === 'analyst-a' || agentName === 'analyst-b') {
        if (text === 'broadcast:phase-1') {
          await input.context.sendMessage(
            'coordinator',
            `ack:${agentName}`,
            `ack ${agentName}`,
          )
          await input.context.sendMessage(
            'reviewer',
            `evidence:${agentName}`,
            `evidence ${agentName}`,
          )
          return {
            summary: `${agentName} replied to broadcast and shared evidence`,
          }
        }
      }

      if (agentName === 'reviewer') {
        if (text === 'broadcast:phase-1') {
          await input.context.sendMessage(
            'coordinator',
            'ack:reviewer',
            'ack reviewer',
          )
          return {
            summary: 'reviewer acknowledged broadcast',
          }
        }

        if (text.startsWith('evidence:')) {
          const source = text.split(':')[1] ?? 'unknown'
          await input.context.sendMessage(
            'summarizer',
            `reviewed:${source}`,
            `reviewed ${source}`,
          )
          return {
            summary: `reviewer forwarded reviewed evidence from ${source}`,
          }
        }
      }

      if (agentName === 'summarizer') {
        if (text === 'broadcast:phase-1') {
          await input.context.sendMessage(
            'coordinator',
            'ack:summarizer',
            'ack summarizer',
          )
          return {
            summary: 'summarizer acknowledged broadcast',
          }
        }

        if (text.startsWith('reviewed:')) {
          reviewedCount += 1
          if (reviewedCount >= 2) {
            await input.context.sendMessage(
              'coordinator',
              `summary:${reviewedCount}-reviewed`,
              'summary to coordinator',
            )
          }
          return {
            summary: `summarizer recorded ${text}`,
          }
        }
      }

      if (agentName === 'coordinator') {
        return {
          summary: `coordinator received ${text}`,
        }
      }

      return {
        summary: `${agentName} processed ${text}`,
      }
    }),
  })

  const results = await spawnAgents(teamName, agents, adapter, options, {
    maxIterations: 30,
    pollIntervalMs: 10,
  })
  await Promise.all(results.map(result => result.handle?.join?.()))

  const tasks = await listTasks(getTaskListIdForTeam(teamName), options)
  assert.equal(tasks.filter(task => task.status === 'completed').length, 1)

  const coordinatorMailbox = await readMailbox(teamName, 'coordinator', options)
  const analystAMailbox = await readMailbox(teamName, 'analyst-a', options)
  const analystBMailbox = await readMailbox(teamName, 'analyst-b', options)
  const reviewerMailbox = await readMailbox(teamName, 'reviewer', options)
  const summarizerMailbox = await readMailbox(teamName, 'summarizer', options)

  assert.equal(countPeerMessages(coordinatorMailbox), 5)
  assert.equal(countPeerMessages(analystAMailbox), 1)
  assert.equal(countPeerMessages(analystBMailbox), 1)
  assert.equal(countPeerMessages(reviewerMailbox), 3)
  assert.equal(countPeerMessages(summarizerMailbox), 3)
  assert.equal(
    [
      coordinatorMailbox,
      analystAMailbox,
      analystBMailbox,
      reviewerMailbox,
      summarizerMailbox,
    ].reduce((sum, mailbox) => sum + countPeerMessages(mailbox), 0),
    13,
  )

  const coordinatorTranscript = await readTranscriptEntries(
    teamName,
    'coordinator',
    options,
  )
  const reviewerTranscript = await readTranscriptEntries(
    teamName,
    'reviewer',
    options,
  )
  const summarizerTranscript = await readTranscriptEntries(
    teamName,
    'summarizer',
    options,
  )

  assert.ok(
    coordinatorTranscript.some(
      entry =>
        entry.role === 'work_item' &&
        entry.content.includes('Peer message from analyst-a: ack:analyst-a'),
    ),
  )
  assert.ok(
    coordinatorTranscript.some(
      entry =>
        entry.role === 'work_item' &&
        entry.content.includes('Peer message from summarizer: summary:'),
    ),
  )
  assert.equal(
    reviewerTranscript.filter(
      entry =>
        entry.role === 'work_item' &&
        entry.content.startsWith('Peer message from '),
    ).length,
    3,
  )
  assert.equal(
    summarizerTranscript.filter(
      entry =>
        entry.role === 'work_item' &&
        entry.content.startsWith('Peer message from '),
    ).length,
    3,
  )
})

test('five-agent dialogue case 3: pending task backlog yields to peer dialogue before second task pickup', async t => {
  const options = await createTempOptions(t)
  const teamName = 'parallel-priority-team'
  const agents = ['atlas', 'blaze', 'cinder', 'drift', 'ember']
  const barrier = createBarrier(agents.length)
  const taskTurns = new Map<string, number>()
  let ringCount = 0
  let secondWaveCreated = false

  await createTeamOnly(teamName, options)
  await createSequentialTasks(teamName, 5, options, 'Priority task')

  const nextAgent = (agentName: string) =>
    agents[(agents.indexOf(agentName) + 1) % agents.length]!

  const adapter = createLocalRuntimeAdapter({
    bridge: createFunctionRuntimeTurnBridge(async input => {
      const agentName = input.context.config.name

      if (input.workItem.kind === 'task') {
        const nextTaskTurn = (taskTurns.get(agentName) ?? 0) + 1
        taskTurns.set(agentName, nextTaskTurn)

        if (nextTaskTurn === 1) {
          await barrier.wait()
          await input.context.sendMessage(
            nextAgent(agentName),
            `wave1:${agentName}`,
            `wave1 ${agentName}`,
          )
        }

        return {
          summary: `${agentName} completed task turn ${nextTaskTurn}`,
          taskStatus: 'completed',
          completedTaskId: input.workItem.task.id,
          completedStatus: 'resolved',
        }
      }

      if (input.workItem.kind === 'peer_message') {
        const text = input.workItem.message.text
        if (text.startsWith('wave1:')) {
          ringCount += 1
          if (!secondWaveCreated && ringCount >= agents.length) {
            secondWaveCreated = true
            await createSequentialTasks(
              teamName,
              5,
              options,
              'Priority task second wave',
            )
          }
          await input.context.sendMessage(
            input.workItem.message.from,
            `wave1-ack:${agentName}`,
            `wave1 ack ${agentName}`,
          )
          return {
            summary: `${agentName} processed wave1 from ${input.workItem.message.from}`,
          }
        }

        if (text.startsWith('wave1-ack:')) {
          return {
            summary: `${agentName} processed wave1 ack from ${input.workItem.message.from}`,
          }
        }
      }

      return {
        summary: `${agentName} had no additional work`,
      }
    }),
  })

  const results = await spawnAgents(teamName, agents, adapter, options, {
    maxIterations: 20,
    pollIntervalMs: 10,
  })
  await Promise.all(results.map(result => result.handle?.join?.()))

  const tasks = await listTasks(getTaskListIdForTeam(teamName), options)
  assert.equal(tasks.filter(task => task.status === 'completed').length, 10)
  const firstWaveOwners = new Set(
    tasks
      .filter(task => Number(task.id) <= 5)
      .map(task => task.owner)
      .filter((owner): owner is string => owner !== undefined),
  )
  assert.equal(firstWaveOwners.size, agents.length)

  let agentsWithSecondTask = 0
  let totalProcessedPeerWorkItems = 0
  for (const agentName of agents) {
    assert.ok((taskTurns.get(agentName) ?? 0) >= 1)

    const mailbox = await readMailbox(teamName, agentName, options)
    assert.equal(countPeerMessages(mailbox), 2)

    const transcriptEntries = await readTranscriptEntries(teamName, agentName, options)
    const workItemEntries = transcriptEntries.filter(entry => entry.role === 'work_item')
    const taskEntryIndexes = workItemEntries
      .map((entry, index) =>
        entry.content.startsWith('Task #') ? index : -1,
      )
      .filter(index => index >= 0)
    const peerEntryIndexes = workItemEntries
      .map((entry, index) =>
        entry.content.startsWith('Peer message from ') ? index : -1,
      )
      .filter(index => index >= 0)

    assert.ok(taskEntryIndexes.length >= 1)
    assert.ok(peerEntryIndexes.length >= 1)
    totalProcessedPeerWorkItems += peerEntryIndexes.length
    assert.ok(peerEntryIndexes[0]! > taskEntryIndexes[0]!)
    if (peerEntryIndexes.length >= 2) {
      assert.ok(peerEntryIndexes[1]! > peerEntryIndexes[0]!)
    }
    if (
      peerEntryIndexes.length >= 2 &&
      taskEntryIndexes.length >= 2 &&
      taskEntryIndexes[1]! > peerEntryIndexes[1]!
    ) {
      agentsWithSecondTask += 1
    }
  }

  assert.ok(agentsWithSecondTask >= 2)
  assert.ok(totalProcessedPeerWorkItems >= agents.length + 2)
})

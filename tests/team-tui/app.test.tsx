import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import React from 'react'
import { render } from 'ink-testing-library'
import type { RenderOptions } from 'ink'
import {
  createPermissionRequestRecord,
  createTask,
  createTeam,
  upsertTeamMember,
  writePendingPermissionRequest,
} from '../../src/team-core/index.js'
import { getTaskListIdForTeam } from '../../src/team-core/paths.js'
import { TeamTuiApp } from '../../src/team-tui/app.js'
import { createTempOptions, sleep } from '../test-helpers.js'
import { runTuiCommand } from '../../src/team-tui/commands/tui.js'
import { runWatchCommand } from '../../src/team-tui/commands/watch.js'

function createInkRenderOptions(): RenderOptions {
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean
    ref(): void
    setRawMode(mode: boolean): void
    unref(): void
  }
  stdin.isTTY = true
  stdin.ref = () => {}
  stdin.setRawMode = (_mode: boolean) => {}
  stdin.unref = () => {}

  return {
    stdin,
  } as unknown as RenderOptions
}

async function waitForFrame(
  app: ReturnType<typeof render>,
  pattern: RegExp,
  timeoutMs = 2000,
): Promise<string> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const frame = app.lastFrame() ?? ''
    if (pattern.test(frame)) {
      return frame
    }
    await sleep(50)
  }
  throw new Error(`Timed out waiting for frame ${pattern}`)
}

test('TeamTuiApp watch mode renders the dashboard for a team', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'

  await createTeam(
    {
      teamName: 'watch team',
      leadAgentId: 'team-lead@watch team',
      leadMember: {
        name: 'team-lead',
        agentType: 'team-lead',
        cwd,
        subscriptions: [],
      },
    },
    options,
  )

  await createTask(
    getTaskListIdForTeam('watch team'),
    {
      subject: 'Investigate dashboard',
      description: 'Review the watch view',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  const app = render(
    <TeamTuiApp initialTeamName="watch team" options={options} mode="watch" />,
  )
  t.after(() => {
    app.unmount()
  })

  const frame = await waitForFrame(app, /Investigate dashboard/)
  assert.match(frame, /Investigate dashboard/)
  assert.match(frame, /Tasks/)
})

test('TeamTuiApp control mode can open the spawn modal', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'

  await createTeam(
    {
      teamName: 'control team',
      leadAgentId: 'team-lead@control team',
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
    'control team',
    {
      agentId: 'researcher@control team',
      name: 'researcher',
      agentType: 'researcher',
      cwd,
      subscriptions: [],
      joinedAt: Date.now(),
      backendType: 'in-process',
    },
    options,
  )

  await createTask(
    getTaskListIdForTeam('control team'),
    {
      subject: 'Investigate modal flow',
      description: 'Validate interactive modals',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  await writePendingPermissionRequest(
    createPermissionRequestRecord({
      id: 'perm-1',
      teamName: 'control team',
      workerId: 'researcher@control team',
      workerName: 'researcher',
      toolName: 'exec_command',
      toolUseId: 'tool-1',
      description: 'Run tests',
      input: {
        cmd: 'npm test',
        cwd,
      },
    }),
    options,
  )

  const app = render(
    <TeamTuiApp initialTeamName="control team" options={options} mode="control" />,
  )
  t.after(() => {
    app.unmount()
  })

  await waitForFrame(app, /Investigate modal flow/)

  app.stdin.write('s')
  const frame = await waitForFrame(app, /Spawn Teammate/)
  assert.match(frame, /Spawn Teammate/)
})

test('TeamTuiApp control mode can open the approval modal', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'

  await createTeam(
    {
      teamName: 'approval team',
      leadAgentId: 'team-lead@approval team',
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
    'approval team',
    {
      agentId: 'researcher@approval team',
      name: 'researcher',
      agentType: 'researcher',
      cwd,
      subscriptions: [],
      joinedAt: Date.now(),
      backendType: 'in-process',
    },
    options,
  )

  await createTask(
    getTaskListIdForTeam('approval team'),
    {
      subject: 'Review approval flow',
      description: 'Validate approval modal',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  await writePendingPermissionRequest(
    createPermissionRequestRecord({
      id: 'perm-approval',
      teamName: 'approval team',
      workerId: 'researcher@approval team',
      workerName: 'researcher',
      toolName: 'exec_command',
      toolUseId: 'tool-2',
      description: 'Run approval tests',
      input: {
        cmd: 'npm test',
        cwd,
      },
    }),
    options,
  )

  const app = render(
    <TeamTuiApp initialTeamName="approval team" options={options} mode="control" />,
  )
  t.after(() => {
    app.unmount()
  })

  await waitForFrame(app, /Review approval flow/)

  app.stdin.write('a')
  const frame = await waitForFrame(app, /Approval Inbox/)
  assert.match(frame, /\[permission\]/)
})

test('watch and tui commands boot successfully with rootDir state', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'

  await createTeam(
    {
      teamName: 'boot team',
      leadAgentId: 'team-lead@boot team',
      leadMember: {
        name: 'team-lead',
        agentType: 'team-lead',
        cwd,
        subscriptions: [],
      },
    },
    options,
  )

  await createTask(
    getTaskListIdForTeam('boot team'),
    {
      subject: 'Smoke the TUI',
      description: 'Make sure Ink can boot from commands',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  const watchExitCode = await runWatchCommand(
    'boot team',
    options,
    {
      exitOnRender: true,
      renderOptions: createInkRenderOptions(),
    },
  )
  assert.equal(watchExitCode, 0)

  const tuiExitCode = await runTuiCommand(
    'boot team',
    options,
    {
      exitOnRender: true,
      renderOptions: createInkRenderOptions(),
    },
  )
  assert.equal(tuiExitCode, 0)
})

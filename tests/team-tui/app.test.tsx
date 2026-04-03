import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import React from 'react'
import { render } from 'ink-testing-library'
import type { RenderOptions } from 'ink'
import {
  appendTranscriptEntry,
  createPermissionRequestRecord,
  createTask,
  createTeam,
  createTranscriptEntry,
  getWorkerStderrLogPath,
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

test('TeamTuiApp shows worker activity for pending tasks that are actively being processed', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'
  const teamName = 'active task team'

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

  await createTask(
    getTaskListIdForTeam(teamName),
    {
      subject: 'Build live progress hints',
      description: 'Make active work visible in the task pane',
      owner: `researcher@${teamName}`,
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  await upsertTeamMember(
    teamName,
    {
      agentId: `researcher@${teamName}`,
      name: 'researcher',
      agentType: 'researcher',
      cwd,
      subscriptions: [],
      joinedAt: Date.now(),
      backendType: 'in-process',
      isActive: true,
      runtimeState: {
        runtimeKind: 'codex-cli',
        currentWorkKind: 'task',
        currentTaskId: '1',
        turnStartedAt: Date.now() - 2_000,
        lastHeartbeatAt: Date.now() - 200,
      },
    },
    options,
  )

  const app = render(
    <TeamTuiApp
      initialTeamName={teamName}
      options={options}
      mode="watch"
      viewport={{ columns: 220, rows: 30 }}
    />,
  )
  t.after(() => {
    app.unmount()
  })

  const frame = await waitForFrame(app, /working:researcher/)
  assert.match(frame, /workers 1 active\s+1 running/)
  assert.match(
    frame,
    /#1 \[pending\] Build live progress hints[\s\S]*working:researcher/,
  )
})

test('TeamTuiApp surfaces stderr preview for detached teammates', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'
  const teamName = 'stderr team'

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

  await upsertTeamMember(
    teamName,
    {
      agentId: `researcher@${teamName}`,
      name: 'researcher',
      agentType: 'researcher',
      cwd,
      subscriptions: [],
      joinedAt: Date.now(),
      backendType: 'in-process',
      isActive: true,
      runtimeState: {
        runtimeKind: 'codex-cli',
        processId: 8484,
        launchMode: 'detached',
        launchCommand: 'spawn',
        lifecycle: 'bounded',
        lastHeartbeatAt: Date.now(),
      },
    },
    options,
  )

  const stderrLogPath = getWorkerStderrLogPath(teamName, 'researcher', options)
  await mkdir(dirname(stderrLogPath), { recursive: true })

  await writeFile(
    stderrLogPath,
    'waiting on backend schema\nlatest contract mismatch\n',
    'utf8',
  )

  const app = render(
    <TeamTuiApp initialTeamName={teamName} options={options} mode="watch" />,
  )
  t.after(() => {
    app.unmount()
  })

  await waitForFrame(app, /Tasks/)
  app.stdin.write('\t')
  app.stdin.write('f')
  const frame = await waitForFrame(app, /Focus: primary/)
  const expandedFrame = await waitForFrame(app, /latest contract mismatch/)
  assert.match(frame, /Teammates \[focused\] \[focus\]/)
  assert.match(expandedFrame, /researcher active idle/)
  assert.match(expandedFrame, /researcher\.stderr\.log/)
  assert.match(expandedFrame, /latest contract mismatch/)
})

test('TeamTuiApp uses a compact narrow shell on small viewports', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'

  await createTeam(
    {
      teamName: 'narrow team',
      leadAgentId: 'team-lead@narrow team',
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
    getTaskListIdForTeam('narrow team'),
    {
      subject: 'Keep the shell compact',
      description: 'Prefer one main pane on narrow terminals',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  const app = render(
    <TeamTuiApp
      initialTeamName="narrow team"
      options={options}
      mode="watch"
      viewport={{ columns: 90, rows: 24 }}
    />,
  )
  t.after(() => {
    app.unmount()
  })

  const frame = await waitForFrame(app, /Keep the shell compact/)
  assert.match(frame, /Tasks \[focused\]/)
  assert.match(frame, /\[Activity\]\s+Transcript/)
  assert.doesNotMatch(frame, /Teammates \[focused\]/)
})

test('TeamTuiApp switches detail tabs in narrow mode', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'

  await createTeam(
    {
      teamName: 'detail team',
      leadAgentId: 'team-lead@detail team',
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
    getTaskListIdForTeam('detail team'),
    {
      subject: 'Switch detail tabs',
      description: 'Use transcript as the bottom detail view',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  const app = render(
    <TeamTuiApp
      initialTeamName="detail team"
      options={options}
      mode="control"
      viewport={{ columns: 90, rows: 24 }}
    />,
  )
  t.after(() => {
    app.unmount()
  })

  await waitForFrame(app, /Activity Feed/)
  app.stdin.write(']')
  const frame = await waitForFrame(app, /Transcript \/ /)
  assert.match(frame, /Activity\s+\[Transcript\]/)
  assert.match(frame, /Transcript \/ team-lead|Transcript/)
})

test('TeamTuiApp cycles between primary and detail focus modes', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'

  await createTeam(
    {
      teamName: 'focus team',
      leadAgentId: 'team-lead@focus team',
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
    getTaskListIdForTeam('focus team'),
    {
      subject: 'Focus the selected pane',
      description: 'Expand one pane at a time',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  const app = render(
    <TeamTuiApp
      initialTeamName="focus team"
      options={options}
      mode="watch"
      viewport={{ columns: 90, rows: 20 }}
    />,
  )
  t.after(() => {
    app.unmount()
  })

  await waitForFrame(app, /Activity Feed/)

  app.stdin.write('f')
  const primaryFocusFrame = await waitForFrame(app, /Tasks \[focused\] \[focus\]/)
  assert.match(primaryFocusFrame, /Focus: primary/)
  assert.doesNotMatch(primaryFocusFrame, /Activity Feed/)

  app.stdin.write('f')
  const detailFocusFrame = await waitForFrame(app, /Activity Feed \[focused\] \[focus\]/)
  assert.match(detailFocusFrame, /Focus: detail/)
  assert.doesNotMatch(detailFocusFrame, /Tasks \[focused\] \[focus\]/)
})

test('TeamTuiApp scrolls transcript entries in detail focus mode', async t => {
  const options = await createTempOptions(t)
  const cwd = options.rootDir ?? '/tmp/project'
  const teamName = 'scroll team'

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

  await upsertTeamMember(
    teamName,
    {
      agentId: `researcher@${teamName}`,
      name: 'researcher',
      agentType: 'researcher',
      cwd,
      subscriptions: [],
      joinedAt: Date.now(),
      backendType: 'in-process',
      isActive: true,
    },
    options,
  )

  for (let index = 1; index <= 10; index += 1) {
    await appendTranscriptEntry(
      teamName,
      'researcher',
      createTranscriptEntry({
        sessionId: 'session-scroll',
        agentName: 'researcher',
        role: 'assistant',
        content: `Transcript entry ${index}`,
      }),
      options,
    )
  }

  const app = render(
    <TeamTuiApp
      initialTeamName={teamName}
      options={options}
      mode="watch"
      viewport={{ columns: 90, rows: 12 }}
    />,
  )
  t.after(() => {
    app.unmount()
  })

  await waitForFrame(app, /Activity Feed/)
  app.stdin.write(']')
  const transcriptFrame = await waitForFrame(app, /Transcript \/ researcher/)
  assert.match(transcriptFrame, /Transcript entry 10/)
  assert.doesNotMatch(transcriptFrame, /Transcript entry 1\b/)

  app.stdin.write('f')
  app.stdin.write('f')
  await waitForFrame(app, /Transcript \/ researcher \[focus\]/)

  app.stdin.write('k')
  app.stdin.write('k')
  const scrolledFrame = await waitForFrame(app, /Transcript entry 1/)
  assert.match(scrolledFrame, /showing 1-8 of 10/)
  assert.doesNotMatch(scrolledFrame, /Transcript entry 10/)
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

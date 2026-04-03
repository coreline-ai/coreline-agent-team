import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import test from 'node:test'
import React from 'react'
import { render } from 'ink-testing-library'
import {
  createTask,
  createTeam,
  type TeamCoreOptions,
  upsertTeamMember,
} from '../../src/team-core/index.js'
import { getTaskListIdForTeam } from '../../src/team-core/paths.js'
import { ProjectStudioApp } from '../../src/team-tui/project-builder-app.js'
import { createTempDir, createTempOptions, sleep } from '../test-helpers.js'

async function waitForFrame(
  app: ReturnType<typeof render>,
  pattern: RegExp,
  timeoutMs = 2500,
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

async function createStudioTeamFixture(
  options: TeamCoreOptions,
  teamName: string,
  workspace: string,
) {
  await createTeam(
    {
      teamName,
      leadAgentId: `team-lead@${teamName}`,
      description: '쇼핑몰 만들어줘',
      leadMember: {
        name: 'team-lead',
        agentType: 'team-lead',
        cwd: workspace,
        subscriptions: [],
      },
    },
    options,
  )

  await createTask(
    getTaskListIdForTeam(teamName),
    {
      subject: 'Scaffold the project workspace',
      description: 'Create the initial files',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )
}

test('ProjectStudioApp renders a prompt-first project builder screen', async t => {
  const options = await createTempOptions(t)

  const app = render(
    <ProjectStudioApp
      options={options}
      dependencies={{
        async runDoctorCommand() {
          return {
            success: true,
            message: 'doctor ready',
          }
        },
      }}
    />,
  )
  t.after(() => {
    app.unmount()
  })

  const frame = await waitForFrame(app, /Project goal prompt/)
  assert.match(frame, /ATCLI ready/)
  assert.match(frame, /goal>/)
  const doctorFrame = await waitForFrame(app, /doctor ready/)
  assert.match(doctorFrame, /doctor ready/)
})

test('ProjectStudioApp auto-submits an initial goal and renders attached team state', async t => {
  const options = await createTempOptions(t)
  const workspace = await createTempDir(t)
  let startedGoal = ''

  const app = render(
    <ProjectStudioApp
      options={options}
      workspace={workspace}
      runtimeKind="local"
      initialInput="build shop app"
      autoSubmitInitialInput
      dependencies={{
        async runDoctorCommand() {
          return {
            success: true,
            message: 'doctor ready',
          }
        },
        async startProject(input, runtimeOptions) {
          startedGoal = input.goal
          const teamName = 'studio-team'
          await createStudioTeamFixture(runtimeOptions, teamName, workspace)
          return {
            success: true,
            message: 'Started software-factory team "studio-team"',
            teamName,
            workspacePath: workspace,
          }
        },
      }}
    />,
  )
  t.after(() => {
    app.unmount()
  })

  const frame = await waitForFrame(app, /team=studio-team/)
  assert.equal(startedGoal, 'build shop app')
  assert.match(frame, /Started software-factory team "studio-team"/)
  assert.match(frame, /Prompt \/ follow-up -> planner/)
})

test('ProjectStudioApp auto-submits follow-up text to planner by default for an attached team', async t => {
  const options = await createTempOptions(t)
  const workspace = await createTempDir(t)
  const sentMessages: Array<{ recipient: string; message: string }> = []

  await createStudioTeamFixture(options, 'studio-follow-up', workspace)

  const app = render(
    <ProjectStudioApp
      options={options}
      teamName="studio-follow-up"
      workspace={workspace}
      runtimeKind="local"
      initialInput="status update please"
      autoSubmitInitialInput
      dependencies={{
        async runDoctorCommand() {
          return {
            success: true,
            message: 'doctor ready',
          }
        },
        async sendMessage(input) {
          sentMessages.push({
            recipient: input.recipient,
            message: input.message,
          })
          return {
            success: true,
            message: `sent to ${input.recipient}`,
          }
        },
      }}
    />,
  )
  t.after(() => {
    app.unmount()
  })

  const frame = await waitForFrame(app, /You -> planner: status update please/)
  assert.deepEqual(sentMessages, [
    {
      recipient: 'planner',
      message: 'status update please',
    },
  ])
  assert.match(frame, /sent to planner/)
})

test('ProjectStudioApp renders completed result state and workspace preview for generated files', async t => {
  const options = await createTempOptions(t)
  const workspace = await createTempDir(t)
  const teamName = 'studio-preview'

  await createTeam(
    {
      teamName,
      leadAgentId: `team-lead@${teamName}`,
      description: 'preview verification',
      leadMember: {
        name: 'team-lead',
        agentType: 'team-lead',
        cwd: workspace,
        subscriptions: [],
      },
    },
    options,
  )

  await createTask(
    getTaskListIdForTeam(teamName),
    {
      subject: 'Review the generated outputs',
      description: 'Summarize readiness',
      status: 'completed',
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  await mkdir(`${workspace}/docs`, { recursive: true })
  await writeFile(
    `${workspace}/docs/review.md`,
    '# Review Summary\n\nProject skeleton is ready for handoff.\n',
    'utf8',
  )
  await mkdir(`${workspace}/frontend`, { recursive: true })
  await mkdir(`${workspace}/backend`, { recursive: true })
  await writeFile(`${workspace}/docs/plan.md`, '# Plan\n', 'utf8')
  await writeFile(`${workspace}/docs/research.md`, '# Research\n', 'utf8')
  await writeFile(`${workspace}/frontend/README.md`, '# Frontend\n', 'utf8')
  await writeFile(`${workspace}/backend/README.md`, '# Backend\n', 'utf8')
  await writeFile(`${workspace}/package.json`, '{}\n', 'utf8')

  const app = render(
    <ProjectStudioApp
      options={options}
      teamName={teamName}
      workspace={workspace}
      runtimeKind="local"
      dependencies={{
        async runDoctorCommand() {
          return {
            success: true,
            message: 'doctor ready',
          }
        },
      }}
    />,
  )
  t.after(() => {
    app.unmount()
  })

  const frame = await waitForFrame(app, /Generated Files \(6\)/, 3_000)
  assert.match(frame, /result=completed/)
  assert.match(frame, /generated=6/)
  assert.match(frame, /preview=docs\/review\.md/)
  assert.match(frame, /total=6 docs=3 frontend=1 backend=1[\s\S]*other=1/)
  assert.match(frame, /\[Files\]\s+Preview\s+Teammates/)
  assert.doesNotMatch(frame, /Output Preview \(docs\/review\.md\)/)

  app.stdin.write(']')
  const previewFrame = await waitForFrame(
    app,
    /Output Preview \(docs\/review\.md\)/,
    3_000,
  )
  assert.match(previewFrame, /headline=Review Summary/)
  assert.match(previewFrame, /Review Summary/)
  assert.match(previewFrame, /Files\s+\[Preview\]\s+Teammates/)
})

test('ProjectStudioApp surfaces executing-turn teammate state in the status panels', async t => {
  const options = await createTempOptions(t)
  const workspace = await createTempDir(t)
  const teamName = 'studio-executing'

  await createTeam(
    {
      teamName,
      leadAgentId: `team-lead@${teamName}`,
      description: 'executing turn visibility',
      leadMember: {
        name: 'team-lead',
        agentType: 'team-lead',
        cwd: workspace,
        subscriptions: [],
      },
    },
    options,
  )

  await createTask(
    getTaskListIdForTeam(teamName),
    {
      subject: 'Implement the frontend application',
      description: 'Create the UI shell',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  await upsertTeamMember(
    teamName,
    {
      agentId: `frontend@${teamName}`,
      name: 'frontend',
      agentType: 'frontend',
      cwd: workspace,
      subscriptions: [],
      joinedAt: Date.now(),
      backendType: 'in-process',
      isActive: true,
      runtimeState: {
        runtimeKind: 'codex-cli',
        processId: 7171,
        launchMode: 'detached',
        launchCommand: 'spawn',
        lifecycle: 'bounded',
        prompt: 'Build the frontend shell',
        cwd: workspace,
        currentWorkKind: 'task',
        currentTaskId: '1',
        currentWorkSummary: 'Task #1: Implement the frontend application',
        turnStartedAt: Date.now() - 4_000,
        lastHeartbeatAt: Date.now() - 500,
      },
    },
    options,
  )

  const app = render(
    <ProjectStudioApp
      options={options}
      teamName={teamName}
      workspace={workspace}
      runtimeKind="codex-cli"
      dependencies={{
        async runDoctorCommand() {
          return {
            success: true,
            message: 'doctor ready',
          }
        },
      }}
    />,
  )
  t.after(() => {
    app.unmount()
  })

  const frame = await waitForFrame(app, /executing=1/)
  assert.match(frame, /stale=0/)
  assert.match(frame, /workers 1 active\s+1 running/)
  assert.match(frame, /#1 \[pending\] Implement the frontend/)
  assert.match(frame, /working:frontend/)

  app.stdin.write(']')
  app.stdin.write(']')
  const teammateFrame = await waitForFrame(
    app,
    /frontend active busy executing-turn/,
  )
  assert.match(teammateFrame, /frontend active busy executing-turn[\s\S]*task#1/)
  assert.match(teammateFrame, /pid=7171[\s\S]*detached\/spawn/)
  assert.match(teammateFrame, /Files\s+Preview\s+\[Teammates\]/)
})

test('ProjectStudioApp collapses generated outputs into detail tabs on compact viewports', async t => {
  const options = await createTempOptions(t)
  const workspace = await createTempDir(t)
  const teamName = 'studio-compact'

  await createTeam(
    {
      teamName,
      leadAgentId: `team-lead@${teamName}`,
      description: 'compact studio layout',
      leadMember: {
        name: 'team-lead',
        agentType: 'team-lead',
        cwd: workspace,
        subscriptions: [],
      },
    },
    options,
  )

  await createTask(
    getTaskListIdForTeam(teamName),
    {
      subject: 'Review compact detail tabs',
      description: 'Make sure files and preview collapse into a single detail area',
      status: 'completed',
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  await mkdir(`${workspace}/docs`, { recursive: true })
  await writeFile(
    `${workspace}/docs/review.md`,
    '# Review Summary\n\nCompact detail tabs are ready.\n',
    'utf8',
  )
  await writeFile(`${workspace}/docs/plan.md`, '# Plan\n', 'utf8')

  const app = render(
    <ProjectStudioApp
      options={options}
      teamName={teamName}
      workspace={workspace}
      runtimeKind="local"
      viewport={{ columns: 110, rows: 28 }}
      dependencies={{
        async runDoctorCommand() {
          return {
            success: true,
            message: 'doctor ready',
          }
        },
      }}
    />,
  )
  t.after(() => {
    app.unmount()
  })

  const frame = await waitForFrame(app, /Generated Files \(2\)/)
  assert.match(frame, /Generated Files \(2\)/)
  assert.match(frame, /\[Files\]\s+Preview\s+Teammates/)
  assert.doesNotMatch(frame, /Output Preview \(docs\/review\.md\)/)
})

test('ProjectStudioApp switches compact detail tabs with keyboard input', async t => {
  const options = await createTempOptions(t)
  const workspace = await createTempDir(t)
  const teamName = 'studio-detail-tabs'

  await createTeam(
    {
      teamName,
      leadAgentId: `team-lead@${teamName}`,
      description: 'detail tab keyboard switching',
      leadMember: {
        name: 'team-lead',
        agentType: 'team-lead',
        cwd: workspace,
        subscriptions: [],
      },
    },
    options,
  )

  await createTask(
    getTaskListIdForTeam(teamName),
    {
      subject: 'Switch between files preview and teammates',
      description: 'Use the compact detail tabs',
      status: 'completed',
      blocks: [],
      blockedBy: [],
    },
    options,
  )

  await mkdir(`${workspace}/docs`, { recursive: true })
  await writeFile(
    `${workspace}/docs/review.md`,
    '# Review Summary\n\nDetail tab switching works.\n',
    'utf8',
  )

  await upsertTeamMember(
    teamName,
    {
      agentId: `frontend@${teamName}`,
      name: 'frontend',
      agentType: 'frontend',
      cwd: workspace,
      subscriptions: [],
      joinedAt: Date.now(),
      backendType: 'in-process',
      isActive: true,
      runtimeState: {
        runtimeKind: 'codex-cli',
        currentWorkKind: 'task',
        currentTaskId: '1',
        turnStartedAt: Date.now() - 1_000,
        lastHeartbeatAt: Date.now() - 100,
      },
    },
    options,
  )

  const app = render(
    <ProjectStudioApp
      options={options}
      teamName={teamName}
      workspace={workspace}
      runtimeKind="codex-cli"
      viewport={{ columns: 110, rows: 28 }}
      dependencies={{
        async runDoctorCommand() {
          return {
            success: true,
            message: 'doctor ready',
          }
        },
      }}
    />,
  )
  t.after(() => {
    app.unmount()
  })

  await waitForFrame(app, /Generated Files \(1\)/)
  app.stdin.write(']')
  const previewFrame = await waitForFrame(
    app,
    /Output Preview \(docs\/review\.md\)/,
  )
  assert.match(previewFrame, /Files\s+\[Preview\]\s+Teammates/)

  app.stdin.write(']')
  const teammateFrame = await waitForFrame(app, /\[Teammates\]/)
  assert.match(teammateFrame, /frontend active busy executing-turn/)
})

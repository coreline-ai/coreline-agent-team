import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import test from 'node:test'
import React from 'react'
import { render } from 'ink-testing-library'
import {
  createTask,
  createTeam,
  type TeamCoreOptions,
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

  const frame = await waitForFrame(app, /result=completed/)
  assert.match(frame, /generated=1/)
  assert.match(frame, /preview=docs\/review\.md/)
  assert.match(frame, /docs\/review\.md/)
  assert.match(frame, /Review Summary/)
})

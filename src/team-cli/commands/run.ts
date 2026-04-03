import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  createTask,
  createTeam,
  getTaskListIdForTeam,
  readTeamFile,
  resetTaskList,
  sanitizePathComponent,
  type CreateTaskInput,
  type TeamCoreOptions,
  type TeamRuntimeKind,
} from '../../team-core/index.js'
import { launchBackgroundAgentTeamCommand } from '../../team-operator/background-process.js'
import { runSendCommand } from './send.js'
import type { CliCommandResult } from '../types.js'

export type RunPresetName = 'software-factory'

export type RunCommandInput = {
  goal: string
  workspace?: string
  teamName?: string
  preset?: RunPresetName
  runtimeKind?: TeamRuntimeKind
  model?: string
  maxIterations?: number
  pollIntervalMs?: number
  codexExecutablePath?: string
  upstreamExecutablePath?: string
  codexArgs?: string[]
  upstreamArgs?: string[]
}

export type RunCommandDependencies = {
  launchBackgroundAgentTeamCommand: typeof launchBackgroundAgentTeamCommand
  now: () => number
}

const defaultRunCommandDependencies: RunCommandDependencies = {
  launchBackgroundAgentTeamCommand,
  now: () => Date.now(),
}

type RunAgentSpec = {
  name: string
  role: 'planner' | 'search' | 'frontend' | 'backend' | 'reviewer'
  directories: string[]
  prompt: string
  leaderMessage: string
  task: CreateTaskInput
  codexArgs?: string[]
}

const REVIEWER_DEPENDENCY_ROLES: ReadonlyArray<RunAgentSpec['role']> = [
  'planner',
  'search',
  'frontend',
  'backend',
]

function createDefaultTeamName(goal: string, now: number): string {
  const sanitized = sanitizePathComponent(goal)
    .toLowerCase()
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24)

  const prefix = sanitized.length > 0 ? sanitized : 'run'
  return `${prefix}-${now.toString(36)}`
}

function resolveWorkspacePath(
  workspace: string | undefined,
  teamName: string,
): string {
  if (workspace) {
    return resolve(workspace)
  }
  return resolve(process.cwd(), 'agent-team-output', teamName)
}

function buildDefaultCodexArgs(input: RunCommandInput): string[] {
  const defaults = ['--full-auto']
  return [...defaults, ...(input.codexArgs ?? [])]
}

function renderRolePrompt(
  role: RunAgentSpec['role'],
  goal: string,
  workspacePath: string,
  directories: string[],
): string {
  const directoryText = directories.map(dir => `- ${dir}`).join('\n')

  const shared = [
    `You are the ${role} teammate for the project goal: "${goal}".`,
    `Primary workspace: ${workspacePath}`,
    'Work directly in the workspace files when the runtime allows it.',
    'Leave concise progress updates for the team lead.',
    'Coordinate with teammates when your work depends on them.',
    'Stay focused on your assigned directories and deliverables.',
    '',
    'Assigned directories:',
    directoryText,
    '',
  ]

  if (role === 'planner') {
    return [
      ...shared,
      'Produce the initial implementation plan and architecture notes.',
      'Expected deliverables:',
      '- docs/plan.md',
      '- docs/architecture.md',
      '- docs/task-breakdown.md',
    ].join('\n')
  }
  if (role === 'search') {
    return [
      ...shared,
      'Research requirements, references, and implementation constraints.',
      'Expected deliverable:',
      '- docs/research.md',
      'If external search is unavailable, document assumptions and uncertainty clearly.',
    ].join('\n')
  }
  if (role === 'frontend') {
    return [
      ...shared,
      'Build the frontend application skeleton and core pages.',
      'Expected deliverables:',
      '- frontend/ app scaffold',
      '- frontend/README.md if additional setup is needed',
    ].join('\n')
  }
  if (role === 'backend') {
    return [
      ...shared,
      'Build the backend/API skeleton and core endpoints.',
      'Expected deliverables:',
      '- backend/ service scaffold',
      '- docs/backend-api.md',
    ].join('\n')
  }
  return [
    ...shared,
    'Review the outputs of the other teammates and summarize readiness.',
    'Expected deliverable:',
    '- docs/review.md',
  ].join('\n')
}

function buildRunAgentSpecs(
  goal: string,
  workspacePath: string,
  teamName: string,
  codexArgs: string[],
): RunAgentSpec[] {
  const docsDir = join(workspacePath, 'docs')
  const frontendDir = join(workspacePath, 'frontend')
  const backendDir = join(workspacePath, 'backend')

  return [
    {
      name: 'planner',
      role: 'planner',
      directories: [docsDir],
      prompt: renderRolePrompt('planner', goal, workspacePath, [docsDir]),
      leaderMessage:
        `Goal: ${goal}\n` +
        `Create a concrete implementation plan in ${join('docs', 'plan.md')} and architecture notes in ${join('docs', 'architecture.md')}.` +
        ' Coordinate expectations for frontend/backend/review.',
      task: {
        subject: 'Plan the product implementation',
        description:
          `Create planning documents for goal "${goal}" in docs/ and align the team on scope.`,
        status: 'pending',
        owner: `planner@${teamName}`,
        blocks: [],
        blockedBy: [],
      },
      codexArgs,
    },
    {
      name: 'search',
      role: 'search',
      directories: [docsDir],
      prompt: renderRolePrompt('search', goal, workspacePath, [docsDir]),
      leaderMessage:
        `Goal: ${goal}\n` +
        `Collect requirement assumptions and implementation references in ${join('docs', 'research.md')}.`,
      task: {
        subject: 'Research requirements and references',
        description:
          `Research implementation constraints and references for "${goal}" and record them in docs/research.md.`,
        status: 'pending',
        owner: `search@${teamName}`,
        blocks: [],
        blockedBy: [],
      },
      codexArgs,
    },
    {
      name: 'frontend',
      role: 'frontend',
      directories: [frontendDir, docsDir],
      prompt: renderRolePrompt('frontend', goal, workspacePath, [
        frontendDir,
        docsDir,
      ]),
      leaderMessage:
        `Goal: ${goal}\n` +
        `Build the frontend application in ${join('frontend')} and record setup notes if needed.`,
      task: {
        subject: 'Implement the frontend application',
        description:
          `Create the frontend workspace for "${goal}" under frontend/ and coordinate API assumptions with backend.`,
        status: 'pending',
        owner: `frontend@${teamName}`,
        blocks: [],
        blockedBy: [],
      },
      codexArgs,
    },
    {
      name: 'backend',
      role: 'backend',
      directories: [backendDir, docsDir],
      prompt: renderRolePrompt('backend', goal, workspacePath, [
        backendDir,
        docsDir,
      ]),
      leaderMessage:
        `Goal: ${goal}\n` +
        `Build the backend service in ${join('backend')} and document endpoints in ${join('docs', 'backend-api.md')}.`,
      task: {
        subject: 'Implement the backend service',
        description:
          `Create the backend workspace for "${goal}" under backend/ and document the API in docs/backend-api.md.`,
        status: 'pending',
        owner: `backend@${teamName}`,
        blocks: [],
        blockedBy: [],
      },
      codexArgs,
    },
    {
      name: 'reviewer',
      role: 'reviewer',
      directories: [docsDir, frontendDir, backendDir],
      prompt: renderRolePrompt('reviewer', goal, workspacePath, [
        docsDir,
        frontendDir,
        backendDir,
      ]),
      leaderMessage:
        `Goal: ${goal}\n` +
        `Review the planner/search/frontend/backend outputs and summarize readiness in ${join('docs', 'review.md')}.`,
      task: {
        subject: 'Review and summarize the outputs',
        description:
          `Review the work produced for "${goal}" and summarize the current readiness in docs/review.md.`,
        status: 'pending',
        owner: `reviewer@${teamName}`,
        blocks: [],
        blockedBy: [],
      },
      codexArgs,
    },
  ]
}

async function createWorkspaceBootstrapFiles(
  goal: string,
  workspacePath: string,
  teamName: string,
  preset: RunPresetName,
  runtimeKind: TeamRuntimeKind,
): Promise<void> {
  const docsDir = join(workspacePath, 'docs')
  const frontendDir = join(workspacePath, 'frontend')
  const backendDir = join(workspacePath, 'backend')
  const internalDir = join(workspacePath, '.agent-team')

  await Promise.all([
    mkdir(workspacePath, { recursive: true }),
    mkdir(docsDir, { recursive: true }),
    mkdir(frontendDir, { recursive: true }),
    mkdir(backendDir, { recursive: true }),
    mkdir(internalDir, { recursive: true }),
  ])

  await writeFile(
    join(docsDir, 'goal.md'),
    [
      '# Project Goal',
      '',
      `- Goal: ${goal}`,
      `- Team: ${teamName}`,
      `- Preset: ${preset}`,
      `- Runtime: ${runtimeKind}`,
      '',
      'This file was generated by `agent-team run`.',
    ].join('\n') + '\n',
    'utf8',
  )

  await writeFile(
    join(internalDir, 'run.json'),
    JSON.stringify(
      {
        goal,
        teamName,
        preset,
        runtimeKind,
        workspacePath,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
    'utf8',
  )
}

function buildBackgroundSpawnArgs(
  input: {
    teamName: string
    agentName: string
    prompt: string
    cwd: string
    runtimeKind: TeamRuntimeKind
    model?: string
    maxIterations: number
    pollIntervalMs?: number
    codexExecutablePath?: string
    upstreamExecutablePath?: string
    codexArgs?: string[]
    upstreamArgs?: string[]
  },
  options: TeamCoreOptions,
): string[] {
  const args: string[] = []

  if (options.rootDir) {
    args.push('--root-dir', options.rootDir)
  }

  args.push(
    'spawn',
    input.teamName,
    input.agentName,
    '--prompt',
    input.prompt,
    '--cwd',
    input.cwd,
    '--runtime',
    input.runtimeKind,
    '--max-iterations',
    String(input.maxIterations),
  )

  if (input.pollIntervalMs) {
    args.push('--poll-interval', String(input.pollIntervalMs))
  }
  if (input.model) {
    args.push('--model', input.model)
  }
  if (input.codexExecutablePath) {
    args.push('--codex-executable', input.codexExecutablePath)
  }
  if (input.upstreamExecutablePath) {
    args.push('--upstream-executable', input.upstreamExecutablePath)
  }
  for (const codexArg of input.codexArgs ?? []) {
    args.push('--codex-arg', codexArg)
  }
  for (const upstreamArg of input.upstreamArgs ?? []) {
    args.push('--upstream-arg', upstreamArg)
  }

  return args
}

function renderCliInvocation(
  args: string[],
  options: TeamCoreOptions,
): string {
  const segments = [
    'agent-team',
    ...(options.rootDir ? ['--root-dir', options.rootDir] : []),
    ...args,
  ]

  return segments
    .map(segment =>
      /\s/.test(segment) ? JSON.stringify(segment) : segment,
    )
    .join(' ')
}

export async function runRunCommand(
  input: RunCommandInput,
  options: TeamCoreOptions = {},
  dependencies: Partial<RunCommandDependencies> = {},
): Promise<CliCommandResult> {
  const resolvedDependencies = {
    ...defaultRunCommandDependencies,
    ...dependencies,
  } satisfies RunCommandDependencies

  const goal = input.goal.trim()
  if (goal.length === 0) {
    return {
      success: false,
      message: 'Missing run goal',
    }
  }

  const preset = input.preset ?? 'software-factory'
  const runtimeKind = input.runtimeKind ?? 'codex-cli'
  const teamName =
    input.teamName ??
    createDefaultTeamName(goal, resolvedDependencies.now())
  const workspacePath = resolveWorkspacePath(input.workspace, teamName)

  if (await readTeamFile(teamName, options)) {
    return {
      success: false,
      message: `Team "${teamName}" already exists`,
    }
  }

  await createWorkspaceBootstrapFiles(
    goal,
    workspacePath,
    teamName,
    preset,
    runtimeKind,
  )

  await createTeam(
    {
      teamName,
      description: goal,
      leadAgentId: `team-lead@${teamName}`,
      leadMember: {
        name: 'team-lead',
        agentType: 'team-lead',
        cwd: workspacePath,
        subscriptions: [],
      },
    },
    options,
  )
  const taskListId = getTaskListIdForTeam(teamName)
  await resetTaskList(taskListId, options)

  const codexArgs =
    runtimeKind === 'codex-cli' ? buildDefaultCodexArgs(input) : input.codexArgs
  const agents = buildRunAgentSpecs(goal, workspacePath, teamName, codexArgs ?? [])
  const taskIdsByRole = new Map<RunAgentSpec['role'], string>()

  for (const agent of agents) {
    const task = await createTask(
      taskListId,
      {
        ...agent.task,
        blockedBy:
          agent.role === 'reviewer'
            ? REVIEWER_DEPENDENCY_ROLES.map(role => taskIdsByRole.get(role)).filter(
                (taskId): taskId is string => taskId !== undefined,
              )
            : agent.task.blockedBy,
      },
      options,
    )
    taskIdsByRole.set(agent.role, task.id)
    await runSendCommand(teamName, agent.name, agent.leaderMessage, options)
  }

  const launchResults = []
  for (const agent of agents) {
    const launched = await resolvedDependencies.launchBackgroundAgentTeamCommand(
      buildBackgroundSpawnArgs(
        {
          teamName,
          agentName: agent.name,
          prompt: agent.prompt,
          cwd: workspacePath,
          runtimeKind,
          model: input.model,
          maxIterations: input.maxIterations ?? 8,
          pollIntervalMs: input.pollIntervalMs,
          codexExecutablePath: input.codexExecutablePath,
          upstreamExecutablePath: input.upstreamExecutablePath,
          codexArgs: agent.codexArgs,
          upstreamArgs: input.upstreamArgs,
        },
        options,
      ),
    )

    launchResults.push({
      agent: agent.name,
      ...launched,
    })

    if (!launched.success) {
      return {
        success: false,
        message:
          `Failed to launch ${agent.name} for team "${teamName}": ` +
          (launched.error ?? 'unknown error'),
      }
    }
  }

  const watchCommand = renderCliInvocation(['watch', teamName], options)
  const tuiCommand = renderCliInvocation(['tui', teamName], options)
  const statusCommand = renderCliInvocation(['status', teamName], options)
  const attachCommand = renderCliInvocation(['attach', teamName], options)

  return {
    success: true,
    message: [
      `Started ${preset} team "${teamName}" for goal: ${goal}`,
      `workspace=${workspacePath}`,
      `runtime=${runtimeKind}`,
      `launched=${launchResults.length}`,
      ...launchResults.map(
        launched =>
          `- ${launched.agent} pid=${launched.pid ?? 'n/a'} command=${launched.command}`,
      ),
      '',
      'Next steps:',
      `- Attach: ${attachCommand}`,
      `- Watch: ${watchCommand}`,
      `- TUI:   ${tuiCommand}`,
      `- Status: ${statusCommand}`,
    ].join('\n'),
  }
}

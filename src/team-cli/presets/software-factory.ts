import { join } from 'node:path'
import type { CreateTaskInput } from '../../team-core/index.js'

export type SoftwareFactoryRole =
  | 'planner'
  | 'search'
  | 'frontend'
  | 'backend'
  | 'reviewer'

export type SoftwareFactoryAgentSpec = {
  name: string
  role: SoftwareFactoryRole
  directories: string[]
  prompt: string
  leaderMessage: string
  task: CreateTaskInput
  codexArgs?: string[]
}

export const WORKSPACE_DIRECTORIES = ['docs/', 'frontend/', 'backend/'] as const

export const REVIEWER_DEPENDENCY_ROLES: ReadonlyArray<SoftwareFactoryRole> = [
  'planner',
  'search',
  'frontend',
  'backend',
]

export function renderRolePrompt(
  role: SoftwareFactoryRole,
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

export function buildSoftwareFactoryAgentSpecs(
  goal: string,
  workspacePath: string,
  teamName: string,
  codexArgs: string[],
): SoftwareFactoryAgentSpec[] {
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
        metadata: {
          ownership: {
            scopedPaths: [
              'docs/plan.md',
              'docs/architecture.md',
              'docs/task-breakdown.md',
            ],
            scopeSource: 'metadata',
          },
        },
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
        metadata: {
          ownership: {
            scopedPaths: ['docs/research.md'],
            scopeSource: 'metadata',
          },
        },
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
        metadata: {
          ownership: {
            scopedPaths: ['frontend/**'],
            scopeSource: 'metadata',
          },
        },
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
        metadata: {
          ownership: {
            scopedPaths: ['backend/**', 'docs/backend-api.md'],
            scopeSource: 'metadata',
          },
        },
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
        metadata: {
          ownership: {
            scopedPaths: ['docs/review.md'],
            scopeSource: 'metadata',
          },
        },
      },
      codexArgs,
    },
  ]
}

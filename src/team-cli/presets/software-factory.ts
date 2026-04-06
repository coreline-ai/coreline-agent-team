import { join } from 'node:path'
import type { CreateTaskInput } from '../../team-core/index.js'

export type SoftwareFactoryRole =
  | 'planner'
  | 'search'
  | 'frontend'
  | 'backend'
  | 'database'
  | 'devops'
  | 'testing'
  | 'mobile'
  | 'security'
  | 'reviewer'

export type RoleDefinition = {
  role: SoftwareFactoryRole
  directory: string
  keywords: string[]
  description: string
  promptSuffix: string
  deliverables: string[]
  taskSubject: string
  taskDescription: (goal: string) => string
  leaderMessageSuffix: (workspacePath: string) => string
  scopedPaths: string[]
}

export const ROLE_REGISTRY: ReadonlyArray<RoleDefinition> = [
  {
    role: 'planner',
    directory: 'docs',
    keywords: [], // always included
    description: 'Implementation planning and architecture',
    promptSuffix: [
      'Produce the initial implementation plan and architecture notes.',
      'Expected deliverables:',
      '- docs/plan.md',
      '- docs/architecture.md',
      '- docs/task-breakdown.md',
    ].join('\n'),
    deliverables: ['docs/plan.md', 'docs/architecture.md', 'docs/task-breakdown.md'],
    taskSubject: 'Plan the product implementation',
    taskDescription: (goal: string) =>
      `Create planning documents for goal "${goal}" in docs/ and align the team on scope.`,
    leaderMessageSuffix: () =>
      'Create a concrete implementation plan in docs/plan.md and architecture notes in docs/architecture.md.' +
      ' Coordinate expectations for all teammates.',
    scopedPaths: ['docs/plan.md', 'docs/architecture.md', 'docs/task-breakdown.md'],
  },
  {
    role: 'search',
    directory: 'docs',
    keywords: ['research', 'search', 'investigate', 'analyze', 'survey', 'reference', 'requirement'],
    description: 'Requirements research and reference gathering',
    promptSuffix: [
      'Research requirements, references, and implementation constraints.',
      'Expected deliverable:',
      '- docs/research.md',
      'If external search is unavailable, document assumptions and uncertainty clearly.',
    ].join('\n'),
    deliverables: ['docs/research.md'],
    taskSubject: 'Research requirements and references',
    taskDescription: (goal: string) =>
      `Research implementation constraints and references for "${goal}" and record them in docs/research.md.`,
    leaderMessageSuffix: () =>
      'Collect requirement assumptions and implementation references in docs/research.md.',
    scopedPaths: ['docs/research.md'],
  },
  {
    role: 'frontend',
    directory: 'frontend',
    keywords: [
      'frontend', 'front-end', 'ui', 'ux', 'web', 'page', 'component', 'react',
      'vue', 'angular', 'svelte', 'next', 'nuxt', 'html', 'css', 'tailwind',
      'dashboard', 'form', 'layout', 'widget', 'browser', 'client',
      '프론트엔드', '웹', '페이지', '화면', '프론트',
    ],
    description: 'Frontend application development',
    promptSuffix: [
      'Build the frontend application skeleton and core pages.',
      'Expected deliverables:',
      '- frontend/ app scaffold',
      '- frontend/README.md if additional setup is needed',
    ].join('\n'),
    deliverables: ['frontend/ app scaffold'],
    taskSubject: 'Implement the frontend application',
    taskDescription: (goal: string) =>
      `Create the frontend workspace for "${goal}" under frontend/ and coordinate API assumptions with backend.`,
    leaderMessageSuffix: () =>
      'Build the frontend application in frontend/ and record setup notes if needed.',
    scopedPaths: ['frontend/**'],
  },
  {
    role: 'backend',
    directory: 'backend',
    keywords: [
      'backend', 'back-end', 'api', 'server', 'endpoint', 'rest', 'graphql',
      'microservice', 'service', 'express', 'fastify', 'nest', 'django', 'flask',
      'spring', 'gin', 'fiber', 'controller', 'route',
      '백엔드', '서버', '서비스',
    ],
    description: 'Backend service and API development',
    promptSuffix: [
      'Build the backend/API skeleton and core endpoints.',
      'Expected deliverables:',
      '- backend/ service scaffold',
      '- docs/backend-api.md',
    ].join('\n'),
    deliverables: ['backend/ service scaffold', 'docs/backend-api.md'],
    taskSubject: 'Implement the backend service',
    taskDescription: (goal: string) =>
      `Create the backend workspace for "${goal}" under backend/ and document the API in docs/backend-api.md.`,
    leaderMessageSuffix: () =>
      'Build the backend service in backend/ and document endpoints in docs/backend-api.md.',
    scopedPaths: ['backend/**', 'docs/backend-api.md'],
  },
  {
    role: 'database',
    directory: 'database',
    keywords: [
      'database', 'db', 'schema', 'migration', 'sql', 'nosql', 'postgres',
      'mysql', 'mongodb', 'redis', 'prisma', 'drizzle', 'typeorm', 'sequelize',
      'table', 'model', 'entity', 'storage', 'data model',
      '데이터베이스', '디비', 'DB',
    ],
    description: 'Database schema and data layer development',
    promptSuffix: [
      'Design the database schema and data access layer.',
      'Expected deliverables:',
      '- database/ schema and migration files',
      '- docs/database-schema.md',
    ].join('\n'),
    deliverables: ['database/ schema files', 'docs/database-schema.md'],
    taskSubject: 'Design and implement the database layer',
    taskDescription: (goal: string) =>
      `Design the database schema for "${goal}" under database/ and document it in docs/database-schema.md.`,
    leaderMessageSuffix: () =>
      'Design the database schema in database/ and document it in docs/database-schema.md.',
    scopedPaths: ['database/**', 'docs/database-schema.md'],
  },
  {
    role: 'devops',
    directory: 'infra',
    keywords: [
      'devops', 'deploy', 'deployment', 'ci', 'cd', 'ci/cd', 'docker',
      'kubernetes', 'k8s', 'terraform', 'aws', 'gcp', 'azure', 'cloud',
      'nginx', 'pipeline', 'infrastructure', 'infra', 'container', 'helm',
      '배포', '인프라', '클라우드',
    ],
    description: 'Infrastructure, CI/CD, and deployment',
    promptSuffix: [
      'Set up infrastructure configuration and deployment pipeline.',
      'Expected deliverables:',
      '- infra/ configuration files (Dockerfile, CI config, etc.)',
      '- docs/deployment.md',
    ].join('\n'),
    deliverables: ['infra/ config files', 'docs/deployment.md'],
    taskSubject: 'Set up infrastructure and deployment',
    taskDescription: (goal: string) =>
      `Configure infrastructure and deployment pipeline for "${goal}" under infra/ and document in docs/deployment.md.`,
    leaderMessageSuffix: () =>
      'Set up infrastructure in infra/ and document deployment steps in docs/deployment.md.',
    scopedPaths: ['infra/**', 'docs/deployment.md'],
  },
  {
    role: 'testing',
    directory: 'tests',
    keywords: [
      'test', 'testing', 'qa', 'quality', 'e2e', 'integration test', 'unit test',
      'playwright', 'cypress', 'jest', 'vitest', 'mocha', 'selenium',
      '테스트', '품질',
    ],
    description: 'Test suite and quality assurance',
    promptSuffix: [
      'Write comprehensive test suites for the project.',
      'Expected deliverables:',
      '- tests/ test files',
      '- docs/testing-strategy.md',
    ].join('\n'),
    deliverables: ['tests/ test files', 'docs/testing-strategy.md'],
    taskSubject: 'Implement test suites',
    taskDescription: (goal: string) =>
      `Write test suites for "${goal}" under tests/ and document the testing strategy in docs/testing-strategy.md.`,
    leaderMessageSuffix: () =>
      'Write test suites in tests/ and document the testing strategy in docs/testing-strategy.md.',
    scopedPaths: ['tests/**', 'docs/testing-strategy.md'],
  },
  {
    role: 'mobile',
    directory: 'mobile',
    keywords: [
      'mobile', 'ios', 'android', 'react native', 'flutter', 'swift',
      'kotlin', 'expo', 'app store', 'play store', 'native app',
      '모바일', '앱', '네이티브',
    ],
    description: 'Mobile application development',
    promptSuffix: [
      'Build the mobile application scaffold.',
      'Expected deliverables:',
      '- mobile/ app scaffold',
      '- docs/mobile-setup.md',
    ].join('\n'),
    deliverables: ['mobile/ app scaffold', 'docs/mobile-setup.md'],
    taskSubject: 'Implement the mobile application',
    taskDescription: (goal: string) =>
      `Create the mobile app for "${goal}" under mobile/ and document setup in docs/mobile-setup.md.`,
    leaderMessageSuffix: () =>
      'Build the mobile application in mobile/ and document setup in docs/mobile-setup.md.',
    scopedPaths: ['mobile/**', 'docs/mobile-setup.md'],
  },
  {
    role: 'security',
    directory: 'docs',
    keywords: [
      'security', 'auth', 'authentication', 'authorization', 'oauth', 'jwt',
      'encryption', 'permission', 'rbac', 'acl', 'firewall', 'ssl', 'tls',
      'csrf', 'xss', 'vulnerability',
      '보안', '인증', '권한',
    ],
    description: 'Security architecture and implementation',
    promptSuffix: [
      'Design and document the security architecture.',
      'Expected deliverables:',
      '- docs/security-architecture.md',
      '- docs/auth-flow.md',
    ].join('\n'),
    deliverables: ['docs/security-architecture.md', 'docs/auth-flow.md'],
    taskSubject: 'Design security architecture',
    taskDescription: (goal: string) =>
      `Design the security architecture for "${goal}" and document in docs/security-architecture.md and docs/auth-flow.md.`,
    leaderMessageSuffix: () =>
      'Design the security architecture in docs/security-architecture.md and auth flow in docs/auth-flow.md.',
    scopedPaths: ['docs/security-architecture.md', 'docs/auth-flow.md'],
  },
  {
    role: 'reviewer',
    directory: 'docs',
    keywords: [], // always included
    description: 'Output review and readiness summary',
    promptSuffix: [
      'Review the outputs of the other teammates and summarize readiness.',
      'Expected deliverable:',
      '- docs/review.md',
    ].join('\n'),
    deliverables: ['docs/review.md'],
    taskSubject: 'Review and summarize the outputs',
    taskDescription: (goal: string) =>
      `Review the work produced for "${goal}" and summarize the current readiness in docs/review.md.`,
    leaderMessageSuffix: () =>
      'Review all teammate outputs and summarize readiness in docs/review.md.',
    scopedPaths: ['docs/review.md'],
  },
]

const ALWAYS_INCLUDED_ROLES: ReadonlyArray<SoftwareFactoryRole> = ['planner', 'reviewer']
const FALLBACK_ROLES: ReadonlyArray<SoftwareFactoryRole> = ['search', 'frontend', 'backend']

type CompoundKeyword = {
  patterns: string[]
  implies: SoftwareFactoryRole[]
}

const COMPOUND_KEYWORDS: ReadonlyArray<CompoundKeyword> = [
  {
    patterns: ['full-stack', 'full stack', 'fullstack', '풀스택'],
    implies: ['frontend', 'backend'],
  },
  {
    patterns: ['웹 앱', '웹앱', 'web app', 'webapp', 'web application'],
    implies: ['frontend', 'backend'],
  },
  {
    patterns: ['쇼핑몰', 'e-commerce', 'ecommerce', '이커머스'],
    implies: ['frontend', 'backend', 'database'],
  },
  {
    patterns: ['saas', 'platform', '플랫폼'],
    implies: ['frontend', 'backend', 'database'],
  },
]

export function analyzeGoalForRoles(goal: string): SoftwareFactoryRole[] {
  const normalized = goal.toLowerCase()
  const matched = new Set<SoftwareFactoryRole>()

  // 1. Compound keyword matching (multi-role implications)
  for (const compound of COMPOUND_KEYWORDS) {
    for (const pattern of compound.patterns) {
      if (normalized.includes(pattern)) {
        for (const role of compound.implies) {
          matched.add(role)
        }
        break
      }
    }
  }

  // 2. Individual role keyword matching
  for (const def of ROLE_REGISTRY) {
    if (ALWAYS_INCLUDED_ROLES.includes(def.role)) continue
    for (const keyword of def.keywords) {
      if (normalized.includes(keyword)) {
        matched.add(def.role)
        break
      }
    }
  }

  if (matched.size === 0) {
    for (const role of FALLBACK_ROLES) {
      matched.add(role)
    }
  }

  const ordered: SoftwareFactoryRole[] = ['planner']
  for (const def of ROLE_REGISTRY) {
    if (def.role === 'planner' || def.role === 'reviewer') continue
    if (matched.has(def.role)) {
      ordered.push(def.role)
    }
  }
  ordered.push('reviewer')

  return ordered
}

export function getRoleDefinition(role: SoftwareFactoryRole): RoleDefinition {
  const def = ROLE_REGISTRY.find(d => d.role === role)
  if (!def) {
    throw new Error(`Unknown role: ${role}`)
  }
  return def
}

export function getWorkspaceDirectories(roles: SoftwareFactoryRole[]): string[] {
  const dirs = new Set<string>()
  dirs.add('docs')
  for (const role of roles) {
    const def = getRoleDefinition(role)
    dirs.add(def.directory)
  }
  return [...dirs].map(d => `${d}/`)
}

export function getReviewerDependencyRoles(roles: SoftwareFactoryRole[]): SoftwareFactoryRole[] {
  return roles.filter(r => r !== 'reviewer')
}

export type SoftwareFactoryAgentSpec = {
  name: string
  role: SoftwareFactoryRole
  directories: string[]
  prompt: string
  leaderMessage: string
  task: CreateTaskInput
  codexArgs?: string[]
}

// Legacy exports for backward compatibility
export const WORKSPACE_DIRECTORIES = ['docs/', 'frontend/', 'backend/'] as const
export const REVIEWER_DEPENDENCY_ROLES: ReadonlyArray<SoftwareFactoryRole> = [
  'planner',
  'search',
  'frontend',
  'backend',
]

function renderRolePrompt(
  role: SoftwareFactoryRole,
  goal: string,
  workspacePath: string,
  directories: string[],
): string {
  const def = getRoleDefinition(role)
  const directoryText = directories.map(dir => `- ${dir}`).join('\n')

  return [
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
    def.promptSuffix,
  ].join('\n')
}

export function buildSoftwareFactoryAgentSpecs(
  goal: string,
  workspacePath: string,
  teamName: string,
  codexArgs: string[],
  roles?: SoftwareFactoryRole[],
): SoftwareFactoryAgentSpec[] {
  const selectedRoles = roles ?? analyzeGoalForRoles(goal)

  return selectedRoles.map(role => {
    const def = getRoleDefinition(role)
    const directories =
      role === 'reviewer'
        ? selectedRoles
            .filter(r => r !== 'reviewer')
            .map(r => join(workspacePath, getRoleDefinition(r).directory))
            .filter((v, i, a) => a.indexOf(v) === i) // dedupe
        : role === 'planner'
          ? [join(workspacePath, 'docs')]
          : [join(workspacePath, def.directory), join(workspacePath, 'docs')].filter(
              (v, i, a) => a.indexOf(v) === i,
            )

    const blockedBy: string[] = []

    return {
      name: role,
      role,
      directories,
      prompt: renderRolePrompt(role, goal, workspacePath, directories),
      leaderMessage:
        `Goal: ${goal}\n` + def.leaderMessageSuffix(workspacePath),
      task: {
        subject: def.taskSubject,
        description: def.taskDescription(goal),
        status: 'pending' as const,
        owner: `${role}@${teamName}`,
        blocks: [],
        blockedBy,
        metadata: {
          ownership: {
            scopedPaths: def.scopedPaths,
            scopeSource: 'metadata' as const,
          },
        },
      },
      codexArgs,
    }
  })
}

export function parseRolesString(rolesStr: string): SoftwareFactoryRole[] | null {
  const knownRoles = new Set<string>(ROLE_REGISTRY.map(d => d.role))
  const parts = rolesStr.split(',').map(s => s.trim()).filter(Boolean)
  if (parts.length === 0) return null

  for (const part of parts) {
    if (!knownRoles.has(part)) return null
  }

  const roles = parts as SoftwareFactoryRole[]

  // Ensure planner is first and reviewer is last
  const ordered: SoftwareFactoryRole[] = []
  if (!roles.includes('planner')) ordered.push('planner')
  for (const def of ROLE_REGISTRY) {
    if (def.role === 'reviewer') continue
    if (roles.includes(def.role) && !ordered.includes(def.role)) {
      ordered.push(def.role)
    }
  }
  if (!roles.includes('reviewer')) ordered.push('reviewer')
  else ordered.push('reviewer')

  return ordered
}

export function listAvailableRoles(): string[] {
  return ROLE_REGISTRY.map(d => d.role)
}

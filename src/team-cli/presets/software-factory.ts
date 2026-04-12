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
  leaderMessageSuffix: (workspacePath: string) => string
  scopedPaths: string[]
}

export type RoleTaskTemplate = {
  subject: string
  description: string
  scopedPaths: string[]
}

export const ROLE_REGISTRY: ReadonlyArray<RoleDefinition> = [
  {
    role: 'planner',
    directory: 'docs',
    keywords: [], // always included
    description: 'Implementation planning and architecture',
    promptSuffix: [
      'Execute only the currently claimed planner task.',
      'Freeze docs/implementation-contract.md first using docs/goal.md and any metadata files already present under docs/.',
      'Only after the contract exists should later planner tasks expand docs/plan.md, docs/architecture.md, and docs/task-breakdown.md in narrow slices.',
      'Do not preempt later planner documents early; the current task prompt is the source of truth for which planner file to edit now.',
    ].join('\n'),
    deliverables: [
      'docs/plan.md',
      'docs/architecture.md',
      'docs/task-breakdown.md',
      'docs/implementation-contract.md',
    ],
    leaderMessageSuffix: () =>
      'Freeze docs/implementation-contract.md first, then create a concrete implementation plan in docs/plan.md,' +
      ' architecture notes in docs/architecture.md,' +
      ' and task breakdown notes in docs/task-breakdown.md before other teammates start coding.' +
      ' Coordinate expectations for all teammates.',
    scopedPaths: [
      'docs/plan.md',
      'docs/architecture.md',
      'docs/task-breakdown.md',
      'docs/implementation-contract.md',
    ],
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
      'Build the frontend application in narrow file-sized slices.',
      'Prefer these inputs in order:',
      '- docs/implementation-contract.md',
      '- docs/plan.md',
      '- docs/architecture.md',
      'Do not crawl broad metadata again unless explicitly instructed by the leader.',
      'Create the concrete file(s) named by the current task before attempting broader polish.',
      'Expected deliverables:',
      '- frontend/index.html',
      '- frontend/app.js',
      '- frontend/styles.css',
    ].join('\n'),
    deliverables: ['frontend/index.html', 'frontend/app.js', 'frontend/styles.css'],
    leaderMessageSuffix: () =>
      'Wait for docs/implementation-contract.md, then build the frontend application in frontend/ in narrow slices.' +
      ' Stay inside frontend/ unless the contract explicitly calls for a shared doc update.',
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
      'Build the backend/API in narrow file-sized slices.',
      'Prefer these inputs in order:',
      '- docs/implementation-contract.md',
      '- docs/plan.md',
      '- docs/architecture.md',
      'Do not crawl broad metadata again unless explicitly instructed by the leader.',
      'Create the concrete file(s) named by the current task before attempting broader polish.',
      'Expected deliverables:',
      '- backend/router.mjs',
      '- backend/server.mjs',
      '- docs/backend-api.md',
    ].join('\n'),
    deliverables: ['backend/router.mjs', 'backend/server.mjs', 'docs/backend-api.md'],
    leaderMessageSuffix: () =>
      'Wait for docs/implementation-contract.md, then build the backend service in backend/ in narrow slices.' +
      ' Document externally visible API behavior in docs/backend-api.md.',
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
      'Write contract-first and integration-focused test suites in narrow file-sized slices.',
      'Prefer these inputs in order:',
      '- docs/implementation-contract.md',
      '- docs/plan.md',
      '- docs/architecture.md',
      'Do not crawl broad metadata again unless explicitly instructed by the leader.',
      'Create the concrete file(s) named by the current task before attempting broader polish.',
      'Expected deliverables:',
      '- tests/contract.test.mjs',
      '- tests/scenarios.test.mjs',
      '- docs/testing-strategy.md',
    ].join('\n'),
    deliverables: ['tests/contract.test.mjs', 'tests/scenarios.test.mjs', 'docs/testing-strategy.md'],
    leaderMessageSuffix: () =>
      'Wait for docs/implementation-contract.md, then write contract and integration tests in tests/.' +
      ' Document the testing strategy in docs/testing-strategy.md.',
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
    leaderMessageSuffix: () =>
      'Review all teammate outputs only after implementation artifacts and test evidence exist,' +
      ' then summarize readiness in docs/review.md.',
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
  tasks: CreateTaskInput[]
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
    role === 'planner'
      ? 'You are responsible for freezing the implementation contract before broad implementation begins.'
      : 'Prefer docs/implementation-contract.md, docs/plan.md, and docs/architecture.md over raw metadata packages.',
    '',
    'Assigned directories:',
    directoryText,
    '',
    def.promptSuffix,
  ].join('\n')
}

function buildRoleTaskTemplates(
  def: RoleDefinition,
  goal: string,
): RoleTaskTemplate[] {
  switch (def.role) {
    case 'planner':
      return [
        {
          subject: 'Freeze the implementation contract',
          description:
            `Create docs/implementation-contract.md for "${goal}" first. ` +
            'The implementation contract must be detailed enough that frontend/backend/testing can work from it without rereading broad metadata.',
          scopedPaths: ['docs/implementation-contract.md'],
        },
        {
          subject: 'Write the implementation plan',
          description:
            `Using docs/implementation-contract.md as the frozen source, create docs/plan.md for "${goal}". ` +
            'Keep it aligned with the contract and do not broaden scope beyond the frozen contract.',
          scopedPaths: ['docs/plan.md'],
        },
        {
          subject: 'Write the architecture notes',
          description:
            `Using docs/implementation-contract.md and docs/plan.md, create docs/architecture.md for "${goal}". ` +
            'Keep the architecture bounded by the frozen contract and implementation plan.',
          scopedPaths: ['docs/architecture.md'],
        },
        {
          subject: 'Write the task breakdown',
          description:
            `Using docs/implementation-contract.md, docs/plan.md, and docs/architecture.md, create docs/task-breakdown.md for "${goal}". ` +
            'Make the breakdown implementation-ready for frontend/backend/testing/reviewer follow-up.',
          scopedPaths: [
            'docs/task-breakdown.md',
          ],
        },
      ]
    case 'frontend':
      return [
        {
          subject: 'Create frontend HTML shell',
          description:
            `Using docs/implementation-contract.md as the frozen source, refine frontend/index.html for "${goal}". ` +
            'Edit the existing frontend/index.html starter in place. If the current shell already satisfies the task, keep edits minimal and complete the work item. Focus only on structure, transcript container, composer shell, and placeholder regions in frontend/index.html.',
          scopedPaths: ['frontend/index.html'],
        },
        {
          subject: 'Create frontend interaction script',
          description:
            `Using docs/implementation-contract.md as the frozen source, refine frontend/app.js for "${goal}". ` +
            'Edit the existing frontend/app.js starter in place. Handle bootstrap loading, submit flow, fallback/reset behavior, and API wiring only in frontend/app.js.',
          scopedPaths: ['frontend/app.js'],
        },
        {
          subject: 'Create frontend styles',
          description:
            `Using docs/implementation-contract.md as the frozen source, refine frontend/styles.css for "${goal}". ` +
            'Edit the existing frontend/styles.css starter in place. Style only the current HTML shell and interaction states in frontend/styles.css without expanding scope.',
          scopedPaths: ['frontend/styles.css'],
        },
      ]
    case 'backend':
      return [
        {
          subject: 'Create backend route module',
          description:
            `Using docs/implementation-contract.md as the frozen source, refine backend/router.mjs for "${goal}". ` +
            'Edit the existing backend/router.mjs starter in place. If the current route scaffold already satisfies most of the task, keep edits minimal and complete the work item. Implement only the route handlers and deterministic response contract in backend/router.mjs.',
          scopedPaths: ['backend/router.mjs'],
        },
        {
          subject: 'Create backend server entry',
          description:
            `Using docs/implementation-contract.md as the frozen source, refine backend/server.mjs for "${goal}". ` +
            'Edit the existing backend/server.mjs starter in place. Wire the HTTP server, route registration, and startup behavior only in backend/server.mjs.',
          scopedPaths: ['backend/server.mjs'],
        },
        {
          subject: 'Document backend API',
          description:
            `Document the externally visible backend behavior for "${goal}" in docs/backend-api.md using docs/implementation-contract.md and completed backend implementation evidence. Edit the existing docs/backend-api.md starter in place.`,
          scopedPaths: ['docs/backend-api.md'],
        },
      ]
    case 'testing':
      return [
        {
          subject: 'Write contract tests',
          description:
            `Using docs/implementation-contract.md as the frozen source, refine tests/contract.test.mjs for "${goal}". ` +
            'Edit the existing tests/contract.test.mjs starter in place. Focus only on request/response and invariant coverage in tests/contract.test.mjs.',
          scopedPaths: ['tests/contract.test.mjs'],
        },
        {
          subject: 'Write scenario and persona tests',
          description:
            `Using docs/implementation-contract.md as the frozen source, refine tests/scenarios.test.mjs for "${goal}". ` +
            'Edit the existing tests/scenarios.test.mjs starter in place. Cover scenario, fallback, and persona behavior only in tests/scenarios.test.mjs.',
          scopedPaths: ['tests/scenarios.test.mjs'],
        },
        {
          subject: 'Document testing strategy',
          description:
            `Document the testing strategy, coverage boundaries, and known gaps for "${goal}" in docs/testing-strategy.md using the completed test suite as evidence. Edit the existing docs/testing-strategy.md starter in place.`,
          scopedPaths: ['docs/testing-strategy.md'],
        },
      ]
    default:
      if (def.role === 'database') {
        return [
          {
            subject: 'Design and implement the database layer',
            description: `Design the database schema for "${goal}" under database/.`,
            scopedPaths: ['database/**'],
          },
          {
            subject: 'Document database schema',
            description: `Document the database schema for "${goal}" in docs/database-schema.md.`,
            scopedPaths: ['docs/database-schema.md'],
          },
        ]
      }
      if (def.role === 'devops') {
        return [
          {
            subject: 'Set up infrastructure and deployment',
            description: `Configure infrastructure and deployment pipeline for "${goal}" under infra/.`,
            scopedPaths: ['infra/**'],
          },
          {
            subject: 'Document deployment steps',
            description: `Document deployment and operator steps for "${goal}" in docs/deployment.md.`,
            scopedPaths: ['docs/deployment.md'],
          },
        ]
      }
      if (def.role === 'mobile') {
        return [
          {
            subject: 'Implement the mobile application',
            description: `Create the mobile app for "${goal}" under mobile/.`,
            scopedPaths: ['mobile/**'],
          },
          {
            subject: 'Document mobile setup',
            description: `Document mobile setup for "${goal}" in docs/mobile-setup.md.`,
            scopedPaths: ['docs/mobile-setup.md'],
          },
        ]
      }
      return [
        {
          subject: def.role === 'reviewer'
            ? 'Review and summarize the outputs'
            : def.role === 'search'
              ? 'Research requirements and references'
              : def.role === 'security'
                ? 'Design security architecture'
                : `Deliver ${def.role} outputs`,
          description:
            def.role === 'reviewer'
              ? `Review the work produced for "${goal}" and summarize the current readiness in docs/review.md.`
              : def.role === 'search'
                ? `Research implementation constraints and references for "${goal}" and record them in docs/research.md.`
                : def.role === 'security'
                  ? `Design the security architecture for "${goal}" and document it in docs/security-architecture.md and docs/auth-flow.md.`
                  : `Produce the expected ${def.role} outputs for "${goal}".`,
          scopedPaths: def.scopedPaths,
        },
      ]
  }
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

    const taskTemplates = buildRoleTaskTemplates(def, goal)

    return {
      name: role,
      role,
      directories,
      prompt: renderRolePrompt(role, goal, workspacePath, directories),
      leaderMessage:
        `Goal: ${goal}\n` + def.leaderMessageSuffix(workspacePath),
      tasks: taskTemplates.map(taskTemplate => ({
        subject: taskTemplate.subject,
        description: taskTemplate.description,
        status: 'pending' as const,
        owner: `${role}@${teamName}`,
        blocks: [],
        blockedBy: [],
        metadata: {
          ownership: {
            scopedPaths: taskTemplate.scopedPaths,
            scopeSource: 'metadata' as const,
          },
        },
      })),
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

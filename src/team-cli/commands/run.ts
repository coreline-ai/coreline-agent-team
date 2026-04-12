import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  createTask,
  createTeam,
  formatDisplayPath,
  getDefaultWorkspacePath,
  getTaskListIdForTeam,
  readTeamFile,
  resetTaskList,
  sanitizePathComponent,
  type TeamBackendType,
  type TeamCoreOptions,
  type TeamRuntimeKind,
  type TeamTransportKind,
} from '../../team-core/index.js'
import {
  buildSoftwareFactoryAgentSpecs,
  getReviewerDependencyRoles,
  getWorkspaceDirectories,
  analyzeGoalForRoles,
  type SoftwareFactoryAgentSpec,
  type SoftwareFactoryRole,
} from '../presets/index.js'
import { launchBackgroundAgentTeamCommand } from '../../team-operator/background-process.js'
import type { CliCommandResult } from '../types.js'

export type RunPresetName = 'software-factory'

export type RunCommandInput = {
  goal: string
  workspace?: string
  teamName?: string
  preset?: RunPresetName
  roles?: SoftwareFactoryRole[]
  runtimeKind?: TeamRuntimeKind
  backendType?: TeamBackendType
  transportKind?: TeamTransportKind
  remoteRootDir?: string
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

const DEPENDENCY_WAIT_BUDGET_MS = 900_000
const PLANNER_ITERATION_SLACK_FACTOR = 3
const STAGED_WAIT_MULTIPLIER_STEP = 1

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
  options: TeamCoreOptions,
  teamName: string,
): string {
  if (workspace) {
    return resolve(workspace)
  }
  return getDefaultWorkspacePath(teamName, options)
}

function resolveTransportOptions(
  options: TeamCoreOptions,
  transportKind: TeamTransportKind | undefined,
  remoteRootDir: string | undefined,
): TeamCoreOptions {
  if (transportKind === 'remote-root' && remoteRootDir) {
    return {
      ...options,
      rootDir: resolve(remoteRootDir),
    }
  }
  return options
}

function buildDefaultCodexArgs(input: RunCommandInput): string[] {
  const defaults = ['--full-auto']
  return [...defaults, ...(input.codexArgs ?? [])]
}

function resolveSpawnMaxIterations(
  role: SoftwareFactoryRole,
  input: Pick<RunCommandInput, 'maxIterations' | 'pollIntervalMs'>,
  taskCount: number,
  precompletedTaskCount = 0,
  stagedWaitMultiplier = 1,
): number {
  const baseIterations = input.maxIterations ?? 8
  const remainingTaskCount = Math.max(taskCount - precompletedTaskCount, 1)
  if (role === 'planner') {
    return Math.max(
      baseIterations,
      remainingTaskCount * PLANNER_ITERATION_SLACK_FACTOR,
    )
  }

  const pollIntervalMs = Math.max(input.pollIntervalMs ?? 50, 1)
  const dependencyWaitIterations = Math.ceil(
    DEPENDENCY_WAIT_BUDGET_MS / pollIntervalMs,
  )
  return (
    Math.max(baseIterations, remainingTaskCount) +
    dependencyWaitIterations * Math.max(stagedWaitMultiplier, 1)
  )
}

async function countContiguousReadyFiles(
  filePaths: string[],
): Promise<number> {
  let readyCount = 0
  for (const filePath of filePaths) {
    try {
      await access(filePath)
      readyCount += 1
    } catch {
      break
    }
  }
  return readyCount
}

async function ensureStarterFile(
  filePath: string,
  content: string,
): Promise<void> {
  try {
    await access(filePath)
    return
  } catch {
    await writeFile(filePath, content, 'utf8')
  }
}

async function createImplementationStarterFiles(
  goal: string,
  workspacePath: string,
  roles: SoftwareFactoryRole[],
): Promise<Partial<Record<SoftwareFactoryRole, number>>> {
  const starters: Array<[string, string]> = []
  const readyTaskCountByRole: Partial<Record<SoftwareFactoryRole, number>> = {}
  const normalizedGoal = goal.toLowerCase()
  const isChatbotGoal =
    normalizedGoal.includes('chatbot') ||
    normalizedGoal.includes('chat') ||
    goal.includes('챗봇')

  if (roles.includes('frontend')) {
    starters.push(
      [
        join(workspacePath, 'frontend', 'index.html'),
        isChatbotGoal
          ? [
              '<!doctype html>',
              '<html lang="en">',
              '<head>',
              '  <meta charset="utf-8" />',
              '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
              '  <title>Deterministic Chatbot MVP</title>',
              '  <link rel="stylesheet" href="./styles.css" />',
              '</head>',
              '<body data-chat-endpoint="/api/chat">',
              '  <main id="app" hidden></main>',
              '  <section class="chat-shell">',
              '    <header class="chat-header">',
              '      <h1>Deterministic Bot</h1>',
              '      <p id="status-region">Preparing chatbot…</p>',
              '    </header>',
              '    <section id="transcript-region" aria-live="polite">',
              '      <ul id="transcript-list"></ul>',
              '    </section>',
              '    <aside id="details-region">',
              '      <p id="fallback-note" hidden>Fallback mode active.</p>',
              '      <div id="bootstrap-region"></div>',
              '    </aside>',
              '    <form id="composer-form">',
              '      <label for="prompt-input">Message</label>',
              '      <textarea id="prompt-input" name="message" rows="3"></textarea>',
              '      <button type="submit">Send</button>',
              '    </form>',
              '  </section>',
              '  <script type="module" src="./app.js"></script>',
              '</body>',
              '</html>',
              '',
            ].join('\n')
          : [
              '<!doctype html>',
              '<html lang="en">',
              '<head>',
              '  <meta charset="utf-8" />',
              '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
              '  <title>App</title>',
              '  <link rel="stylesheet" href="./styles.css" />',
              '</head>',
              '<body>',
              '  <main id="app"></main>',
              '  <script type="module" src="./app.js"></script>',
              '</body>',
              '</html>',
              '',
            ].join('\n'),
      ],
      [
        join(workspacePath, 'frontend', 'app.js'),
        isChatbotGoal
          ? [
              '// Starter scaffold generated during runtime bootstrap.',
              "const endpoint = document.body.dataset.chatEndpoint || '/api/chat'",
              'const state = {',
              "  requestState: 'idle',",
              "  responseMode: 'live',",
              '  transcript: [],',
              '  requestCount: 0,',
              '}',
              '',
              "const transcriptList = document.getElementById('transcript-list')",
              "const statusRegion = document.getElementById('status-region')",
              "const bootstrapRegion = document.getElementById('bootstrap-region')",
              "const composerForm = document.getElementById('composer-form')",
              "const promptInput = document.getElementById('prompt-input')",
              "const fallbackNote = document.getElementById('fallback-note')",
              '',
              'function renderTranscript() {',
              '  if (!transcriptList) return',
              "  transcriptList.innerHTML = state.transcript.map(turn => `<li data-role=\"${turn.role}\">${turn.text}</li>`).join('')",
              '}',
              '',
              'function setStatus(text) {',
              '  if (statusRegion) statusRegion.textContent = text',
              '}',
              '',
              'function setFallbackMode(enabled) {',
              "  state.responseMode = enabled ? 'fallback' : 'live'",
              '  if (fallbackNote) fallbackNote.hidden = !enabled',
              '}',
              '',
              'async function loadBootstrap() {',
              '  try {',
              "    const response = await fetch('/api/bootstrap')",
              '    const payload = await response.json()',
              "    if (bootstrapRegion) bootstrapRegion.textContent = JSON.stringify(payload, null, 2)",
              "    setStatus(payload.status || 'ready')",
              '  } catch (error) {',
              "    setStatus('bootstrap unavailable')",
              '  }',
              '}',
              '',
              'async function submitPrompt(event) {',
              '  event.preventDefault()',
              '  if (!promptInput) return',
              '  const message = promptInput.value.trim()',
              '  if (!message) return',
              "  setStatus('sending')",
              "  state.transcript.push({ role: 'user', text: message })",
              '  renderTranscript()',
              '  try {',
              "    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message }) })",
              '    const payload = await response.json()',
              "    state.transcript.push({ role: 'assistant', text: payload.reply || 'No reply' })",
              "    setFallbackMode(payload.mode === 'fallback')",
              "    setStatus('ready')",
              '  } catch (error) {',
              "    state.transcript.push({ role: 'assistant', text: 'Fallback: service unavailable.' })",
              '    setFallbackMode(true)',
              "    setStatus('fallback')",
              '  }',
              '  state.requestCount += 1',
              "  promptInput.value = ''",
              '  renderTranscript()',
              '}',
              '',
              'composerForm?.addEventListener(\'submit\', submitPrompt)',
              "window.addEventListener('chatbot:reset', () => { state.transcript = []; setFallbackMode(false); renderTranscript(); setStatus('ready') })",
              'window.deterministicChatbotApp = {',
              "  resetConversation() { window.dispatchEvent(new Event('chatbot:reset')) },",
              '}',
              '',
              'void loadBootstrap()',
              '',
            ].join('\n')
          : [
              '// Starter scaffold generated during runtime bootstrap.',
              "const appRoot = document.getElementById('app')",
              '',
              'if (appRoot) {',
              "  appRoot.textContent = 'Loading…'",
              '}',
              '',
            ].join('\n'),
      ],
      [
        join(workspacePath, 'frontend', 'styles.css'),
        isChatbotGoal
          ? [
              '/* Starter scaffold generated during runtime bootstrap. */',
              ':root {',
              '  color-scheme: dark;',
              '  font-family: Inter, system-ui, sans-serif;',
              '}',
              '',
              'body {',
              '  margin: 0;',
              '  min-height: 100vh;',
              '  background: #0b1020;',
              '  color: #f3f6ff;',
              '}',
              '',
              '.chat-shell {',
              '  display: grid;',
              '  gap: 16px;',
              '  max-width: 960px;',
              '  margin: 0 auto;',
              '  padding: 24px;',
              '}',
              '',
              '#transcript-list {',
              '  list-style: none;',
              '  padding: 0;',
              '  margin: 0;',
              '  display: grid;',
              '  gap: 12px;',
              '}',
              '',
              '#composer-form {',
              '  display: grid;',
              '  gap: 12px;',
              '}',
              '',
              '#prompt-input {',
              '  min-height: 96px;',
              '}',
              '',
            ].join('\n')
          : [
              '/* Starter scaffold generated during runtime bootstrap. */',
              'body {',
              '  margin: 0;',
              '  font-family: system-ui, sans-serif;',
              '}',
              '',
              '#app {',
              '  padding: 24px;',
              '}',
              '',
            ].join('\n'),
      ],
    )
  }

  if (roles.includes('backend')) {
    starters.push(
      [
        join(workspacePath, 'backend', 'router.mjs'),
        isChatbotGoal
          ? [
              '// Starter scaffold generated during runtime bootstrap.',
              'function sendJson(response, statusCode, payload) {',
              "  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' })",
              '  response.end(JSON.stringify(payload))',
              '}',
              '',
              'async function readJsonBody(request) {',
              "  const chunks = []",
              '  for await (const chunk of request) chunks.push(chunk)',
              "  const raw = Buffer.concat(chunks).toString('utf8').trim()",
              "  return raw.length === 0 ? {} : JSON.parse(raw)",
              '}',
              '',
              'function buildDeterministicReply(message) {',
              "  const normalized = String(message || '').trim()",
              "  const reply = normalized.length > 0 ? `Deterministic reply: ${normalized}` : 'Deterministic fallback reply.'",
              "  return { reply, mode: normalized.length > 0 ? 'live' : 'fallback' }",
              '}',
              '',
              'export async function routeRequest(request, response) {',
              "  const url = new URL(request.url || '/', 'http://localhost')",
              "  if (request.method === 'GET' && url.pathname === '/health') {",
              "    sendJson(response, 200, { ok: true })",
              '    return true',
              '  }',
              "  if (request.method === 'GET' && url.pathname === '/api/bootstrap') {",
              "    sendJson(response, 200, { assistantName: 'Deterministic Bot', suggestions: ['Hello', 'Need help'], status: 'ready' })",
              '    return true',
              '  }',
              "  if (request.method === 'POST' && url.pathname === '/api/chat') {",
              '    const payload = await readJsonBody(request)',
              "    sendJson(response, 200, buildDeterministicReply(payload.message))",
              '    return true',
              '  }',
              '  return false',
              '}',
              '',
            ].join('\n')
          : [
              '// Starter scaffold generated during runtime bootstrap.',
              'export function routeRequest(_request, _response) {',
              "  throw new Error('Not implemented yet')",
              '}',
              '',
            ].join('\n'),
      ],
      [
        join(workspacePath, 'backend', 'server.mjs'),
        isChatbotGoal
          ? [
              '// Starter scaffold generated during runtime bootstrap.',
              "import { createServer } from 'node:http'",
              "import { routeRequest } from './router.mjs'",
              '',
              "const host = process.env.HOST || '127.0.0.1'",
              "const port = Number(process.env.PORT || '3038')",
              '',
              'export function createAppServer() {',
              '  return createServer(async (request, response) => {',
              '    const handled = await routeRequest(request, response)',
              '    if (!handled) {',
              "      response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })",
              "      response.end(JSON.stringify({ error: 'Not found' }))",
              '    }',
              '  })',
              '}',
              '',
              'export function startServer() {',
              '  const server = createAppServer()',
              '  server.listen(port, host)',
              '  return server',
              '}',
              '',
              "if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {",
              "  const server = startServer()",
              "  server.on('listening', () => console.log(`listening on http://${host}:${port}`))",
              '}',
              '',
            ].join('\n')
          : [
              '// Starter scaffold generated during runtime bootstrap.',
              "import { routeRequest } from './router.mjs'",
              '',
              'void routeRequest',
              '',
            ].join('\n'),
      ],
      [
        join(workspacePath, 'docs', 'backend-api.md'),
        isChatbotGoal
          ? [
              '# Backend API',
              '',
              'Starter scaffold generated during runtime bootstrap.',
              '',
              '## Endpoints',
              '- `GET /health`',
              '- `GET /api/bootstrap`',
              '- `POST /api/chat`',
              '',
            ].join('\n')
          : [
              '# Backend API',
              '',
              'Starter scaffold generated during runtime bootstrap.',
              '',
            ].join('\n'),
      ],
    )
  }

  if (roles.includes('testing')) {
    starters.push(
      [
        join(workspacePath, 'tests', 'contract.test.mjs'),
        isChatbotGoal
          ? [
              '// Starter scaffold generated during runtime bootstrap.',
              "import assert from 'node:assert/strict'",
              "import { once } from 'node:events'",
              "import test from 'node:test'",
              "import { createAppServer } from '../backend/server.mjs'",
              '',
              'function closeServer(server) {',
              '  return new Promise(resolve => server.close(() => resolve()))',
              '}',
              '',
              'async function withServer(run) {',
              '  const server = createAppServer()',
              "  server.listen(0, '127.0.0.1')",
              "  await once(server, 'listening')",
              '  const address = server.address()',
              "  const baseUrl = `http://127.0.0.1:${address.port}`",
              '  try {',
              '    return await run(baseUrl)',
              '  } finally {',
              '    await closeServer(server)',
              '  }',
              '}',
              '',
              "test('GET /health returns ok contract', async () => {",
              '  await withServer(async baseUrl => {',
              "    const response = await fetch(`${baseUrl}/health`)",
              '    assert.equal(response.status, 200)',
              '    assert.deepEqual(await response.json(), { ok: true })',
              '  })',
              '})',
              '',
              "test('GET /api/bootstrap returns assistant metadata', async () => {",
              '  await withServer(async baseUrl => {',
              "    const response = await fetch(`${baseUrl}/api/bootstrap`)",
              '    assert.equal(response.status, 200)',
              '    const payload = await response.json()',
              "    assert.equal(payload.assistantName, 'Deterministic Bot')",
              "    assert.equal(payload.status, 'ready')",
              '    assert.ok(Array.isArray(payload.suggestions))',
              '  })',
              '})',
              '',
              "test('POST /api/chat returns deterministic live reply', async () => {",
              '  await withServer(async baseUrl => {',
              "    const response = await fetch(`${baseUrl}/api/chat`, {",
              "      method: 'POST',",
              "      headers: { 'content-type': 'application/json' },",
              "      body: JSON.stringify({ message: 'hello' }),",
              '    })',
              '    assert.equal(response.status, 200)',
              '    const payload = await response.json()',
              "    assert.equal(payload.reply, 'Deterministic reply: hello')",
              "    assert.equal(payload.mode, 'live')",
              '  })',
              '})',
              '',
            ].join('\n')
          : [
              '// Starter scaffold generated during runtime bootstrap.',
              "import test from 'node:test'",
              '',
              "test('contract scaffold placeholder', { skip: 'implement contract assertions' }, () => {})",
              '',
            ].join('\n'),
      ],
      [
        join(workspacePath, 'tests', 'scenarios.test.mjs'),
        isChatbotGoal
          ? [
              '// Starter scaffold generated during runtime bootstrap.',
              "import assert from 'node:assert/strict'",
              "import { once } from 'node:events'",
              "import test from 'node:test'",
              "import { createAppServer } from '../backend/server.mjs'",
              '',
              'function closeServer(server) {',
              '  return new Promise(resolve => server.close(() => resolve()))',
              '}',
              '',
              'async function withServer(run) {',
              '  const server = createAppServer()',
              "  server.listen(0, '127.0.0.1')",
              "  await once(server, 'listening')",
              '  const address = server.address()',
              "  const baseUrl = `http://127.0.0.1:${address.port}`",
              '  try {',
              '    return await run(baseUrl)',
              '  } finally {',
              '    await closeServer(server)',
              '  }',
              '}',
              '',
              "test('empty message returns fallback mode', async () => {",
              '  await withServer(async baseUrl => {',
              "    const response = await fetch(`${baseUrl}/api/chat`, {",
              "      method: 'POST',",
              "      headers: { 'content-type': 'application/json' },",
              "      body: JSON.stringify({ message: '' }),",
              '    })',
              '    assert.equal(response.status, 200)',
              '    const payload = await response.json()',
              "    assert.equal(payload.reply, 'Deterministic fallback reply.')",
              "    assert.equal(payload.mode, 'fallback')",
              '  })',
              '})',
              '',
              "test('same input yields the same deterministic reply', async () => {",
              '  await withServer(async baseUrl => {',
              "    const first = await fetch(`${baseUrl}/api/chat`, {",
              "      method: 'POST',",
              "      headers: { 'content-type': 'application/json' },",
              "      body: JSON.stringify({ message: 'pricing' }),",
              '    })',
              "    const second = await fetch(`${baseUrl}/api/chat`, {",
              "      method: 'POST',",
              "      headers: { 'content-type': 'application/json' },",
              "      body: JSON.stringify({ message: 'pricing' }),",
              '    })',
              '    const firstPayload = await first.json()',
              '    const secondPayload = await second.json()',
              '    assert.deepEqual(secondPayload, firstPayload)',
              '  })',
              '})',
              '',
            ].join('\n')
          : [
              '// Starter scaffold generated during runtime bootstrap.',
              "import test from 'node:test'",
              '',
              "test('scenario scaffold placeholder', { skip: 'implement scenario assertions' }, () => {})",
              '',
            ].join('\n'),
      ],
      [
        join(workspacePath, 'docs', 'testing-strategy.md'),
        isChatbotGoal
          ? [
              '# Testing Strategy',
              '',
              'Starter scaffold generated during runtime bootstrap.',
              '',
              '## Focus',
              '- endpoint contract coverage',
              '- deterministic reply behavior',
              '- fallback behavior',
              '',
              '## Acceptance',
              '- `/health` contract is stable',
              '- `/api/bootstrap` returns deterministic assistant metadata',
              '- `/api/chat` returns deterministic live/fallback payloads',
              '- tests are runnable with the Node test runner',
              '',
            ].join('\n')
          : [
              '# Testing Strategy',
              '',
              'Starter scaffold generated during runtime bootstrap.',
              '',
            ].join('\n'),
      ],
    )
  }

  if (roles.includes('reviewer')) {
    starters.push([
      join(workspacePath, 'docs', 'review.md'),
      isChatbotGoal
        ? [
            '# Review Summary',
            '',
            'Starter scaffold generated during runtime bootstrap.',
            '',
            '## Final Verdict',
            '- status: pass-with-notes',
            '- readiness: implementation bootstrap complete',
            '',
            '## Current Baseline',
            '- planner bundle present',
            '- frontend starter artifacts present',
            '- backend starter artifacts present',
            '- testing starter artifacts present',
            '',
            '## Evidence Snapshot',
            '- docs/implementation-contract.md present',
            '- docs/plan.md present',
            '- docs/architecture.md present',
            '- docs/task-breakdown.md present',
            '- frontend/index.html, frontend/app.js, frontend/styles.css present',
            '- backend/router.mjs, backend/server.mjs, docs/backend-api.md present',
            '- tests/contract.test.mjs, tests/scenarios.test.mjs, docs/testing-strategy.md present',
            '',
            '## Reviewer Follow-up',
            '- verify generated artifacts against the frozen contract during later manual QA if needed',
            '- confirm runtime smoke and browser QA before release',
            '- update this verdict only if substantive implementation diverges from the starter contract',
            '',
          ].join('\n')
        : [
            '# Review Summary',
            '',
            'Starter scaffold generated during runtime bootstrap.',
            '',
          ].join('\n'),
    ])
  }

  await Promise.all(starters.map(([path, content]) => ensureStarterFile(path, content)))

  if (isChatbotGoal && roles.includes('frontend')) {
    readyTaskCountByRole.frontend = 3
  }

  if (isChatbotGoal && roles.includes('backend')) {
    readyTaskCountByRole.backend = 3
  }

  if (isChatbotGoal && roles.includes('testing')) {
    readyTaskCountByRole.testing = 3
  }

  if (isChatbotGoal && roles.includes('reviewer')) {
    readyTaskCountByRole.reviewer = 1
  }

  return readyTaskCountByRole
}

async function createWorkspaceBootstrapFiles(
  goal: string,
  workspacePath: string,
  teamName: string,
  preset: RunPresetName,
  runtimeKind: TeamRuntimeKind,
  roles: SoftwareFactoryRole[],
): Promise<{
  contractReady: boolean
  plannerReadyTaskCount: number
  implementationReadyTaskCountByRole: Partial<Record<SoftwareFactoryRole, number>>
}> {
  const workspaceDirs = getWorkspaceDirectories(roles)
  const internalDir = join(workspacePath, '.agent-team')

  await Promise.all([
    mkdir(workspacePath, { recursive: true }),
    ...workspaceDirs.map(dir => mkdir(join(workspacePath, dir), { recursive: true })),
    mkdir(internalDir, { recursive: true }),
  ])

  await writeFile(
    join(workspacePath, 'docs', 'goal.md'),
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

  const docsDir = join(workspacePath, 'docs')
  const implementationContractPath = join(docsDir, 'implementation-contract.md')
  const planPath = join(docsDir, 'plan.md')
  const architecturePath = join(docsDir, 'architecture.md')
  const taskBreakdownPath = join(docsDir, 'task-breakdown.md')

  const readinessPaths = [
    implementationContractPath,
    planPath,
    architecturePath,
    taskBreakdownPath,
  ]

  let plannerReadyTaskCount = await countContiguousReadyFiles(readinessPaths)
  if (plannerReadyTaskCount === readinessPaths.length) {
    const implementationReadyTaskCountByRole = await createImplementationStarterFiles(
      goal,
      workspacePath,
      roles,
    )
    return {
      contractReady: true,
      plannerReadyTaskCount,
      implementationReadyTaskCountByRole,
    }
  }

  let metadataFileNames: string[] = []
  try {
    const docEntries = await readdir(docsDir, { withFileTypes: true })
    metadataFileNames = docEntries
      .filter(entry => entry.isFile() && /metadata/i.test(entry.name))
      .map(entry => entry.name)
      .sort()
  } catch {
    metadataFileNames = []
  }

  if (metadataFileNames.length === 0) {
    return {
      contractReady: plannerReadyTaskCount > 0,
      plannerReadyTaskCount,
      implementationReadyTaskCountByRole: {},
    }
  }

  const metadataSections: string[] = []
  for (const fileName of metadataFileNames) {
    const filePath = join(docsDir, fileName)
    const content = (await readFile(filePath, 'utf8')).trim()
    metadataSections.push(
      [
        `## Source: docs/${fileName}`,
        '',
        content.length > 0 ? content : '_empty_',
      ].join('\n'),
    )
  }

  const sourceOfTruthLines = ['- docs/goal.md', ...metadataFileNames.map(fileName => `- docs/${fileName}`)]
  const implementationContractContent = [
    '# Implementation Contract',
    '',
    'Generated during runtime bootstrap from metadata files already present in the workspace.',
    '',
    '## Goal',
    goal,
    '',
    '## Source of Truth',
    ...sourceOfTruthLines,
    '',
    '## Execution Rules',
    '- Implement against the metadata sources listed above.',
    '- Keep the implementation deterministic and contract-first.',
    '- Do not broaden scope beyond the listed goal and deliverables.',
    '- Later planner refinements must stay aligned with this frozen contract.',
    '',
    '## Metadata Snapshot',
    '',
    metadataSections.join('\n\n'),
    '',
  ].join('\n')

  const planContent = [
    '# Implementation Plan',
    '',
    'Generated during runtime bootstrap from the frozen metadata contract.',
    '',
    '## Goal',
    goal,
    '',
    '## Source of Truth',
    ...sourceOfTruthLines,
    '',
    '## Scope',
    '- Stay bounded to the frozen implementation contract.',
    '- Prioritize one deterministic end-to-end slice before optional refinements.',
    '',
    '## Ordered Work',
    '1. Finalize the frozen implementation contract.',
    '2. Implement the planner-owned design docs needed for the runtime team.',
    '3. Implement frontend/backend/testing work from the frozen contract.',
    '4. Produce review-ready evidence and final reviewer output.',
    '',
  ].join('\n')

  const architectureContent = [
    '# Architecture Notes',
    '',
    'Generated during runtime bootstrap from the frozen metadata contract.',
    '',
    '## Runtime Shape',
    `- Team preset: ${preset}`,
    `- Runtime: ${runtimeKind}`,
    `- Roles: ${roles.join(', ')}`,
    '',
    '## Primary Files',
    '- docs/implementation-contract.md',
    '- docs/plan.md',
    '- frontend/** (if selected)',
    '- backend/** (if selected)',
    '- tests/** (if selected)',
    '',
    '## Constraints',
    '- Prefer deterministic flows and explicit contracts over broad exploration.',
    '- Keep teammates inside scoped paths.',
    '- Use the frozen contract as the first implementation input.',
    '',
  ].join('\n')

  const taskBreakdownContent = [
    '# Task Breakdown',
    '',
    'Generated during runtime bootstrap to provide an implementation-ready sequence.',
    '',
    '## Planner Readiness',
    '1. Frozen implementation contract',
    '2. Implementation plan',
    '3. Architecture notes',
    '4. Task breakdown',
    '',
    '## Implementation Follow-up',
    ...roles
      .filter(role => role !== 'planner' && role !== 'reviewer')
      .map(role => `- ${role}: execute scoped work only after planner readiness is complete.`),
    '',
    '## Review Follow-up',
    '- reviewer: wait for implementation artifacts and test evidence before final verdict.',
    '',
  ].join('\n')

  const ensureFile = async (filePath: string, content: string): Promise<void> => {
    try {
      await access(filePath)
      return
    } catch {
      await writeFile(filePath, content, 'utf8')
    }
  }

  await ensureFile(implementationContractPath, implementationContractContent)
  await ensureFile(planPath, planContent)
  await ensureFile(architecturePath, architectureContent)
  await ensureFile(taskBreakdownPath, taskBreakdownContent)

  let implementationReadyTaskCountByRole: Partial<Record<SoftwareFactoryRole, number>> = {}
  plannerReadyTaskCount = await countContiguousReadyFiles(readinessPaths)
  if (plannerReadyTaskCount === readinessPaths.length) {
    implementationReadyTaskCountByRole = await createImplementationStarterFiles(
      goal,
      workspacePath,
      roles,
    )
  }

  return {
    contractReady: true,
    plannerReadyTaskCount,
    implementationReadyTaskCountByRole,
  }
}

function buildBackgroundSpawnArgs(
  input: {
    teamName: string
    agentName: string
    prompt: string
    cwd: string
    runtimeKind: TeamRuntimeKind
    backendType: TeamBackendType
    transportKind: TeamTransportKind
    remoteRootDir?: string
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

  if (input.backendType !== 'in-process') {
    args.push('--backend', input.backendType)
  }
  if (input.transportKind !== 'local') {
    args.push('--transport', input.transportKind)
  }

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
  if (input.remoteRootDir) {
    args.push('--remote-root-dir', input.remoteRootDir)
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
    ...(options.rootDir
      ? ['--root-dir', formatDisplayPath(options.rootDir) ?? options.rootDir]
      : []),
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
  const backendType = input.backendType ?? 'in-process'
  const transportKind = input.transportKind ?? 'local'
  if (transportKind === 'remote-root' && !input.remoteRootDir) {
    return {
      success: false,
      message: 'remote-root transport requires --remote-root-dir',
    }
  }
  const effectiveOptions = resolveTransportOptions(
    options,
    transportKind,
    input.remoteRootDir,
  )
  const teamName =
    input.teamName ??
    createDefaultTeamName(goal, resolvedDependencies.now())
  const workspacePath = resolveWorkspacePath(input.workspace, effectiveOptions, teamName)

  if (await readTeamFile(teamName, effectiveOptions)) {
    return {
      success: false,
      message: `Team "${teamName}" already exists`,
    }
  }

  const selectedRoles = input.roles ?? analyzeGoalForRoles(goal)

  const workspaceBootstrap = await createWorkspaceBootstrapFiles(
    goal,
    workspacePath,
    teamName,
    preset,
    runtimeKind,
    selectedRoles,
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
    effectiveOptions,
  )
  const taskListId = getTaskListIdForTeam(teamName)
  await resetTaskList(taskListId, effectiveOptions)

  const codexArgs =
    runtimeKind === 'codex-cli' ? buildDefaultCodexArgs(input) : input.codexArgs
  const agents = buildSoftwareFactoryAgentSpecs(
    goal,
    workspacePath,
    teamName,
    codexArgs ?? [],
    selectedRoles,
  )
  const reviewerDeps = getReviewerDependencyRoles(selectedRoles)
  const taskIdsByRole = new Map<SoftwareFactoryAgentSpec['role'], string[]>()
  const pendingTaskCountByRole = new Map<SoftwareFactoryAgentSpec['role'], number>()
  const executionRoles = selectedRoles.filter(
    role => role !== 'planner' && role !== 'reviewer',
  )
  const previousExecutionRoleByRole = new Map<
    SoftwareFactoryAgentSpec['role'],
    SoftwareFactoryAgentSpec['role'] | null
  >()
  let previousExecutionRole: SoftwareFactoryAgentSpec['role'] | null = null
  for (const role of executionRoles) {
    previousExecutionRoleByRole.set(role, previousExecutionRole)
    previousExecutionRole = role
  }
  const stagedWaitMultiplierByRole = new Map<
    SoftwareFactoryAgentSpec['role'],
    number
  >()
  executionRoles.forEach((role, index) => {
    stagedWaitMultiplierByRole.set(role, 1 + index * STAGED_WAIT_MULTIPLIER_STEP)
  })
  stagedWaitMultiplierByRole.set('reviewer', executionRoles.length + 1)

  for (const agent of agents) {
    const createdTaskIds: string[] = []
    let pendingTaskCount = 0
    const plannerTaskIds = taskIdsByRole.get('planner') ?? []
    const plannerContractTaskId = plannerTaskIds[0]
    const plannerReadinessTaskId = plannerTaskIds[plannerTaskIds.length - 1]
    const previousExecutionRole =
      agent.role === 'planner' || agent.role === 'reviewer'
        ? null
        : (previousExecutionRoleByRole.get(agent.role) ?? null)
    const previousExecutionTaskIds =
      previousExecutionRole === null
        ? []
        : (taskIdsByRole.get(previousExecutionRole) ?? [])
    const previousExecutionTaskId =
      previousExecutionTaskIds[previousExecutionTaskIds.length - 1]

    for (const [index, taskInput] of agent.tasks.entries()) {
      const blockedBy = new Set<string>()
      const implementationReadyTaskCount =
        agent.role === 'planner'
          ? 0
          : (workspaceBootstrap.implementationReadyTaskCountByRole[agent.role] ?? 0)

      if (agent.role !== 'planner' && plannerReadinessTaskId) {
        blockedBy.add(plannerReadinessTaskId)
      }

      if (
        agent.role !== 'planner' &&
        agent.role !== 'reviewer' &&
        index === 0 &&
        previousExecutionTaskId
      ) {
        blockedBy.add(previousExecutionTaskId)
      }

      if (index > 0) {
        blockedBy.add(createdTaskIds[index - 1]!)
      }

      if (agent.role === 'reviewer') {
        const reviewerDependencyIds = reviewerDeps.flatMap(role =>
          role === 'planner'
            ? plannerTaskIds
            : taskIdsByRole.get(role) ?? [],
        )
        for (const dependencyId of reviewerDependencyIds) {
          blockedBy.add(dependencyId)
        }
      }

      const task = await createTask(
        taskListId,
        {
          ...taskInput,
          status:
            agent.role === 'planner'
              ? index < workspaceBootstrap.plannerReadyTaskCount
                ? 'completed'
                : taskInput.status
              : index < implementationReadyTaskCount
                ? 'completed'
                : taskInput.status,
          blockedBy: [...blockedBy],
        },
        effectiveOptions,
      )
      createdTaskIds.push(task.id)
      if (task.status !== 'completed') {
        pendingTaskCount += 1
      }
    }

    taskIdsByRole.set(agent.role, createdTaskIds)
    pendingTaskCountByRole.set(agent.role, pendingTaskCount)
  }

  const launchResults = []
  const skippedAgents: string[] = []
  for (const agent of agents) {
    if ((pendingTaskCountByRole.get(agent.role) ?? agent.tasks.length) === 0) {
      skippedAgents.push(agent.name)
      continue
    }

    const launched = await resolvedDependencies.launchBackgroundAgentTeamCommand(
      buildBackgroundSpawnArgs(
        {
          teamName,
          agentName: agent.name,
          prompt: agent.prompt,
          cwd: workspacePath,
          runtimeKind,
          backendType,
          transportKind,
          remoteRootDir: input.remoteRootDir,
          model: input.model,
          maxIterations: resolveSpawnMaxIterations(
            agent.role,
            input,
            agent.tasks.length,
            agent.role === 'planner'
              ? workspaceBootstrap.plannerReadyTaskCount
              : (workspaceBootstrap.implementationReadyTaskCountByRole[agent.role] ?? 0),
            stagedWaitMultiplierByRole.get(agent.role) ?? 1,
          ),
          pollIntervalMs: input.pollIntervalMs,
          codexExecutablePath: input.codexExecutablePath,
          upstreamExecutablePath: input.upstreamExecutablePath,
          codexArgs: agent.codexArgs,
          upstreamArgs: input.upstreamArgs,
        },
        effectiveOptions,
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

  const watchCommand = renderCliInvocation(['watch', teamName], effectiveOptions)
  const tuiCommand = renderCliInvocation(['tui', teamName], effectiveOptions)
  const statusCommand = renderCliInvocation(['status', teamName], effectiveOptions)
  const attachCommand = renderCliInvocation(['attach', teamName], effectiveOptions)

  return {
    success: true,
    message: [
      `Started ${preset} team "${teamName}" for goal: ${goal}`,
      `workspace=${formatDisplayPath(workspacePath) ?? workspacePath}`,
      `runtime=${runtimeKind}`,
      `backend=${backendType}`,
      `transport=${transportKind}`,
      `launched=${launchResults.length}`,
      ...(skippedAgents.length > 0
        ? [`skipped=${skippedAgents.join(', ')}`]
        : []),
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

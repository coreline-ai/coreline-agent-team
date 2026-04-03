import { Box, Text, useApp, useInput, useStdout } from 'ink'
import TextInput from 'ink-text-input'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RenderOptions } from 'ink'
import { runDoctorCommand, type DoctorCommandInput } from '../team-cli/commands/doctor.js'
import { runRunCommand } from '../team-cli/commands/run.js'
import type { CliCommandResult } from '../team-cli/types.js'
import {
  classifySummaryState,
  listWorkspaceFiles,
  readWorkspacePreview,
  summarizeWorkspaceFiles,
  type SummaryResultState,
  type WorkspacePreview,
} from '../team-cli/commands/summary-utils.js'
import { sendLeaderMessage, type OperatorActionResult } from '../team-operator/index.js'
import type { TeamCoreOptions, TeamRuntimeKind } from '../team-core/index.js'
import {
  formatElapsedShort,
  formatDisplayPath,
  getDefaultWorkspacePath,
  getAgentDisplayInfo,
  sanitizePathComponent,
} from '../team-core/index.js'
import { useDashboard } from './hooks/use-dashboard.js'
import { Panel, KeyHint, TabLabel } from './components/layout.js'
import { getTeamTuiLayoutMode } from './layout-mode.js'
import { buildTaskRuntimeSignals } from './task-runtime.js'

export type ProjectStudioStartInput = {
  goal: string
  teamName?: string
  workspace?: string
  runtimeKind?: TeamRuntimeKind
  model?: string
  codexExecutablePath?: string
  upstreamExecutablePath?: string
}

export type ProjectStudioStartResult = CliCommandResult & {
  teamName?: string
  workspacePath?: string
}

export type ProjectStudioSendInput = {
  teamName: string
  recipient: string
  message: string
}

export type ProjectStudioAppDependencies = {
  runDoctorCommand: (input: DoctorCommandInput) => Promise<CliCommandResult>
  startProject: (
    input: ProjectStudioStartInput,
    options: TeamCoreOptions,
  ) => Promise<ProjectStudioStartResult>
  sendMessage: (
    input: ProjectStudioSendInput,
    options: TeamCoreOptions,
  ) => Promise<OperatorActionResult>
}

export type ProjectStudioAppProps = {
  options?: TeamCoreOptions
  teamName?: string
  workspace?: string
  runtimeKind?: TeamRuntimeKind
  model?: string
  codexExecutablePath?: string
  upstreamExecutablePath?: string
  initialInput?: string
  autoSubmitInitialInput?: boolean
  viewport?: {
    columns: number
    rows: number
  }
  exitOnRender?: boolean
  onExit?: (exitCode: number) => void
  dependencies?: Partial<ProjectStudioAppDependencies>
}

type ProjectStudioDetailTab = 'files' | 'preview' | 'teammates'

type StudioLogItem = {
  id: string
  kind: 'system' | 'user' | 'activity' | 'error'
  text: string
}

const defaultProjectStudioDependencies: ProjectStudioAppDependencies = {
  runDoctorCommand,
  async startProject(input, options) {
    const resolvedTeamName = input.teamName ?? createStudioTeamName(input.goal)
    const resolvedWorkspace = resolveStudioWorkspacePath(
      input.workspace,
      options,
      resolvedTeamName,
    )
    const result = await runRunCommand(
      {
        goal: input.goal,
        teamName: resolvedTeamName,
        workspace: resolvedWorkspace,
        runtimeKind: input.runtimeKind ?? 'codex-cli',
        model: input.model ?? 'gpt-5.4-mini',
        codexExecutablePath: input.codexExecutablePath,
        upstreamExecutablePath: input.upstreamExecutablePath,
      },
      options,
    )

    return {
      ...result,
      teamName: resolvedTeamName,
      workspacePath: resolvedWorkspace,
    }
  },
  async sendMessage(input, options) {
    return sendLeaderMessage(input, options)
  },
}

function createStudioTeamName(goal: string): string {
  const sanitized = sanitizePathComponent(goal)
    .toLowerCase()
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24)
  const prefix = sanitized.length > 0 ? sanitized : 'project'
  return `${prefix}-${Date.now().toString(36)}`
}

function resolveStudioWorkspacePath(
  workspace: string | undefined,
  options: TeamCoreOptions,
  teamName: string,
): string {
  if (workspace) {
    return workspace
  }
  return getDefaultWorkspacePath(teamName, options)
}

function createLogId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function messageToLogItems(
  message: string,
  kind: StudioLogItem['kind'],
): StudioLogItem[] {
  return message
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.length > 0)
    .map(line => ({
      id: createLogId(),
      kind,
      text: line,
    }))
}

function logColor(kind: StudioLogItem['kind']): string | undefined {
  if (kind === 'system') {
    return 'cyan'
  }
  if (kind === 'user') {
    return 'green'
  }
  if (kind === 'error') {
    return 'red'
  }
  return 'yellow'
}

function parseFollowUpInput(input: string): {
  recipient: string
  message: string
} {
  const trimmed = input.trim()
  if (trimmed.startsWith('/to ')) {
    const remainder = trimmed.slice(4).trim()
    const [recipient, ...parts] = remainder.split(/\s+/)
    if (!recipient || parts.length === 0) {
      throw new Error('Usage: /to <agent> <message>')
    }
    return {
      recipient,
      message: parts.join(' '),
    }
  }

  return {
    recipient: 'planner',
    message: trimmed,
  }
}

function getNextStudioDetailTab(
  current: ProjectStudioDetailTab,
): ProjectStudioDetailTab {
  if (current === 'files') {
    return 'preview'
  }
  if (current === 'preview') {
    return 'teammates'
  }
  return 'files'
}

function getPreviousStudioDetailTab(
  current: ProjectStudioDetailTab,
): ProjectStudioDetailTab {
  if (current === 'teammates') {
    return 'preview'
  }
  if (current === 'preview') {
    return 'files'
  }
  return 'teammates'
}

function renderStudioHeader(input: {
  currentTeamName?: string
  rootDir?: string
  runtimeKind: TeamRuntimeKind
  model?: string
  readinessLabel: string
  currentRecipient: string
  inFlight: boolean
}): string {
  return [
    `Studio: ${input.currentTeamName ?? 'new project'}`,
    `Root: ${formatDisplayPath(input.rootDir) ?? '~/.agent-team'}`,
    `Runtime: ${input.runtimeKind}`,
    `Model: ${input.model ?? 'default'}`,
    `Codex readiness: ${input.readinessLabel}`,
    `Follow-up target: ${input.currentRecipient}`,
    input.inFlight ? 'Action: running' : 'Action: idle',
  ].join('  |  ')
}

export function ProjectStudioApp(props: ProjectStudioAppProps) {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const options = props.options ?? {}
  const viewportColumns = props.viewport?.columns ?? stdout.columns ?? 120
  const layoutMode = getTeamTuiLayoutMode(viewportColumns)
  const dependencies = useMemo(() => ({
    ...defaultProjectStudioDependencies,
    ...props.dependencies,
  } satisfies ProjectStudioAppDependencies), [props.dependencies])

  const [currentTeamName, setCurrentTeamName] = useState<string | undefined>(
    props.teamName,
  )
  const [workspacePath, setWorkspacePath] = useState<string | undefined>(
    props.workspace,
  )
  const [inputValue, setInputValue] = useState(props.initialInput ?? '')
  const [currentRecipient, setCurrentRecipient] = useState('planner')
  const [detailTab, setDetailTab] = useState<ProjectStudioDetailTab>('files')
  const [logs, setLogs] = useState<StudioLogItem[]>(() => [
    {
      id: createLogId(),
      kind: 'system',
      text: 'ATCLI ready. Type a project goal and press Enter to start the Codex-backed agent team.',
    },
    {
      id: createLogId(),
      kind: 'system',
      text: 'After the project starts, plain text sends a follow-up message to planner. Use /to <agent> <message> to target another teammate.',
    },
  ])
  const [readinessLabel, setReadinessLabel] = useState('checking')
  const [actionInFlight, setActionInFlight] = useState(false)
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([])
  const [workspacePreview, setWorkspacePreview] = useState<
    WorkspacePreview | undefined
  >(undefined)
  const [resultState, setResultState] =
    useState<SummaryResultState>('pending')
  const seenActivityIdsRef = useRef<Set<string>>(new Set())
  const autoSubmitTriggeredRef = useRef(false)
  const lastResultStateRef = useRef<SummaryResultState | undefined>(undefined)
  const lastWorkspaceSignatureRef = useRef('')
  const workspaceRefreshNonceRef = useRef(0)

  const dashboardState = useDashboard(currentTeamName, options, {
    selectedAgentName: currentRecipient,
    transcriptLimit: 6,
    activityLimit: 8,
    pollIntervalMs: 500,
  })

  const dashboard = dashboardState.dashboard
  const visibleLogs = logs.slice(-14)
  const allTeammateStatuses =
    dashboard?.statuses.filter(status => status.name !== 'team-lead') ?? []
  const visibleTasks = dashboard?.tasks.slice(0, 6) ?? []
  const visibleStatuses = allTeammateStatuses.slice(0, 6)
  const displayNow = Date.now()
  const visibleStatusDisplays = visibleStatuses.map(status => ({
    status,
    display: getAgentDisplayInfo(status, displayNow),
  }))
  const taskRuntimeSignals = useMemo(
    () => buildTaskRuntimeSignals(visibleTasks, allTeammateStatuses, displayNow),
    [visibleTasks, allTeammateStatuses, displayNow],
  )
  const workspaceSummary = useMemo(
    () => summarizeWorkspaceFiles(workspaceFiles, 6),
    [workspaceFiles],
  )
  const executingCount = visibleStatusDisplays.filter(
    item => item.display.state === 'executing-turn',
  ).length
  const staleCount = visibleStatusDisplays.filter(
    item => item.display.state === 'stale',
  ).length
  const settlingCount = visibleStatusDisplays.filter(
    item => item.display.state === 'settling',
  ).length

  function appendLogs(nextLogs: StudioLogItem[]) {
    setLogs(previous => [...previous, ...nextLogs])
  }

  useEffect(() => {
    if (!props.exitOnRender) {
      return
    }
    props.onExit?.(0)
    exit()
  }, [props, exit])

  useEffect(() => {
    let disposed = false

    const runStartupDoctor = async () => {
      const result = await dependencies.runDoctorCommand({
        workspace: props.workspace ?? process.cwd(),
        probe: false,
        codexExecutablePath: props.codexExecutablePath,
      })
      if (disposed) {
        return
      }
      setReadinessLabel(result.success ? 'ready' : 'attention')
      appendLogs(
        messageToLogItems(
          result.message,
          result.success ? 'system' : 'error',
        ),
      )
    }

    void runStartupDoctor()
    return () => {
      disposed = true
    }
  }, [
    dependencies,
    props.codexExecutablePath,
    props.workspace,
  ])

  useEffect(() => {
    if (!dashboard) {
      return
    }

    const nextRecipient =
      currentRecipient === 'planner' &&
      !dashboard.statuses.some(status => status.name === currentRecipient)
        ? dashboard.statuses.find(status => status.name !== 'team-lead')?.name ?? 'planner'
        : currentRecipient

    if (nextRecipient !== currentRecipient) {
      setCurrentRecipient(nextRecipient)
    }

    const newActivityLogs = dashboard.activity
      .filter(item => !seenActivityIdsRef.current.has(item.id))
      .map(item => {
        seenActivityIdsRef.current.add(item.id)
        return {
          id: item.id,
          kind: 'activity' as const,
          text: `[${item.from}] ${item.text}`,
        }
      })

    if (newActivityLogs.length > 0) {
      appendLogs(newActivityLogs)
    }
  }, [dashboard, currentRecipient])

  useEffect(() => {
    if (!currentTeamName || !dashboard) {
      setResultState('pending')
      lastResultStateRef.current = undefined
      return
    }

    const nextState = classifySummaryState({
      totalTasks: dashboard.tasks.length,
      pendingTasks: dashboard.taskCounts.pending,
      inProgressTasks: dashboard.taskCounts.inProgress,
      completedTasks: dashboard.taskCounts.completed,
      activeMembers: dashboard.statuses.filter(status => status.isActive).length,
      failureCount: dashboard.activity.filter(item =>
        item.text.toLowerCase().includes('failed'),
      ).length,
    })

    setResultState(nextState)

    if (lastResultStateRef.current !== nextState) {
      lastResultStateRef.current = nextState
      appendLogs([
        {
          id: createLogId(),
          kind: nextState === 'attention' ? 'error' : 'system',
          text: `Project result state: ${nextState}`,
        },
      ])
    }
  }, [currentTeamName, dashboard])

  useEffect(() => {
    if (!currentTeamName || !workspacePath) {
      setWorkspaceFiles([])
      setWorkspacePreview(undefined)
      lastWorkspaceSignatureRef.current = ''
      return
    }

    let disposed = false
    const nonce = workspaceRefreshNonceRef.current + 1
    workspaceRefreshNonceRef.current = nonce

    const refreshWorkspaceSummary = async () => {
      const files = await listWorkspaceFiles(workspacePath, 12)
      if (disposed || workspaceRefreshNonceRef.current !== nonce) {
        return
      }

      setWorkspaceFiles(files)
      const preview = await readWorkspacePreview(workspacePath, files)
      if (disposed || workspaceRefreshNonceRef.current !== nonce) {
        return
      }
      setWorkspacePreview(preview)

      const signature = files.join('|')
      if (signature !== lastWorkspaceSignatureRef.current) {
        lastWorkspaceSignatureRef.current = signature
        if (files.length > 0) {
          const summary = summarizeWorkspaceFiles(files, 3)
          const previewList = summary.featuredFiles.join(', ')
          appendLogs([
            {
              id: createLogId(),
              kind: 'system',
              text:
                summary.hiddenCount > 0
                  ? `Generated files detected: ${previewList}, +${summary.hiddenCount} more`
                  : `Generated files detected: ${previewList}`,
            },
          ])
        }
      }
    }

    void refreshWorkspaceSummary()
    return () => {
      disposed = true
    }
  }, [
    currentTeamName,
    workspacePath,
    dashboard?.taskCounts.completed,
    dashboard?.taskCounts.inProgress,
    dashboard?.activity.length,
  ])


  useEffect(() => {
    if (
      !props.autoSubmitInitialInput ||
      autoSubmitTriggeredRef.current ||
      inputValue.trim().length === 0
    ) {
      return
    }

    autoSubmitTriggeredRef.current = true
    void submitInput()
  }, [props.autoSubmitInitialInput, inputValue, currentTeamName])

  useInput((_input, key) => {
    if (key.ctrl && _input === 'c') {
      props.onExit?.(0)
      exit()
      return
    }
    if (_input === '[') {
      setDetailTab(previous => getPreviousStudioDetailTab(previous))
      return
    }
    if (_input === ']') {
      setDetailTab(previous => getNextStudioDetailTab(previous))
      return
    }
  })

  async function submitInput() {
    const trimmed = inputValue.trim()
    if (!trimmed || actionInFlight) {
      return
    }

    if (trimmed === '/quit') {
      props.onExit?.(0)
      exit()
      return
    }

    if (trimmed === '/doctor') {
      setInputValue('')
      setActionInFlight(true)
      appendLogs([{ id: createLogId(), kind: 'user', text: '/doctor' }])
      try {
        const result = await dependencies.runDoctorCommand({
          workspace: workspacePath ?? props.workspace ?? process.cwd(),
          probe: true,
          codexExecutablePath: props.codexExecutablePath,
        })
        setReadinessLabel(result.success ? 'ready' : 'attention')
        appendLogs(
          messageToLogItems(
            result.message,
            result.success ? 'system' : 'error',
          ),
        )
      } finally {
        setActionInFlight(false)
      }
      return
    }

    setInputValue('')

    if (!currentTeamName) {
      appendLogs([{ id: createLogId(), kind: 'user', text: trimmed }])
      setActionInFlight(true)
      try {
        const result = await dependencies.startProject(
          {
            goal: trimmed,
            teamName: props.teamName,
            workspace: props.workspace,
            runtimeKind: props.runtimeKind ?? 'codex-cli',
            model: props.model ?? 'gpt-5.4-mini',
            codexExecutablePath: props.codexExecutablePath,
            upstreamExecutablePath: props.upstreamExecutablePath,
          },
          options,
        )
        appendLogs(
          messageToLogItems(
            result.message,
            result.success ? 'system' : 'error',
          ),
        )
        if (result.success) {
          setCurrentTeamName(result.teamName)
          setWorkspacePath(result.workspacePath)
          setReadinessLabel('running')
        }
      } finally {
        setActionInFlight(false)
      }
      return
    }

    setActionInFlight(true)
    try {
      const parsed = parseFollowUpInput(trimmed)
      setCurrentRecipient(parsed.recipient)
      appendLogs([
        {
          id: createLogId(),
          kind: 'user',
          text: `You -> ${parsed.recipient}: ${parsed.message}`,
        },
      ])
      const result = await dependencies.sendMessage(
        {
          teamName: currentTeamName,
          recipient: parsed.recipient,
          message: parsed.message,
        },
        options,
      )
      appendLogs(
        messageToLogItems(
          result.message,
          result.success ? 'system' : 'error',
        ),
      )
    } catch (error) {
      appendLogs([
        {
          id: createLogId(),
          kind: 'error',
          text: error instanceof Error ? error.message : String(error),
        },
      ])
    } finally {
      setActionInFlight(false)
    }
  }

  const header = useMemo(
    () =>
      renderStudioHeader({
        currentTeamName,
        rootDir: options.rootDir,
        runtimeKind: props.runtimeKind ?? 'codex-cli',
        model: props.model ?? 'gpt-5.4-mini',
        readinessLabel,
        currentRecipient,
        inFlight: actionInFlight,
      }),
    [
      currentTeamName,
      options.rootDir,
      props.runtimeKind,
      props.model,
      readinessLabel,
      currentRecipient,
      actionInFlight,
    ],
  )

  const projectResultLabel = !currentTeamName
    ? 'waiting-for-goal'
    : dashboard
      ? resultState
      : 'starting'
  const detailTabs = (
    <Box>
      <TabLabel label="Files" active={detailTab === 'files'} />
      <Text>  </Text>
      <TabLabel label="Preview" active={detailTab === 'preview'} />
      <Text>  </Text>
      <TabLabel label="Teammates" active={detailTab === 'teammates'} />
      <Text>  </Text>
      <KeyHint label="[ ] detail tab" />
    </Box>
  )
  const detailPanel =
    detailTab === 'files' ? (
      <Panel title={`Generated Files (${workspaceSummary.total})`} minHeight={8}>
        {workspaceSummary.total === 0 ? (
          <Text color="gray">No generated files yet.</Text>
        ) : (
          <>
            <Text color="gray">{workspaceSummary.overview}</Text>
            {workspaceSummary.featuredFiles.map(file => (
              <Text key={file}>{file}</Text>
            ))}
            {workspaceSummary.hiddenCount > 0 ? (
              <Text color="gray">+{workspaceSummary.hiddenCount} more files</Text>
            ) : null}
          </>
        )}
      </Panel>
    ) : detailTab === 'preview' ? (
      <Panel
        title={
          workspacePreview
            ? `Output Preview (${workspacePreview.path})`
            : 'Output Preview'
        }
        minHeight={8}
      >
        {workspacePreview ? (
          <>
            {workspacePreview.headline ? (
              <Text color="gray">headline={workspacePreview.headline}</Text>
            ) : null}
            {workspacePreview.content.split('\n').map((line, index) => (
              <Text key={`${workspacePreview.path}-${index}`}>
                {line.length > 0 ? line : ' '}
              </Text>
            ))}
          </>
        ) : (
          <Text color="gray">No preview file yet.</Text>
        )}
      </Panel>
    ) : (
      <Panel title="Teammates" minHeight={8}>
        {visibleStatuses.length === 0 ? (
          <Text color="gray">No teammates yet.</Text>
        ) : (
          visibleStatusDisplays.map(({ status, display }) => (
            <Text key={status.agentId}>
              {status.name} {status.isActive ? 'active' : 'inactive'} {status.status} {display.state}
              {display.workLabel ? ` ${display.workLabel}` : ''}
              {display.state === 'executing-turn' && display.turnAgeMs !== undefined
                ? ` ${formatElapsedShort(display.turnAgeMs)}`
                : ''}
              {display.state === 'settling' && display.turnAgeMs !== undefined
                ? ` settle=${formatElapsedShort(display.turnAgeMs)}`
                : ''}
              {display.state === 'stale' && display.heartbeatAgeMs !== undefined
                ? ` stale=${formatElapsedShort(display.heartbeatAgeMs)}`
                : ''}
              {' '}
              {status.runtimeKind ?? 'local'}
              {status.processId ? ` pid=${status.processId}` : ''}
              {status.launchMode ? ` ${status.launchMode}` : ''}
              {status.launchCommand ? `/${status.launchCommand}` : ''}
            </Text>
          ))
        )}
      </Panel>
    )

  return (
    <Box flexDirection="column">
      <Text>{header}</Text>
      <Box>
        <KeyHint label="Enter submit" active />
        <Text>  </Text>
        <KeyHint label="/doctor" />
        <Text>  </Text>
        {currentTeamName ? (
          <>
            <KeyHint label="/to <agent> <message>" />
            <Text>  </Text>
          </>
        ) : null}
        <KeyHint label="/quit" />
        <Text>  </Text>
        <KeyHint label="Ctrl+C exit" />
      </Box>

      {layoutMode === 'wide' ? (
        <Box marginTop={1}>
          <Panel title="Conversation / State Log" width="60%" minHeight={18} borderColor="green">
            {visibleLogs.map(item => (
              <Text key={item.id} color={logColor(item.kind)}>
                {item.kind === 'user' ? '> ' : ''}
                {item.text}
              </Text>
            ))}
          </Panel>

          <Box flexDirection="column" width="40%" marginLeft={1}>
            <Panel title="Project Status" minHeight={8}>
              <Text>team={currentTeamName ?? 'not started'}</Text>
              <Text>workspace={formatDisplayPath(workspacePath ?? props.workspace) ?? 'auto'}</Text>
              <Text>result={projectResultLabel}</Text>
              <Text>tasks={dashboard?.tasks.length ?? 0}</Text>
              <Text>active={visibleStatuses.filter(status => status.isActive).length}</Text>
              <Text>executing={executingCount}</Text>
              <Text>settling={settlingCount}</Text>
              <Text>stale={staleCount}</Text>
              <Text>generated={workspaceFiles.length}</Text>
              <Text>preview={workspacePreview?.path ?? 'none'}</Text>
              <Text>follow-up={currentRecipient}</Text>
            </Panel>

            <Box marginTop={1}>
              <Panel title="Tasks" minHeight={8}>
                <Text color="gray">
                  workers {taskRuntimeSignals.overview.active} active  {taskRuntimeSignals.overview.executing} running  {taskRuntimeSignals.overview.settling} settling  {taskRuntimeSignals.overview.stale} stale
                </Text>
                {visibleTasks.length === 0 ? (
                  <Text color="gray">No tasks yet.</Text>
                ) : (
                  visibleTasks.map(task => (
                    <Text key={task.id}>
                      #{task.id} [{task.status}] {task.subject}
                      {taskRuntimeSignals.labelsByTaskId[task.id]
                        ? ` · ${taskRuntimeSignals.labelsByTaskId[task.id]}`
                        : ''}
                    </Text>
                  ))
                )}
              </Panel>
            </Box>

            <Box marginTop={1}>{detailTabs}</Box>
            <Box marginTop={1}>{detailPanel}</Box>
          </Box>
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
          <Panel title="Conversation / State Log" minHeight={12} borderColor="green">
            {visibleLogs.map(item => (
              <Text key={item.id} color={logColor(item.kind)}>
                {item.kind === 'user' ? '> ' : ''}
                {item.text}
              </Text>
            ))}
          </Panel>

          <Box marginTop={1}>
            <Panel title="Project Status" minHeight={8}>
              <Text>team={currentTeamName ?? 'not started'}</Text>
              <Text>workspace={formatDisplayPath(workspacePath ?? props.workspace) ?? 'auto'}</Text>
              <Text>result={projectResultLabel}</Text>
              <Text>tasks={dashboard?.tasks.length ?? 0}</Text>
              <Text>active={visibleStatuses.filter(status => status.isActive).length}</Text>
              <Text>executing={executingCount}</Text>
              <Text>settling={settlingCount}</Text>
              <Text>stale={staleCount}</Text>
              <Text>generated={workspaceFiles.length}</Text>
              <Text>preview={workspacePreview?.path ?? 'none'}</Text>
              <Text>follow-up={currentRecipient}</Text>
            </Panel>
          </Box>

          <Box marginTop={1}>
            <Panel title="Tasks" minHeight={8}>
              <Text color="gray">
                workers {taskRuntimeSignals.overview.active} active  {taskRuntimeSignals.overview.executing} running  {taskRuntimeSignals.overview.settling} settling  {taskRuntimeSignals.overview.stale} stale
              </Text>
              {visibleTasks.length === 0 ? (
                <Text color="gray">No tasks yet.</Text>
              ) : (
                visibleTasks.map(task => (
                  <Text key={task.id}>
                    #{task.id} [{task.status}] {task.subject}
                    {taskRuntimeSignals.labelsByTaskId[task.id]
                      ? ` · ${taskRuntimeSignals.labelsByTaskId[task.id]}`
                      : ''}
                  </Text>
                ))
              )}
            </Panel>
          </Box>

          <Box marginTop={1}>{detailTabs}</Box>
          <Box marginTop={1}>{detailPanel}</Box>
        </Box>
      )}

      <Box marginTop={1}>
        <Panel title={currentTeamName ? `Prompt / follow-up -> ${currentRecipient}` : 'Project goal prompt'} minHeight={4} borderColor="yellow">
          <Text color="gray">
            {currentTeamName
              ? 'Plain text sends to planner by default. Use /to <agent> <message> to target another teammate.'
              : 'Describe the project you want the agent team to build and press Enter.'}
          </Text>
          <Box marginTop={1}>
            <Text color="green">{currentTeamName ? 'message>' : 'goal>'} </Text>
            <TextInput value={inputValue} onChange={setInputValue} onSubmit={() => void submitInput()} />
          </Box>
        </Panel>
      </Box>
    </Box>
  )
}

export type ProjectStudioCommandRenderOptions = {
  renderOptions?: RenderOptions
}

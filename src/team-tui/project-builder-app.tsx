import { Box, Text, useApp, useInput } from 'ink'
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
  type SummaryResultState,
  type WorkspacePreview,
} from '../team-cli/commands/summary-utils.js'
import { sendLeaderMessage, type OperatorActionResult } from '../team-operator/index.js'
import type { TeamCoreOptions, TeamRuntimeKind } from '../team-core/index.js'
import { sanitizePathComponent } from '../team-core/index.js'
import { useDashboard } from './hooks/use-dashboard.js'
import { Panel, KeyHint } from './components/layout.js'

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
  exitOnRender?: boolean
  onExit?: (exitCode: number) => void
  dependencies?: Partial<ProjectStudioAppDependencies>
}

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
  teamName: string,
): string {
  if (workspace) {
    return workspace
  }
  return `${process.cwd()}/agent-team-output/${teamName}`
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
    `Root: ${input.rootDir ?? '~/.agent-team'}`,
    `Runtime: ${input.runtimeKind}`,
    `Model: ${input.model ?? 'default'}`,
    `Codex readiness: ${input.readinessLabel}`,
    `Follow-up target: ${input.currentRecipient}`,
    input.inFlight ? 'Action: running' : 'Action: idle',
  ].join('  |  ')
}

export function ProjectStudioApp(props: ProjectStudioAppProps) {
  const { exit } = useApp()
  const options = props.options ?? {}
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
  const visibleTasks = dashboard?.tasks.slice(0, 6) ?? []
  const visibleStatuses =
    dashboard?.statuses.filter(status => status.name !== 'team-lead').slice(0, 6) ?? []

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
          const previewList = files.slice(0, 3).join(', ')
          appendLogs([
            {
              id: createLogId(),
              kind: 'system',
              text:
                files.length > 3
                  ? `Generated files detected: ${previewList}, +${files.length - 3} more`
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

  return (
    <Box flexDirection="column">
      <Text>{header}</Text>
      <Box>
        <KeyHint label="Enter submit" active />
        <Text>  </Text>
        <KeyHint label="/doctor" />
        <Text>  </Text>
        <KeyHint label="/to <agent> <message>" />
        <Text>  </Text>
        <KeyHint label="/quit" />
        <Text>  </Text>
        <KeyHint label="Ctrl+C exit" />
      </Box>

      <Box marginTop={1}>
        <Panel title="Conversation / State Log" width="60%" minHeight={20} borderColor="green">
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
            <Text>workspace={workspacePath ?? props.workspace ?? 'auto'}</Text>
            <Text>result={projectResultLabel}</Text>
            <Text>tasks={dashboard?.tasks.length ?? 0}</Text>
            <Text>active={visibleStatuses.filter(status => status.isActive).length}</Text>
            <Text>generated={workspaceFiles.length}</Text>
            <Text>preview={workspacePreview?.path ?? 'none'}</Text>
            <Text>follow-up={currentRecipient}</Text>
          </Panel>

          <Box marginTop={1}>
            <Panel title="Tasks" minHeight={8}>
              {visibleTasks.length === 0 ? (
                <Text color="gray">No tasks yet.</Text>
              ) : (
                visibleTasks.map(task => (
                  <Text key={task.id}>#{task.id} [{task.status}] {task.subject}</Text>
                ))
              )}
            </Panel>
          </Box>

          <Box marginTop={1}>
            <Panel title="Generated Files" minHeight={8}>
              {workspaceFiles.length === 0 ? (
                <Text color="gray">No generated files yet.</Text>
              ) : (
                workspaceFiles.slice(0, 6).map(file => (
                  <Text key={file}>{file}</Text>
                ))
              )}
            </Panel>
          </Box>

          <Box marginTop={1}>
            <Panel
              title={
                workspacePreview
                  ? `Output Preview (${workspacePreview.path})`
                  : 'Output Preview'
              }
              minHeight={8}
            >
              {workspacePreview ? (
                workspacePreview.content.split('\n').map((line, index) => (
                  <Text key={`${workspacePreview.path}-${index}`}>
                    {line.length > 0 ? line : ' '}
                  </Text>
                ))
              ) : (
                <Text color="gray">No preview file yet.</Text>
              )}
            </Panel>
          </Box>

          <Box marginTop={1}>
            <Panel title="Teammates" minHeight={8}>
              {visibleStatuses.length === 0 ? (
                <Text color="gray">No teammates yet.</Text>
              ) : (
                visibleStatuses.map(status => (
                  <Text key={status.agentId}>
                    {status.name} {status.isActive ? 'active' : 'inactive'} {status.status} {status.runtimeKind ?? 'local'}
                  </Text>
                ))
              )}
            </Panel>
          </Box>
        </Box>
      </Box>

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

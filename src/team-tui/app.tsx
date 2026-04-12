import { Box, Newline, Text, useApp, useInput, useStdout } from 'ink'
import TextInput from 'ink-text-input'
import { useEffect, useState } from 'react'
import {
  approvePermission,
  approvePlan,
  approveSandbox,
  createTask,
  createTeam,
  denyPermission,
  denySandbox,
  loadGlobalDashboardSummary,
  rejectPlan,
  resumeTeammate,
  sendLeaderMessage,
  shutdownTeammate,
  spawnTeammate,
} from '../team-operator/index.js'
import type { GlobalDashboardSummary, TeamListItem } from '../team-operator/index.js'
import { ActivityFeed } from './components/activity-feed.js'
import { HelpOverlay } from './components/help-overlay.js'
import { KeyHint, TabLabel } from './components/layout.js'
import { LogViewer } from './components/log-viewer.js'
import { TasksPane } from './components/tasks-pane.js'
import { TeammatesPane } from './components/teammates-pane.js'
import { TranscriptDrawer } from './components/transcript-drawer.js'
import { StatusBar } from './components/status-bar.js'
import { buildTaskRuntimeSignals } from './task-runtime.js'
import { getTeamTuiLayoutMode } from './layout-mode.js'
import { useDashboard } from './hooks/use-dashboard.js'
import { useModalState } from './hooks/use-modal-state.js'
import { useShortcuts } from './hooks/use-shortcuts.js'
import { ApprovalModal } from './modals/approval-modal.js'
import { SendMessageModal } from './modals/send-message-modal.js'
import { SpawnModal } from './modals/spawn-modal.js'
import { TaskCreateModal } from './modals/task-create-modal.js'
import type {
  TeamTuiAppProps,
  TuiDetailTab,
  TuiFocusMode,
  TuiLogStream,
  TuiPane,
} from './types.js'

function getNextPane(current: TuiPane): TuiPane {
  return current === 'tasks' ? 'teammates' : 'tasks'
}

function getNextDetailTab(current: TuiDetailTab): TuiDetailTab {
  if (current === 'activity') {
    return 'transcript'
  }
  if (current === 'transcript') {
    return 'logs'
  }
  return 'activity'
}

function getPreviousDetailTab(current: TuiDetailTab): TuiDetailTab {
  if (current === 'logs') {
    return 'transcript'
  }
  if (current === 'transcript') {
    return 'activity'
  }
  return 'logs'
}

function getNextLogStream(current: TuiLogStream): TuiLogStream {
  return current === 'stderr' ? 'stdout' : 'stderr'
}

function getPreviousLogStream(current: TuiLogStream): TuiLogStream {
  return current === 'stdout' ? 'stderr' : 'stdout'
}

function getTeamPickerStateColor(
  state: TeamListItem['resultState'],
): string {
  if (state === 'attention') {
    return 'yellow'
  }
  if (state === 'running') {
    return 'cyan'
  }
  if (state === 'completed') {
    return 'green'
  }
  return 'gray'
}

function truncateTeamPickerText(
  value: string | undefined,
  maxLength = 84,
): string | undefined {
  if (!value) {
    return undefined
  }
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`
}

function clampIndex(nextIndex: number, length: number): number {
  if (length <= 0) {
    return 0
  }
  return Math.max(0, Math.min(nextIndex, length - 1))
}

function getNextFocusMode(current: TuiFocusMode): TuiFocusMode {
  if (current === 'none') {
    return 'primary'
  }
  if (current === 'primary') {
    return 'detail'
  }
  return 'none'
}

function clampScrollOffset(
  nextOffset: number,
  itemCount: number,
  windowSize: number,
): number {
  return Math.max(0, Math.min(nextOffset, Math.max(0, itemCount - windowSize)))
}

async function loadGlobalOverview(
  rootDir?: string,
): Promise<GlobalDashboardSummary> {
  return loadGlobalDashboardSummary({ rootDir })
}

function summarizeGlobalTeams(
  teams: TeamListItem[],
  formatter: (team: TeamListItem) => string,
  emptyLabel = 'none',
  limit = 3,
): string {
  if (teams.length === 0) {
    return emptyLabel
  }
  return teams.slice(0, limit).map(formatter).join('  ·  ')
}

export function TeamTuiApp(props: TeamTuiAppProps) {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const readOnly = props.mode === 'watch'
  const options = props.options ?? {}
  const viewportColumns = props.viewport?.columns ?? stdout.columns ?? 120
  const viewportRows = props.viewport?.rows ?? stdout.rows ?? 30
  const layoutMode = getTeamTuiLayoutMode(viewportColumns)

  const [currentTeamName, setCurrentTeamName] = useState<string | undefined>(
    props.initialTeamName,
  )
  const [teamList, setTeamList] = useState<TeamListItem[]>([])
  const [globalOverview, setGlobalOverview] = useState<GlobalDashboardSummary | null>(null)
  const [teamSelectionIndex, setTeamSelectionIndex] = useState(0)
  const [isCreatingTeam, setIsCreatingTeam] = useState(false)
  const [teamPickerInitialized, setTeamPickerInitialized] = useState(
    props.initialTeamName !== undefined,
  )
  const [newTeamName, setNewTeamName] = useState('')
  const [focusedPane, setFocusedPane] = useState<TuiPane>('tasks')
  const [focusMode, setFocusMode] = useState<TuiFocusMode>('none')
  const [selectedTaskIndex, setSelectedTaskIndex] = useState(0)
  const [selectedTeammateIndex, setSelectedTeammateIndex] = useState(0)
  const [detailTab, setDetailTab] = useState<TuiDetailTab>('activity')
  const [logStream, setLogStream] = useState<TuiLogStream>('stderr')
  const [activityScrollOffset, setActivityScrollOffset] = useState(0)
  const [transcriptScrollOffset, setTranscriptScrollOffset] = useState(0)
  const [logScrollOffset, setLogScrollOffset] = useState(0)
  const [toastMessage, setToastMessage] = useState<string>()
  const [actionInFlight, setActionInFlight] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const { modal, openModal, closeModal } = useModalState()

  useEffect(() => {
    if (currentTeamName) {
      return
    }

    let disposed = false

    const refreshTeams = async () => {
      const nextOverview = await loadGlobalOverview(options.rootDir)
      if (disposed) {
        return
      }
      const nextTeams = nextOverview.teams
      setGlobalOverview(nextOverview)
      setTeamList(nextTeams)
      if (!teamPickerInitialized) {
        setIsCreatingTeam(nextTeams.length === 0)
        setTeamPickerInitialized(true)
      }
      if (nextTeams.length > 0 && !isCreatingTeam) {
        setTeamSelectionIndex(previous =>
          clampIndex(previous, nextTeams.length),
        )
      }
      if (nextTeams.length === 0) {
        setIsCreatingTeam(true)
      }
    }

    void refreshTeams()
    const interval = setInterval(() => {
      void refreshTeams()
    }, 1000)

    return () => {
      disposed = true
      clearInterval(interval)
    }
  }, [currentTeamName, isCreatingTeam, options.rootDir, teamPickerInitialized])

  const [selectedTranscriptAgentName, setSelectedTranscriptAgentName] = useState<
    string | undefined
  >(undefined)

  const dashboardState = useDashboard(currentTeamName, options, {
    selectedAgentName: selectedTranscriptAgentName,
    transcriptLimit: 24,
    activityLimit: 24,
    logTailLines: 32,
    logTailBytes: 16 * 1024,
    pollIntervalMs: 500,
  })

  const dashboard = dashboardState.dashboard
  const teammateStatuses =
    dashboard?.statuses.filter(status => status.name !== 'team-lead') ?? []
  const safeSelectedTeammateIndex = clampIndex(
    selectedTeammateIndex,
    teammateStatuses.length,
  )
  const activeTeammateName =
    teammateStatuses[safeSelectedTeammateIndex]?.name
  const effectiveDashboard = dashboard
  const selectedLogSnapshot = effectiveDashboard?.logViewer?.snapshots.find(
    snapshot => snapshot.stream === logStream,
  )
  const taskRuntimeSignals = effectiveDashboard
    ? buildTaskRuntimeSignals(effectiveDashboard.tasks, teammateStatuses)
    : undefined
  const primaryPaneMinHeight = layoutMode === 'narrow' ? 10 : 9
  const detailPaneMinHeight = layoutMode === 'narrow' ? 8 : 7
  const primaryWindowSize =
    focusMode === 'primary'
      ? Math.max(8, viewportRows - 10)
      : layoutMode === 'narrow'
        ? 5
        : 6
  const detailWindowSize =
    focusMode === 'detail'
      ? Math.max(8, viewportRows - 10)
      : layoutMode === 'narrow'
        ? 5
        : 6

  useEffect(() => {
    setSelectedTaskIndex(previous =>
      clampIndex(previous, effectiveDashboard?.tasks.length ?? 0),
    )
  }, [effectiveDashboard?.tasks.length])

  useEffect(() => {
    setSelectedTeammateIndex(previous =>
      clampIndex(previous, teammateStatuses.length),
    )
  }, [teammateStatuses.length])

  useEffect(() => {
    if (!currentTeamName) {
      setSelectedTranscriptAgentName(undefined)
      setFocusMode('none')
      setActivityScrollOffset(0)
      setTranscriptScrollOffset(0)
      setLogScrollOffset(0)
      return
    }

    const nextAgentName = activeTeammateName
    setSelectedTranscriptAgentName(previous =>
      previous === nextAgentName ? previous : nextAgentName,
    )
  }, [currentTeamName, activeTeammateName])

  useEffect(() => {
    setActivityScrollOffset(previous =>
      clampScrollOffset(previous, effectiveDashboard?.activity.length ?? 0, detailWindowSize),
    )
  }, [effectiveDashboard?.activity.length, detailWindowSize])

  useEffect(() => {
    setTranscriptScrollOffset(previous =>
      clampScrollOffset(
        previous,
        effectiveDashboard?.transcriptEntries.length ?? 0,
        detailWindowSize,
      ),
    )
  }, [effectiveDashboard?.transcriptEntries.length, detailWindowSize])

  useEffect(() => {
    setLogScrollOffset(previous =>
      clampScrollOffset(
        previous,
        selectedLogSnapshot?.tail?.state === 'ok'
          ? selectedLogSnapshot.tail.lines.length
          : 0,
        detailWindowSize,
      ),
    )
  }, [selectedLogSnapshot, detailWindowSize])

  useEffect(() => {
    setLogScrollOffset(0)
  }, [selectedTranscriptAgentName, logStream])

  useEffect(() => {
    if (!props.exitOnRender) {
      return
    }

    const isReady =
      (currentTeamName !== undefined && effectiveDashboard !== null) ||
      (currentTeamName === undefined && teamList.length >= 0)

    if (isReady) {
      props.onExit?.(0)
      exit()
    }
  }, [props, currentTeamName, effectiveDashboard, teamList.length, exit])

  async function refreshDashboard() {
    await dashboardState.refresh()
  }

  async function runAction(
    work: () => Promise<{ success: boolean; message: string }>,
  ) {
    setActionInFlight(true)
    try {
      const result = await work()
      setToastMessage(result.message)
      await refreshDashboard()
    } catch (error) {
      setToastMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setActionInFlight(false)
    }
  }

  useInput((_input, key) => {
    if (
      !currentTeamName &&
      isCreatingTeam &&
      teamList.length > 0 &&
      key.escape
    ) {
      setIsCreatingTeam(false)
    }
  })

  useShortcuts({
    enabled:
      !showHelp &&
      modal.kind === 'none' &&
      (!isCreatingTeam || currentTeamName !== undefined),
    onTab: () => {
      if (!currentTeamName) {
        return
      }
      setFocusedPane(previous => getNextPane(previous))
    },
    onUp: () => {
      if (!currentTeamName) {
        if (isCreatingTeam) {
          return
        }
        setTeamSelectionIndex(previous => clampIndex(previous - 1, teamList.length))
        return
      }

      if (focusedPane === 'tasks') {
        setSelectedTaskIndex(previous =>
          clampIndex(previous - 1, effectiveDashboard?.tasks.length ?? 0),
        )
        return
      }
      if (focusedPane === 'teammates') {
        setSelectedTeammateIndex(previous =>
          clampIndex(previous - 1, teammateStatuses.length),
        )
      }
    },
    onDown: () => {
      if (!currentTeamName) {
        if (isCreatingTeam) {
          return
        }
        setTeamSelectionIndex(previous => clampIndex(previous + 1, teamList.length))
        return
      }

      if (focusedPane === 'tasks') {
        setSelectedTaskIndex(previous =>
          clampIndex(previous + 1, effectiveDashboard?.tasks.length ?? 0),
        )
        return
      }
      if (focusedPane === 'teammates') {
        setSelectedTeammateIndex(previous =>
          clampIndex(previous + 1, teammateStatuses.length),
        )
      }
    },
    onLeft: () => {
      if (!currentTeamName) {
        return
      }
      setDetailTab(previous => getPreviousDetailTab(previous))
    },
    onRight: () => {
      if (!currentTeamName) {
        return
      }
      setDetailTab(previous => getNextDetailTab(previous))
    },
    onReturn: () => {
      if (!currentTeamName && isCreatingTeam) {
        return
      }
      if (!currentTeamName && teamList[teamSelectionIndex]) {
        setCurrentTeamName(teamList[teamSelectionIndex]?.name)
        setIsCreatingTeam(false)
      }
    },
    onEscape: () => {
      if (!currentTeamName) {
        if (isCreatingTeam && teamList.length > 0) {
          setIsCreatingTeam(false)
          return
        }
        props.onExit?.(0)
        exit()
        return
      }
      if (focusMode !== 'none') {
        setFocusMode('none')
        return
      }
      setShowHelp(false)
    },
    onInput: input => {
      if (input === 'q') {
        props.onExit?.(0)
        exit()
        return
      }
      if (input === '?') {
        setShowHelp(previous => !previous)
        return
      }
      if (input === 'r') {
        void refreshDashboard()
        return
      }
      if (input === 'f' && currentTeamName) {
        setFocusMode(previous => getNextFocusMode(previous))
        return
      }
      if (input === '[') {
        setDetailTab(previous => getPreviousDetailTab(previous))
        return
      }
      if (input === ']') {
        setDetailTab(previous => getNextDetailTab(previous))
        return
      }
      if (input === ',' && currentTeamName && detailTab === 'logs') {
        setLogStream(previous => getPreviousLogStream(previous))
        return
      }
      if (input === '.' && currentTeamName && detailTab === 'logs') {
        setLogStream(previous => getNextLogStream(previous))
        return
      }
      if (input === 'j' && currentTeamName) {
        if (detailTab === 'activity') {
          setActivityScrollOffset(previous =>
            clampScrollOffset(
              previous - 1,
              effectiveDashboard?.activity.length ?? 0,
              detailWindowSize,
            ),
          )
        } else if (detailTab === 'transcript') {
          setTranscriptScrollOffset(previous =>
            clampScrollOffset(
              previous - 1,
              effectiveDashboard?.transcriptEntries.length ?? 0,
              detailWindowSize,
            ),
          )
        } else {
          setLogScrollOffset(previous =>
            clampScrollOffset(
              previous - 1,
              selectedLogSnapshot?.tail?.state === 'ok'
                ? selectedLogSnapshot.tail.lines.length
                : 0,
              detailWindowSize,
            ),
          )
        }
        return
      }
      if (input === 'k' && currentTeamName) {
        if (detailTab === 'activity') {
          setActivityScrollOffset(previous =>
            clampScrollOffset(
              previous + 1,
              effectiveDashboard?.activity.length ?? 0,
              detailWindowSize,
            ),
          )
        } else if (detailTab === 'transcript') {
          setTranscriptScrollOffset(previous =>
            clampScrollOffset(
              previous + 1,
              effectiveDashboard?.transcriptEntries.length ?? 0,
              detailWindowSize,
            ),
          )
        } else {
          setLogScrollOffset(previous =>
            clampScrollOffset(
              previous + 1,
              selectedLogSnapshot?.tail?.state === 'ok'
                ? selectedLogSnapshot.tail.lines.length
                : 0,
              detailWindowSize,
            ),
          )
        }
        return
      }

      if (!currentTeamName) {
        if (input === 'c' && !readOnly) {
          setIsCreatingTeam(true)
        }
        return
      }

      if (readOnly) {
        return
      }

      if (input === 's') {
        openModal({ kind: 'spawn' })
        return
      }
      if (input === 't') {
        openModal({ kind: 'task-create' })
        return
      }
      if (input === 'm') {
        openModal({ kind: 'send-message' })
        return
      }
      if (input === 'a') {
        openModal({ kind: 'approvals' })
        return
      }
      if (input === 'u' && activeTeammateName) {
        void runAction(() =>
          resumeTeammate(
            {
              teamName: currentTeamName,
              agentName: activeTeammateName,
            },
            options,
          ),
        )
        return
      }
      if (input === 'x' && activeTeammateName) {
        void runAction(() =>
          shutdownTeammate(
            {
              teamName: currentTeamName,
              recipient: activeTeammateName,
              reason: 'Requested from TUI',
            },
            options,
          ),
        )
      }
    },
  })

  if (!currentTeamName) {
    return (
      <Box flexDirection="column">
        <Text color="cyan">agent-team tui</Text>
        <Newline />
        {isCreatingTeam ? (
          <Box flexDirection="column">
            <Text color="cyan">Global Ops Overview</Text>
            <Text color="gray">
              teams {globalOverview?.teamCounts.total ?? 0}  attention {globalOverview?.teamCounts.attention ?? 0}  running {globalOverview?.teamCounts.running ?? 0}  pending {globalOverview?.teamCounts.pending ?? 0}  completed {globalOverview?.teamCounts.completed ?? 0}
            </Text>
            <Text color="gray">
              approvals {globalOverview?.pendingApprovalsTotal ?? 0}  workers {globalOverview?.activeWorkersTotal ?? 0} active  {globalOverview?.executingWorkersTotal ?? 0} running  {globalOverview?.staleWorkersTotal ?? 0} stale  unread {globalOverview?.unreadLeaderMessagesTotal ?? 0}
            </Text>
            <Text color="yellow">
              attention: {summarizeGlobalTeams(globalOverview?.attentionTeams ?? [], team => team.name)}
            </Text>
            <Text color="yellow">
              approvals: {summarizeGlobalTeams(globalOverview?.pendingApprovalTeams ?? [], team => `${team.name}(${team.pendingApprovals})`)}
            </Text>
            <Text color="yellow">
              stale: {summarizeGlobalTeams(globalOverview?.staleWorkerTeams ?? [], team => `${team.name}(${team.staleWorkerCount})`)}
            </Text>
            <Text color="gray">
              backlog: {summarizeGlobalTeams(globalOverview?.blockedOrPendingTeams ?? [], team => `${team.name}(${team.taskCounts.pending})`)}
            </Text>
            <Newline />
            <Text>Create a new team and press Enter.</Text>
            <Box>
              <Text>Team name: </Text>
              <TextInput
                value={newTeamName}
                onChange={setNewTeamName}
              onSubmit={async () => {
                  const teamName = newTeamName.trim()
                  if (!teamName) {
                    return
                  }
                  await runAction(() =>
                    createTeam(
                      {
                        teamName,
                      },
                      options,
                    ),
                  )
                  setCurrentTeamName(teamName)
                  setIsCreatingTeam(false)
                  setTeamPickerInitialized(true)
                }}
              />
            </Box>
            {teamList.length > 0 ? (
              <Text color="gray">Press Esc to go back to the team list.</Text>
            ) : null}
          </Box>
        ) : (
          <Box flexDirection="column">
            <Text color="cyan">Global Ops Overview</Text>
            <Text color="gray">
              teams {globalOverview?.teamCounts.total ?? 0}  attention {globalOverview?.teamCounts.attention ?? 0}  running {globalOverview?.teamCounts.running ?? 0}  pending {globalOverview?.teamCounts.pending ?? 0}  completed {globalOverview?.teamCounts.completed ?? 0}
            </Text>
            <Text color="gray">
              approvals {globalOverview?.pendingApprovalsTotal ?? 0}  workers {globalOverview?.activeWorkersTotal ?? 0} active  {globalOverview?.executingWorkersTotal ?? 0} running  {globalOverview?.staleWorkersTotal ?? 0} stale  unread {globalOverview?.unreadLeaderMessagesTotal ?? 0}
            </Text>
            <Text color="yellow">
              attention: {summarizeGlobalTeams(globalOverview?.attentionTeams ?? [], team => team.name)}
            </Text>
            <Text color="yellow">
              approvals: {summarizeGlobalTeams(globalOverview?.pendingApprovalTeams ?? [], team => `${team.name}(${team.pendingApprovals})`)}
            </Text>
            <Text color="yellow">
              stale: {summarizeGlobalTeams(globalOverview?.staleWorkerTeams ?? [], team => `${team.name}(${team.staleWorkerCount})`)}
            </Text>
            <Text color="gray">
              backlog: {summarizeGlobalTeams(globalOverview?.blockedOrPendingTeams ?? [], team => `${team.name}(${team.taskCounts.pending})`)}
            </Text>
            <Newline />
            <Text>
              Select a team. Enter opens, c creates a new team. Attention-needed teams float to the top.
            </Text>
            {teamList.length === 0 ? (
              <Text color="gray">No teams found.</Text>
            ) : (
              teamList.map((team, index) => {
                const isSelected = teamSelectionIndex === index
                const headingColor = isSelected
                  ? 'green'
                  : getTeamPickerStateColor(team.resultState)
                const truncatedDescription = truncateTeamPickerText(
                  team.description,
                )

                return (
                  <Box key={team.name} flexDirection="column" marginBottom={1}>
                    <Text color={headingColor}>
                      {isSelected ? '> ' : '  '}
                      {team.name} [{team.resultState}] ({team.memberCount} members)
                    </Text>
                    <Text color="gray">
                      {'   '}
                      approvals {team.pendingApprovals}  workers {team.activeWorkerCount} active  {team.executingWorkerCount} running  {team.staleWorkerCount} stale  tasks {team.taskCounts.pending} pending  {team.taskCounts.inProgress} in_progress  {team.taskCounts.completed} done
                    </Text>
                    {team.attentionReasons.length > 0 ? (
                      <Text color="yellow">
                        {'   '}
                        ! {team.attentionReasons.join('  ·  ')}
                      </Text>
                    ) : truncatedDescription ? (
                      <Text color="gray">
                        {'   '}
                        {truncatedDescription}
                      </Text>
                    ) : null}
                  </Box>
                )
              })
            )}
          </Box>
        )}
        {toastMessage ? (
          <Text color="green">{toastMessage}</Text>
        ) : null}
      </Box>
    )
  }

  if (showHelp) {
    return <HelpOverlay />
  }

  const pendingApprovals = effectiveDashboard?.approvals.length ?? 0
  const primaryPane =
    focusedPane === 'tasks' ? (
      <TasksPane
        tasks={effectiveDashboard?.tasks ?? []}
        selectedTaskIndex={selectedTaskIndex}
        isFocused
        isExpanded={focusMode === 'primary'}
        counts={effectiveDashboard?.taskCounts ?? {
          pending: 0,
          inProgress: 0,
          completed: 0,
        }}
        runtimeOverview={taskRuntimeSignals?.overview}
        taskRuntimeLabels={taskRuntimeSignals?.labelsByTaskId}
        effectiveTaskStatuses={taskRuntimeSignals?.effectiveStatusByTaskId}
        guardrailWarnings={effectiveDashboard?.guardrailWarnings}
        costWarnings={effectiveDashboard?.costWarnings}
        windowSize={primaryWindowSize}
        width="100%"
        minHeight={primaryPaneMinHeight}
      />
    ) : (
      <TeammatesPane
        statuses={effectiveDashboard?.statuses ?? []}
        selectedTeammateIndex={safeSelectedTeammateIndex}
        isFocused
        isExpanded={focusMode === 'primary'}
        windowSize={primaryWindowSize}
        width="100%"
        minHeight={primaryPaneMinHeight}
      />
    )
  const detailTabs = (
    <Box>
      <TabLabel label="Activity" active={detailTab === 'activity'} />
      <Text>  </Text>
      <TabLabel label="Transcript" active={detailTab === 'transcript'} />
      <Text>  </Text>
      <TabLabel label="Logs" active={detailTab === 'logs'} />
      <Text>  </Text>
      {detailTab === 'logs' ? (
        <>
          <TabLabel label="stderr" active={logStream === 'stderr'} />
          <Text>  </Text>
          <TabLabel label="stdout" active={logStream === 'stdout'} />
          <Text>  </Text>
          <KeyHint label=",/. stream" active />
          <Text>  </Text>
        </>
      ) : null}
      <KeyHint label="[ ] detail tab" active />
    </Box>
  )
  const primaryTabs = (
    <Box>
      <TabLabel label="Tasks" active={focusedPane === 'tasks'} />
      <Text>  </Text>
      <TabLabel label="Teammates" active={focusedPane === 'teammates'} />
      <Text>  </Text>
      <KeyHint label="Tab switch pane" active />
    </Box>
  )
  const detailPanel =
    detailTab === 'activity' ? (
      <ActivityFeed
        activity={effectiveDashboard?.activity ?? []}
        isFocused={focusMode === 'detail'}
        isExpanded={focusMode === 'detail'}
        windowSize={detailWindowSize}
        scrollOffset={activityScrollOffset}
        width="100%"
        minHeight={detailPaneMinHeight}
      />
    ) : detailTab === 'transcript' ? (
      <TranscriptDrawer
        agentName={effectiveDashboard?.transcriptAgentName}
        entries={effectiveDashboard?.transcriptEntries ?? []}
        isFocused={focusMode === 'detail'}
        isExpanded={focusMode === 'detail'}
        windowSize={detailWindowSize}
        scrollOffset={transcriptScrollOffset}
        width="100%"
        minHeight={detailPaneMinHeight}
      />
    ) : (
      <LogViewer
        agentName={effectiveDashboard?.logViewer?.agentName}
        snapshot={selectedLogSnapshot}
        stream={logStream}
        isFocused={focusMode === 'detail'}
        isExpanded={focusMode === 'detail'}
        windowSize={detailWindowSize}
        scrollOffset={logScrollOffset}
        width="100%"
        minHeight={detailPaneMinHeight}
      />
    )

  return (
    <Box flexDirection="column">
      <StatusBar
        readOnly={readOnly}
        pendingApprovals={pendingApprovals}
        rootDir={options.rootDir}
        currentTeamName={currentTeamName}
        focusMode={focusMode}
        toastMessage={toastMessage}
        error={dashboardState.error}
        actionInFlight={actionInFlight}
      />

      {effectiveDashboard ? (
        <>
          {focusMode === 'primary' ? (
            <>
              <Box marginTop={1}>
                <Box>
                  {primaryTabs}
                  <Text>  </Text>
                  <KeyHint label="f cycle focus" active />
                </Box>
              </Box>
              <Box marginTop={1}>{primaryPane}</Box>
            </>
          ) : focusMode === 'detail' ? (
            <>
              <Box marginTop={1}>
                <Box>
                  {detailTabs}
                  <Text>  </Text>
                  <KeyHint label="j/k scroll" active />
                  <Text>  </Text>
                  <KeyHint label="f cycle focus" active />
                </Box>
              </Box>
              <Box marginTop={1}>{detailPanel}</Box>
            </>
          ) : layoutMode === 'narrow' ? (
            <>
              <Box marginTop={1}>
                <Box>{primaryTabs}</Box>
              </Box>
              <Box marginTop={1}>{primaryPane}</Box>
              <Box marginTop={1}>
                <Box>{detailTabs}</Box>
              </Box>
              <Box marginTop={1}>{detailPanel}</Box>
            </>
          ) : (
            <>
              <Box marginTop={1}>
                <Box>
                  {primaryTabs}
                  <Text>  </Text>
                  <KeyHint label="f cycle focus" active />
                </Box>
              </Box>
              <Box marginTop={1}>
                <TasksPane
                  tasks={effectiveDashboard.tasks}
                  selectedTaskIndex={selectedTaskIndex}
                  isFocused={focusedPane === 'tasks'}
                  counts={effectiveDashboard.taskCounts}
                  runtimeOverview={taskRuntimeSignals?.overview}
                  taskRuntimeLabels={taskRuntimeSignals?.labelsByTaskId}
                  effectiveTaskStatuses={taskRuntimeSignals?.effectiveStatusByTaskId}
                  guardrailWarnings={effectiveDashboard.guardrailWarnings}
                  costWarnings={effectiveDashboard.costWarnings}
                  windowSize={primaryWindowSize}
                  width="50%"
                  minHeight={primaryPaneMinHeight}
                />
                <TeammatesPane
                  statuses={effectiveDashboard.statuses}
                  selectedTeammateIndex={safeSelectedTeammateIndex}
                  isFocused={focusedPane === 'teammates'}
                  windowSize={primaryWindowSize}
                  width="50%"
                  minHeight={primaryPaneMinHeight}
                />
              </Box>
              <Box marginTop={1}>
                <Box>
                  {detailTabs}
                  <Text>  </Text>
                  <KeyHint label="j/k scroll" active />
                </Box>
              </Box>
              <Box marginTop={1}>{detailPanel}</Box>
            </>
          )}
        </>
      ) : (
        <Text>{dashboardState.isLoading ? 'Loading dashboard...' : 'Team not found.'}</Text>
      )}

      {modal.kind === 'spawn' ? (
        <SpawnModal
          initialAgentName={activeTeammateName}
          onCancel={closeModal}
          onSubmit={async input => {
            closeModal()
            await runAction(() =>
              spawnTeammate(
                {
                  teamName: currentTeamName,
                  agentName: input.agentName,
                  prompt: input.prompt,
                  runtimeKind: input.runtimeKind,
                  model: input.model,
                },
                options,
              ),
            )
          }}
        />
      ) : null}

      {modal.kind === 'task-create' ? (
        <TaskCreateModal
          onCancel={closeModal}
          onSubmit={async input => {
            closeModal()
            await runAction(() =>
              createTask(
                {
                  teamName: currentTeamName,
                  subject: input.subject,
                  description: input.description,
                },
                options,
              ),
            )
          }}
        />
      ) : null}

      {modal.kind === 'send-message' ? (
        <SendMessageModal
          initialRecipient={activeTeammateName}
          onCancel={closeModal}
          onSubmit={async input => {
            closeModal()
            await runAction(() =>
              sendLeaderMessage(
                {
                  teamName: currentTeamName,
                  recipient: input.recipient,
                  message: input.message,
                },
                options,
              ),
            )
          }}
        />
      ) : null}

      {modal.kind === 'approvals' ? (
        <ApprovalModal
          approvals={effectiveDashboard?.approvals ?? []}
          onCancel={closeModal}
          onApprove={async input => {
            const approval = input.approval
            if (approval.kind === 'permission') {
              await runAction(() =>
                approvePermission(
                  {
                    teamName: currentTeamName,
                    requestId: approval.requestId,
                    recipientName: approval.recipientName,
                    persistDecision: input.persistDecision,
                    rulePreset: input.rulePreset,
                    ruleContent: input.ruleContent,
                  },
                  options,
                ),
              )
            } else if (approval.kind === 'sandbox') {
              await runAction(() =>
                approveSandbox(
                  {
                    teamName: currentTeamName,
                    requestId: approval.requestId,
                    recipientName: approval.recipientName,
                    host: approval.host,
                  },
                  options,
                ),
              )
            } else {
              await runAction(() =>
                approvePlan(
                  {
                    teamName: currentTeamName,
                    requestId: approval.requestId,
                    recipientName: approval.recipientName,
                  },
                  options,
                ),
              )
            }
            closeModal()
          }}
          onDeny={async input => {
            const approval = input.approval
            if (approval.kind === 'permission') {
              await runAction(() =>
                denyPermission(
                  {
                    teamName: currentTeamName,
                    requestId: approval.requestId,
                    recipientName: approval.recipientName,
                    errorMessage: 'Denied in TUI',
                    persistDecision: input.persistDecision,
                    rulePreset: input.rulePreset,
                    ruleContent: input.ruleContent,
                  },
                  options,
                ),
              )
            } else if (approval.kind === 'sandbox') {
              await runAction(() =>
                denySandbox(
                  {
                    teamName: currentTeamName,
                    requestId: approval.requestId,
                    recipientName: approval.recipientName,
                    host: approval.host,
                  },
                  options,
                ),
              )
            } else {
              await runAction(() =>
                rejectPlan(
                  {
                    teamName: currentTeamName,
                    requestId: approval.requestId,
                    recipientName: approval.recipientName,
                    feedback: 'Rejected in TUI',
                  },
                  options,
                ),
              )
            }
            closeModal()
          }}
        />
      ) : null}
    </Box>
  )
}

import { Box, Newline, Text, useApp, useStdout } from 'ink'
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
  listTeams,
  rejectPlan,
  resumeTeammate,
  sendLeaderMessage,
  shutdownTeammate,
  spawnTeammate,
} from '../team-operator/index.js'
import type { TeamListItem } from '../team-operator/index.js'
import { ActivityFeed } from './components/activity-feed.js'
import { HelpOverlay } from './components/help-overlay.js'
import { KeyHint, TabLabel } from './components/layout.js'
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
  TuiPane,
} from './types.js'

function getNextPane(current: TuiPane): TuiPane {
  return current === 'tasks' ? 'teammates' : 'tasks'
}

function getNextDetailTab(current: TuiDetailTab): TuiDetailTab {
  return current === 'activity' ? 'transcript' : 'activity'
}

function getPreviousDetailTab(current: TuiDetailTab): TuiDetailTab {
  return current === 'transcript' ? 'activity' : 'transcript'
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

async function loadTeamList(
  rootDir?: string,
): Promise<TeamListItem[]> {
  return listTeams({ rootDir })
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
  const [teamSelectionIndex, setTeamSelectionIndex] = useState(0)
  const [isCreatingTeam, setIsCreatingTeam] = useState(
    props.initialTeamName === undefined,
  )
  const [newTeamName, setNewTeamName] = useState('')
  const [focusedPane, setFocusedPane] = useState<TuiPane>('tasks')
  const [focusMode, setFocusMode] = useState<TuiFocusMode>('none')
  const [selectedTaskIndex, setSelectedTaskIndex] = useState(0)
  const [selectedTeammateIndex, setSelectedTeammateIndex] = useState(0)
  const [detailTab, setDetailTab] = useState<TuiDetailTab>('activity')
  const [activityScrollOffset, setActivityScrollOffset] = useState(0)
  const [transcriptScrollOffset, setTranscriptScrollOffset] = useState(0)
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
      const nextTeams = await loadTeamList(options.rootDir)
      if (disposed) {
        return
      }
      setTeamList(nextTeams)
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
  }, [currentTeamName, isCreatingTeam, options.rootDir])

  const [selectedTranscriptAgentName, setSelectedTranscriptAgentName] = useState<
    string | undefined
  >(undefined)

  const dashboardState = useDashboard(currentTeamName, options, {
    selectedAgentName: selectedTranscriptAgentName,
    transcriptLimit: 24,
    activityLimit: 24,
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
      if (!currentTeamName && teamList[teamSelectionIndex]) {
        setCurrentTeamName(teamList[teamSelectionIndex]?.name)
        setIsCreatingTeam(false)
      }
    },
    onEscape: () => {
      if (!currentTeamName) {
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
      if (input === 'j' && currentTeamName) {
        if (detailTab === 'activity') {
          setActivityScrollOffset(previous =>
            clampScrollOffset(
              previous - 1,
              effectiveDashboard?.activity.length ?? 0,
              detailWindowSize,
            ),
          )
        } else {
          setTranscriptScrollOffset(previous =>
            clampScrollOffset(
              previous - 1,
              effectiveDashboard?.transcriptEntries.length ?? 0,
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
        } else {
          setTranscriptScrollOffset(previous =>
            clampScrollOffset(
              previous + 1,
              effectiveDashboard?.transcriptEntries.length ?? 0,
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
                }}
              />
            </Box>
            {teamList.length > 0 ? (
              <Text color="gray">Press Esc to go back to the team list.</Text>
            ) : null}
          </Box>
        ) : (
          <Box flexDirection="column">
            <Text>Select a team. Enter opens, c creates a new team.</Text>
            {teamList.length === 0 ? (
              <Text color="gray">No teams found.</Text>
            ) : (
              teamList.map((team, index) => (
                <Text
                  key={team.name}
                  color={teamSelectionIndex === index ? 'green' : undefined}
                >
                  {teamSelectionIndex === index ? '> ' : '  '}
                  {team.name} ({team.memberCount} members)
                </Text>
              ))
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
      <KeyHint label="[ ] detail tab" />
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
    ) : (
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
                  <TabLabel label="Tasks" active={focusedPane === 'tasks'} />
                  <Text>  </Text>
                  <TabLabel
                    label="Teammates"
                    active={focusedPane === 'teammates'}
                  />
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
              <Box marginTop={1}>{primaryPane}</Box>
              <Box marginTop={1}>
                <Box>
                  <TabLabel label="Tasks" active={focusedPane === 'tasks'} />
                  <Text>  </Text>
                  <TabLabel
                    label="Teammates"
                    active={focusedPane === 'teammates'}
                  />
                  <Text>  </Text>
                  {detailTabs}
                </Box>
              </Box>
              <Box marginTop={1}>{detailPanel}</Box>
            </>
          ) : (
            <>
              <Box marginTop={1}>
                <TasksPane
                  tasks={effectiveDashboard.tasks}
                  selectedTaskIndex={selectedTaskIndex}
                  isFocused={focusedPane === 'tasks'}
                  counts={effectiveDashboard.taskCounts}
                  runtimeOverview={taskRuntimeSignals?.overview}
                  taskRuntimeLabels={taskRuntimeSignals?.labelsByTaskId}
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
              <Box marginTop={1}>{detailTabs}</Box>
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

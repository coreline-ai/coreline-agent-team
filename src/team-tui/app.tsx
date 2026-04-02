import { Box, Newline, Text, useApp } from 'ink'
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
  stopTrackedTeammates,
} from '../team-operator/index.js'
import type {
  DashboardApprovalItem,
  TeamListItem,
} from '../team-operator/index.js'
import { ActivityFeed } from './components/activity-feed.js'
import { HelpOverlay } from './components/help-overlay.js'
import { TasksPane } from './components/tasks-pane.js'
import { TeammatesPane } from './components/teammates-pane.js'
import { TranscriptDrawer } from './components/transcript-drawer.js'
import { StatusBar } from './components/status-bar.js'
import { useDashboard } from './hooks/use-dashboard.js'
import { useModalState } from './hooks/use-modal-state.js'
import { useShortcuts } from './hooks/use-shortcuts.js'
import { ApprovalModal } from './modals/approval-modal.js'
import { SendMessageModal } from './modals/send-message-modal.js'
import { SpawnModal } from './modals/spawn-modal.js'
import { TaskCreateModal } from './modals/task-create-modal.js'
import type { TeamTuiAppProps, TuiPane } from './types.js'

function getNextPane(current: TuiPane): TuiPane {
  if (current === 'tasks') {
    return 'teammates'
  }
  if (current === 'teammates') {
    return 'activity'
  }
  return 'tasks'
}

function clampIndex(nextIndex: number, length: number): number {
  if (length <= 0) {
    return 0
  }
  return Math.max(0, Math.min(nextIndex, length - 1))
}

async function loadTeamList(
  rootDir?: string,
): Promise<TeamListItem[]> {
  return listTeams({ rootDir })
}

export function TeamTuiApp(props: TeamTuiAppProps) {
  const { exit } = useApp()
  const readOnly = props.mode === 'watch'
  const options = props.options ?? {}

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
  const [selectedTaskIndex, setSelectedTaskIndex] = useState(0)
  const [selectedTeammateIndex, setSelectedTeammateIndex] = useState(0)
  const [toastMessage, setToastMessage] = useState<string>()
  const [actionInFlight, setActionInFlight] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const { modal, openModal, closeModal } = useModalState()

  const displayStatuses =
    props.initialTeamName || currentTeamName
      ? undefined
      : teamList

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

  const selectedTeammateName =
    currentTeamName && displayStatuses === undefined
      ? undefined
      : undefined

  const dashboardState = useDashboard(
    currentTeamName,
    options,
    {
      selectedAgentName:
        currentTeamName && displayStatuses === undefined
          ? undefined
          : undefined,
      pollIntervalMs: 500,
    },
  )

  const dashboard = dashboardState.dashboard
  const teammateStatuses =
    dashboard?.statuses.filter(status => status.name !== 'team-lead') ?? []
  const safeSelectedTeammateIndex = clampIndex(
    selectedTeammateIndex,
    teammateStatuses.length,
  )
  const activeTeammateName =
    teammateStatuses[safeSelectedTeammateIndex]?.name

  const transcriptDashboard = useDashboard(
    currentTeamName,
    options,
    {
      selectedAgentName: activeTeammateName,
      transcriptLimit: 8,
      activityLimit: 8,
      pollIntervalMs: 500,
    },
  )

  const effectiveDashboard = transcriptDashboard.dashboard ?? dashboard

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

  useEffect(() => {
    return () => {
      void stopTrackedTeammates(currentTeamName)
    }
  }, [currentTeamName])

  async function refreshDashboard() {
    await Promise.all([
      dashboardState.refresh(),
      transcriptDashboard.refresh(),
    ])
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

  return (
    <Box flexDirection="column">
      <StatusBar
        readOnly={readOnly}
        pendingApprovals={pendingApprovals}
        rootDir={options.rootDir}
        currentTeamName={currentTeamName}
        toastMessage={toastMessage}
        error={dashboardState.error ?? transcriptDashboard.error}
        actionInFlight={actionInFlight}
      />

      {effectiveDashboard ? (
        <>
          <Box marginTop={1}>
            <TasksPane
              tasks={effectiveDashboard.tasks}
              selectedTaskIndex={selectedTaskIndex}
              isFocused={focusedPane === 'tasks'}
              counts={effectiveDashboard.taskCounts}
            />
            <TeammatesPane
              statuses={effectiveDashboard.statuses}
              selectedTeammateIndex={safeSelectedTeammateIndex}
              isFocused={focusedPane === 'teammates'}
            />
          </Box>

          <Box marginTop={1}>
            <ActivityFeed
              activity={effectiveDashboard.activity}
              isFocused={focusedPane === 'activity'}
            />
          </Box>

          <Box marginTop={1}>
            <TranscriptDrawer
              agentName={effectiveDashboard.transcriptAgentName}
              entries={effectiveDashboard.transcriptEntries}
            />
          </Box>
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

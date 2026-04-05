import { useCallback, useEffect, useRef, useState } from 'react'
import { createPollingHandle, loadDashboard } from '../../team-operator/index.js'
import type { TeamDashboard } from '../../team-operator/index.js'
import type { TeamCoreOptions } from '../../team-core/index.js'

export type DashboardLoadLifecycle = {
  begin(): number
  isCurrent(requestId: number): boolean
  dispose(): void
}

export type LoadDashboardFunction = typeof loadDashboard

export type SafeDashboardLoadInput = {
  lifecycle: DashboardLoadLifecycle
  teamName: string | undefined
  options: TeamCoreOptions
  selectedAgentName?: string
  transcriptLimit?: number
  activityLimit?: number
  logTailLines?: number
  logTailBytes?: number
  loadDashboardImpl?: LoadDashboardFunction
  applyDashboard(nextDashboard: TeamDashboard | null): void
  applyLoading(nextIsLoading: boolean): void
  applyError(nextError: string | undefined): void
}

export function createDashboardLoadLifecycle(): DashboardLoadLifecycle {
  let currentRequestId = 0
  let disposed = false

  return {
    begin() {
      currentRequestId += 1
      return currentRequestId
    },
    isCurrent(requestId) {
      return !disposed && requestId === currentRequestId
    },
    dispose() {
      disposed = true
      currentRequestId += 1
    },
  }
}

export async function loadDashboardSafely(
  input: SafeDashboardLoadInput,
): Promise<void> {
  const requestId = input.lifecycle.begin()

  if (!input.teamName) {
    if (!input.lifecycle.isCurrent(requestId)) {
      return
    }
    input.applyDashboard(null)
    input.applyLoading(false)
    input.applyError(undefined)
    return
  }

  if (input.lifecycle.isCurrent(requestId)) {
    input.applyLoading(true)
  }

  try {
    const nextDashboard = await (input.loadDashboardImpl ?? loadDashboard)(
      input.teamName,
      input.options,
      {
        selectedAgentName: input.selectedAgentName,
        transcriptLimit: input.transcriptLimit,
        activityLimit: input.activityLimit,
        logTailLines: input.logTailLines,
        logTailBytes: input.logTailBytes,
      },
    )
    if (!input.lifecycle.isCurrent(requestId)) {
      return
    }
    input.applyDashboard(nextDashboard)
    input.applyError(undefined)
  } catch (nextError) {
    if (!input.lifecycle.isCurrent(requestId)) {
      return
    }
    input.applyError(
      nextError instanceof Error ? nextError.message : String(nextError),
    )
  } finally {
    if (input.lifecycle.isCurrent(requestId)) {
      input.applyLoading(false)
    }
  }
}

export function useDashboard(
  teamName: string | undefined,
  options: TeamCoreOptions,
  input: {
    selectedAgentName?: string
    transcriptLimit?: number
    activityLimit?: number
    logTailLines?: number
    logTailBytes?: number
    pollIntervalMs?: number
  } = {},
) {
  const [dashboard, setDashboard] = useState<TeamDashboard | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string>()
  const lifecycleRef = useRef<DashboardLoadLifecycle>(
    createDashboardLoadLifecycle(),
  )
  const loadCurrentDashboard = useCallback(async (): Promise<void> => {
    await loadDashboardSafely({
      lifecycle: lifecycleRef.current,
      teamName,
      options,
      selectedAgentName: input.selectedAgentName,
      transcriptLimit: input.transcriptLimit,
      activityLimit: input.activityLimit,
      logTailLines: input.logTailLines,
      logTailBytes: input.logTailBytes,
      applyDashboard: setDashboard,
      applyLoading: setIsLoading,
      applyError: setError,
    })
  }, [
    teamName,
    options.rootDir,
    input.selectedAgentName,
    input.transcriptLimit,
    input.activityLimit,
    input.logTailLines,
    input.logTailBytes,
  ])

  useEffect(() => {
    const lifecycle = createDashboardLoadLifecycle()
    lifecycleRef.current.dispose()
    lifecycleRef.current = lifecycle

    if (!teamName) {
      void loadDashboardSafely({
        lifecycle,
        teamName,
        options,
        selectedAgentName: input.selectedAgentName,
        transcriptLimit: input.transcriptLimit,
        activityLimit: input.activityLimit,
        logTailLines: input.logTailLines,
        logTailBytes: input.logTailBytes,
        applyDashboard: setDashboard,
        applyLoading: setIsLoading,
        applyError: setError,
      })
      return () => {
        lifecycle.dispose()
      }
    }

    const pollingHandle = createPollingHandle(
      async () => {
        await loadDashboardSafely({
          lifecycle,
          teamName,
          options,
          selectedAgentName: input.selectedAgentName,
          transcriptLimit: input.transcriptLimit,
          activityLimit: input.activityLimit,
          logTailLines: input.logTailLines,
          logTailBytes: input.logTailBytes,
          applyDashboard: setDashboard,
          applyLoading: setIsLoading,
          applyError: setError,
        })
      },
      input.pollIntervalMs ?? 500,
    )

    return () => {
      lifecycle.dispose()
      pollingHandle.stop()
    }
  }, [
    loadCurrentDashboard,
    teamName,
    input.pollIntervalMs,
    input.selectedAgentName,
    input.transcriptLimit,
    input.activityLimit,
    input.logTailLines,
    input.logTailBytes,
    options.rootDir,
  ])

  return {
    dashboard,
    isLoading,
    error,
    async refresh() {
      await loadCurrentDashboard()
    },
  }
}

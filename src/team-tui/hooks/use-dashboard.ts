import { useEffect, useState } from 'react'
import { createPollingHandle, loadDashboard } from '../../team-operator/index.js'
import type { TeamDashboard } from '../../team-operator/index.js'
import type { TeamCoreOptions } from '../../team-core/index.js'

export function useDashboard(
  teamName: string | undefined,
  options: TeamCoreOptions,
  input: {
    selectedAgentName?: string
    transcriptLimit?: number
    activityLimit?: number
    pollIntervalMs?: number
  } = {},
) {
  const [dashboard, setDashboard] = useState<TeamDashboard | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!teamName) {
      setDashboard(null)
      setIsLoading(false)
      setError(undefined)
      return
    }

    let disposed = false
    setIsLoading(true)

    const refresh = async () => {
      try {
        const nextDashboard = await loadDashboard(teamName, options, {
          selectedAgentName: input.selectedAgentName,
          transcriptLimit: input.transcriptLimit,
          activityLimit: input.activityLimit,
        })
        if (disposed) {
          return
        }
        setDashboard(nextDashboard)
        setError(undefined)
      } catch (nextError) {
        if (disposed) {
          return
        }
        setError(nextError instanceof Error ? nextError.message : String(nextError))
      } finally {
        if (!disposed) {
          setIsLoading(false)
        }
      }
    }

    const pollingHandle = createPollingHandle(
      refresh,
      input.pollIntervalMs ?? 500,
    )

    return () => {
      disposed = true
      pollingHandle.stop()
    }
  }, [
    teamName,
    options.rootDir,
    input.selectedAgentName,
    input.transcriptLimit,
    input.activityLimit,
    input.pollIntervalMs,
  ])

  return {
    dashboard,
    isLoading,
    error,
    async refresh() {
      if (!teamName) {
        return
      }
      setIsLoading(true)
      try {
        const nextDashboard = await loadDashboard(teamName, options, {
          selectedAgentName: input.selectedAgentName,
          transcriptLimit: input.transcriptLimit,
          activityLimit: input.activityLimit,
        })
        setDashboard(nextDashboard)
        setError(undefined)
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError))
      } finally {
        setIsLoading(false)
      }
    },
  }
}

import { AsyncLocalStorage } from 'node:async_hooks'

export type TeamRuntimeContext = {
  agentId: string
  agentName: string
  teamName: string
  color?: string
  planModeRequired: boolean
  abortController: AbortController
}

const storage = new AsyncLocalStorage<TeamRuntimeContext>()

export function getRuntimeContext(): TeamRuntimeContext | undefined {
  return storage.getStore()
}

export function runWithRuntimeContext<T>(
  context: TeamRuntimeContext,
  fn: () => T,
): T {
  return storage.run(context, fn)
}

export function createRuntimeContext(input: {
  agentId: string
  agentName: string
  teamName: string
  color?: string
  planModeRequired?: boolean
  abortController?: AbortController
}): TeamRuntimeContext {
  return {
    agentId: input.agentId,
    agentName: input.agentName,
    teamName: input.teamName,
    color: input.color,
    planModeRequired: input.planModeRequired ?? false,
    abortController: input.abortController ?? new AbortController(),
  }
}

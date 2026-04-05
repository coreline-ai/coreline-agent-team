import {
  markMessagesAsReadByPredicate,
  readUnreadMessages,
  type TeamCoreOptions,
  type TeammateMessage,
} from '../team-core/index.js'
import type { TeamRuntimeContext } from './context.js'
import type { RuntimeTeammateConfig } from './types.js'

export const MAX_POLL_ERRORS = 20
export const MAX_POLL_BACKOFF_MS = 5_000

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

function matchesMailboxMessage(
  target: TeammateMessage,
): (message: TeammateMessage) => boolean {
  return message =>
    !message.read &&
    message.from === target.from &&
    message.timestamp === target.timestamp &&
    message.text === target.text
}

export async function markMailboxMessageAsRead(
  teamName: string,
  agentName: string,
  message: TeammateMessage,
  options: TeamCoreOptions,
): Promise<void> {
  await markMessagesAsReadByPredicate(
    teamName,
    agentName,
    matchesMailboxMessage(message),
    options,
  )
}

export async function pollForMailboxResponse<T>(
  input: {
    config: Pick<RuntimeTeammateConfig, 'teamName' | 'name'>
    runtimeContext: TeamRuntimeContext
    coreOptions?: TeamCoreOptions
    matcher: (message: TeammateMessage) => T | null
    pollIntervalMs: number
    requestId: string
    waitLabel: string
    maxPollErrors?: number
    maxPollBackoffMs?: number
  },
): Promise<T> {
  const coreOptions = input.coreOptions ?? {}
  const maxPollErrors = input.maxPollErrors ?? MAX_POLL_ERRORS
  const maxPollBackoffMs = input.maxPollBackoffMs ?? MAX_POLL_BACKOFF_MS
  let consecutiveErrors = 0

  while (!input.runtimeContext.abortController.signal.aborted) {
    try {
      const unreadMessages = await readUnreadMessages(
        input.config.teamName,
        input.config.name,
        coreOptions,
      )
      consecutiveErrors = 0

      for (const message of unreadMessages) {
        const match = input.matcher(message)
        if (match === null) {
          continue
        }

        await markMailboxMessageAsRead(
          input.config.teamName,
          input.config.name,
          message,
          coreOptions,
        )
        return match
      }
    } catch {
      consecutiveErrors += 1
      if (consecutiveErrors >= maxPollErrors) {
        throw new Error(
          `${input.waitLabel} poll failed after ${maxPollErrors} consecutive errors for "${input.requestId}"`,
        )
      }

      const backoff = Math.min(
        input.pollIntervalMs * 2 ** consecutiveErrors,
        maxPollBackoffMs,
      )
      await sleep(backoff)
      continue
    }

    await sleep(input.pollIntervalMs)
  }

  throw new Error(
    `${input.waitLabel} wait aborted for request "${input.requestId}"`,
  )
}

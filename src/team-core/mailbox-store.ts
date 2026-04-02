import type {
  TeamCoreOptions,
  TeammateMessage,
  WriteMailboxMessage,
} from './types.js'
import { ensureFile, readJsonFile, writeJsonFile } from './file-utils.js'
import { withFileLock } from './lockfile.js'
import { getInboxPath } from './paths.js'

const MAILBOX_LOCK_OPTIONS = {
  lockfilePath: undefined,
  retries: {
    retries: 20,
    minTimeout: 5,
    maxTimeout: 100,
  },
}

async function ensureInboxFile(
  teamName: string,
  agentName: string,
  options: TeamCoreOptions,
): Promise<string> {
  const inboxPath = getInboxPath(teamName, agentName, options)
  await ensureFile(inboxPath, '[]\n')
  return inboxPath
}

async function withInboxLock<T>(
  teamName: string,
  agentName: string,
  options: TeamCoreOptions,
  work: () => Promise<T>,
): Promise<T> {
  const inboxPath = await ensureInboxFile(teamName, agentName, options)
  return withFileLock(inboxPath, work, {
    ...MAILBOX_LOCK_OPTIONS,
    lockfilePath: `${inboxPath}.lock`,
  })
}

async function readMailboxFile(
  teamName: string,
  agentName: string,
  options: TeamCoreOptions,
): Promise<TeammateMessage[]> {
  return readJsonFile<TeammateMessage[]>(
    getInboxPath(teamName, agentName, options),
    [],
  )
}

export async function readMailbox(
  teamName: string,
  agentName: string,
  options: TeamCoreOptions = {},
): Promise<TeammateMessage[]> {
  return readMailboxFile(teamName, agentName, options)
}

export async function readUnreadMessages(
  teamName: string,
  agentName: string,
  options: TeamCoreOptions = {},
): Promise<TeammateMessage[]> {
  const messages = await readMailboxFile(teamName, agentName, options)
  return messages.filter(message => !message.read)
}

export async function writeToMailbox(
  teamName: string,
  recipientName: string,
  message: WriteMailboxMessage,
  options: TeamCoreOptions = {},
): Promise<TeammateMessage[]> {
  return withInboxLock(teamName, recipientName, options, async () => {
    const messages = await readMailboxFile(teamName, recipientName, options)
    const nextMessages = [...messages, { ...message, read: false }]
    await writeJsonFile(getInboxPath(teamName, recipientName, options), nextMessages)
    return nextMessages
  })
}

export async function markMessageAsReadByIndex(
  teamName: string,
  agentName: string,
  messageIndex: number,
  options: TeamCoreOptions = {},
): Promise<boolean> {
  return withInboxLock(teamName, agentName, options, async () => {
    const messages = await readMailboxFile(teamName, agentName, options)

    if (messageIndex < 0 || messageIndex >= messages.length) {
      return false
    }

    const message = messages[messageIndex]
    if (!message || message.read) {
      return false
    }

    const nextMessages = [...messages]
    nextMessages[messageIndex] = {
      ...message,
      read: true,
    }

    await writeJsonFile(getInboxPath(teamName, agentName, options), nextMessages)
    return true
  })
}

export async function markMessagesAsRead(
  teamName: string,
  agentName: string,
  options: TeamCoreOptions = {},
): Promise<void> {
  await withInboxLock(teamName, agentName, options, async () => {
    const messages = await readMailboxFile(teamName, agentName, options)
    if (messages.length === 0) {
      return
    }
    await writeJsonFile(
      getInboxPath(teamName, agentName, options),
      messages.map(message => ({ ...message, read: true })),
    )
  })
}

export async function markMessagesAsReadByPredicate(
  teamName: string,
  agentName: string,
  predicate: (message: TeammateMessage) => boolean,
  options: TeamCoreOptions = {},
): Promise<void> {
  await withInboxLock(teamName, agentName, options, async () => {
    const messages = await readMailboxFile(teamName, agentName, options)
    if (messages.length === 0) {
      return
    }
    await writeJsonFile(
      getInboxPath(teamName, agentName, options),
      messages.map(message =>
        !message.read && predicate(message) ? { ...message, read: true } : message,
      ),
    )
  })
}

export async function clearMailbox(
  teamName: string,
  agentName: string,
  options: TeamCoreOptions = {},
): Promise<void> {
  await withInboxLock(teamName, agentName, options, async () => {
    await writeJsonFile(getInboxPath(teamName, agentName, options), [])
  })
}

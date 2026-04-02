import { useInput, type Key } from 'ink'

export type ShortcutHandlers = {
  enabled?: boolean
  onTab?: () => void
  onUp?: () => void
  onDown?: () => void
  onLeft?: () => void
  onRight?: () => void
  onReturn?: () => void
  onEscape?: () => void
  onInput?: (input: string, key: Key) => void
}

export function useShortcuts(handlers: ShortcutHandlers): void {
  useInput((input, key) => {
    if (handlers.enabled === false) {
      return
    }

    if (key.tab) {
      handlers.onTab?.()
      return
    }
    if (key.upArrow) {
      handlers.onUp?.()
      return
    }
    if (key.downArrow) {
      handlers.onDown?.()
      return
    }
    if (key.leftArrow) {
      handlers.onLeft?.()
      return
    }
    if (key.rightArrow) {
      handlers.onRight?.()
      return
    }
    if (key.return) {
      handlers.onReturn?.()
      return
    }
    if (key.escape) {
      handlers.onEscape?.()
      return
    }

    handlers.onInput?.(input, key)
  })
}

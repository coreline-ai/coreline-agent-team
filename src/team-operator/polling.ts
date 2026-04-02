export type PollingHandle = {
  stop(): void
}

export function createPollingHandle(
  work: () => Promise<void> | void,
  intervalMs: number,
): PollingHandle {
  let timer: NodeJS.Timeout | undefined
  let stopped = false

  const run = async () => {
    if (stopped) {
      return
    }

    try {
      await work()
    } finally {
      if (!stopped) {
        timer = setTimeout(run, intervalMs)
      }
    }
  }

  void run()

  return {
    stop() {
      stopped = true
      if (timer) {
        clearTimeout(timer)
      }
    },
  }
}

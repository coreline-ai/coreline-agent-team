import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

type LockRelease = () => Promise<void>

type LockOptions = {
  lockfilePath?: string
  retries?: {
    retries: number
    minTimeout: number
    maxTimeout: number
  }
}

type LockfileModule = {
  lock(path: string, options?: LockOptions): Promise<LockRelease>
}

let lockfileModule: LockfileModule | undefined

function getLockfile(): LockfileModule {
  if (!lockfileModule) {
    lockfileModule = require('proper-lockfile') as LockfileModule
  }
  return lockfileModule
}

export async function lockFile(
  path: string,
  options?: LockOptions,
): Promise<LockRelease> {
  return getLockfile().lock(path, options)
}

export async function withFileLock<T>(
  path: string,
  work: () => Promise<T>,
  options?: LockOptions,
): Promise<T> {
  const release = await lockFile(path, options)
  try {
    return await work()
  } finally {
    await release()
  }
}

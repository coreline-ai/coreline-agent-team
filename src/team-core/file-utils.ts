import { randomUUID } from 'node:crypto'
import { access, appendFile, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

type ErrnoException = Error & {
  code?: string
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function ensureFile(
  path: string,
  initialContent = '',
): Promise<void> {
  await ensureDir(dirname(path))
  try {
    await writeFile(path, initialContent, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if ((error as ErrnoException).code !== 'EEXIST') {
      throw error
    }
  }
}

const RETRYABLE_FS_CODES = new Set(['EAGAIN', 'EBUSY', 'EIO', 'EINTR', 'EMFILE', 'ENFILE'])

export async function readJsonFile<T>(
  path: string,
  fallback: T,
  options: {
    readFileImpl?: typeof readFile
  } = {},
): Promise<T> {
  const readFileImpl = options.readFileImpl ?? readFile
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const content = await readFileImpl(path, 'utf8')
      return JSON.parse(content) as T
    } catch (error) {
      if ((error as ErrnoException).code === 'ENOENT') {
        return fallback
      }

      const isRetryable =
        error instanceof SyntaxError ||
        RETRYABLE_FS_CODES.has((error as ErrnoException).code ?? '')

      if (!isRetryable || attempt === 2) {
        throw error
      }

      await sleep(10 * 2 ** attempt) // 10ms, 20ms, 40ms exponential backoff
    }
  }

  return fallback
}

export async function writeJsonFile(
  path: string,
  value: unknown,
): Promise<void> {
  await writeFileAtomically(path, `${JSON.stringify(value, null, 2)}\n`)
}

export async function readTextFile(
  path: string,
  fallback = '',
): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as ErrnoException).code === 'ENOENT') {
      return fallback
    }
    throw error
  }
}

export async function writeTextFile(
  path: string,
  value: string,
): Promise<void> {
  await writeFileAtomically(path, value)
}

export async function appendTextFile(
  path: string,
  value: string,
): Promise<void> {
  await ensureDir(dirname(path))
  await appendFile(path, value, { encoding: 'utf8' })
}

export type BoundedTailState =
  | 'ok'
  | 'missing'
  | 'empty'
  | 'unreadable'

export type BoundedTailResult = {
  path: string
  state: BoundedTailState
  lines: string[]
  truncated: boolean
  bytesRead: number
  fileSize: number
  error?: string
}

export type ReadBoundedTailOptions = {
  maxLines?: number
  maxBytes?: number
}

export async function readBoundedTail(
  path: string,
  options: ReadBoundedTailOptions = {},
): Promise<BoundedTailResult> {
  const maxLines = Math.max(1, options.maxLines ?? 3)
  const maxBytes = Math.max(1, options.maxBytes ?? 8 * 1024)

  try {
    const fileHandle = await open(path, 'r')
    try {
      const stats = await fileHandle.stat()
      const fileSize = stats.size
      if (fileSize === 0) {
        return {
          path,
          state: 'empty',
          lines: [],
          truncated: false,
          bytesRead: 0,
          fileSize,
        }
      }

      const start = Math.max(0, fileSize - maxBytes)
      const length = Math.min(maxBytes, fileSize)
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await fileHandle.read(buffer, 0, length, start)
      const chunk = buffer.toString('utf8', 0, bytesRead)
      const dropFirstPartialLine =
        start > 0 &&
        buffer[0] !== 0x0a &&
        buffer[0] !== 0x0d

      let lines = chunk
        .split(/\r?\n/)
        .map(line => line.trimEnd())
        .filter(line => line.length > 0)

      if (dropFirstPartialLine && lines.length > 0) {
        lines = lines.slice(1)
      }

      const truncated = start > 0 || lines.length > maxLines

      return {
        path,
        state: lines.length === 0 ? 'empty' : 'ok',
        lines: lines.slice(-maxLines),
        truncated,
        bytesRead,
        fileSize,
      }
    } finally {
      await fileHandle.close()
    }
  } catch (error) {
    const code = (error as ErrnoException).code
    if (code === 'ENOENT') {
      return {
        path,
        state: 'missing',
        lines: [],
        truncated: false,
        bytesRead: 0,
        fileSize: 0,
      }
    }

    return {
      path,
      state: 'unreadable',
      lines: [],
      truncated: false,
      bytesRead: 0,
      fileSize: 0,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function readTailLines(
  path: string,
  maxLines = 3,
): Promise<string[]> {
  const result = await readBoundedTail(path, { maxLines })
  return result.lines
}

export async function writeFileAtomically(
  path: string,
  value: string,
): Promise<void> {
  await ensureDir(dirname(path))
  const tempPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
  )

  try {
    await writeFile(tempPath, value, { encoding: 'utf8', flag: 'wx' })
    await rename(tempPath, path)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function removeDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
}

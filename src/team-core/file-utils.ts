import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

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

export async function readJsonFile<T>(
  path: string,
  fallback: T,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const content = await readFile(path, 'utf8')
      return JSON.parse(content) as T
    } catch (error) {
      if ((error as ErrnoException).code === 'ENOENT') {
        return fallback
      }

      const isSyntaxError = error instanceof SyntaxError
      if (!isSyntaxError || attempt === 2) {
        throw error
      }

      await sleep(5)
    }
  }

  return fallback
}

export async function writeJsonFile(
  path: string,
  value: unknown,
): Promise<void> {
  await ensureDir(dirname(path))
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
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
  await ensureDir(dirname(path))
  await writeFile(path, value, 'utf8')
}

export async function removeDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
}

import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestContext } from 'node:test'
import type { TeamCoreOptions } from '../src/team-core/index.js'

export async function createTempOptions(
  t: TestContext,
): Promise<TeamCoreOptions> {
  const rootDir = await mkdtemp(join(tmpdir(), 'agent-team-'))
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true })
  })
  return { rootDir }
}

export async function createTempDir(t: TestContext): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), 'agent-team-dir-'))
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true })
  })
  return rootDir
}

export async function createExecutableFile(
  t: TestContext,
  filename: string,
  content: string,
): Promise<string> {
  const rootDir = await createTempDir(t)
  const filePath = join(rootDir, filename)
  await writeFile(filePath, content, 'utf8')
  await chmod(filePath, 0o755)
  return filePath
}

export async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

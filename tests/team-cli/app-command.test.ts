import assert from 'node:assert/strict'
import test from 'node:test'
import { renderHelp } from '../../src/team-cli/arg-parsers.js'
import { runCli } from '../../src/team-cli/run-cli.js'

async function withCapturedConsole(
  work: () => Promise<number>,
): Promise<{ exitCode: number; logs: string[]; errors: string[] }> {
  const logs: string[] = []
  const errors: string[] = []
  const originalLog = console.log
  const originalError = console.error
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '))
  }
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '))
  }

  try {
    const exitCode = await work()
    return { exitCode, logs, errors }
  } finally {
    console.log = originalLog
    console.error = originalError
  }
}

test('renderHelp includes the app command entry', () => {
  assert.match(renderHelp(), /agent-team \[--root-dir <path>] app/)
})

test('runCli reports invalid app arguments before launching the interactive app', async () => {
  const output = await withCapturedConsole(() => runCli(['app', '--bogus']))

  assert.equal(output.exitCode, 1)
  assert.equal(output.logs.length, 0)
  assert.match(output.errors.join('\n'), /Unknown app argument: --bogus/)
})

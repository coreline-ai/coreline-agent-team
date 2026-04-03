import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runDoctorCommand } from '../../src/team-cli/commands/doctor.js'
import { runCli } from '../../src/team-cli/run-cli.js'
import { createExecutableFile, createTempDir } from '../test-helpers.js'

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

test('runDoctorCommand reports READY when codex executable, login, workspace, and probe all succeed', async t => {
  const workspace = await createTempDir(t)
  const executablePath = await createExecutableFile(
    t,
    'codex-doctor-success.cjs',
    [
      '#!/usr/bin/env node',
      "const fs = require('node:fs')",
      "const args = process.argv.slice(2)",
      "if (args[0] === '--version') { console.log('codex-cli 0.999-test'); process.exit(0) }",
      "if (args[0] === 'login' && args[1] === 'status') { console.log('Logged in using ChatGPT'); process.exit(0) }",
      "if (args[0] === 'exec') {",
      "  const outputPath = args[args.indexOf('-o') + 1]",
      "  let stdin = ''",
      "  process.stdin.setEncoding('utf8')",
      "  process.stdin.on('data', chunk => { stdin += chunk })",
      "  process.stdin.on('end', () => {",
      "    if (!stdin.includes('READY')) { process.stderr.write('missing probe prompt'); process.exit(2); return }",
      "    fs.writeFileSync(outputPath, 'READY\\n')",
      '    process.exit(0)',
      '  })',
      '  process.stdin.resume()',
      '  return',
      '}',
      "process.stderr.write(`unexpected args: ${args.join(' ')}`)",
      'process.exit(2)',
    ].join('\n'),
  )

  const result = await runDoctorCommand({
    workspace,
    probe: true,
    codexExecutablePath: executablePath,
  })

  assert.equal(result.success, true)
  assert.match(result.message, /Codex CLI executable: OK/)
  assert.match(result.message, /Codex CLI login: OK/)
  assert.match(result.message, /Workspace write access: OK/)
  assert.match(result.message, /Codex exec probe: OK - READY/)
  assert.match(result.message, /Result: READY/)
})

test('runDoctorCommand reports NOT READY when the codex executable is unavailable', async t => {
  const workspace = await createTempDir(t)

  const result = await runDoctorCommand({
    workspace,
    codexExecutablePath: '/path/that/does/not/exist/codex',
  })

  assert.equal(result.success, false)
  assert.match(result.message, /Codex CLI executable: FAIL/)
  assert.match(result.message, /Codex CLI login: SKIP/)
  assert.match(result.message, /Workspace write access: OK/)
  assert.match(result.message, /Result: NOT READY/)
})

test('runCli dispatches doctor command and prints a user-facing summary', async t => {
  const workspace = await createTempDir(t)
  const executablePath = await createExecutableFile(
    t,
    'codex-doctor-dispatch.cjs',
    [
      '#!/usr/bin/env node',
      "const args = process.argv.slice(2)",
      "if (args[0] === '--version') { console.log('codex-cli test-dispatch'); process.exit(0) }",
      "if (args[0] === 'login' && args[1] === 'status') { console.log('Logged in using ChatGPT'); process.exit(0) }",
      "process.stderr.write('unexpected dispatch path')",
      'process.exit(2)',
    ].join('\n'),
  )

  const output = await withCapturedConsole(() =>
    runCli([
      'doctor',
      '--workspace',
      workspace,
      '--codex-executable',
      executablePath,
    ]),
  )

  assert.equal(output.exitCode, 0)
  assert.equal(output.errors.length, 0)
  assert.match(output.logs.join('\n'), /agent-team doctor/)
  assert.match(output.logs.join('\n'), /Result: READY/)
})

test('built CLI bin preserves a node shebang for npm link execution', async () => {
  const builtBin = await readFile('dist/src/team-cli/bin.js', 'utf8')
  assert.match(builtBin, /^#!\/usr\/bin\/env node/)
})

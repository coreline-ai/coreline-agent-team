import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import {
  buildBackgroundResumeCliArgs,
  buildBackgroundSpawnCliArgs,
  launchBackgroundAgentTeamCommand,
} from '../../src/team-operator/background-process.js'

class FakeChildProcess extends EventEmitter {
  pid = 4242
  unrefCalled = false

  override once(event: 'spawn', listener: () => void): this
  override once(event: 'error', listener: (error: Error) => void): this
  override once(
    event: 'spawn' | 'error',
    listener: (() => void) | ((error: Error) => void),
  ): this {
    return super.once(event, listener)
  }

  unref(): void {
    this.unrefCalled = true
  }
}

test('background spawn cli args include root dir and runtime options', () => {
  const args = buildBackgroundSpawnCliArgs(
    {
      teamName: 'alpha team',
      agentName: 'researcher',
      prompt: 'Help with tasks',
      cwd: '/tmp/project',
      runtimeKind: 'codex-cli',
      model: 'gpt-5.4-mini',
      maxIterations: 25,
      pollIntervalMs: 750,
      planModeRequired: true,
      codexExecutablePath: '/usr/local/bin/codex',
    },
    {
      rootDir: '/tmp/agent-root',
    },
  )

  assert.deepEqual(args, [
    '--root-dir',
    '/tmp/agent-root',
    'spawn',
    'alpha team',
    'researcher',
    '--prompt',
    'Help with tasks',
    '--cwd',
    '/tmp/project',
    '--max-iterations',
    '25',
    '--poll-interval',
    '750',
    '--runtime',
    'codex-cli',
    '--model',
    'gpt-5.4-mini',
    '--plan-mode',
    '--codex-executable',
    '/usr/local/bin/codex',
  ])
})

test('background resume cli args include lifecycle command and root dir', () => {
  const args = buildBackgroundResumeCliArgs(
    'resume',
    {
      teamName: 'alpha team',
      agentName: 'researcher',
      maxIterations: 40,
      pollIntervalMs: 600,
    },
    {
      rootDir: '/tmp/agent-root',
    },
  )

  assert.deepEqual(args, [
    '--root-dir',
    '/tmp/agent-root',
    'resume',
    'alpha team',
    'researcher',
    '--max-iterations',
    '40',
    '--poll-interval',
    '600',
  ])
})

test('background launcher starts detached process and unrefs on spawn', async () => {
  const child = new FakeChildProcess()
  let capturedCommand: string | undefined
  let capturedArgs: string[] | undefined
  let capturedOptions:
    | {
        detached: boolean
        stdio: 'ignore'
        env: NodeJS.ProcessEnv
      }
    | undefined

  const resultPromise = launchBackgroundAgentTeamCommand(
    ['spawn', 'alpha team', 'researcher', '--prompt', 'Help'],
    {
      cliBinPath: '/tmp/bin.js',
      nodeExecutablePath: '/usr/local/bin/node',
      spawnImpl: (command, args, options) => {
        capturedCommand = command
        capturedArgs = args
        capturedOptions = options
        queueMicrotask(() => {
          child.emit('spawn')
        })
        return child
      },
    },
  )

  const result = await resultPromise
  assert.equal(result.success, true)
  assert.equal(result.pid, 4242)
  assert.equal(capturedCommand, '/usr/local/bin/node')
  assert.deepEqual(capturedArgs, [
    '/tmp/bin.js',
    'spawn',
    'alpha team',
    'researcher',
    '--prompt',
    'Help',
  ])
  assert.deepEqual(capturedOptions, {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  })
  assert.equal(child.unrefCalled, true)
})

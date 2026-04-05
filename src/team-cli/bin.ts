#!/usr/bin/env node

import { runCli } from './run-cli.js'

function handleSignal(signal: string): void {
  process.exitCode = signal === 'SIGTERM' ? 143 : 130
  process.exit()
}

process.on('SIGTERM', () => handleSignal('SIGTERM'))
process.on('SIGINT', () => handleSignal('SIGINT'))

const exitCode = await runCli()
process.exitCode = exitCode

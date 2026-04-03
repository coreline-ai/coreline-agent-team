#!/usr/bin/env node

import { runCli } from './run-cli.js'

const exitCode = await runCli()
process.exitCode = exitCode

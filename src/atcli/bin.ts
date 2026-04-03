#!/usr/bin/env node

import { runCli } from '../team-cli/run-cli.js'
import { buildAtcliForwardedArgs } from './forwarded-args.js'

const exitCode = await runCli(buildAtcliForwardedArgs(process.argv.slice(2)))
process.exitCode = exitCode

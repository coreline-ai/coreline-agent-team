#!/usr/bin/env node

import process from 'node:process'
import {
  evaluateCodexRepeatedSoakReleaseGate,
  readCodexRepeatedSoakSummaryArtifact,
  renderCodexRepeatedSoakSummary,
  runCodexRepeatedSoak,
} from '../dist/src/team-cli/soak/codex-repeated-soak.js'

const ALLOWED_GATES = new Set(['permission', 'runtime', 'bridge'])

function renderHelp() {
  return [
    'Usage:',
    '  node scripts/run-codex-repeated-soak.mjs [options]',
    '',
    'Options:',
    '  --root-dir <path>',
    '  --cwd <path>',
    '  --team <name>',
    '  --agent <name>',
    '  --label <name>',
    '  --prompt <text>',
    '  --model <name>',
    '  --iterations <n>',
    '  --max-iterations <n>',
    '  --poll-interval <ms>',
    '  --codex-executable <path>',
    '  --artifact-dir <path>',
    '  --gate <permission|runtime|bridge>',
    '  --continue-on-failure',
    '  --help',
  ].join('\n')
}

function parseArgs(argv) {
  const parsed = {
    continueOnFailure: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    const value = argv[index + 1]

    if (token === '--help' || token === '-h') {
      parsed.help = true
      continue
    }
    if (token === '--continue-on-failure') {
      parsed.continueOnFailure = true
      continue
    }
    if (token === '--root-dir') {
      parsed.rootDir = value
      index += 1
      continue
    }
    if (token === '--cwd') {
      parsed.cwd = value
      index += 1
      continue
    }
    if (token === '--team') {
      parsed.teamName = value
      index += 1
      continue
    }
    if (token === '--agent') {
      parsed.agentName = value
      index += 1
      continue
    }
    if (token === '--label') {
      parsed.runLabel = value
      index += 1
      continue
    }
    if (token === '--prompt') {
      parsed.prompt = value
      index += 1
      continue
    }
    if (token === '--model') {
      parsed.model = value
      index += 1
      continue
    }
    if (token === '--iterations') {
      parsed.iterations = value ? Number.parseInt(value, 10) : Number.NaN
      index += 1
      continue
    }
    if (token === '--max-iterations') {
      parsed.maxIterationsPerLaunch = value
        ? Number.parseInt(value, 10)
        : Number.NaN
      index += 1
      continue
    }
    if (token === '--poll-interval') {
      parsed.pollIntervalMs = value ? Number.parseInt(value, 10) : Number.NaN
      index += 1
      continue
    }
    if (token === '--codex-executable') {
      parsed.codexExecutablePath = value
      index += 1
      continue
    }
    if (token === '--artifact-dir') {
      parsed.artifactDir = value
      index += 1
      continue
    }
    if (token === '--gate') {
      if (!value || !ALLOWED_GATES.has(value)) {
        throw new Error(`Invalid gate: ${value ?? '<missing>'}`)
      }
      parsed.gate = value
      index += 1
      continue
    }

    throw new Error(`Unknown argument: ${token}`)
  }

  return parsed
}

async function main() {
  let parsed
  try {
    parsed = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    console.error('')
    console.error(renderHelp())
    process.exit(1)
    return
  }

  if (parsed.help) {
    console.log(renderHelp())
    process.exit(0)
    return
  }

  const result = await runCodexRepeatedSoak(parsed)
  console.log(renderCodexRepeatedSoakSummary(result))
  let gatePassed = true
  if (parsed.gate && result.summaryArtifactPath) {
    const summary = await readCodexRepeatedSoakSummaryArtifact(
      result.summaryArtifactPath,
    )
    const evaluation = evaluateCodexRepeatedSoakReleaseGate(summary, parsed.gate)
    gatePassed = evaluation.passed
    console.log('')
    console.log(`gate=${parsed.gate}`)
    console.log(
      evaluation.passed
        ? 'release_gate=passed'
        : `release_gate=failed (${evaluation.blockers.map(blocker => blocker.code).join(',')})`,
    )
  }
  process.exit(result.success && gatePassed ? 0 : 1)
}

await main()

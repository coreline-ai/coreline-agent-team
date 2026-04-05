#!/usr/bin/env node

import process from 'node:process'
import {
  evaluateCodexRepeatedSoakReleaseGate,
  renderCodexRepeatedSoakGateEvaluation,
  resolveCodexRepeatedSoakSummarySelection,
} from '../dist/src/team-cli/soak/codex-repeated-soak.js'

const ALLOWED_GATES = new Set(['permission', 'runtime', 'bridge'])

function renderHelp() {
  return [
    'Usage:',
    '  node scripts/check-codex-repeated-soak.mjs [options]',
    '',
    'Options:',
    '  --summary <path>',
    '  --history <path>',
    '  --run-label <label>',
    '  --gate <permission|runtime|bridge>',
    '  --json',
    '  --help',
  ].join('\n')
}

function parseArgs(argv) {
  const parsed = {
    json: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    const value = argv[index + 1]

    if (token === '--help' || token === '-h') {
      parsed.help = true
      continue
    }
    if (token === '--json') {
      parsed.json = true
      continue
    }
    if (token === '--summary') {
      parsed.summaryPath = value
      index += 1
      continue
    }
    if (token === '--history') {
      parsed.historyManifestPath = value
      index += 1
      continue
    }
    if (token === '--run-label') {
      parsed.runLabel = value
      index += 1
      continue
    }
    if (token === '--gate') {
      parsed.gate = value
      index += 1
      continue
    }

    throw new Error(`Unknown argument: ${token}`)
  }

  if (!parsed.help && !parsed.summaryPath && !parsed.historyManifestPath) {
    throw new Error('Missing required argument: --summary <path> or --history <path>')
  }

  if (!parsed.help && parsed.summaryPath && parsed.historyManifestPath) {
    throw new Error('Use either --summary <path> or --history <path>, not both')
  }

  if (!parsed.help && parsed.runLabel && !parsed.historyManifestPath) {
    throw new Error('--run-label requires --history <path>')
  }

  if (!parsed.help && !parsed.gate) {
    throw new Error('Missing required argument: --gate <permission|runtime|bridge>')
  }
  if (parsed.gate && !ALLOWED_GATES.has(parsed.gate)) {
    throw new Error(`Invalid gate: ${parsed.gate}`)
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

  const selection = await resolveCodexRepeatedSoakSummarySelection({
    summaryPath: parsed.summaryPath,
    historyManifestPath: parsed.historyManifestPath,
    runLabel: parsed.runLabel,
  })
  const evaluation = evaluateCodexRepeatedSoakReleaseGate(
    selection.summary,
    parsed.gate,
    {
      summaryPath: selection.summaryPath,
      historyManifestPath: selection.historyManifestPath,
      historyRunCount: selection.historyRunCount,
      selectedRunLabel: selection.selectedRunLabel,
    },
  )

  if (parsed.json) {
    console.log(JSON.stringify(evaluation, null, 2))
  } else {
    console.log(renderCodexRepeatedSoakGateEvaluation(evaluation))
  }

  process.exit(evaluation.passed ? 0 : 1)
}

await main()

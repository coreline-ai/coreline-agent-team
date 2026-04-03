import type {
  TaskStatus,
  TeamCoreOptions,
  TeamPermissionMode,
} from '../team-core/index.js'
import type { PermissionListScope } from './commands/permissions.js'

export type RuntimeKind = 'local' | 'codex-cli' | 'upstream'

export function isTaskStatus(value: string): value is TaskStatus {
  return value === 'pending' || value === 'in_progress' || value === 'completed'
}

export function isRuntimeKind(value: string): value is RuntimeKind {
  return value === 'local' || value === 'codex-cli' || value === 'upstream'
}

export function isTeamPermissionMode(value: string): value is TeamPermissionMode {
  return (
    value === 'default' ||
    value === 'plan' ||
    value === 'acceptEdits' ||
    value === 'bypassPermissions' ||
    value === 'auto'
  )
}

export function isPermissionListScope(value: string): value is PermissionListScope {
  return value === 'pending' || value === 'resolved' || value === 'rules'
}

export function renderHelp(): string {
  return [
    'Usage:',
    '  agent-team [--root-dir <path>] init <team-name>',
    '  agent-team [--root-dir <path>] doctor [--workspace <path>] [--probe] [--codex-executable <path>]',
    '  agent-team [--root-dir <path>] attach [team-name]',
    '  agent-team [--root-dir <path>] app [--team <name>] [--workspace <path>] [--runtime <local|codex-cli|upstream>] [--model <name>] [--codex-executable <path>] [--upstream-executable <path>]',
    '  agent-team [--root-dir <path>] run <goal...> [--workspace <path>] [--team <name>] [--preset <software-factory>] [--runtime <local|codex-cli|upstream>] [--model <name>] [--max-iterations <n>] [--poll-interval <ms>] [--codex-executable <path>] [--upstream-executable <path>] [--codex-arg <value>] [--upstream-arg <value>]',
    '  agent-team [--root-dir <path>] watch <team-name>',
    '  agent-team [--root-dir <path>] tui [team-name]',
    '  agent-team [--root-dir <path>] spawn <team-name> <agent-name> --prompt <prompt> [--cwd <path>] [--plan-mode] [--max-iterations <n>] [--poll-interval <ms>] [--runtime <local|codex-cli|upstream>] [--model <name>] [--codex-executable <path>] [--upstream-executable <path>] [--codex-arg <value>] [--upstream-arg <value>]',
    '  agent-team [--root-dir <path>] resume <team-name> <agent-name> [--max-iterations <n>] [--poll-interval <ms>]',
    '  agent-team [--root-dir <path>] reopen <team-name> <agent-name> [--max-iterations <n>] [--poll-interval <ms>]',
    '  agent-team [--root-dir <path>] cleanup <team-name> [--stale-after-ms <ms>] [--remove-inactive]',
    '  agent-team [--root-dir <path>] permissions <team-name> [pending|resolved|rules]',
    '  agent-team [--root-dir <path>] transcript <team-name> <agent-name> [--limit <n>]',
    '  agent-team [--root-dir <path>] tasks <team-name>',
    '  agent-team [--root-dir <path>] send <team-name> <recipient> <message>',
    '  agent-team [--root-dir <path>] status <team-name>',
    '  agent-team [--root-dir <path>] task-create <team-name> <subject> <description>',
    '  agent-team [--root-dir <path>] task-update <team-name> <task-id> <status> [owner|-]',
    '  agent-team [--root-dir <path>] shutdown <team-name> <recipient> [reason]',
    '  agent-team [--root-dir <path>] approve-permission <team-name> <recipient> <request-id> [--persist] [--rule <text>] [--match-command <text>] [--match-cwd-prefix <path>] [--match-path-prefix <path>] [--match-host <host>]',
    '  agent-team [--root-dir <path>] deny-permission <team-name> <recipient> <request-id> <error> [--persist] [--rule <text>] [--match-command <text>] [--match-cwd-prefix <path>] [--match-path-prefix <path>] [--match-host <host>]',
    '  agent-team [--root-dir <path>] approve-sandbox <team-name> <recipient> <request-id> <host>',
    '  agent-team [--root-dir <path>] deny-sandbox <team-name> <recipient> <request-id> <host>',
    '  agent-team [--root-dir <path>] approve-plan <team-name> <recipient> <request-id>',
    '  agent-team [--root-dir <path>] reject-plan <team-name> <recipient> <request-id> <feedback>',
    '  agent-team [--root-dir <path>] set-mode <team-name> <recipient> <mode>',
  ].join('\n')
}

export function parseGlobalOptions(argv: string[]): {
  args: string[]
  options: TeamCoreOptions
  error?: string
} {
  const args: string[] = []
  const options: TeamCoreOptions = {}

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--root-dir') {
      const value = argv[index + 1]
      if (!value) {
        return {
          args,
          options,
          error: 'Missing value for --root-dir',
        }
      }
      options.rootDir = value
      index += 1
      continue
    }
    args.push(token)
  }

  return {
    args,
    options,
  }
}

export function parseDoctorArgs(rest: string[]): {
  workspace?: string
  probe: boolean
  codexExecutablePath?: string
  error?: string
} {
  const parsed = {
    workspace: undefined as string | undefined,
    probe: false,
    codexExecutablePath: undefined as string | undefined,
    error: undefined as string | undefined,
  }

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    const value = rest[index + 1]

    if (token === '--probe') {
      parsed.probe = true
      continue
    }
    if (token === '--workspace') {
      if (!value) {
        parsed.error = 'Missing value for --workspace'
        break
      }
      parsed.workspace = value
      index += 1
      continue
    }
    if (token === '--codex-executable') {
      if (!value) {
        parsed.error = 'Missing value for --codex-executable'
        break
      }
      parsed.codexExecutablePath = value
      index += 1
      continue
    }

    parsed.error = `Unknown doctor argument: ${token}`
    break
  }

  return parsed
}


export function parseAppArgs(rest: string[]): {
  teamName?: string
  workspace?: string
  runtimeKind?: RuntimeKind
  model?: string
  codexExecutablePath?: string
  upstreamExecutablePath?: string
  error?: string
} {
  const parsed = {
    teamName: undefined as string | undefined,
    workspace: undefined as string | undefined,
    runtimeKind: undefined as RuntimeKind | undefined,
    model: undefined as string | undefined,
    codexExecutablePath: undefined as string | undefined,
    upstreamExecutablePath: undefined as string | undefined,
    error: undefined as string | undefined,
  }

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    const value = rest[index + 1]

    if (token === '--team') {
      if (!value) {
        parsed.error = 'Missing value for --team'
        break
      }
      parsed.teamName = value
      index += 1
      continue
    }
    if (token === '--workspace') {
      if (!value) {
        parsed.error = 'Missing value for --workspace'
        break
      }
      parsed.workspace = value
      index += 1
      continue
    }
    if (token === '--runtime') {
      if (!value) {
        parsed.error = 'Missing value for --runtime'
        break
      }
      if (!isRuntimeKind(value)) {
        parsed.error = `Invalid value for --runtime: ${value}`
        break
      }
      parsed.runtimeKind = value
      index += 1
      continue
    }
    if (token === '--model') {
      if (!value) {
        parsed.error = 'Missing value for --model'
        break
      }
      parsed.model = value
      index += 1
      continue
    }
    if (token === '--codex-executable') {
      if (!value) {
        parsed.error = 'Missing value for --codex-executable'
        break
      }
      parsed.codexExecutablePath = value
      index += 1
      continue
    }
    if (token === '--upstream-executable') {
      if (!value) {
        parsed.error = 'Missing value for --upstream-executable'
        break
      }
      parsed.upstreamExecutablePath = value
      index += 1
      continue
    }

    parsed.error = `Unknown app argument: ${token}`
    break
  }

  return parsed
}

export function parseApprovePermissionArgs(rest: string[]): {
  teamName?: string
  recipient?: string
  requestId?: string
  persistDecision: boolean
  ruleContent?: string
  commandContains?: string
  cwdPrefix?: string
  pathPrefix?: string
  hostEquals?: string
  error?: string
} {
  const [teamName, recipient, requestId, ...flags] = rest
  const parsed = {
    teamName,
    recipient,
    requestId,
    persistDecision: false,
    ruleContent: undefined as string | undefined,
    commandContains: undefined as string | undefined,
    cwdPrefix: undefined as string | undefined,
    pathPrefix: undefined as string | undefined,
    hostEquals: undefined as string | undefined,
    error: undefined as string | undefined,
  }

  for (let index = 0; index < flags.length; index += 1) {
    const token = flags[index]
    const value = flags[index + 1]

    if (token === '--persist') {
      parsed.persistDecision = true
      continue
    }
    if (token === '--rule') {
      if (!value) {
        parsed.error = 'Missing value for --rule'
        break
      }
      parsed.ruleContent = value
      index += 1
      continue
    }
    if (token === '--match-command') {
      if (!value) {
        parsed.error = 'Missing value for --match-command'
        break
      }
      parsed.commandContains = value
      index += 1
      continue
    }
    if (token === '--match-cwd-prefix') {
      if (!value) {
        parsed.error = 'Missing value for --match-cwd-prefix'
        break
      }
      parsed.cwdPrefix = value
      index += 1
      continue
    }
    if (token === '--match-path-prefix') {
      if (!value) {
        parsed.error = 'Missing value for --match-path-prefix'
        break
      }
      parsed.pathPrefix = value
      index += 1
      continue
    }
    if (token === '--match-host') {
      if (!value) {
        parsed.error = 'Missing value for --match-host'
        break
      }
      parsed.hostEquals = value
      index += 1
      continue
    }

    parsed.error = `Unknown approve-permission argument: ${token}`
    break
  }

  return parsed
}

export function parseDenyPermissionArgs(rest: string[]): {
  teamName?: string
  recipient?: string
  requestId?: string
  errorMessage?: string
  persistDecision: boolean
  ruleContent?: string
  commandContains?: string
  cwdPrefix?: string
  pathPrefix?: string
  hostEquals?: string
  error?: string
} {
  const [teamName, recipient, requestId, ...remaining] = rest
  const flagStartIndex = remaining.findIndex(value => value.startsWith('--'))
  const errorParts =
    flagStartIndex === -1 ? remaining : remaining.slice(0, flagStartIndex)
  const flags =
    flagStartIndex === -1 ? [] : remaining.slice(flagStartIndex)
  const parsed = {
    teamName,
    recipient,
    requestId,
    errorMessage: errorParts.join(' '),
    persistDecision: false,
    ruleContent: undefined as string | undefined,
    commandContains: undefined as string | undefined,
    cwdPrefix: undefined as string | undefined,
    pathPrefix: undefined as string | undefined,
    hostEquals: undefined as string | undefined,
    error: undefined as string | undefined,
  }

  for (let index = 0; index < flags.length; index += 1) {
    const token = flags[index]
    const value = flags[index + 1]

    if (token === '--persist') {
      parsed.persistDecision = true
      continue
    }
    if (token === '--rule') {
      if (!value) {
        parsed.error = 'Missing value for --rule'
        break
      }
      parsed.ruleContent = value
      index += 1
      continue
    }
    if (token === '--match-command') {
      if (!value) {
        parsed.error = 'Missing value for --match-command'
        break
      }
      parsed.commandContains = value
      index += 1
      continue
    }
    if (token === '--match-cwd-prefix') {
      if (!value) {
        parsed.error = 'Missing value for --match-cwd-prefix'
        break
      }
      parsed.cwdPrefix = value
      index += 1
      continue
    }
    if (token === '--match-path-prefix') {
      if (!value) {
        parsed.error = 'Missing value for --match-path-prefix'
        break
      }
      parsed.pathPrefix = value
      index += 1
      continue
    }
    if (token === '--match-host') {
      if (!value) {
        parsed.error = 'Missing value for --match-host'
        break
      }
      parsed.hostEquals = value
      index += 1
      continue
    }

    parsed.error = `Unknown deny-permission argument: ${token}`
    break
  }

  return parsed
}

export function parseSpawnArgs(rest: string[]): {
  teamName?: string
  agentName?: string
  prompt?: string
  cwd?: string
  model?: string
  runtimeKind?: RuntimeKind
  codexExecutablePath?: string
  upstreamExecutablePath?: string
  codexArgs: string[]
  upstreamArgs: string[]
  planModeRequired: boolean
  maxIterations?: number
  pollIntervalMs?: number
  error?: string
} {
  const [teamName, agentName, ...flags] = rest
  const parsed = {
    teamName,
    agentName,
    prompt: undefined as string | undefined,
    cwd: undefined as string | undefined,
    model: undefined as string | undefined,
    runtimeKind: undefined as RuntimeKind | undefined,
    codexExecutablePath: undefined as string | undefined,
    upstreamExecutablePath: undefined as string | undefined,
    codexArgs: [] as string[],
    upstreamArgs: [] as string[],
    planModeRequired: false,
    maxIterations: undefined as number | undefined,
    pollIntervalMs: undefined as number | undefined,
    error: undefined as string | undefined,
  }

  for (let index = 0; index < flags.length; index += 1) {
    const token = flags[index]
    const value = flags[index + 1]

    if (token === '--prompt') {
      if (!value) {
        parsed.error = 'Missing value for --prompt'
        break
      }
      parsed.prompt = value
      index += 1
      continue
    }
    if (token === '--cwd') {
      if (!value) {
        parsed.error = 'Missing value for --cwd'
        break
      }
      parsed.cwd = value
      index += 1
      continue
    }
    if (token === '--runtime') {
      if (!value) {
        parsed.error = 'Missing value for --runtime'
        break
      }
      if (!isRuntimeKind(value)) {
        parsed.error = `Invalid value for --runtime: ${value}`
        break
      }
      parsed.runtimeKind = value
      index += 1
      continue
    }
    if (token === '--model') {
      if (!value) {
        parsed.error = 'Missing value for --model'
        break
      }
      parsed.model = value
      index += 1
      continue
    }
    if (token === '--codex-executable') {
      if (!value) {
        parsed.error = 'Missing value for --codex-executable'
        break
      }
      parsed.codexExecutablePath = value
      index += 1
      continue
    }
    if (token === '--codex-arg') {
      if (!value) {
        parsed.error = 'Missing value for --codex-arg'
        break
      }
      parsed.codexArgs.push(value)
      index += 1
      continue
    }
    if (token === '--upstream-executable') {
      if (!value) {
        parsed.error = 'Missing value for --upstream-executable'
        break
      }
      parsed.upstreamExecutablePath = value
      index += 1
      continue
    }
    if (token === '--upstream-arg') {
      if (!value) {
        parsed.error = 'Missing value for --upstream-arg'
        break
      }
      parsed.upstreamArgs.push(value)
      index += 1
      continue
    }
    if (token === '--plan-mode') {
      parsed.planModeRequired = true
      continue
    }
    if (token === '--max-iterations') {
      if (!value) {
        parsed.error = 'Missing value for --max-iterations'
        break
      }
      const parsedNumber = Number.parseInt(value, 10)
      if (Number.isNaN(parsedNumber) || parsedNumber <= 0) {
        parsed.error = `Invalid value for --max-iterations: ${value}`
        break
      }
      parsed.maxIterations = parsedNumber
      index += 1
      continue
    }
    if (token === '--poll-interval') {
      if (!value) {
        parsed.error = 'Missing value for --poll-interval'
        break
      }
      const parsedNumber = Number.parseInt(value, 10)
      if (Number.isNaN(parsedNumber) || parsedNumber <= 0) {
        parsed.error = `Invalid value for --poll-interval: ${value}`
        break
      }
      parsed.pollIntervalMs = parsedNumber
      index += 1
      continue
    }

    parsed.error = `Unknown spawn argument: ${token}`
    break
  }

  return parsed
}

export type RunPresetName = 'software-factory'

export function isRunPresetName(value: string): value is RunPresetName {
  return value === 'software-factory'
}

export function parseRunArgs(rest: string[]): {
  goal?: string
  workspace?: string
  teamName?: string
  preset?: RunPresetName
  runtimeKind?: RuntimeKind
  model?: string
  codexExecutablePath?: string
  upstreamExecutablePath?: string
  codexArgs: string[]
  upstreamArgs: string[]
  maxIterations?: number
  pollIntervalMs?: number
  error?: string
} {
  const flagStartIndex = rest.findIndex(token => token.startsWith('--'))
  const goalParts =
    flagStartIndex === -1 ? rest : rest.slice(0, flagStartIndex)
  const flags = flagStartIndex === -1 ? [] : rest.slice(flagStartIndex)

  const parsed = {
    goal: goalParts.join(' ').trim() || undefined,
    workspace: undefined as string | undefined,
    teamName: undefined as string | undefined,
    preset: undefined as RunPresetName | undefined,
    runtimeKind: undefined as RuntimeKind | undefined,
    model: undefined as string | undefined,
    codexExecutablePath: undefined as string | undefined,
    upstreamExecutablePath: undefined as string | undefined,
    codexArgs: [] as string[],
    upstreamArgs: [] as string[],
    maxIterations: undefined as number | undefined,
    pollIntervalMs: undefined as number | undefined,
    error: undefined as string | undefined,
  }

  for (let index = 0; index < flags.length; index += 1) {
    const token = flags[index]
    const value = flags[index + 1]

    if (token === '--workspace') {
      if (!value) {
        parsed.error = 'Missing value for --workspace'
        break
      }
      parsed.workspace = value
      index += 1
      continue
    }
    if (token === '--team') {
      if (!value) {
        parsed.error = 'Missing value for --team'
        break
      }
      parsed.teamName = value
      index += 1
      continue
    }
    if (token === '--preset') {
      if (!value) {
        parsed.error = 'Missing value for --preset'
        break
      }
      if (!isRunPresetName(value)) {
        parsed.error = `Invalid value for --preset: ${value}`
        break
      }
      parsed.preset = value
      index += 1
      continue
    }
    if (token === '--runtime') {
      if (!value) {
        parsed.error = 'Missing value for --runtime'
        break
      }
      if (!isRuntimeKind(value)) {
        parsed.error = `Invalid value for --runtime: ${value}`
        break
      }
      parsed.runtimeKind = value
      index += 1
      continue
    }
    if (token === '--model') {
      if (!value) {
        parsed.error = 'Missing value for --model'
        break
      }
      parsed.model = value
      index += 1
      continue
    }
    if (token === '--codex-executable') {
      if (!value) {
        parsed.error = 'Missing value for --codex-executable'
        break
      }
      parsed.codexExecutablePath = value
      index += 1
      continue
    }
    if (token === '--upstream-executable') {
      if (!value) {
        parsed.error = 'Missing value for --upstream-executable'
        break
      }
      parsed.upstreamExecutablePath = value
      index += 1
      continue
    }
    if (token === '--codex-arg') {
      if (!value) {
        parsed.error = 'Missing value for --codex-arg'
        break
      }
      parsed.codexArgs.push(value)
      index += 1
      continue
    }
    if (token === '--upstream-arg') {
      if (!value) {
        parsed.error = 'Missing value for --upstream-arg'
        break
      }
      parsed.upstreamArgs.push(value)
      index += 1
      continue
    }
    if (token === '--max-iterations') {
      if (!value) {
        parsed.error = 'Missing value for --max-iterations'
        break
      }
      const parsedNumber = Number.parseInt(value, 10)
      if (Number.isNaN(parsedNumber) || parsedNumber <= 0) {
        parsed.error = `Invalid value for --max-iterations: ${value}`
        break
      }
      parsed.maxIterations = parsedNumber
      index += 1
      continue
    }
    if (token === '--poll-interval') {
      if (!value) {
        parsed.error = 'Missing value for --poll-interval'
        break
      }
      const parsedNumber = Number.parseInt(value, 10)
      if (Number.isNaN(parsedNumber) || parsedNumber <= 0) {
        parsed.error = `Invalid value for --poll-interval: ${value}`
        break
      }
      parsed.pollIntervalMs = parsedNumber
      index += 1
      continue
    }

    parsed.error = `Unknown run argument: ${token}`
    break
  }

  return parsed
}

export function parseResumeArgs(rest: string[]): {
  teamName?: string
  agentName?: string
  maxIterations?: number
  pollIntervalMs?: number
  error?: string
} {
  const [teamName, agentName, ...flags] = rest
  const parsed = {
    teamName,
    agentName,
    maxIterations: undefined as number | undefined,
    pollIntervalMs: undefined as number | undefined,
    error: undefined as string | undefined,
  }

  for (let index = 0; index < flags.length; index += 1) {
    const token = flags[index]
    const value = flags[index + 1]

    if (token === '--max-iterations') {
      if (!value) {
        parsed.error = 'Missing value for --max-iterations'
        break
      }
      const parsedNumber = Number.parseInt(value, 10)
      if (Number.isNaN(parsedNumber) || parsedNumber <= 0) {
        parsed.error = `Invalid value for --max-iterations: ${value}`
        break
      }
      parsed.maxIterations = parsedNumber
      index += 1
      continue
    }
    if (token === '--poll-interval') {
      if (!value) {
        parsed.error = 'Missing value for --poll-interval'
        break
      }
      const parsedNumber = Number.parseInt(value, 10)
      if (Number.isNaN(parsedNumber) || parsedNumber <= 0) {
        parsed.error = `Invalid value for --poll-interval: ${value}`
        break
      }
      parsed.pollIntervalMs = parsedNumber
      index += 1
      continue
    }

    parsed.error = `Unknown resume argument: ${token}`
    break
  }

  return parsed
}

export function parseCleanupArgs(rest: string[]): {
  teamName?: string
  staleAfterMs?: number
  removeInactiveMembers: boolean
  error?: string
} {
  const [teamName, ...flags] = rest
  const parsed = {
    teamName,
    staleAfterMs: undefined as number | undefined,
    removeInactiveMembers: false,
    error: undefined as string | undefined,
  }

  for (let index = 0; index < flags.length; index += 1) {
    const token = flags[index]
    const value = flags[index + 1]

    if (token === '--remove-inactive') {
      parsed.removeInactiveMembers = true
      continue
    }
    if (token === '--stale-after-ms') {
      if (!value) {
        parsed.error = 'Missing value for --stale-after-ms'
        break
      }
      const parsedNumber = Number.parseInt(value, 10)
      if (Number.isNaN(parsedNumber) || parsedNumber < 0) {
        parsed.error = `Invalid value for --stale-after-ms: ${value}`
        break
      }
      parsed.staleAfterMs = parsedNumber
      index += 1
      continue
    }

    parsed.error = `Unknown cleanup argument: ${token}`
    break
  }

  return parsed
}

export function parseTranscriptArgs(rest: string[]): {
  teamName?: string
  agentName?: string
  limit?: number
  error?: string
} {
  const [teamName, agentName, ...flags] = rest
  const parsed = {
    teamName,
    agentName,
    limit: undefined as number | undefined,
    error: undefined as string | undefined,
  }

  for (let index = 0; index < flags.length; index += 1) {
    const token = flags[index]
    const value = flags[index + 1]

    if (token === '--limit') {
      if (!value) {
        parsed.error = 'Missing value for --limit'
        break
      }
      const parsedNumber = Number.parseInt(value, 10)
      if (Number.isNaN(parsedNumber) || parsedNumber <= 0) {
        parsed.error = `Invalid value for --limit: ${value}`
        break
      }
      parsed.limit = parsedNumber
      index += 1
      continue
    }

    parsed.error = `Unknown transcript argument: ${token}`
    break
  }

  return parsed
}

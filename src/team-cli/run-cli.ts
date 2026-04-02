import type {
  TaskStatus,
  TeamCoreOptions,
  TeamPermissionMode,
} from '../team-core/index.js'
import { runWatchCommand } from '../team-tui/commands/watch.js'
import { runTuiCommand } from '../team-tui/commands/tui.js'
import { runApprovePermissionCommand } from './commands/approve-permission.js'
import { runApproveSandboxCommand } from './commands/approve-sandbox.js'
import { runApprovePlanCommand } from './commands/approve-plan.js'
import { runCleanupCommand } from './commands/cleanup.js'
import { runDenyPermissionCommand } from './commands/deny-permission.js'
import { runDenySandboxCommand } from './commands/deny-sandbox.js'
import { runInitCommand } from './commands/init.js'
import { runPermissionsCommand, type PermissionListScope } from './commands/permissions.js'
import { runReopenCommand } from './commands/reopen.js'
import { runRejectPlanCommand } from './commands/reject-plan.js'
import { runResumeCommand } from './commands/resume.js'
import { runSendCommand } from './commands/send.js'
import { runSetModeCommand } from './commands/set-mode.js'
import { runShutdownCommand } from './commands/shutdown.js'
import { runSpawnCommand } from './commands/spawn.js'
import { runStatusCommand } from './commands/status.js'
import { runTaskCreateCommand } from './commands/task-create.js'
import { runTaskUpdateCommand } from './commands/task-update.js'
import { runTasksCommand } from './commands/tasks.js'
import { runTranscriptCommand } from './commands/transcript.js'

type RuntimeKind = 'local' | 'codex-cli' | 'upstream'

function isTaskStatus(value: string): value is TaskStatus {
  return value === 'pending' || value === 'in_progress' || value === 'completed'
}

function isRuntimeKind(value: string): value is RuntimeKind {
  return value === 'local' || value === 'codex-cli' || value === 'upstream'
}

function isTeamPermissionMode(value: string): value is TeamPermissionMode {
  return (
    value === 'default' ||
    value === 'plan' ||
    value === 'acceptEdits' ||
    value === 'bypassPermissions' ||
    value === 'auto'
  )
}

function isPermissionListScope(value: string): value is PermissionListScope {
  return value === 'pending' || value === 'resolved' || value === 'rules'
}

function renderHelp(): string {
  return [
    'Usage:',
    '  agent-team [--root-dir <path>] init <team-name>',
    '  agent-team [--root-dir <path>] watch <team-name>',
    '  agent-team [--root-dir <path>] tui [team-name]',
    '  agent-team [--root-dir <path>] spawn <team-name> <agent-name> --prompt <prompt> [--cwd <path>] [--plan-mode] [--max-iterations <n>] [--poll-interval <ms>] [--runtime <local|codex-cli|upstream>] [--model <name>] [--codex-executable <path>] [--upstream-executable <path>]',
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

function parseGlobalOptions(argv: string[]): {
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

function parseApprovePermissionArgs(rest: string[]): {
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

function parseDenyPermissionArgs(rest: string[]): {
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

function parseSpawnArgs(rest: string[]): {
  teamName?: string
  agentName?: string
  prompt?: string
  cwd?: string
  model?: string
  runtimeKind?: RuntimeKind
  codexExecutablePath?: string
  upstreamExecutablePath?: string
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
    if (token === '--upstream-executable') {
      if (!value) {
        parsed.error = 'Missing value for --upstream-executable'
        break
      }
      parsed.upstreamExecutablePath = value
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

function parseResumeArgs(rest: string[]): {
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

function parseCleanupArgs(rest: string[]): {
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

function parseTranscriptArgs(rest: string[]): {
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

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  const parsedGlobals = parseGlobalOptions(argv)
  if (parsedGlobals.error) {
    console.error(parsedGlobals.error)
    return 1
  }

  const options = parsedGlobals.options
  const [command, ...rest] = parsedGlobals.args

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(renderHelp())
    return 0
  }

  if (command === 'watch') {
    const [teamName] = rest
    if (!teamName) {
      console.error('Missing team name')
      return 1
    }
    return runWatchCommand(teamName, options)
  }

  if (command === 'tui') {
    const [teamName] = rest
    return runTuiCommand(teamName, options)
  }

  if (command === 'init') {
    const [teamName] = rest
    if (!teamName) {
      console.error('Missing team name')
      return 1
    }
    const result = await runInitCommand(teamName, options)
    console.log(result.message)
    return result.success ? 0 : 1
  }

  if (command === 'spawn') {
    const parsed = parseSpawnArgs(rest)
    if (parsed.error) {
      console.error(parsed.error)
      return 1
    }
    if (!parsed.teamName || !parsed.agentName || !parsed.prompt) {
      console.error('Missing spawn arguments')
      return 1
    }
    const result = await runSpawnCommand(
      parsed.teamName,
      parsed.agentName,
      {
        prompt: parsed.prompt,
        cwd: parsed.cwd,
        model: parsed.model,
        runtimeKind: parsed.runtimeKind,
        planModeRequired: parsed.planModeRequired,
        maxIterations: parsed.maxIterations,
        pollIntervalMs: parsed.pollIntervalMs,
        codexExecutablePath: parsed.codexExecutablePath,
        upstreamExecutablePath: parsed.upstreamExecutablePath,
      },
      options,
    )
    console.log(result.message)
    return result.success ? 0 : 1
  }

  if (command === 'resume') {
    const parsed = parseResumeArgs(rest)
    if (parsed.error) {
      console.error(parsed.error)
      return 1
    }
    if (!parsed.teamName || !parsed.agentName) {
      console.error('Missing resume arguments')
      return 1
    }
    const result = await runResumeCommand(
      parsed.teamName,
      parsed.agentName,
      {
        maxIterations: parsed.maxIterations,
        pollIntervalMs: parsed.pollIntervalMs,
      },
      options,
    )
    console.log(result.message)
    return result.success ? 0 : 1
  }

  if (command === 'reopen') {
    const parsed = parseResumeArgs(rest)
    if (parsed.error) {
      console.error(parsed.error)
      return 1
    }
    if (!parsed.teamName || !parsed.agentName) {
      console.error('Missing reopen arguments')
      return 1
    }
    const result = await runReopenCommand(
      parsed.teamName,
      parsed.agentName,
      {
        maxIterations: parsed.maxIterations,
        pollIntervalMs: parsed.pollIntervalMs,
      },
      options,
    )
    console.log(result.message)
    return result.success ? 0 : 1
  }

  if (command === 'cleanup') {
    const parsed = parseCleanupArgs(rest)
    if (parsed.error) {
      console.error(parsed.error)
      return 1
    }
    if (!parsed.teamName) {
      console.error('Missing team name')
      return 1
    }
    const result = await runCleanupCommand(
      parsed.teamName,
      {
        staleAfterMs: parsed.staleAfterMs,
        removeInactiveMembers: parsed.removeInactiveMembers,
      },
      options,
    )
    console.log(result.message)
    return result.success ? 0 : 1
  }

  if (command === 'permissions') {
    const [teamName, scopeArg] = rest
    if (!teamName) {
      console.error('Missing team name')
      return 1
    }
    const scope = scopeArg ?? 'pending'
    if (!isPermissionListScope(scope)) {
      console.error(`Invalid permissions scope: ${scope}`)
      return 1
    }
    const result = await runPermissionsCommand(teamName, scope, options)
    console.log(result.message)
    return result.success ? 0 : 1
  }

  if (command === 'transcript') {
    const parsed = parseTranscriptArgs(rest)
    if (parsed.error) {
      console.error(parsed.error)
      return 1
    }
    if (!parsed.teamName || !parsed.agentName) {
      console.error('Missing transcript arguments')
      return 1
    }
    const result = await runTranscriptCommand(
      parsed.teamName,
      parsed.agentName,
      parsed.limit,
      options,
    )
    console.log(result.message)
    return result.success ? 0 : 1
  }

  if (command === 'tasks') {
    const [teamName] = rest
    if (!teamName) {
      console.error('Missing team name')
      return 1
    }
    const result = await runTasksCommand(teamName, options)
    console.log(result.message)
    return result.success ? 0 : 1
  }

  if (command === 'send') {
    const [teamName, recipient, ...messageParts] = rest
    if (!teamName || !recipient || messageParts.length === 0) {
      console.error('Missing send arguments')
      return 1
    }
    const result = await runSendCommand(
      teamName,
      recipient,
      messageParts.join(' '),
      options,
    )
    console.log(result.message)
    return result.success ? 0 : 1
  }

  if (command === 'status') {
    const [teamName] = rest
    if (!teamName) {
      console.error('Missing team name')
      return 1
    }
    const result = await runStatusCommand(teamName, options)
    console.log(result.message)
    return result.success ? 0 : 1
  }

  if (command === 'task-create') {
    const [teamName, subject, ...descriptionParts] = rest
    if (!teamName || !subject || descriptionParts.length === 0) {
      console.error('Missing task-create arguments')
      return 1
    }
    const result = await runTaskCreateCommand(
      teamName,
      subject,
      descriptionParts.join(' '),
      options,
    )
    console.log(result.message)
    return result.success ? 0 : 1
  }

  if (command === 'task-update') {
    const [teamName, taskId, status, owner] = rest
    if (!teamName || !taskId || !status) {
      console.error('Missing task-update arguments')
      return 1
    }
    if (!isTaskStatus(status)) {
      console.error(`Invalid task status: ${status}`)
      return 1
    }
    const result = await runTaskUpdateCommand(
      teamName,
      taskId,
      status,
      owner,
      options,
    )
    console.log(result.message)
    return result.success ? 0 : 1
  }

  if (command === 'shutdown') {
    const [teamName, recipient, ...reasonParts] = rest
    if (!teamName || !recipient) {
      console.error('Missing shutdown arguments')
      return 1
    }
    const result = await runShutdownCommand(
      teamName,
      recipient,
      reasonParts.length > 0 ? reasonParts.join(' ') : undefined,
      options,
    )
    console.log(result.message)
    return result.success ? 0 : 1
  }

  if (command === 'approve-permission') {
    const parsed = parseApprovePermissionArgs(rest)
    if (parsed.error) {
      console.error(parsed.error)
      return 1
    }
    if (!parsed.teamName || !parsed.recipient || !parsed.requestId) {
      console.error('Missing approve-permission arguments')
      return 1
    }
    const result = await runApprovePermissionCommand(
      parsed.teamName,
      parsed.recipient,
      parsed.requestId,
      {
        persistDecision: parsed.persistDecision,
        ruleContent: parsed.ruleContent,
        commandContains: parsed.commandContains,
        cwdPrefix: parsed.cwdPrefix,
        pathPrefix: parsed.pathPrefix,
        hostEquals: parsed.hostEquals,
      },
      options,
    )
    console.log(result.message)
    return result.success ? 0 : 1
  }

  if (command === 'deny-permission') {
    const parsed = parseDenyPermissionArgs(rest)
    if (parsed.error) {
      console.error(parsed.error)
      return 1
    }
    if (
      !parsed.teamName ||
      !parsed.recipient ||
      !parsed.requestId ||
      !parsed.errorMessage
    ) {
      console.error('Missing deny-permission arguments')
      return 1
    }
    const result = await runDenyPermissionCommand(
      parsed.teamName,
      parsed.recipient,
      parsed.requestId,
      {
        errorMessage: parsed.errorMessage,
        persistDecision: parsed.persistDecision,
        ruleContent: parsed.ruleContent,
        commandContains: parsed.commandContains,
        cwdPrefix: parsed.cwdPrefix,
        pathPrefix: parsed.pathPrefix,
        hostEquals: parsed.hostEquals,
      },
      options,
    )
    console.log(result.message)
    return result.success ? 0 : 1
  }

  if (command === 'approve-sandbox') {
    const [teamName, recipient, requestId, host] = rest
    if (!teamName || !recipient || !requestId || !host) {
      console.error('Missing approve-sandbox arguments')
      return 1
    }
    const result = await runApproveSandboxCommand(
      teamName,
      recipient,
      requestId,
      host,
      options,
    )
    console.log(result.message)
    return result.success ? 0 : 1
  }

  if (command === 'deny-sandbox') {
    const [teamName, recipient, requestId, host] = rest
    if (!teamName || !recipient || !requestId || !host) {
      console.error('Missing deny-sandbox arguments')
      return 1
    }
    const result = await runDenySandboxCommand(
      teamName,
      recipient,
      requestId,
      host,
      options,
    )
    console.log(result.message)
    return result.success ? 0 : 1
  }

  if (command === 'approve-plan') {
    const [teamName, recipient, requestId] = rest
    if (!teamName || !recipient || !requestId) {
      console.error('Missing approve-plan arguments')
      return 1
    }
    const result = await runApprovePlanCommand(
      teamName,
      recipient,
      requestId,
      options,
    )
    console.log(result.message)
    return result.success ? 0 : 1
  }

  if (command === 'reject-plan') {
    const [teamName, recipient, requestId, ...feedbackParts] = rest
    if (!teamName || !recipient || !requestId || feedbackParts.length === 0) {
      console.error('Missing reject-plan arguments')
      return 1
    }
    const result = await runRejectPlanCommand(
      teamName,
      recipient,
      requestId,
      feedbackParts.join(' '),
      options,
    )
    console.log(result.message)
    return result.success ? 0 : 1
  }

  if (command === 'set-mode') {
    const [teamName, recipient, mode] = rest
    if (!teamName || !recipient || !mode) {
      console.error('Missing set-mode arguments')
      return 1
    }
    if (!isTeamPermissionMode(mode)) {
      console.error(`Invalid mode: ${mode}`)
      return 1
    }
    const result = await runSetModeCommand(teamName, recipient, mode, options)
    console.log(result.message)
    return result.success ? 0 : 1
  }

  console.error(`Unknown command: ${command}`)
  return 1
}

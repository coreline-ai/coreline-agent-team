import type { TeamCoreOptions } from '../team-core/index.js'
import { runWatchCommand } from '../team-tui/commands/watch.js'
import { runTuiCommand } from '../team-tui/commands/tui.js'
import { runAppCommand } from '../team-tui/commands/app.js'
import {
  isPermissionListScope,
  isTaskStatus,
  isTeamPermissionMode,
  parseAppArgs,
  parseApprovePermissionArgs,
  parseCleanupArgs,
  parseDoctorArgs,
  parseDenyPermissionArgs,
  parseLogsArgs,
  parseRunArgs,
  parseResumeArgs,
  parseSpawnArgs,
  parseTranscriptArgs,
} from './arg-parsers.js'
import { runApprovePermissionCommand } from './commands/approve-permission.js'
import { runApproveSandboxCommand } from './commands/approve-sandbox.js'
import { runApprovePlanCommand } from './commands/approve-plan.js'
import { runAttachCommand } from './commands/attach.js'
import { runCleanupCommand } from './commands/cleanup.js'
import { runDenyPermissionCommand } from './commands/deny-permission.js'
import { runDenySandboxCommand } from './commands/deny-sandbox.js'
import { runDoctorCommand } from './commands/doctor.js'
import { runInitCommand } from './commands/init.js'
import { runLogsCommand } from './commands/logs.js'
import { runPermissionsCommand } from './commands/permissions.js'
import { runReopenCommand } from './commands/reopen.js'
import { runRejectPlanCommand } from './commands/reject-plan.js'
import { runResumeCommand } from './commands/resume.js'
import { runRunCommand } from './commands/run.js'
import { runSendCommand } from './commands/send.js'
import { runSetModeCommand } from './commands/set-mode.js'
import { runShutdownCommand } from './commands/shutdown.js'
import { runSpawnCommand } from './commands/spawn.js'
import { runStatusCommand } from './commands/status.js'
import { runTaskCreateCommand } from './commands/task-create.js'
import { runTaskUpdateCommand } from './commands/task-update.js'
import { runTasksCommand } from './commands/tasks.js'
import { runTranscriptCommand } from './commands/transcript.js'
import type { CliCommandResult } from './types.js'

export type CliCommandHandler = (
  rest: string[],
  options: TeamCoreOptions,
) => Promise<number>

function fail(message: string): number {
  console.error(message)
  return 1
}

async function emitResult(
  resultPromise: Promise<CliCommandResult>,
): Promise<number> {
  const result = await resultPromise
  console.log(result.message)
  return result.success ? 0 : 1
}

const cliCommandHandlers: Record<string, CliCommandHandler> = {
  app: async (rest, options) => {
    const parsed = parseAppArgs(rest)
    if (parsed.error) {
      return fail(parsed.error)
    }
    return runAppCommand(
      {
        teamName: parsed.teamName,
        workspace: parsed.workspace,
        runtimeKind: parsed.runtimeKind,
        model: parsed.model,
        codexExecutablePath: parsed.codexExecutablePath,
        upstreamExecutablePath: parsed.upstreamExecutablePath,
      },
      options,
    )
  },
  watch: async (rest, options) => {
    const [teamName] = rest
    if (!teamName) {
      return fail('Missing team name')
    }
    return runWatchCommand(teamName, options)
  },
  tui: async (rest, options) => {
    const [teamName] = rest
    return runTuiCommand(teamName, options)
  },
  init: async (rest, options) => {
    const [teamName] = rest
    if (!teamName) {
      return fail('Missing team name')
    }
    return emitResult(runInitCommand(teamName, options))
  },
  doctor: async rest => {
    const parsed = parseDoctorArgs(rest)
    if (parsed.error) {
      return fail(parsed.error)
    }
    return emitResult(
      runDoctorCommand({
        workspace: parsed.workspace,
        probe: parsed.probe,
        codexExecutablePath: parsed.codexExecutablePath,
      }),
    )
  },
  attach: async (rest, options) => {
    const [teamName] = rest
    return emitResult(runAttachCommand(teamName, options))
  },
  run: async (rest, options) => {
    const parsed = parseRunArgs(rest)
    if (parsed.error) {
      return fail(parsed.error)
    }
    if (!parsed.goal) {
      return fail('Missing run goal')
    }
    return emitResult(
      runRunCommand(
        {
          goal: parsed.goal,
          workspace: parsed.workspace,
          teamName: parsed.teamName,
          preset: parsed.preset,
          roles: parsed.roles,
          runtimeKind: parsed.runtimeKind,
          model: parsed.model,
          maxIterations: parsed.maxIterations,
          pollIntervalMs: parsed.pollIntervalMs,
          codexExecutablePath: parsed.codexExecutablePath,
          upstreamExecutablePath: parsed.upstreamExecutablePath,
          codexArgs: parsed.codexArgs,
          upstreamArgs: parsed.upstreamArgs,
        },
        options,
      ),
    )
  },
  spawn: async (rest, options) => {
    const parsed = parseSpawnArgs(rest)
    if (parsed.error) {
      return fail(parsed.error)
    }
    if (!parsed.teamName || !parsed.agentName || !parsed.prompt) {
      return fail('Missing spawn arguments')
    }
    return emitResult(
      runSpawnCommand(
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
          codexArgs: parsed.codexArgs,
          upstreamArgs: parsed.upstreamArgs,
        },
        options,
      ),
    )
  },
  resume: async (rest, options) => {
    const parsed = parseResumeArgs(rest)
    if (parsed.error) {
      return fail(parsed.error)
    }
    if (!parsed.teamName || !parsed.agentName) {
      return fail('Missing resume arguments')
    }
    return emitResult(
      runResumeCommand(
        parsed.teamName,
        parsed.agentName,
        {
          maxIterations: parsed.maxIterations,
          pollIntervalMs: parsed.pollIntervalMs,
        },
        options,
      ),
    )
  },
  reopen: async (rest, options) => {
    const parsed = parseResumeArgs(rest)
    if (parsed.error) {
      return fail(parsed.error)
    }
    if (!parsed.teamName || !parsed.agentName) {
      return fail('Missing reopen arguments')
    }
    return emitResult(
      runReopenCommand(
        parsed.teamName,
        parsed.agentName,
        {
          maxIterations: parsed.maxIterations,
          pollIntervalMs: parsed.pollIntervalMs,
        },
        options,
      ),
    )
  },
  cleanup: async (rest, options) => {
    const parsed = parseCleanupArgs(rest)
    if (parsed.error) {
      return fail(parsed.error)
    }
    if (!parsed.teamName) {
      return fail('Missing team name')
    }
    return emitResult(
      runCleanupCommand(
        parsed.teamName,
        {
          staleAfterMs: parsed.staleAfterMs,
          removeInactiveMembers: parsed.removeInactiveMembers,
        },
        options,
      ),
    )
  },
  permissions: async (rest, options) => {
    const [teamName, scopeArg] = rest
    if (!teamName) {
      return fail('Missing team name')
    }
    const scope = scopeArg ?? 'pending'
    if (!isPermissionListScope(scope)) {
      return fail(`Invalid permissions scope: ${scope}`)
    }
    return emitResult(runPermissionsCommand(teamName, scope, options))
  },
  transcript: async (rest, options) => {
    const parsed = parseTranscriptArgs(rest)
    if (parsed.error) {
      return fail(parsed.error)
    }
    if (!parsed.teamName || !parsed.agentName) {
      return fail('Missing transcript arguments')
    }
    return emitResult(
      runTranscriptCommand(
        parsed.teamName,
        parsed.agentName,
        parsed.limit,
        options,
      ),
    )
  },
  logs: async (rest, options) => {
    const parsed = parseLogsArgs(rest)
    if (parsed.error) {
      return fail(parsed.error)
    }
    if (!parsed.teamName || !parsed.agentName) {
      return fail('Missing logs arguments')
    }
    return emitResult(
      runLogsCommand(
        parsed.teamName,
        parsed.agentName,
        {
          stream: parsed.stream,
          lines: parsed.lines,
          bytes: parsed.bytes,
        },
        options,
      ),
    )
  },
  tasks: async (rest, options) => {
    const [teamName] = rest
    if (!teamName) {
      return fail('Missing team name')
    }
    return emitResult(runTasksCommand(teamName, options))
  },
  send: async (rest, options) => {
    const [teamName, recipient, ...messageParts] = rest
    if (!teamName || !recipient || messageParts.length === 0) {
      return fail('Missing send arguments')
    }
    return emitResult(
      runSendCommand(teamName, recipient, messageParts.join(' '), options),
    )
  },
  status: async (rest, options) => {
    const [teamName] = rest
    if (!teamName) {
      return fail('Missing team name')
    }
    return emitResult(runStatusCommand(teamName, options))
  },
  'task-create': async (rest, options) => {
    const [teamName, subject, ...descriptionParts] = rest
    if (!teamName || !subject || descriptionParts.length === 0) {
      return fail('Missing task-create arguments')
    }
    return emitResult(
      runTaskCreateCommand(
        teamName,
        subject,
        descriptionParts.join(' '),
        options,
      ),
    )
  },
  'task-update': async (rest, options) => {
    const [teamName, taskId, status, owner] = rest
    if (!teamName || !taskId || !status) {
      return fail('Missing task-update arguments')
    }
    if (!isTaskStatus(status)) {
      return fail(`Invalid task status: ${status}`)
    }
    return emitResult(
      runTaskUpdateCommand(teamName, taskId, status, owner, options),
    )
  },
  shutdown: async (rest, options) => {
    const [teamName, recipient, ...reasonParts] = rest
    if (!teamName || !recipient) {
      return fail('Missing shutdown arguments')
    }
    return emitResult(
      runShutdownCommand(
        teamName,
        recipient,
        reasonParts.length > 0 ? reasonParts.join(' ') : undefined,
        options,
      ),
    )
  },
  'approve-permission': async (rest, options) => {
    const parsed = parseApprovePermissionArgs(rest)
    if (parsed.error) {
      return fail(parsed.error)
    }
    if (!parsed.teamName || !parsed.recipient || !parsed.requestId) {
      return fail('Missing approve-permission arguments')
    }
    return emitResult(
      runApprovePermissionCommand(
        parsed.teamName,
        parsed.recipient,
        parsed.requestId,
        {
          persistDecision: parsed.persistDecision,
          rulePreset: parsed.rulePreset,
          ruleContent: parsed.ruleContent,
          commandContains: parsed.commandContains,
          cwdPrefix: parsed.cwdPrefix,
          pathPrefix: parsed.pathPrefix,
          hostEquals: parsed.hostEquals,
        },
        options,
      ),
    )
  },
  'deny-permission': async (rest, options) => {
    const parsed = parseDenyPermissionArgs(rest)
    if (parsed.error) {
      return fail(parsed.error)
    }
    if (
      !parsed.teamName ||
      !parsed.recipient ||
      !parsed.requestId ||
      !parsed.errorMessage
    ) {
      return fail('Missing deny-permission arguments')
    }
    return emitResult(
      runDenyPermissionCommand(
        parsed.teamName,
        parsed.recipient,
        parsed.requestId,
        {
          errorMessage: parsed.errorMessage,
          persistDecision: parsed.persistDecision,
          rulePreset: parsed.rulePreset,
          ruleContent: parsed.ruleContent,
          commandContains: parsed.commandContains,
          cwdPrefix: parsed.cwdPrefix,
          pathPrefix: parsed.pathPrefix,
          hostEquals: parsed.hostEquals,
        },
        options,
      ),
    )
  },
  'approve-sandbox': async (rest, options) => {
    const [teamName, recipient, requestId, host] = rest
    if (!teamName || !recipient || !requestId || !host) {
      return fail('Missing approve-sandbox arguments')
    }
    return emitResult(
      runApproveSandboxCommand(teamName, recipient, requestId, host, options),
    )
  },
  'deny-sandbox': async (rest, options) => {
    const [teamName, recipient, requestId, host] = rest
    if (!teamName || !recipient || !requestId || !host) {
      return fail('Missing deny-sandbox arguments')
    }
    return emitResult(
      runDenySandboxCommand(teamName, recipient, requestId, host, options),
    )
  },
  'approve-plan': async (rest, options) => {
    const [teamName, recipient, requestId] = rest
    if (!teamName || !recipient || !requestId) {
      return fail('Missing approve-plan arguments')
    }
    return emitResult(
      runApprovePlanCommand(teamName, recipient, requestId, options),
    )
  },
  'reject-plan': async (rest, options) => {
    const [teamName, recipient, requestId, ...feedbackParts] = rest
    if (!teamName || !recipient || !requestId || feedbackParts.length === 0) {
      return fail('Missing reject-plan arguments')
    }
    return emitResult(
      runRejectPlanCommand(
        teamName,
        recipient,
        requestId,
        feedbackParts.join(' '),
        options,
      ),
    )
  },
  'set-mode': async (rest, options) => {
    const [teamName, recipient, mode] = rest
    if (!teamName || !recipient || !mode) {
      return fail('Missing set-mode arguments')
    }
    if (!isTeamPermissionMode(mode)) {
      return fail(`Invalid mode: ${mode}`)
    }
    return emitResult(runSetModeCommand(teamName, recipient, mode, options))
  },
}

export function getCliCommandHandler(
  command: string,
): CliCommandHandler | undefined {
  return cliCommandHandlers[command]
}

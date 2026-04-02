import { randomUUID } from 'node:crypto'
import {
  closeTeamSession,
  openTeamSession,
  readTeamFile,
  removeTeamMember,
  setMemberActive,
  upsertTeamMember,
  type TeamCoreOptions,
} from '../team-core/index.js'
import { createRuntimeContext } from './context.js'
import { createNoopRuntimeAdapter, formatAgentId } from './runtime-adapter.js'
import type {
  RuntimeAdapter,
  RuntimeSpawnResult,
  RuntimeTeammateConfig,
} from './types.js'

function createSessionId(): string {
  return randomUUID()
}

export async function spawnInProcessTeammate(
  config: RuntimeTeammateConfig,
  options: TeamCoreOptions = {},
  adapter: RuntimeAdapter = createNoopRuntimeAdapter(),
): Promise<RuntimeSpawnResult> {
  const team = await readTeamFile(config.teamName, options)

  if (!team) {
    return {
      success: false,
      agentId: formatAgentId(config.name, config.teamName),
      error: `Team "${config.teamName}" does not exist`,
    }
  }

  const agentId = formatAgentId(config.name, config.teamName)
  const existingMember = team.members.find(member => member.agentId === agentId)
  const reusedSessionId =
    config.sessionId ??
    (config.reopenSession === true
      ? existingMember?.runtimeState?.sessionId ??
        existingMember?.runtimeState?.lastSessionId
      : undefined)
  const sessionId = reusedSessionId ?? createSessionId()
  const runtimeConfig: RuntimeTeammateConfig = {
    ...config,
    sessionId,
    reopenSession:
      config.reopenSession === true &&
      reusedSessionId !== undefined &&
      reusedSessionId === sessionId,
  }
  const runtimeContext = createRuntimeContext({
    agentId,
    agentName: config.name,
    teamName: config.teamName,
    color: config.color,
    planModeRequired: config.planModeRequired,
  })

  await openTeamSession(
    config.teamName,
    config.name,
    {
      sessionId,
      runtimeKind: config.runtimeKind ?? 'local',
      cwd: config.cwd,
      prompt: config.prompt,
      model: config.model,
      reopen: runtimeConfig.reopenSession,
    },
    options,
  )

  await upsertTeamMember(
    config.teamName,
    {
      agentId,
      name: config.name,
      agentType: config.name,
      model: config.model,
      color: config.color,
      joinedAt: Date.now(),
      cwd: config.cwd,
      subscriptions: [],
      backendType: config.backendType ?? 'in-process',
      isActive: true,
      runtimeState: {
        sessionId,
        lastSessionId:
          existingMember?.runtimeState?.sessionId !== sessionId
            ? existingMember?.runtimeState?.sessionId
            : existingMember?.runtimeState?.lastSessionId,
        reopenCount:
          (existingMember?.runtimeState?.reopenCount ?? 0) +
          (runtimeConfig.reopenSession ? 1 : 0),
        runtimeKind: config.runtimeKind ?? 'local',
        prompt: config.prompt,
        cwd: config.cwd,
        model: config.model,
        planModeRequired: config.planModeRequired,
        startedAt: Date.now(),
        lastHeartbeatAt: Date.now(),
        maxIterations: config.runtimeOptions?.maxIterations,
        pollIntervalMs: config.runtimeOptions?.pollIntervalMs,
        codexExecutablePath: config.codexExecutablePath,
        codexArgs: config.codexArgs,
        upstreamExecutablePath: config.upstreamExecutablePath,
        upstreamArgs: config.upstreamArgs,
      },
    },
    options,
  )

  const result = await adapter.startTeammate(runtimeConfig, {
    coreOptions: options,
    runtimeContext,
  })

  if (!result.success) {
    await closeTeamSession(
      config.teamName,
      config.name,
      sessionId,
      {
        lastExitReason: result.error ?? 'spawn_failed',
      },
      options,
    )
    if (existingMember) {
      await setMemberActive(config.teamName, config.name, false, options)
    } else {
      await removeTeamMember(config.teamName, { agentId }, options)
    }
    return result
  }

  const baseHandle = result.handle
  return {
    ...result,
    handle: {
      agentId,
      async stop(): Promise<void> {
        await baseHandle?.stop()
        runtimeContext.abortController.abort()
        await setMemberActive(config.teamName, config.name, false, options)
      },
      async join() {
        return baseHandle?.join?.()
      },
    },
  }
}

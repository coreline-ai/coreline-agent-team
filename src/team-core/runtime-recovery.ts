import { closeTeamSession } from './session-store.js'
import { getTaskListIdForTeam } from './paths.js'
import { unassignTeammateTasks } from './task-store.js'
import { readTeamFile, setMemberActive, setMemberRuntimeState } from './team-store.js'
import type { TeamCoreOptions, TeamMember } from './types.js'

export type RepairLostDetachedMembersResult = {
  recoveredAgentNames: string[]
  cleanedTaskIds: string[]
  notificationMessage: string
}

export function isProcessAlive(pid: number | undefined): boolean {
  if (pid === undefined || !Number.isInteger(pid) || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    return code === 'EPERM'
  }
}

function isLostDetachedMember(member: TeamMember): boolean {
  return (
    member.isActive === true &&
    member.runtimeState?.launchMode === 'detached' &&
    member.runtimeState.processId !== undefined &&
    !isProcessAlive(member.runtimeState.processId)
  )
}

export async function listLostDetachedMembers(
  teamName: string,
  options: TeamCoreOptions = {},
): Promise<TeamMember[]> {
  const team = await readTeamFile(teamName, options)
  if (!team) {
    return []
  }

  return team.members.filter(isLostDetachedMember)
}

export async function repairLostDetachedMembers(
  teamName: string,
  options: TeamCoreOptions = {},
): Promise<RepairLostDetachedMembersResult> {
  const lostMembers = await listLostDetachedMembers(teamName, options)
  if (lostMembers.length === 0) {
    return {
      recoveredAgentNames: [],
      cleanedTaskIds: [],
      notificationMessage: 'No lost detached workers found.',
    }
  }

  const now = Date.now()
  const taskListId = getTaskListIdForTeam(teamName)
  const cleanedTaskIds = new Set<string>()

  for (const member of lostMembers) {
    await setMemberRuntimeState(
      teamName,
      member.name,
      {
        processId: undefined,
        currentWorkKind: undefined,
        currentTaskId: undefined,
        currentWorkSummary: undefined,
        turnStartedAt: undefined,
        lastTurnEndedAt: now,
        lastHeartbeatAt: now,
        lastExitAt: now,
        lastExitReason: 'lost',
      },
      options,
    )
    await setMemberActive(teamName, member.name, false, options)

    if (member.runtimeState?.sessionId) {
      await closeTeamSession(
        teamName,
        member.name,
        member.runtimeState.sessionId,
        {
          lastExitReason: 'lost',
        },
        options,
      )
    }

    const unassigned = await unassignTeammateTasks(
      taskListId,
      member.agentId,
      member.name,
      'terminated',
      options,
    )
    for (const task of unassigned.unassignedTasks) {
      cleanedTaskIds.add(task.id)
    }
  }

  return {
    recoveredAgentNames: lostMembers.map(member => member.name),
    cleanedTaskIds: [...cleanedTaskIds].sort((left, right) => Number(left) - Number(right)),
    notificationMessage: `Recovered ${lostMembers.length} lost detached worker(s).`,
  }
}

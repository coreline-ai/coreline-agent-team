import { closeTeamSession } from './session-store.js'
import { getTaskListIdForTeam } from './paths.js'
import { listTasks, unassignTeammateTasks } from './task-store.js'
import { readTeamFile, setMemberActive, setMemberRuntimeState } from './team-store.js'
import type { TeamCoreOptions, TeamMember, TeamTask } from './types.js'

export type RepairLostDetachedMembersResult = {
  recoveredAgentNames: string[]
  cleanedTaskIds: string[]
  notificationMessage: string
}

export type RepairLostRuntimeMembersResult = RepairLostDetachedMembersResult

export type RuntimeRecoveryExitReason =
  | 'lost'
  | 'completed-with-evidence'
  | 'completed-clean'

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
    isLostRuntimeMember(member) &&
    member.runtimeState?.launchMode === 'detached'
  )
}

function isLostRuntimeMember(member: TeamMember): boolean {
  return (
    member.isActive === true &&
    member.runtimeState?.processId !== undefined &&
    !isProcessAlive(member.runtimeState.processId)
  )
}

function hasRuntimeEvidence(task: TeamTask | undefined): boolean {
  if (!task?.metadata || typeof task.metadata !== 'object') {
    return false
  }

  return 'runtimeEvidence' in task.metadata
}

function resolveRecoveryExitReason(
  member: TeamMember,
  tasks: TeamTask[],
): RuntimeRecoveryExitReason {
  const currentTaskId = member.runtimeState?.currentTaskId
  if (!currentTaskId) {
    return 'lost'
  }

  const currentTask = tasks.find(task => task.id === currentTaskId)
  if (currentTask?.status !== 'completed') {
    return 'lost'
  }

  return hasRuntimeEvidence(currentTask)
    ? 'completed-with-evidence'
    : 'completed-clean'
}

async function repairLostMembers(
  teamName: string,
  members: TeamMember[],
  options: TeamCoreOptions = {},
): Promise<RepairLostRuntimeMembersResult> {
  if (members.length === 0) {
    return {
      recoveredAgentNames: [],
      cleanedTaskIds: [],
      notificationMessage: 'No lost workers found.',
    }
  }

  const now = Date.now()
  const taskListId = getTaskListIdForTeam(teamName)
  const tasks = await listTasks(taskListId, options)
  const cleanedTaskIds = new Set<string>()

  for (const member of members) {
    const exitReason = resolveRecoveryExitReason(member, tasks)

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
        lastExitReason: exitReason,
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
          lastExitReason: exitReason,
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
    recoveredAgentNames: members.map(member => member.name),
    cleanedTaskIds: [...cleanedTaskIds].sort((left, right) => Number(left) - Number(right)),
    notificationMessage: `Recovered ${members.length} lost worker(s).`,
  }
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

export async function listLostRuntimeMembers(
  teamName: string,
  options: TeamCoreOptions = {},
): Promise<TeamMember[]> {
  const team = await readTeamFile(teamName, options)
  if (!team) {
    return []
  }

  return team.members.filter(isLostRuntimeMember)
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

  const repaired = await repairLostMembers(teamName, lostMembers, options)
  return {
    ...repaired,
    notificationMessage: `Recovered ${lostMembers.length} lost detached worker(s).`,
  }
}

export async function repairLostRuntimeMembers(
  teamName: string,
  options: TeamCoreOptions = {},
): Promise<RepairLostRuntimeMembersResult> {
  const lostMembers = await listLostRuntimeMembers(teamName, options)
  return repairLostMembers(teamName, lostMembers, options)
}

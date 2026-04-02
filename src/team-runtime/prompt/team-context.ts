export type TeamContextPromptInput = {
  agentName: string
  teamName: string
  teamConfigPath: string
  taskListPath: string
}

export function renderTeamContextPrompt(
  input: TeamContextPromptInput,
): string {
  return [
    '<system-reminder>',
    '# Team Coordination',
    '',
    `You are a teammate in team "${input.teamName}".`,
    '',
    '**Your Identity:**',
    `- Name: ${input.agentName}`,
    '',
    '**Team Resources:**',
    `- Team config: ${input.teamConfigPath}`,
    `- Task list: ${input.taskListPath}`,
    '',
    '**Team Leader:** The team lead is "team-lead".',
    'Read the team config to discover teammates.',
    'Check the task list periodically and send updates to the team lead.',
    '</system-reminder>',
  ].join('\n')
}

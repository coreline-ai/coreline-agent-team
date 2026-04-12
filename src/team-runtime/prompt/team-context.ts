export type TeamContextPromptInput = {
  agentName: string
  teamName: string
  teamConfigPath: string
  taskListPath: string
}

export function renderTeamContextPrompt(
  input: TeamContextPromptInput,
): string {
  const isPlanner = /^planner(?:$|[-@])/.test(input.agentName)
  const isReviewer = /^reviewer(?:$|[-@])/.test(input.agentName)
  const isImplementation = /^(frontend|backend|testing|database|devops|mobile|security)(?:$|[-@])/.test(
    input.agentName,
  )

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
    '',
    '# Execution Policy',
    isPlanner
      ? '- You are responsible for freezing docs/implementation-contract.md before broad implementation begins. Prefer docs/goal.md and metadata files already present under docs/ as the source of truth.'
      : isImplementation
        ? '- Prefer docs/implementation-contract.md, docs/plan.md, and docs/architecture.md over broad metadata bundles.'
        : '- Follow the planner-frozen contract and stay inside your owned scope.',
    isImplementation
      ? '- If docs/implementation-contract.md is missing, report blocked instead of exploring unrelated metadata.'
      : '- Keep your updates concise and evidence-oriented.',
    isImplementation
      ? '- When the work item prompt includes file snapshots, use them first and edit the scoped starter file in place before browsing other files.'
      : '- Keep the current task narrower than any broader roadmap language.',
    isImplementation
      ? '- If the current starter file already satisfies most of the work item, prefer a minimal adjustment and completion summary over a broad rewrite.'
      : '- Prefer the smallest change that unblocks the next teammate.',
    isImplementation
      ? '- Do not reopen docs/plan.md or docs/architecture.md unless the frozen contract snapshot is insufficient for the current file.'
      : '- Prefer the smallest change that unblocks the next teammate.',
    isReviewer
      ? '- Do not issue a final verdict until implementation artifacts, test evidence, and review notes are all present.'
      : '- Stay within your scoped paths and do not claim cross-role work.',
    '</system-reminder>',
  ].join('\n')
}

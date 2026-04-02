# team-cli

`team-cli` is the thin command layer for local development of `agent-team`.

Current scaffold commands:

- `init <team-name>`
- `spawn <team-name> <agent-name> --prompt <prompt> [--cwd <path>] [--plan-mode] [--max-iterations <n>]`
- `tasks <team-name>`
- `send <team-name> <recipient> <message>`
- `status <team-name>`
- `task-create <team-name> <subject> <description>`
- `task-update <team-name> <task-id> <status> [owner|-]`
- `shutdown <team-name> <recipient> [reason]`
- `approve-plan <team-name> <recipient> <request-id>`
- `reject-plan <team-name> <recipient> <request-id> <feedback>`

These commands now cover both:

- direct `team-core` storage workflows
- one-shot `team-runtime` execution through the local runtime adapter

# team-core

`team-core` is the storage and domain layer for `agent-team`.

It is intentionally narrower than the original `claude-code` implementation.
This directory should contain only reusable core pieces:

- team file storage
- mailbox storage
- task list storage
- path conventions
- shared types

It should not depend on:

- React
- AppState
- tmux or iTerm pane management
- product analytics or feature flags

## Source Mapping

The current scaffold is based on these upstream files:

- `sourcemap-extracted/src/utils/swarm/teamHelpers.ts`
- `sourcemap-extracted/src/utils/teammateMailbox.ts`
- `sourcemap-extracted/src/utils/tasks.ts`

## Notes

- This is a draft extraction target, not a complete runtime.
- File locking is still a follow-up item.
- Runtime execution belongs in `team-runtime`.

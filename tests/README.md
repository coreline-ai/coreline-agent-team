# tests

현재 테스트는 아래 영역을 포함한다.

- `team-core`
  - paths
  - team/mailbox/task/permission/session/transcript store
  - concurrent write / orphan cleanup / atomic write
- `team-runtime`
  - spawn / loop / recovery / permission round-trip
  - `Codex CLI` / upstream bridge parsing 및 failure fallback
  - resume / reopen / transcript-aware context restore
- `team-cli`
  - command parsing
  - rootDir override
  - permission/plan/sandbox command round-trip
  - local/codex/upstream spawn flow
- `team-operator`
  - dashboard aggregation
  - background process args / launch
- `team-tui`
  - watch/control boot
  - modal open flow

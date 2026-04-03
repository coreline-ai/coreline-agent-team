# team-core

`team-core` is the storage and domain layer for `agent-team`.

현재 구현 기준에서 `team-core`는 아래 책임을 가진 안정적인 파일 기반 코어 계층이다.

- team file storage
- mailbox storage
- task list storage
- permission / session / transcript storage
- path conventions
- shared types
- lock-safe + atomic write helpers

It should not depend on:

- React
- AppState
- pane backend management
- product analytics or feature flags

## Notes

- File locking과 atomic write는 현재 구현에 반영되어 있다.
- `team-core`는 runtime/UI를 몰라야 하며, 실행 책임은 `team-runtime`에 둔다.
- Runtime execution belongs in `team-runtime`.

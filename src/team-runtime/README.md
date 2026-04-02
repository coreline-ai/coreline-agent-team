# team-runtime

`team-runtime` sits above `team-core`.

Responsibilities:

- spawn teammates
- manage lifecycle
- poll mailbox work
- auto-claim tasks
- send idle and shutdown protocol messages
- request and await plan approval responses
- bridge to a real agent runtime
- render team coordination prompt fragments

Current scaffold coverage:

- `spawn-in-process.ts` registers teammates and lifecycle handles
- `in-process-runner.ts` resolves work priority and runs the one-shot/loop flow
- `runtime-adapter.ts` now provides:
  - noop/mock adapters
  - `createLocalRuntimeAdapter()`
  - `RuntimeTurnBridge`-based execution contracts
  - `join()` support for background loop lifecycle

# Reliability Checklist

## 개요

이 문서는 Phase 3 기준으로 `agent-team`이 어떤 운영성 항목을
자체 테스트로 검증했는지 정리한다.

기준 구현:

- `team-core` lock-safe storage
- `team-runtime` in-process runner
- `Codex CLI` subprocess bridge
- upstream `claude` CLI subprocess bridge
- `team-cli` headless command surface

## 검증 완료 항목

| 항목 | 상태 | 근거 |
|---|---|---|
| concurrent mailbox append safety | 완료 | `tests/team-core/mailbox-store.test.ts` |
| concurrent task creation safety | 완료 | `tests/team-core/task-store.test.ts` |
| orphan task cleanup | 완료 | `tests/team-core/task-cleanup.test.ts` |
| stale inactive member detection | 완료 | `tests/team-core/task-cleanup.test.ts` |
| file-collision / task decomposition guardrails | 완료 | `tests/team-core/task-guardrails.test.ts`, `tests/team-cli/commands.test.ts`, `tests/team-operator/dashboard.test.ts`, `tests/team-tui/app.test.tsx` |
| team-size / broadcast cost guardrails | 완료 | `tests/team-core/team-cost-guardrails.test.ts`, `tests/team-cli/commands.test.ts`, `tests/team-operator/actions.test.ts`, `tests/team-operator/dashboard.test.ts`, `tests/team-tui/app.test.tsx` |
| one-shot in-process spawn | 완료 | `tests/team-runtime/spawn-in-process.test.ts` |
| background join lifecycle | 완료 | `tests/team-runtime/runtime-adapter.test.ts` |
| long-running turn heartbeat refresh | 완료 | `tests/team-runtime/runtime-adapter.test.ts` |
| executing turn busy classification without owned task | 완료 | `tests/team-core/task-store.test.ts` |
| delayed task pickup after idle polling | 완료 | `tests/team-runtime/long-running-loop.test.ts` |
| repeated task claim / complete cycle | 완료 | `tests/team-runtime/long-running-loop.test.ts` |
| shutdown during active work recovery | 완료 | `tests/team-runtime/recovery.test.ts` |
| plan approval wait / abort behavior | 완료 | `tests/team-runtime/in-process-runner.test.ts`, `tests/team-runtime/recovery.test.ts` |
| permission request / response round-trip | 완료 | `tests/team-runtime/permission-roundtrip.test.ts` |
| persisted allow / deny permission auto-decision | 완료 | `tests/team-runtime/permission-roundtrip.test.ts`, `tests/team-cli/permission-commands.test.ts` |
| sandbox permission round-trip | 완료 | `tests/team-runtime/permission-roundtrip.test.ts` |
| teammate mode update propagation | 완료 | `tests/team-runtime/permission-roundtrip.test.ts`, `tests/team-cli/permission-commands.test.ts` |
| resume from stored runtime metadata | 완료 | `tests/team-runtime/resume.test.ts` |
| reopen from stored session id and transcript context | 완료 | `tests/team-core/session-store.test.ts`, `tests/team-runtime/resume.test.ts` |
| Codex CLI structured result parsing | 완료 | `tests/team-runtime/codex-cli-bridge.test.ts` |
| Codex CLI failure fallback | 완료 | `tests/team-runtime/codex-cli-failure.test.ts` |
| Codex CLI spawn flow | 완료 | `tests/team-cli/spawn-codex-cli.test.ts` |
| attach / status live runtime state display | 완료 | `tests/team-cli/attach-command.test.ts`, `tests/team-cli/resume-cleanup.test.ts` |
| TUI / project app live runtime state display | 완료 | `tests/team-tui/project-builder-app.test.tsx` |
| Codex CLI repeated soak harness | 완료 | `tests/team-cli/codex-repeated-soak.test.ts`, manual `npm run soak:codex` smoke (`2026-04-03`) |
| repeated soak structured failure taxonomy / verification summary | 완료 | `tests/team-cli/codex-repeated-soak.test.ts`, `docs/CODEX_REPEATED_SOAK.md` |
| upstream CLI structured result parsing | 완료 | `tests/team-runtime/upstream-cli-bridge.test.ts` |
| upstream CLI spawn flow | 완료 | `tests/team-cli/spawn-upstream.test.ts` |
| live Codex CLI one-shot backend smoke | 완료 | manual smoke, `2026-04-02` |
| live upstream `claude` CLI one-shot backend smoke | 완료 | manual smoke, `2026-04-02` |
| live Codex CLI long-turn visibility verification | 완료 | manual run, `2026-04-03 17:33:55 KST ~ 17:45:07 KST` |

## 현재 보장 범위

1. 로컬 파일 저장소 기반 팀 상태는 동시 append/update 상황에서도 lock-safe 하다.
2. worker는 idle 상태에서 polling 하다가 나중에 들어온 task를 집어갈 수 있다.
3. 종료 요청이 오면 open task를 다시 `pending`으로 되돌리고 멤버를 inactive 처리한다.
4. permission / sandbox approval은 mailbox round-trip으로 왕복 가능하다.
5. persisted permission rule은 `command/cwd/path/host` 기준으로 자동 allow/deny 판단을 내릴 수 있다.
6. `Codex CLI` subprocess가 성공하면 structured turn result를 반영하고, 실패하면 fallback 또는 failed idle result를 돌려준다.
7. upstream `claude` CLI subprocess도 same contract의 turn bridge로 붙일 수 있다.
8. inactive teammate는 저장된 session id, transcript context, runtime metadata로 다시 reopen 가능하다.
9. long-running real backend turn도 `heartbeat_age`, `turn_age`, `state=executing-turn`으로 live 여부를 구분할 수 있다.
10. `attach` / `status` / 앱 / TUI는 실행 중 / 정리 중 / stale 상태를 기존보다 더 명확히 보여준다.
11. open task는 scoped path 기준으로 file-collision 위험을 분석하고, multi-area / overlap / unscoped 경고를 surface에 표시할 수 있다.
12. recommended 3~5 범위를 넘는 team size, wide parallel fan-out, recent broad broadcast는 cost warning으로 surface에 표시할 수 있다.
13. repeated soak artifact는 step별 verification check와 structured failure pattern(`heartbeat_stale`, `reopen_count_mismatch`, `orphan_open_task`, `transcript_rollback` 등)을 함께 남긴다.

## 아직 남아 있는 운영 갭

| 항목 | 현재 상태 |
|---|---|
| direct upstream `runAgent()` import parity | 미구현 |
| original AppState/teamContext exact reopen parity | 부분 구현 |
| permission rule UI parity | 부분 구현 |
| tmux / iTerm pane backend parity | 미구현 |
| cross-process / remote transport | 미구현 |
| long-lived production burn-in beyond unit smoke tests | 미구현 |
| generated files / preview large-output UX polish | 후속 개선 |
| CLI-visible isolated state root override | 완료 |

## 권장 다음 단계

1. direct upstream `runAgent()` import가 꼭 필요한지 재평가한다.
2. [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) 기준으로 real `Codex CLI` / upstream `claude` CLI 백엔드 soak 결과를 계속 누적한다.
3. original leader UI queue parity가 필요한 경우에만 별도 경로로 붙인다.
4. remote transport나 pane backend가 필요할 때만 후속 확장을 연다.
5. generated files / preview가 긴 프로젝트에서 요약 UX를 다듬는다.

# Agent Team Development Progress

## 문서 목적

이 문서는 `PRD.md`, `TRD.md`, `module-boundary.md`, `extraction-targets.md`,
`project.md`를 기준으로 실제 구현을 병렬 가능한 가장 작은 테스트 단위까지
쪼개어 관리하는 개발 진행 문서다.

체크박스 규칙:

- `[ ]` 미완료
- `[x]` 구현 + 자체 테스트 확인 완료

## 병렬 작업 원칙

1. 파일 소유 범위가 겹치지 않도록 쪼갠다.
2. 공용 계약이 필요한 경우 foundation workstream이 먼저 간다.
3. 모든 구현 단위는 최소 1개 이상의 자체 테스트 또는 smoke test를 가진다.
4. 구현 완료 체크는 테스트 확인 후에만 한다.

## Workstream Overview

### WS-00 Foundation And Tooling

Objective:
프로젝트를 빌드/테스트 가능한 상태로 만들고 이후 workstream의 기반을 제공한다.

Owned paths:

- `package.json`
- `tsconfig.json`
- `tests/**`

Dependencies:

- 없음

Tasks:

- [x] DEV-0001 개발 진행 문서 작성
- [x] DEV-0002 Node/TS 빌드 설정 확정
- [x] DEV-0003 테스트 실행 스크립트 추가
- [x] DEV-0004 자체 테스트 베이스라인 구축

Done criteria:

- `npm run typecheck`
- `npm run test`

### WS-01 team-core Paths And Locking

Objective:
저장 경로 규칙과 락 추상화를 고정한다.

Owned paths:

- `src/team-core/file-utils.ts`
- `src/team-core/paths.ts`
- `src/team-core/lockfile.ts`

Non-owned paths:

- `src/team-core/team-store.ts`
- `src/team-core/mailbox-store.ts`
- `src/team-core/task-store.ts`

Dependencies:

- WS-00

Tasks:

- [x] DEV-0101 root/team/task/permission path 유틸 완성
- [x] DEV-0102 taskListId canonical 규칙 고정
- [x] DEV-0103 proper-lockfile 기반 lock abstraction 추가
- [x] DEV-0104 file helper 확장

Tests or checks:

- `tests/team-core/paths.test.ts`

### WS-02 team-core Team Store

Objective:
팀 파일 저장소와 멤버 lifecycle을 완성한다.

Owned paths:

- `src/team-core/team-store.ts`
- `src/team-core/types.ts`

Dependencies:

- WS-01

Tasks:

- [x] DEV-0201 create/read/write team file 보강
- [x] DEV-0202 upsert/list/remove team member 완성
- [x] DEV-0203 setMemberActive 추가
- [x] DEV-0204 setMemberMode 추가
- [x] DEV-0205 cleanupTeamDirectories 추가

Tests or checks:

- `tests/team-core/team-store.test.ts`

### WS-03 team-core Mailbox And Protocol

Objective:
메일박스 CRUD와 structured protocol 최소 세트를 완성한다.

Owned paths:

- `src/team-core/mailbox-store.ts`
- `src/team-core/mailbox-protocol.ts`
- `src/team-core/types.ts`

Dependencies:

- WS-01

Tasks:

- [x] DEV-0301 mailbox write/read를 lock-safe 하게 구현
- [x] DEV-0302 unread / mark-as-read / clear API 완성
- [x] DEV-0303 predicate 기반 mark-as-read 추가
- [x] DEV-0304 idle_notification protocol 구현
- [x] DEV-0305 shutdown protocol 구현
- [x] DEV-0306 plan approval protocol 구현
- [x] DEV-0307 structured message parse helper 구현

Tests or checks:

- `tests/team-core/mailbox-store.test.ts`

### WS-04 team-core Task Store

Objective:
task list CRUD, claim semantics, 상태 계산을 완성한다.

Owned paths:

- `src/team-core/task-store.ts`
- `src/team-core/types.ts`

Dependencies:

- WS-01
- WS-02

Tasks:

- [x] DEV-0401 task create/list/get/update/delete lock-safe 구현
- [x] DEV-0402 high water mark 유지 구현
- [x] DEV-0403 blockTask 구현
- [x] DEV-0404 claimTask 구현
- [x] DEV-0405 busy/blocker rule 구현
- [x] DEV-0406 unassignTeammateTasks 구현
- [x] DEV-0407 getAgentStatuses 구현

Tests or checks:

- `tests/team-core/task-store.test.ts`

### WS-05 team-runtime Foundations

Objective:
runtime context와 in-process spawn 계약을 완성한다.

Owned paths:

- `src/team-runtime/context.ts`
- `src/team-runtime/types.ts`
- `src/team-runtime/runtime-adapter.ts`
- `src/team-runtime/spawn-in-process.ts`

Dependencies:

- WS-02
- WS-03
- WS-04

Tasks:

- [x] DEV-0501 runtime context 계약 고정
- [x] DEV-0502 spawn lifecycle 보강
- [x] DEV-0503 stop handle 정리
- [x] DEV-0504 mock/noop adapter 정리

Tests or checks:

- `tests/team-runtime/spawn-in-process.test.ts`

### WS-06 team-runtime In-Process Runner

Objective:
mailbox poll + task auto-claim + idle/shutdown/plan approval loop를 구현한다.

Owned paths:

- `src/team-runtime/in-process-runner.ts`
- `src/team-runtime/prompt/team-context.ts`

Dependencies:

- WS-03
- WS-04
- WS-05

Tasks:

- [x] DEV-0601 wait loop 구현
- [x] DEV-0602 shutdown 우선순위 처리 구현
- [x] DEV-0603 leader message 우선 처리 구현
- [x] DEV-0604 task auto-claim fallback 구현
- [x] DEV-0605 idle notification 전송 구현
- [x] DEV-0606 plan approval round-trip 구현

Tests or checks:

- `tests/team-runtime/in-process-runner.test.ts`

### WS-07 team-cli Commands

Objective:
headless 사용을 위한 최소 CLI를 완성한다.

Owned paths:

- `src/team-cli/**`

Dependencies:

- WS-02
- WS-03
- WS-04
- WS-05

Tasks:

- [x] DEV-0701 init command 완료
- [x] DEV-0702 send command 완료
- [x] DEV-0703 tasks command 완료
- [x] DEV-0704 spawn command 추가
- [x] DEV-0705 task create/update command 추가
- [x] DEV-0706 shutdown / plan approval command 추가
- [x] DEV-0707 status command 추가

Tests or checks:

- `tests/team-cli/commands.test.ts`

### WS-08 Real Runtime Adapter

Objective:
placeholder adapter 대신 실제 agent runtime bridge를 붙일 준비를 한다.

Owned paths:

- `src/team-runtime/runtime-adapter.ts`
- `src/team-runtime/in-process-runner.ts`

Dependencies:

- WS-05
- WS-06

Tasks:

- [x] DEV-0801 adapter contract 안정화
- [x] DEV-0802 mock adapter 테스트 보강
- [x] DEV-0803 real runtime bridge 설계
- [x] DEV-0804 upstream runAgent 연동 또는 동등 adapter 구현

Tests or checks:

- adapter smoke tests

## Phase 2 Expansion Workstreams

Phase 2 기본 가정:

- 첫 번째 real model/runtime backend는 `Codex CLI`다.
- 구현 방식은 SDK direct call이 아니라 `RuntimeTurnBridge` 위의 command bridge를 우선한다.
- 이후 필요 시 upstream `runAgent()` bridge나 다른 host bridge를 추가한다.

### WS-09 Codex CLI Runtime Bridge

Objective:
`Codex CLI`를 실제 turn executor로 연결하는 command bridge를 구현한다.

Owned paths:

- `src/team-runtime/runtime-adapter.ts`
- `src/team-runtime/codex-cli-bridge.ts`
- `src/team-runtime/types.ts`
- `src/team-cli/commands/spawn.ts`

Dependencies:

- WS-08

Tasks:

- [x] DEV-0901 Codex CLI bridge contract 정의
- [x] DEV-0902 Codex CLI process spawn wrapper 구현
- [x] DEV-0903 `RuntimeTurnInput -> Codex CLI prompt` 매핑 구현
- [x] DEV-0904 Codex CLI stdout/stderr/result parsing 구현
- [x] DEV-0905 `RuntimeTurnResult` 변환 규칙 구현
- [x] DEV-0906 local adapter에서 Codex CLI bridge 선택 옵션 추가
- [x] DEV-0907 spawn command에 Codex CLI runtime 옵션 추가

Tests or checks:

- `tests/team-runtime/codex-cli-bridge.test.ts`
- `tests/team-cli/spawn-codex-cli.test.ts`

### WS-10 Resume And Cleanup Extensions

Objective:
장시간 실행 worker를 위한 resume, cleanup, stale state recovery를 보강한다.

Owned paths:

- `src/team-runtime/spawn-in-process.ts`
- `src/team-runtime/in-process-runner.ts`
- `src/team-core/team-store.ts`
- `src/team-core/task-store.ts`
- `src/team-cli/commands/status.ts`
- `src/team-cli/commands/resume.ts`
- `src/team-cli/commands/cleanup.ts`

Dependencies:

- WS-08

Tasks:

- [x] DEV-1001 stale inactive member 감지 규칙 정의
- [x] DEV-1002 orphan open task cleanup API 추가
- [x] DEV-1003 runtime handle metadata 저장 규칙 추가
- [x] DEV-1004 teammate resume discovery 구현
- [x] DEV-1005 `resume` CLI command 추가
- [x] DEV-1006 `cleanup` CLI command 추가
- [x] DEV-1007 shutdown 이후 cleanup smoke flow 구현

Tests or checks:

- `tests/team-runtime/resume.test.ts`
- `tests/team-core/task-cleanup.test.ts`
- `tests/team-cli/resume-cleanup.test.ts`

### WS-11 Permission Protocol Expansion

Objective:
Phase 1 이후 후순위였던 permission/mode 계열 protocol을 추가한다.

Owned paths:

- `src/team-core/mailbox-protocol.ts`
- `src/team-core/mailbox-store.ts`
- `src/team-core/types.ts`
- `src/team-runtime/in-process-runner.ts`
- `src/team-cli/commands/**`

Dependencies:

- WS-08

Tasks:

- [x] DEV-1101 `permission_request` / `permission_response` message type 추가
- [x] DEV-1102 `sandbox_permission_request` / `sandbox_permission_response` 추가
- [x] DEV-1103 `mode_set_request` / `team_permission_update` 추가
- [x] DEV-1104 runner permission wait state 구현
- [x] DEV-1105 leader approval CLI command 추가
- [x] DEV-1106 teammate mode update command 추가

Tests or checks:

- `tests/team-core/permission-protocol.test.ts`
- `tests/team-runtime/permission-roundtrip.test.ts`
- `tests/team-cli/permission-commands.test.ts`

### WS-12 Long-Running Reliability And Recovery QA

Objective:
장시간 worker loop, reconnect 성격 흐름, 반복 task claim 안정성을 검증한다.

Owned paths:

- `tests/team-runtime/**`
- `tests/team-cli/**`
- `src/team-runtime/in-process-runner.ts`

Dependencies:

- WS-09
- WS-10
- WS-11

Tasks:

- [x] DEV-1201 long-running polling loop smoke test 추가
- [x] DEV-1202 repeated task claim/complete cycle test 추가
- [x] DEV-1203 shutdown during active work recovery test 추가
- [x] DEV-1204 plan approval timeout/abort test 추가
- [x] DEV-1205 Codex CLI bridge failure fallback test 추가
- [x] DEV-1206 reliability checklist 문서화

Tests or checks:

- `tests/team-runtime/long-running-loop.test.ts`
- `tests/team-runtime/recovery.test.ts`
- `tests/team-runtime/codex-cli-failure.test.ts`
- `docs/RELIABILITY_CHECKLIST.md`

## Phase 3 Parity Extension Workstreams

### WS-13 Permission Persistence And Audit

Objective:
원본 `permissionSync` 대비 부족했던 pending/resolved persistence와
team-scoped permission update 반영을 보강한다.

Owned paths:

- `src/team-core/permission-store.ts`
- `src/team-core/team-store.ts`
- `src/team-runtime/in-process-runner.ts`
- `src/team-cli/commands/approve-permission.ts`
- `src/team-cli/commands/permissions.ts`
- `src/team-cli/run-cli.ts`

Dependencies:

- WS-11
- WS-12

Tasks:

- [x] DEV-1301 pending / resolved permission request file store 추가
- [x] DEV-1302 team permission update merge / persistence 추가
- [x] DEV-1303 persisted rule 기반 permission auto-decision 추가
- [x] DEV-1304 `approve-permission --persist [--rule ...]` 추가
- [x] DEV-1305 `permissions <team> [pending|resolved|rules]` CLI 추가
- [x] DEV-1306 permission persistence 테스트 및 문서 반영

Tests or checks:

- `tests/team-core/permission-store.test.ts`
- `tests/team-runtime/permission-roundtrip.test.ts`
- `tests/team-cli/permission-commands.test.ts`

### WS-14 Transcript And Session Context

Objective:
teammate transcript를 저장하고, 다음 spawn/resume 시 직전 session 문맥을
prompt에 다시 주입해서 session resume parity를 보강한다.

Owned paths:

- `src/team-core/transcript-store.ts`
- `src/team-core/paths.ts`
- `src/team-runtime/runtime-adapter.ts`
- `src/team-runtime/spawn-in-process.ts`
- `src/team-runtime/in-process-runner.ts`
- `src/team-cli/commands/transcript.ts`
- `src/team-cli/run-cli.ts`

Dependencies:

- WS-10
- WS-12

Tasks:

- [x] DEV-1401 transcript file store 추가
- [x] DEV-1402 runtime session id 저장 및 lifecycle 연결
- [x] DEV-1403 recent transcript context를 work prompt에 주입
- [x] DEV-1404 outbound assistant messages transcript append
- [x] DEV-1405 `transcript <team> <agent> [--limit n]` CLI 추가
- [x] DEV-1406 transcript / resume context 테스트 및 문서 반영

Tests or checks:

- `tests/team-core/transcript-store.test.ts`
- `tests/team-runtime/runtime-adapter.test.ts`
- `tests/team-cli/transcript.test.ts`

### WS-15 Execution-Ready Completion

Objective:
실행 가능한 형태 완성을 우선해서 session reopen parity, richer permission
rule semantics, upstream CLI bridge를 한 번에 닫는다.

Owned paths:

- `src/team-core/session-store.ts`
- `src/team-core/permission-store.ts`
- `src/team-core/types.ts`
- `src/team-runtime/upstream-cli-bridge.ts`
- `src/team-runtime/runtime-adapter.ts`
- `src/team-runtime/spawn-in-process.ts`
- `src/team-cli/commands/approve-permission.ts`
- `src/team-cli/commands/deny-permission.ts`
- `src/team-cli/commands/reopen.ts`
- `src/team-cli/commands/spawn.ts`
- `src/team-cli/run-cli.ts`

Dependencies:

- WS-09
- WS-13
- WS-14

Tasks:

- [x] DEV-1501 session store 추가
- [x] DEV-1502 same session id reopen lifecycle 연결
- [x] DEV-1503 `reopen` command 추가
- [x] DEV-1504 structured permission rule matching 추가
- [x] DEV-1505 persisted deny rule 및 richer CLI match flags 추가
- [x] DEV-1506 upstream `claude` CLI subprocess bridge 추가
- [x] DEV-1507 upstream runtime spawn/reopen 테스트 및 문서 반영

Tests or checks:

- `tests/team-core/session-store.test.ts`
- `tests/team-core/permission-store.test.ts`
- `tests/team-runtime/permission-roundtrip.test.ts`
- `tests/team-runtime/upstream-cli-bridge.test.ts`
- `tests/team-runtime/resume.test.ts`
- `tests/team-cli/permission-commands.test.ts`
- `tests/team-cli/spawn-upstream.test.ts`

## Merge Sequence

1. WS-00
2. WS-01
3. WS-02, WS-03, WS-04 병렬 가능
4. WS-05
5. WS-06
6. WS-07
7. WS-08
8. WS-09
9. WS-10, WS-11 병렬 가능
10. WS-12
11. WS-13
12. WS-14
13. WS-15

## Integration Checkpoints

- [x] ICP-01 `team-core` 전체 unit test 통과
- [x] ICP-02 `team-cli` smoke test 통과
- [x] ICP-03 `team-runtime` spawn smoke test 통과
- [x] ICP-04 shutdown / plan approval round-trip 검증

## Current Execution Focus

현재 완료 범위:

- WS-00
- WS-01
- WS-02
- WS-03
- WS-04
- WS-05
- WS-06
- WS-07
- WS-08
- WS-09
- WS-10
- WS-11
- WS-12
- WS-13
- WS-14
- WS-15

다음 집중 범위:

- direct upstream `runAgent()` import parity가 정말 필요한지 재평가
- original AppState / leader UI parity가 필요한지 확인
- real backend soak test 확대

## Latest Verification

- [x] `npm run typecheck`
- [x] `npm run test`
- [x] `command -v codex && codex --version`
- [x] 총 58개 테스트 통과

검증 범위:

- `tests/team-core/paths.test.ts`
- `tests/team-core/team-store.test.ts`
- `tests/team-core/mailbox-store.test.ts`
- `tests/team-core/task-store.test.ts`
- `tests/team-core/permission-protocol.test.ts`
- `tests/team-core/permission-store.test.ts`
- `tests/team-core/session-store.test.ts`
- `tests/team-core/task-cleanup.test.ts`
- `tests/team-core/transcript-store.test.ts`
- `tests/team-runtime/in-process-runner.test.ts`
- `tests/team-runtime/runtime-adapter.test.ts`
- `tests/team-runtime/spawn-in-process.test.ts`
- `tests/team-runtime/codex-cli-bridge.test.ts`
- `tests/team-runtime/codex-cli-failure.test.ts`
- `tests/team-runtime/long-running-loop.test.ts`
- `tests/team-runtime/permission-roundtrip.test.ts`
- `tests/team-runtime/recovery.test.ts`
- `tests/team-runtime/resume.test.ts`
- `tests/team-runtime/upstream-cli-bridge.test.ts`
- `tests/team-cli/commands.test.ts`
- `tests/team-cli/permission-commands.test.ts`
- `tests/team-cli/resume-cleanup.test.ts`
- `tests/team-cli/spawn-codex-cli.test.ts`
- `tests/team-cli/spawn-upstream.test.ts`
- `tests/team-cli/transcript.test.ts`

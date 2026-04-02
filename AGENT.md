# AGENT Handoff

## 개요

이 문서는 `agent-team` 프로젝트를 다른 환경이나 다른 작업 세션에서 바로
이어갈 수 있도록 현재 상태를 상세히 정리한 인수인계 문서입니다.

마지막 업데이트 기준:

- 날짜: `2026-04-02`
- 프로젝트 루트: `/Users/hwanchoi/projects/claude-code/agent-team`
- 현재 판정: `목적 달성`, `운영 가능한 수준`, `추가 개선 여지 있음`

프로젝트의 원래 목적은 `claude-code/package` 내부에 결합되어 있던 teammate /
swarm 기능을 분리해서, 독립 실행 가능한 headless 팀 런타임으로 만드는 것이었습니다.

현재는 그 목적이 다음 수준까지 달성되어 있습니다.

- `team-core`, `team-runtime`, `team-cli` 분리 완료
- `Codex CLI`, upstream `claude` CLI backend bridge 구현 완료
- transcript, permission, mailbox, session, cleanup 흐름 구현 완료
- `team-operator` 계층 추가 완료
- Ink 기반 `watch`, `tui` 운영 UI 추가 완료
- TUI에서 띄운 teammate를 detached background process로 분리 완료

## 현재 상태 한눈에 보기

| 항목 | 상태 | 비고 |
|---|---|---|
| headless runtime | 완료 | CLI로 팀 생성, spawn, task, approval, transcript 운영 가능 |
| live backend 연결 | 완료 | `codex-cli`, upstream `claude` 실백엔드 smoke 통과 |
| TUI | 완료 | `watch`, `tui` 둘 다 제공 |
| background teammate | 완료 | TUI spawn/resume/reopen은 detached child process |
| 테스트 | 안정 | `npm run typecheck`, `npm test` 통과 |
| 현재 테스트 수 | `71개 통과` | `0 fail` |

## 프로젝트 구조

```text
agent-team/
  AGENT.md
  README.md
  docs/
  src/
    team-core/
    team-runtime/
    team-cli/
    team-operator/
    team-tui/
  tests/
  dist/
```

핵심 모듈:

| 모듈 | 역할 | 주요 파일 |
|---|---|---|
| `team-core` | 파일 저장소, task/mailbox/permission/session/transcript 규칙 | `src/team-core/index.ts` |
| `team-runtime` | teammate lifecycle, loop, runtime bridge | `src/team-runtime/runtime-adapter.ts` |
| `team-cli` | 사용자/스크립트용 명령 표면 | `src/team-cli/run-cli.ts` |
| `team-operator` | UI-neutral orchestration 계층 | `src/team-operator/dashboard.ts`, `src/team-operator/actions.ts` |
| `team-tui` | Ink 기반 운영 UI | `src/team-tui/app.tsx` |

## 구현 완료 범위

### 1. team-core

구현 완료:

- team file 저장/조회
- teammate registry
- mailbox read/write/mark-read
- structured mailbox protocol
- task 생성/claim/block/unassign/status
- permission request 저장과 resolved 상태 추적
- persisted permission rule
- transcript 저장과 recent context block 생성
- session open/close/reopen 상태 저장
- cleanup / stale member / orphan task 정리
- lock-safe file write

핵심 파일:

- `/Users/hwanchoi/projects/claude-code/agent-team/src/team-core/team-store.ts`
- `/Users/hwanchoi/projects/claude-code/agent-team/src/team-core/mailbox-store.ts`
- `/Users/hwanchoi/projects/claude-code/agent-team/src/team-core/task-store.ts`
- `/Users/hwanchoi/projects/claude-code/agent-team/src/team-core/permission-store.ts`
- `/Users/hwanchoi/projects/claude-code/agent-team/src/team-core/transcript-store.ts`
- `/Users/hwanchoi/projects/claude-code/agent-team/src/team-core/session-store.ts`
- `/Users/hwanchoi/projects/claude-code/agent-team/src/team-core/file-utils.ts`

중요 구현 메모:

- `readJsonFile()`는 드물게 생기던 partial write/read race 완화를 위해 짧은 retry를 가집니다.
- 전역 저장 루트는 `TeamCoreOptions.rootDir`로 override 가능하며, CLI에서는 `--root-dir`로 노출했습니다.

### 2. team-runtime

구현 완료:

- in-process teammate spawn
- mailbox poll -> work selection -> task claim -> idle/shutdown loop
- local runtime bridge
- `Codex CLI` runtime bridge
- upstream `claude` CLI runtime bridge
- permission / sandbox / plan approval round-trip
- session reopen
- transcript 기반 context restore

핵심 파일:

- `/Users/hwanchoi/projects/claude-code/agent-team/src/team-runtime/in-process-runner.ts`
- `/Users/hwanchoi/projects/claude-code/agent-team/src/team-runtime/runtime-adapter.ts`
- `/Users/hwanchoi/projects/claude-code/agent-team/src/team-runtime/spawn-in-process.ts`
- `/Users/hwanchoi/projects/claude-code/agent-team/src/team-runtime/codex-cli-bridge.ts`
- `/Users/hwanchoi/projects/claude-code/agent-team/src/team-runtime/upstream-cli-bridge.ts`

중요 구현 메모:

- `direct upstream runAgent()` import parity는 하지 않았습니다.
- 대신 subprocess 기반 upstream CLI bridge로 운영 가능한 수준을 만들었습니다.
- 현재 목표에는 이 경로로 충분하며, exact parity는 후순위입니다.

### 3. team-cli

구현 완료 명령:

- `init`
- `watch`
- `tui`
- `spawn`
- `resume`
- `reopen`
- `cleanup`
- `permissions`
- `transcript`
- `tasks`
- `send`
- `status`
- `task-create`
- `task-update`
- `shutdown`
- `approve-permission`
- `deny-permission`
- `approve-sandbox`
- `deny-sandbox`
- `approve-plan`
- `reject-plan`
- `set-mode`

핵심 파일:

- `/Users/hwanchoi/projects/claude-code/agent-team/src/team-cli/run-cli.ts`
- `/Users/hwanchoi/projects/claude-code/agent-team/src/team-cli/bin.ts`

중요 구현 메모:

- `--root-dir`는 global option으로 모든 명령에서 지원합니다.
- CLI 표면은 사람이 직접 써도 되고, TUI/operator가 내부적으로 재사용해도 됩니다.

### 4. team-operator

구현 완료:

- 팀 목록/대시보드 집계
- task, status, activity, approvals, transcript preview 통합 조회
- TUI에서 필요한 액션 래퍼 제공
- detached background process spawn helper 추가

핵심 파일:

- `/Users/hwanchoi/projects/claude-code/agent-team/src/team-operator/dashboard.ts`
- `/Users/hwanchoi/projects/claude-code/agent-team/src/team-operator/actions.ts`
- `/Users/hwanchoi/projects/claude-code/agent-team/src/team-operator/background-process.ts`

중요 구현 메모:

- `spawnTeammate`, `resumeTeammate`, `reopenTeammate`는 더 이상 TUI 프로세스 안에서 in-process handle을 붙들지 않습니다.
- 대신 `node <dist bin> spawn/resume/reopen ...` 형태로 detached child process를 띄웁니다.
- 이 설계 덕분에 TUI 종료 후에도 worker가 계속 돌 수 있습니다.

### 5. team-tui

구현 완료:

- team picker / create
- main dashboard
- tasks pane
- teammates pane
- activity feed
- transcript drawer
- spawn modal
- task create modal
- send message modal
- approval modal
- help overlay
- read-only `watch`
- interactive `tui`

핵심 파일:

- `/Users/hwanchoi/projects/claude-code/agent-team/src/team-tui/app.tsx`
- `/Users/hwanchoi/projects/claude-code/agent-team/src/team-tui/commands/tui.tsx`
- `/Users/hwanchoi/projects/claude-code/agent-team/src/team-tui/commands/watch.tsx`

핵심 단축키:

- `Tab`, 방향키: pane / selection 이동
- `s`: spawn modal
- `t`: task create
- `m`: message modal
- `a`: approval inbox
- `u`: resume
- `x`: shutdown request
- `r`: refresh
- `?`: help
- `q`: quit

## 문서 상태

현재 문서:

| 문서 | 역할 |
|---|---|
| [README.md](/Users/hwanchoi/projects/claude-code/agent-team/README.md) | 사용자용 사용법 |
| [project.md](/Users/hwanchoi/projects/claude-code/agent-team/docs/project.md) | 프로젝트 목적 |
| [PRD.md](/Users/hwanchoi/projects/claude-code/agent-team/docs/PRD.md) | 제품 요구사항 |
| [TRD.md](/Users/hwanchoi/projects/claude-code/agent-team/docs/TRD.md) | 기술 설계 |
| [DEVELOPMENT_PROGRESS.md](/Users/hwanchoi/projects/claude-code/agent-team/docs/DEVELOPMENT_PROGRESS.md) | 구현 진행 기록 |
| [ORIGINAL_PARITY_REVIEW.md](/Users/hwanchoi/projects/claude-code/agent-team/docs/ORIGINAL_PARITY_REVIEW.md) | 원본 claude-code와의 비교 |
| [RELIABILITY_CHECKLIST.md](/Users/hwanchoi/projects/claude-code/agent-team/docs/RELIABILITY_CHECKLIST.md) | 운영 안정성 체크 |
| [GOAL_CLOSURE_PLAN.md](/Users/hwanchoi/projects/claude-code/agent-team/docs/GOAL_CLOSURE_PLAN.md) | 목적 달성 후 남은 일 정리 |
| [TUI_SMOKE.md](/Users/hwanchoi/projects/claude-code/agent-team/docs/TUI_SMOKE.md) | TUI 실사용 smoke 시나리오 |

문서 읽는 추천 순서:

1. `README.md`
2. `AGENT.md`
3. `docs/project.md`
4. `docs/PRD.md`
5. `docs/TRD.md`
6. `docs/ORIGINAL_PARITY_REVIEW.md`

## 실사용 방법

빌드:

```bash
cd /Users/hwanchoi/projects/claude-code/agent-team
npm install
npm run build
```

팀 생성과 기본 확인:

```bash
node dist/src/team-cli/bin.js --root-dir /tmp/agent-team-demo init alpha-team
node dist/src/team-cli/bin.js --root-dir /tmp/agent-team-demo task-create alpha-team "Investigate parser" "Review the parsing failure"
node dist/src/team-cli/bin.js --root-dir /tmp/agent-team-demo watch alpha-team
```

TUI 진입:

```bash
node dist/src/team-cli/bin.js --root-dir /tmp/agent-team-demo tui alpha-team
```

실백엔드 spawn 예시:

```bash
node dist/src/team-cli/bin.js --root-dir /tmp/agent-team-demo spawn alpha-team researcher \
  --prompt "Help with the current task list" \
  --runtime codex-cli \
  --model gpt-5.4-mini \
  --max-iterations 50
```

## 운영 / 검증 상태

현재 확인된 것:

- `Codex CLI` live backend smoke 통과
- upstream `claude` live backend smoke 통과
- `Codex CLI` 2개를 붙인 병렬 teammate 소통 live 시뮬레이션 통과
- TUI boot smoke 통과
- `watch` / `tui` 명령 rootDir 상태로 렌더 가능
- detached background spawn 테스트 통과

현재 최종 로컬 검증 결과:

- `npm run typecheck` 통과
- `npm test` 통과
- 총 `71 tests pass`

## 중요 설계 결정

| 항목 | 현재 결정 |
|---|---|
| 실행 목표 | 원본 UI 복제가 아니라 `독립 실행 가능한 headless + TUI 운영 도구` |
| upstream parity | `runAgent` 직접 import 대신 subprocess bridge 사용 |
| 상태 저장 | 파일 기반 저장소 유지 |
| 상태 격리 | `--root-dir` 사용 |
| TUI refresh | watcher 대신 polling |
| TUI teammate 실행 | in-process가 아니라 detached background process |

## 현재 알려진 제한 / 주의점

1. `runAgent()` direct import parity는 아직 하지 않았습니다.  
이건 현재 목적상 필수는 아니며, live backend bridge가 실사용을 대신합니다.

2. TUI background worker는 detached 실행이지만, 현재 별도 로그 뷰어는 없습니다.  
즉 상태는 CLI/TUI에서 보이지만, stdout/stderr 로그 tail 기능은 아직 없습니다.

3. background worker의 PID는 spawn 성공 메시지에는 나오지만, 전용 PID 추적 UI는 없습니다.

4. TUI는 지금 충분히 실사용 가능하지만, 더 긴 시간의 soak test나 multi-team overview는 아직 확장 여지가 있습니다.

5. 이 프로젝트 디렉토리는 현재 독립 git repo가 아닐 수 있습니다.  
환경에 따라 `/Users/hwanchoi/projects/claude-code/agent-team`는 상위 워크스페이스의 일부로 존재합니다.

## 다음 작업 추천

우선순위 높은 후보:

1. background worker log / PID visibility 추가
2. TUI에 worker health badge 추가
3. longer soak / restart validation 문서화
4. approval UX polish
5. multi-team picker 개선

현재 목적 기준으로는 이미 성공 상태이므로, 다음 작업은 대부분 운영성/관측성/UX 고도화 성격입니다.

## 테스트 / 디버그 명령

전체 검증:

```bash
cd /Users/hwanchoi/projects/claude-code/agent-team
npm run typecheck
npm test
```

TUI 관련만 빠르게 보고 싶을 때:

```bash
node --test dist/tests/team-tui/*.test.js
node --test dist/tests/team-operator/*.test.js
```

runtime recovery만 보고 싶을 때:

```bash
node --test dist/tests/team-runtime/recovery.test.js
```

## 이어서 작업할 때 먼저 확인할 파일

| 목적 | 먼저 볼 파일 |
|---|---|
| 전체 사용법 | `/Users/hwanchoi/projects/claude-code/agent-team/README.md` |
| 전체 인수인계 | `/Users/hwanchoi/projects/claude-code/agent-team/AGENT.md` |
| CLI 명령 수정 | `/Users/hwanchoi/projects/claude-code/agent-team/src/team-cli/run-cli.ts` |
| runtime 동작 수정 | `/Users/hwanchoi/projects/claude-code/agent-team/src/team-runtime/in-process-runner.ts` |
| backend bridge 수정 | `/Users/hwanchoi/projects/claude-code/agent-team/src/team-runtime/codex-cli-bridge.ts`, `/Users/hwanchoi/projects/claude-code/agent-team/src/team-runtime/upstream-cli-bridge.ts` |
| TUI 수정 | `/Users/hwanchoi/projects/claude-code/agent-team/src/team-tui/app.tsx` |
| background spawn 수정 | `/Users/hwanchoi/projects/claude-code/agent-team/src/team-operator/background-process.ts` |
| 운영 smoke 재현 | `/Users/hwanchoi/projects/claude-code/agent-team/docs/TUI_SMOKE.md` |

## 한 줄 결론

`agent-team`은 현재 `독립 실행 가능한 팀 에이전트 런타임 + CLI + Ink TUI + detached background worker`까지 갖춘 상태이며, 다른 환경에서 이어받아도 바로 운영/개선 작업을 시작할 수 있습니다.

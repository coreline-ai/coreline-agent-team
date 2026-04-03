# AGENT Handoff

## 개요

이 문서는 `agent-team` 프로젝트를 다른 환경이나 다른 작업 세션에서 바로
이어갈 수 있도록 현재 상태를 상세히 정리한 인수인계 문서입니다.

마지막 업데이트 기준:

- 날짜: `2026-04-03`
- 프로젝트 루트: `/Users/hwanchoi/projects/claude-code/agent-team`
- 현재 판정: `목적 달성`, `운영 검증 완료`, `추가 개선은 선택적`

이 문서에서 쓰는 `<repo-root>`는 위 경로의 별칭입니다.

추가로 현재 저장소 상태는 아래와 같습니다.

- 독립 git 저장소로 초기화되어 있음
- 기본 브랜치: `main`
- 현재 로컬 상태: `origin/main`과 sync 상태

프로젝트의 원래 목적은 `claude-code/package` 내부에 결합되어 있던 teammate /
swarm 기능을 분리해서, 독립 실행 가능한 headless 팀 런타임으로 만드는 것이었습니다.

여기서 빠지면 안 되는 중요한 전제는 다음과 같습니다.

- **LLM 사용의 표준 경로는 `Codex CLI` runtime입니다.**
- direct OpenAI API 또는 기타 vendor API 연동은 **이번 프로젝트의 고려 대상이 아니며 금지**합니다.
- 즉, 이 프로젝트는 **CLI 기반 agent runtime 사용**을 전제로 합니다.

현재는 그 목적이 다음 수준까지 달성되어 있습니다.

- `bun atcli.js` / `atcli` / `agent-team app` 기반 대화형 프로젝트 빌더 진입점 추가
- `run "<goal>"` 기반 비대화형 bootstrap 경로 유지
- `doctor` 기반 실사용 환경 진단 명령 추가
- `attach` 기반 재진입/결과 요약 UX 추가
- `attach` / `status` / TUI / 앱에서 worker 가시성(`worker`, `launch`, `lifecycle`, `pid`)과 long-turn runtime state(`executing-turn`, `settling`, `stale`) 추가
- `team-core`, `team-runtime`, `team-cli` 분리 완료
- `Codex CLI`, upstream `claude` CLI backend bridge 구현 완료
- transcript, permission, mailbox, session, cleanup 흐름 구현 완료
- `team-operator` 계층 추가 완료
- Ink 기반 `watch`, `tui` 운영 UI 추가 완료
- TUI에서 띄운 teammate를 detached background process로 분리 완료
- `dev-plan/implement_20260403_185856.md` 기준 Phase 1~3 완료
  - background worker visibility
  - generated preview UX polish
  - soak / restart verification hardening

## 현재 상태 한눈에 보기

| 항목 | 상태 | 비고 |
|---|---|---|
| 대화형 프로젝트 빌더 | 완료 | `bun atcli.js`, `atcli`, `agent-team app`으로 자연어 입력 대기 TUI 진입 가능 |
| 사용자 환경 진단 | 완료 | `agent-team doctor --workspace <path> --probe` 지원 |
| 재진입 / 결과 확인 | 완료 | `agent-team attach <team>` 으로 현재 상태/생성 파일/최근 activity 요약 |
| background worker visibility | 완료 | `attach` / `status` / TUI / 앱에서 `worker`, `launch`, `lifecycle`, `pid` 표시 |
| worker log visibility | 완료 | detached worker의 `stdout_log`, `stderr_log`, `stderr_tail` 표시 |
| long-turn 상태 가시성 | 완료 | `attach` / `status` / `watch` / 앱에서 `executing-turn`, `settling`, `stale`, `heartbeat_age`, `turn_age` 표시 |
| generated preview UX | 완료 | `attach` / project builder 에서 prioritized file summary, `preview_headline`, `preview_excerpt` 표시 |
| 사용자 quickstart 문서 | 완료 | `docs/USER_QUICKSTART.md`, `docs/TROUBLESHOOTING.md` 추가 |
| goal 기반 bootstrap | 완료 | `agent-team run "<goal>"`으로 software-factory 팀 자동 부팅 가능 |
| headless runtime | 완료 | CLI로 팀 생성, spawn, task, approval, transcript 운영 가능 |
| live backend 연결 | 완료 | `codex-cli`, upstream `claude` 실백엔드 smoke 통과 |
| repeated Codex soak | 실검증 완료 | `npm run soak:codex` + real `Codex CLI` 기준 `1/3/5 iteration` 통과, 단계별 `attach` snapshot과 `latest-summary.json` 기록 |
| TUI | 완료 | `watch`, `tui` 둘 다 제공 |
| background teammate | 완료 | TUI spawn/resume/reopen은 detached child process |
| 테스트 | 안정 | 최신 로컬 검증에서 `npm run typecheck`, `npm test` 통과 |
| 기본 workspace 정책 | 완료 | `--workspace` 미지정 시 `<root-dir>/workspaces/<team>` 사용 |
| 현재 테스트 수 | `139개 통과` | `2026-04-03` 기준 `0 fail` |

## 프로젝트 구조

```text
agent-team/
  AGENT.md
  README.md
  docs/
  dev-plan/
  scripts/
  src/
    atcli/
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
| `team-cli` | 사용자/스크립트용 명령 표면 | `src/team-cli/run-cli.ts`, `src/team-cli/arg-parsers.ts`, `src/team-cli/command-registry.ts` |
| `team-operator` | UI-neutral orchestration 계층 | `src/team-operator/dashboard.ts`, `src/team-operator/actions.ts` |
| `team-tui` | Ink 기반 운영 UI와 프로젝트 빌더 앱 | `src/team-tui/app.tsx`, `src/team-tui/project-builder-app.tsx` |
| `atcli` | `agent-team app`를 더 짧게 실행하는 얇은 진입점 | `src/atcli/bin.ts`, `src/atcli/forwarded-args.ts` |

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
- lock-safe + atomic file write

핵심 파일:

- `src/team-core/team-store.ts`
- `src/team-core/mailbox-store.ts`
- `src/team-core/task-store.ts`
- `src/team-core/permission-store.ts`
- `src/team-core/transcript-store.ts`
- `src/team-core/session-store.ts`
- `src/team-core/file-utils.ts`

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
- active turn metadata / 500ms heartbeat refresh / settle cleanup

핵심 파일:

- `src/team-runtime/in-process-runner.ts`
- `src/team-runtime/runtime-adapter.ts`
- `src/team-runtime/spawn-in-process.ts`
- `src/team-runtime/codex-cli-bridge.ts`
- `src/team-runtime/upstream-cli-bridge.ts`

중요 구현 메모:

- `direct upstream runAgent()` import parity는 하지 않았습니다.
- 대신 subprocess 기반 upstream CLI bridge로 운영 가능한 수준을 만들었습니다.
- 현재 목표에는 이 경로로 충분하며, exact parity는 후순위입니다.

### 3. team-cli

구현 완료 명령:

- `init`
- `doctor`
- `app`
- `attach`
- `run`
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

- `src/team-cli/run-cli.ts`
- `src/team-cli/arg-parsers.ts`
- `src/team-cli/command-registry.ts`
- `src/team-cli/bin.ts`

중요 구현 메모:

- `--root-dir`는 global option으로 모든 명령에서 지원합니다.
- `--workspace`를 생략하면 기본 결과물 경로는 `<root-dir>/workspaces/<team-name>` 입니다.
- CLI 표면은 사람이 직접 써도 되고, TUI/operator가 내부적으로 재사용해도 됩니다.
- `doctor`는 Codex CLI 실행 파일/로그인/workspace 쓰기 가능 여부와 선택적 real exec probe를 점검합니다.
- `attach`는 이미 생성된 팀에 다시 붙어서 result state / teammate 상태 / worker lifecycle / task 집계 / 최근 activity / 생성 파일 summary / preview headline/excerpt를 한 번에 요약합니다.
- `app`은 Codex 스타일 자연어 입력 대기 TUI를 띄우고, 첫 goal 입력 후 내부적으로 `run` bootstrap을 호출하는 제품형 진입점입니다.
- `run "<goal>"`은 `planner/search/frontend/backend/reviewer` 팀을 자동 bootstrap하고 background launch까지 수행하는 비대화형 실사용자 경로입니다.
- `resume`은 저장된 runtime metadata로 **새 session**을 시작합니다.
- `reopen`은 저장된 session id를 재사용해서 **같은 session**을 다시 엽니다.

### 4. team-operator

구현 완료:

- 팀 목록/대시보드 집계
- task, status, activity, approvals, transcript preview 통합 조회
- TUI에서 필요한 액션 래퍼 제공
- detached background process spawn helper 추가

핵심 파일:

- `src/team-operator/dashboard.ts`
- `src/team-operator/actions.ts`
- `src/team-operator/background-process.ts`

중요 구현 메모:

- `spawnTeammate`, `resumeTeammate`, `reopenTeammate`는 더 이상 TUI 프로세스 안에서 in-process handle을 붙들지 않습니다.
- 대신 `node <dist bin> spawn/resume/reopen ...` 형태로 detached child process를 띄웁니다.
- 이 설계 덕분에 TUI 종료 후에도 worker가 계속 돌 수 있습니다.
- detached background worker 기본 loop 정책은 `maxIterations=50`, `pollIntervalMs=500`의 bounded lifecycle입니다.
- detached background launch는 `AGENT_TEAM_LAUNCH_MODE=detached` 환경 마커와 함께 실행되어 worker provenance를 구분합니다.

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
- goal-first 프로젝트 빌더 앱 (`app`, `atcli`)
- teammate pane / project builder 에서 worker `pid`, `launchMode`와 generated preview headline을 함께 표시

핵심 파일:

- `src/team-tui/app.tsx`
- `src/team-tui/project-builder-app.tsx`
- `src/team-tui/commands/tui.tsx`
- `src/team-tui/commands/watch.tsx`
- `src/team-tui/commands/app.tsx`

역할 차이:

- `src/team-tui/app.tsx`
  - 팀이 이미 있는 상태에서 task/status/activity/transcript를 운영하는 control TUI
- `src/team-tui/project-builder-app.tsx`
  - goal 입력부터 시작해서 `run` bootstrap과 `attach` 성격의 결과 확인을 묶은 project builder UI

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
| [README.md](README.md) | 사용자용 사용법 |
| [USER_QUICKSTART.md](docs/USER_QUICKSTART.md) | 초보 사용자용 빠른 시작 가이드 |
| [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | 설치/로그인/권한 문제 해결 가이드 |
| [project.md](docs/project.md) | 프로젝트 목적 |
| [PRD.md](docs/PRD.md) | 제품 요구사항 |
| [TRD.md](docs/TRD.md) | 기술 설계 |
| [DEVELOPMENT_PROGRESS.md](docs/DEVELOPMENT_PROGRESS.md) | 구현 진행 기록 |
| [ORIGINAL_PARITY_REVIEW.md](docs/ORIGINAL_PARITY_REVIEW.md) | 원본 claude-code와의 비교 |
| [RELIABILITY_CHECKLIST.md](docs/RELIABILITY_CHECKLIST.md) | 운영 안정성 체크 |
| [GOAL_CLOSURE_PLAN.md](docs/GOAL_CLOSURE_PLAN.md) | 목적 달성 후 남은 일 정리 |
| [CLI_SMOKE.md](docs/CLI_SMOKE.md) | CLI 최종 smoke 시나리오 |
| [CODEX_REPEATED_SOAK.md](docs/CODEX_REPEATED_SOAK.md) | `Codex CLI` repeated soak / burn-in 절차 |
| [DEV_PLAN_WORKFLOW.md](docs/DEV_PLAN_WORKFLOW.md) | `dev-plan-skill` 기반 로컬 phased plan 운영 규칙 |
| [FINAL_USER_MANUAL_CHECKLIST.md](docs/FINAL_USER_MANUAL_CHECKLIST.md) | 사용자 문서 최종 점검 체크리스트 |
| [PARALLEL_5_AGENT_SMOKE.md](docs/PARALLEL_5_AGENT_SMOKE.md) | 5-agent 병렬 smoke 결과 기록 |
| [PARALLEL_5_AGENT_DIALOGUE_CASES.md](docs/PARALLEL_5_AGENT_DIALOGUE_CASES.md) | 고난도 5-agent 병렬 대화 시나리오 결과 |
| [TUI_SMOKE.md](docs/TUI_SMOKE.md) | TUI 실사용 smoke 시나리오 |

문서 읽는 추천 순서:

1. `README.md`
2. `docs/USER_QUICKSTART.md`
3. `AGENT.md`
4. `docs/DEV_PLAN_WORKFLOW.md`
5. `docs/project.md`
6. `docs/PRD.md`
7. `docs/TRD.md`
8. `docs/ORIGINAL_PARITY_REVIEW.md`

## 실사용 방법

빌드:

```bash
cd <repo-root>
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
- real `Codex CLI` long-turn visibility 검증 통과 (`2026-04-03`, `frontend` 단독 10분 내외 turn에서도 `executing-turn` + `heartbeat_age=0s` 유지 확인)
- real shoe-mall bootstrap 관측에서 `planner/search/backend/reviewer`가 먼저 완료되고, `frontend`만 `pending=1` 상태에서 `executing-turn`을 유지하는 패턴을 확인했다. 즉 `pending task`가 남아 있어도 `state=executing-turn` + `heartbeat_age=0s`면 live turn일 수 있다.
- TUI boot smoke 통과
- `watch` / `tui` 명령 rootDir 상태로 렌더 가능
- detached background spawn 테스트 통과
- detached worker stdout/stderr log capture와 `attach` / `status` / TUI teammate pane의 recent stderr preview 검증 통과
- repeated soak summary artifact(`soak-artifacts/latest-summary.json`) 및 `attach` snapshot 기록 검증 통과

현재 최종 로컬 검증 결과:

- `npm run typecheck` 통과
- `npm test` 통과
- 총 `139 tests pass` (`2026-04-03` 재확인)

## 중요 설계 결정

| 항목 | 현재 결정 |
|---|---|
| 실행 목표 | 원본 UI 복제가 아니라 `독립 실행 가능한 headless + TUI 운영 도구` |
| upstream parity | `runAgent` 직접 import 대신 subprocess bridge 사용 |
| 상태 저장 | 파일 기반 저장소 유지 |
| 상태 격리 | `--root-dir` 사용 |
| 기본 결과물 경로 | `--workspace` 미지정 시 `<root-dir>/workspaces/<team>` |
| TUI refresh | watcher 대신 polling |
| TUI teammate 실행 | in-process가 아니라 detached background process |

## 현재 알려진 제한 / 주의점

1. `runAgent()` direct import parity는 아직 하지 않았습니다.  
이건 현재 목적상 필수는 아니며, live backend bridge가 실사용을 대신합니다.

2. 현재는 `stderr_tail` 최근 일부만 보입니다.  
full log streaming, scrollable tail viewer, stdout/stderr 전환 UI는 아직 없습니다.

3. background worker의 PID는 `attach` / `status` / TUI에 노출되지만, 전용 process control UI는 없습니다.

4. TUI는 지금 충분히 실사용 가능하지만, 더 긴 시간의 soak test나 multi-team overview는 아직 확장 여지가 있습니다.

5. 저장소는 현재 독립 git repo로 운영 중이지만, 상위 워크스페이스 안에 중첩되어 있습니다.  
즉, 작업할 때는 반드시 `/Users/hwanchoi/projects/claude-code/agent-team`를 기준 루트로 잡는 것이 안전합니다.

## 다음 작업 추천

우선순위 높은 후보:

1. background worker log / tail visibility 추가
2. full log tail / scrollable viewer UX
3. approval UX polish
4. multi-team picker / overview 개선
5. longer burn-in 결과 축적과 release checklist 정리

현재 목적 기준으로는 이미 성공 상태이므로, 다음 작업은 대부분 운영성/관측성/UX 고도화 성격입니다.

## 테스트 / 디버그 명령

전체 검증:

```bash
cd <repo-root>
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
| 전체 사용법 | `README.md` |
| 빠른 시작 | `docs/USER_QUICKSTART.md` |
| 전체 인수인계 | `AGENT.md` |
| 새 workstream 계획 생성 | `docs/DEV_PLAN_WORKFLOW.md`, `scripts/new_dev_plan.py`, `dev-plan/implement_20260403_185856.md` |
| CLI 명령 수정 | `src/team-cli/run-cli.ts`, `src/team-cli/arg-parsers.ts`, `src/team-cli/command-registry.ts` |
| runtime 동작 수정 | `src/team-runtime/in-process-runner.ts` |
| backend bridge 수정 | `src/team-runtime/codex-cli-bridge.ts`, `src/team-runtime/upstream-cli-bridge.ts` |
| 프로젝트 빌더 수정 | `src/team-tui/project-builder-app.tsx`, `src/team-tui/commands/app.tsx`, `src/atcli/bin.ts` |
| 운영 TUI 수정 | `src/team-tui/app.tsx` |
| background spawn 수정 | `src/team-operator/background-process.ts` |
| soak / burn-in | `scripts/run-codex-repeated-soak.mjs`, `src/team-cli/soak/codex-repeated-soak.ts`, `docs/CODEX_REPEATED_SOAK.md` |
| 운영 smoke 재현 | `docs/CLI_SMOKE.md`, `docs/PARALLEL_5_AGENT_SMOKE.md`, `docs/PARALLEL_5_AGENT_DIALOGUE_CASES.md`, `docs/TUI_SMOKE.md` |

## 한 줄 결론

`agent-team`은 현재 `독립 실행 가능한 팀 에이전트 런타임 + CLI + Ink TUI + detached background worker`까지 갖춘 상태이며, 다른 환경에서 이어받아도 바로 운영/개선 작업을 시작할 수 있습니다.

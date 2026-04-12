<div align="center">

<img src="https://img.shields.io/badge/agent--team-Multi%20Agent%20Runtime-6C5CE7?style=for-the-badge&logo=robot&logoColor=white" alt="agent-team" />

# agent-team

**CLI 기반 Multi-Agent Team Runtime**

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](#)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)](#)
[![React](https://img.shields.io/badge/Ink%20%2F%20React-61DAFB?style=flat-square&logo=react&logoColor=black)](#)
[![Runtime](https://img.shields.io/badge/LLM%20Runtime-Codex%20CLI-000000?style=flat-square)](#-핵심-설계-원칙)
[![Tests](https://img.shields.io/badge/tests-233%20passed-00B894?style=flat-square&logo=checkmarx&logoColor=white)](#-빌드--테스트)

기존 `claude-code/package` 내부의 teammate / swarm runtime을 독립 실행형으로 분리한 프로젝트입니다.  
사용자가 자연어 goal을 입력하면 **프로젝트 빌더 TUI 또는 CLI run 경로를 통해 팀이 자동 구성**되고,
Codex CLI 기반 background teammate들이 병렬로 소프트웨어를 빌드합니다.

[Quick Start](#-빠른-시작) · [Dynamic Roles](#-goal-기반-동적-역할-선택) · [Architecture](#-아키텍처) · [Commands](#-핵심-cli-명령) · [TUI](#-터미널-ui) · [Soak](#-soak--release-gate)

</div>

---

## 🚨 핵심 설계 원칙

> **이 프로젝트에서 LLM 호출의 표준 경로는 반드시 `Codex CLI` subprocess 입니다.**

| 구분 | 내용 |
|---|---|
| ✅ 표준 경로 | `codex-cli` bridge (`child_process.spawn('codex', ...)`) |
| ⚪ 대체 경로 | `upstream` bridge (대체 CLI 실험/호환용) |
| 🚫 금지 | OpenAI / Anthropic 등 direct HTTP API 연동 |
| 🚫 비목표 | API key 기반 model 호출 레이어 설계·구현 |

이 저장소 기준으로는 OpenAI/Anthropic SDK import나 direct API 호출 경로를 두지 않고,
**CLI 기반 agent runtime**을 전제로 설계되어 있습니다.

---

## 🚀 빠른 시작

### 1) 설치

```bash
npm install
npm run build
npm link
```

### 2) 환경 점검

```bash
agent-team doctor --workspace /tmp/agent-team-demo --probe
```

정상이라면 아래를 확인할 수 있어야 합니다.

- `Codex CLI executable: OK`
- `Codex CLI login: OK`
- `Workspace write access: OK`
- `Codex exec probe: OK`
- 마지막 줄 `Result: READY`

### 3) 대화형 프로젝트 빌더 실행

```bash
bun atcli.js --root-dir /tmp/agent-team-demo
atcli --root-dir /tmp/agent-team-demo
agent-team --root-dir /tmp/agent-team-demo app
```

실행하면 곧바로 자연어 goal 입력 대기 상태가 됩니다. 예:

```text
쇼핑몰 만들어줘
```

프로젝트 빌더에서 바로 볼 수 있는 것:

- 현재 결과 상태 (`waiting-for-goal`, `pending`, `running`, `completed`, `attention`)
- teammate / task 상태
- prioritized generated files summary
- 핵심 preview (`headline`, `excerpt`, `selection`)
- large-output 힌트 (`Generated Files (24+)`, `showing first ... discovered files`, `trimmed`)
- live worker 상태 (`executing-turn`, `settling`, `stale`, `pid`, `launch`)

### 4) 진행 · 결과 확인

```bash
agent-team --root-dir /tmp/agent-team-demo attach <team>
agent-team --root-dir /tmp/agent-team-demo watch <team>
agent-team --root-dir /tmp/agent-team-demo tui <team>
```

비대화형(batch) 부트스트랩도 계속 지원합니다.

```bash
agent-team --root-dir /tmp/agent-team-demo \
  run "쇼핑몰 만들어줘" \
  --team shopping-mall-demo \
  --runtime codex-cli \
  --model gpt-5.4-mini
```

> `--workspace`를 생략하면 결과물은 기본적으로 `<root-dir>/workspaces/<team-name>` 아래에 생성됩니다.

### 5) 선택적 backend / transport

기본선은 여전히 `local runtime + file-backed root` 이지만, 현재는 아래 선택적 확장도 지원합니다.

```bash
# PTY pane backend
agent-team run "Build a deterministic chatbot MVP" \
  --team pane-demo \
  --runtime local \
  --backend pane

# remote-root transport
agent-team run "Build a deterministic chatbot MVP" \
  --team remote-demo \
  --runtime local \
  --transport remote-root \
  --remote-root-dir /tmp/agent-team-remote
```

- `--backend pane`: detached worker를 PTY(`/usr/bin/script`) 기반 pane backend로 launch
- `--transport remote-root --remote-root-dir <path>`: team/task/workspace를 alternate root에 bootstrap
- 이후 재진입은 `agent-team --root-dir <remote-root> status|attach|watch|tui ...` 로 수행

---

## 🤖 goal 기반 동적 역할 선택

현재 `run "<goal>"`은 `software-factory` preset을 기반으로 하지만,
예전처럼 항상 고정 5-agent만 띄우지 않고 **goal 키워드 분석 기반 동적 역할 선택**을 사용합니다.

### 동작 요약

- `planner`, `reviewer`는 항상 포함
- goal 키워드에 따라 필요한 역할만 추가 선택
- `--roles`로 수동 오버라이드 가능
- 키워드 매칭이 없으면 기본 5개 fallback 사용
  - `planner, search, frontend, backend, reviewer`

### 현재 역할 풀 (10종)

| 역할 | 담당 | 자동 선택 키워드 예시 |
|---|---|---|
| `planner` | 구현 계획 & 아키텍처 | 항상 포함 |
| `search` | 요구사항 리서치 | research, reference, requirement |
| `frontend` | 프론트엔드 개발 | frontend, react, web, dashboard, ui |
| `backend` | 백엔드/API 개발 | backend, api, server, endpoint |
| `database` | DB 스키마 & 데이터 레이어 | database, postgresql, schema, migration |
| `devops` | 인프라 & CI/CD | docker, kubernetes, deploy, ci/cd |
| `testing` | 테스트 스위트 | test, e2e, playwright, jest |
| `mobile` | 모바일 앱 | mobile, ios, android, react native |
| `security` | 보안 아키텍처 | auth, oauth, encryption, security |
| `reviewer` | 전체 리뷰 | 항상 포함 |

### 예시

```bash
# 자동 선택: planner + frontend + reviewer
agent-team run "Build a React dashboard"

# 자동 선택: planner + frontend + backend + database + devops + reviewer
agent-team run "Full-stack app with PostgreSQL and Docker"

# 수동 오버라이드: planner/reviewer는 자동 포함
agent-team run "Build X" --roles frontend,database,testing
```

---

## 🏗 아키텍처

```text
┌───────────────────────────────────────────────────────────────┐
│                        사용자 진입점                          │
│   atcli.js  ·  atcli  ·  agent-team app  ·  agent-team run    │
└───────────────┬─────────────────────────────┬─────────────────┘
                │                             │
        ┌───────▼───────┐            ┌────────▼────────┐
        │   team-tui    │            │    team-cli     │
        │ React / Ink   │            │   commands      │
        └───────┬───────┘            └────────┬────────┘
                │                             │
        ┌───────▼─────────────────────────────▼───────┐
        │                 team-operator                │
        │     dashboard · actions · background proc    │
        └──────────────────────┬───────────────────────┘
                               │
        ┌──────────────────────▼───────────────────────┐
        │                  team-runtime                 │
        │ RuntimeTurnBridge: codex-cli / upstream / local │
        └──────────────────────┬───────────────────────┘
                               │
        ┌──────────────────────▼───────────────────────┐
        │             team-core (file-based)            │
        │ team · task · mailbox · permission · session  │
        │ transcript · logs · workspaces                │
        └───────────────────────────────────────────────┘
```

### 핵심 레이어

| 레이어 | 역할 | 대표 파일 |
|---|---|---|
| `team-core` | 파일 기반 영속 저장소, mailbox/task/session/permission | `src/team-core/*` |
| `team-runtime` | teammate 워크루프, session lifecycle, Codex CLI bridge | `src/team-runtime/*` |
| `team-cli` | doctor/run/attach/watch/tui/logs/permissions 등 명령 표면 | `src/team-cli/*` |
| `team-operator` | UI-neutral orchestration, dashboard 집계, background worker | `src/team-operator/*` |
| `team-tui` | Project Builder, Watch, Control TUI | `src/team-tui/*` |
| `atcli` | `agent-team app`를 짧게 실행하는 thin wrapper | `src/atcli/*` |

### 런타임 브리지

| 구현체 | 용도 |
|---|---|
| `codex-cli` | **프로덕션 표준 경로** |
| `upstream` | 대체 CLI 호환/실험 경로 |
| `local` | 테스트 / mock 전용 |

---

## 💻 핵심 CLI 명령

| 명령 | 용도 |
|---|---|
| `agent-team doctor --workspace <path> --probe` | 실행 전 환경 준비 상태 확인 |
| `bun atcli.js [--root-dir <path>]` | 프로젝트 빌더 TUI 시작 |
| `atcli [--root-dir <path>]` | 설치 후 바로 쓰는 프로젝트 빌더 진입점 |
| `agent-team [--root-dir <path>] app` | 명시적 프로젝트 빌더 실행 |
| `agent-team [--root-dir <path>] run <goal...>` | 비대화형 goal bootstrap |
| `agent-team [--root-dir <path>] attach [team]` | 현재 팀 상태 / 결과 / 생성 파일 요약 |
| `agent-team [--root-dir <path>] watch <team>` | 읽기 전용 진행 대시보드 |
| `agent-team [--root-dir <path>] tui [team]` | 인터랙티브 운영 UI. team 생략 시 multi-team picker부터 시작 |
| `agent-team [--root-dir <path>] status <team>` | teammate 상태 상세 확인 |
| `agent-team [--root-dir <path>] tasks <team>` | task 목록 확인 |
| `agent-team [--root-dir <path>] transcript <team> <agent>` | transcript 확인 |
| `agent-team [--root-dir <path>] logs <team> <agent> [stdout\|stderr\|both]` | worker 로그 tail 확인 |
| `agent-team [--root-dir <path>] permissions <team> [pending\|resolved\|rules]` | approval / persisted rule 확인 |

전체 명령은 아래로 확인합니다.

```bash
agent-team --help
```

### 자주 쓰는 운영 예시

```bash
agent-team --root-dir /tmp/agent-team-demo attach shopping-mall-demo
agent-team --root-dir /tmp/agent-team-demo status shopping-mall-demo
agent-team --root-dir /tmp/agent-team-demo logs shopping-mall-demo frontend stderr --lines 40
agent-team --root-dir /tmp/agent-team-demo permissions shopping-mall-demo pending
agent-team --root-dir /tmp/agent-team-demo approve-permission shopping-mall-demo frontend perm-123 --persist --preset suggested
agent-team --root-dir /tmp/agent-team-demo tasks shopping-mall-demo
```

### permission preset

persisted permission rule 저장 시 아래 preset을 지원합니다.

- `suggested`
- `command`
- `cwd`
- `path`
- `host`

---

## 🖥 터미널 UI

### 3가지 모드

| 모드 | 진입 명령 | 용도 |
|---|---|---|
| **Project Builder** | `atcli` / `agent-team app` | goal 입력 → 자동 bootstrap → 결과/preview 확인 |
| **Watch** | `agent-team watch <team>` | 읽기 전용 모니터링 |
| **Control TUI** | `agent-team tui [team]` | spawn/shutdown/approval/message 처리 |

### multi-team picker / overview

`agent-team tui`에서 team 이름을 생략하면 전역 team picker부터 시작합니다.

- 상단에 **Global Ops Overview**가 표시된다.
- `teams / attention / running / pending / completed` 전역 요약을 바로 볼 수 있다.
- `approvals / active workers / running workers / stale workers / unread` 전역 합계를 바로 볼 수 있다.
- `attention / approvals / stale / backlog` 섹션에서 우선 봐야 할 팀을 바로 판독할 수 있다.
- `attention` 팀이 위로 정렬
- row마다 `approvals / workers / tasks / attention reason` 요약 표시
- `c`로 새 팀 생성
- 생성 화면 진입 후에도 기존 팀이 있으면 `Esc`로 다시 목록 복귀
- 정렬 우선순위는 대략 `attention → running → pending → completed`

### 로그 / 상세 보기

- TUI detail tab에서 `Activity`, `Transcript`, `Logs`를 확인할 수 있습니다.
- `Logs` 탭에서 `stdout` / `stderr` 전환과 tail 스크롤이 가능합니다.
- `attach`, `status`, TUI 모두 large-output preview와 bounded log reader 어휘를 공유합니다.

### 자주 쓰는 키

| 키 | 동작 |
|---|---|
| `Tab`, 방향키 | pane / selection 이동 |
| `s` | teammate spawn |
| `t` | task 생성 |
| `m` | leader message 전송 |
| `a` | approval inbox |
| `u` | selected teammate resume |
| `x` | shutdown request |
| `r` | refresh |
| `?` | help |
| `q` | 종료 |

---

## ⚙️ worker / runtime 동작

`run`, `spawn`, `resume`, `reopen`으로 띄운 teammate는 detached background process로 실행될 수 있습니다.

### 확인 가능한 상태

- `worker=attached|detached`
- `launch=spawn|resume|reopen`
- `lifecycle=running|idle|completed|failed`
- `pid=<number>`
- `state=executing-turn|settling|stale|idle`
- `heartbeat_age`, `turn_age`, `currentWorkKind`

### 로그 위치

- `<root-dir>/teams/<team>/logs/*.stdout.log`
- `<root-dir>/teams/<team>/logs/*.stderr.log`

### generated preview UX

large-output workspace에서도 다음 힌트를 제공합니다.

- `Generated Files (24+)`
- `showing first ... discovered files`
- `preview_selection=priority|signal`
- `preview_trimmed=... more line(s) hidden`

---

## 🧪 soak / release gate

반복 soak는 아래처럼 실행합니다.

```bash
npm run soak:codex -- --root-dir /tmp/agent-team-codex-soak --iterations 5
```

release 후보별로 결과를 묶고 싶다면 label을 같이 남길 수 있습니다.

```bash
npm run soak:codex -- \
  --root-dir /tmp/agent-team-codex-soak \
  --iterations 10 \
  --label runtime-rc-20260405
```

### 주요 artifact

- `<root-dir>/soak-artifacts/latest-summary.json`
- `<root-dir>/soak-artifacts/summary-*.json`
- `<root-dir>/soak-artifacts/history.json`
- 실패 시 `<root-dir>/soak-artifacts/failure-*.json`

### gate checker

```bash
npm run soak:codex:check -- \
  --summary /tmp/agent-team-codex-soak/soak-artifacts/latest-summary.json \
  --gate runtime
```

history manifest에서 특정 label을 바로 판독할 수도 있습니다.

```bash
npm run soak:codex:check -- \
  --history /tmp/agent-team-codex-soak/soak-artifacts/history.json \
  --run-label runtime-rc-20260405 \
  --gate runtime
```

### 현재 gate 기준

| gate | 최소 기준 |
|---|---|
| `permission` | 3 iterations |
| `runtime` | 5 iterations |
| `bridge` | 10 iterations |

---

## 🛠 빌드 & 테스트

```bash
npm install
npm run build
npm run typecheck
npm test
```

- 최신 로컬 문서 동기화 기준: **`209 tests pass`**
- soak / release gate 절차는 별도 문서로 운영합니다.

---

## 📚 관련 문서

| 문서 | 용도 |
|---|---|
| [`AGENT.md`](AGENT.md) | 개발 핸드오프, 구현 상태, 설계 결정 |
| [`CLAUDE.md`](CLAUDE.md) | 프로젝트 컨텍스트 및 작업 가이드 |
| [`docs/USER_QUICKSTART.md`](docs/USER_QUICKSTART.md) | 초보 사용자 빠른 시작 |
| [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) | 설치/로그인/권한 실패 대응 |
| [`docs/TEAM_CONSTRAINTS.md`](docs/TEAM_CONSTRAINTS.md) | 구조적 제한 / 운영 안정성 / 비용 기준 |
| [`docs/CLI_SMOKE.md`](docs/CLI_SMOKE.md) | CLI 검증 절차 |
| [`docs/TUI_SMOKE.md`](docs/TUI_SMOKE.md) | TUI 검증 절차 |
| [`docs/CODEX_REPEATED_SOAK.md`](docs/CODEX_REPEATED_SOAK.md) | 반복 soak 절차 |
| [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md) | release gate / 증빙 기준 |
| [`docs/NEXT_BACKLOG.md`](docs/NEXT_BACKLOG.md) | 다음 workstream 우선순위 |

---

<div align="center">

**Built around Codex CLI as the standard LLM runtime**

</div>

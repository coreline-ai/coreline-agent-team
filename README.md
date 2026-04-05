<div align="center">

<img src="https://img.shields.io/badge/agent--team-Multi%20Agent%20Runtime-6C5CE7?style=for-the-badge&logo=robot&logoColor=white" alt="agent-team" />

# agent-team

**CLI 기반 Multi-Agent Team Runtime**

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](#)
[![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white)](#)
[![React](https://img.shields.io/badge/Ink%20%2F%20React-61DAFB?style=flat-square&logo=react&logoColor=black)](#)
[![Tests](https://img.shields.io/badge/tests-139%20passed-00B894?style=flat-square&logo=checkmarx&logoColor=white)](#-테스트)
[![Files](https://img.shields.io/badge/91%20files-~15%2C220%20LOC-0984E3?style=flat-square)](#)

기존 `claude-code/package` 내부의 teammate / swarm runtime을 독립 실행형으로 분리한 프로젝트입니다.  
사용자가 자연어 goal을 입력하면 **5-agent 팀이 자동 구성**되어 소프트웨어를 빌드합니다.

[Quick Start](#-빠른-시작) · [Architecture](#-아키텍처) · [Codex CLI Flow](#-codex-cli-호출-흐름) · [Commands](#-cli-명령어-전체) · [TUI](#-터미널-ui) · [Tests](#-테스트)

</div>

---

## 🚨 핵심 설계 원칙

> **이 프로젝트에서 LLM 호출은 반드시 `Codex CLI` subprocess를 통해서만 이루어집니다.**

| | |
|:---:|---|
| ✅ | **표준 경로** — `codex-cli` (`child_process.spawn('codex', ...)`) |
| 🚫 | **금지** — OpenAI / Anthropic 등 모든 모델의 Direct API 연동 |
| 🚫 | **비목표** — API key 기반 model 호출 레이어 설계 · 구현 |

> 코드 전체에 OpenAI/Anthropic SDK import나 HTTP API 호출이 **단 하나도 없습니다.**

---

## 🚀 빠른 시작

### 1️⃣ 설치

```bash
npm install && npm run build && npm link
```

### 2️⃣ 환경 점검

```bash
agent-team doctor --workspace /tmp/agent-team-demo --probe
```

> 정상이면: `Codex CLI executable: OK` · `Codex CLI login: OK` · `Workspace write access: OK` · `Codex exec probe: OK` · **`Result: READY`**

### 3️⃣ 대화형 프로젝트 빌더 실행

```bash
bun atcli.js --root-dir /tmp/agent-team-demo        # 직접 실행
atcli --root-dir /tmp/agent-team-demo                # npm link 후
agent-team --root-dir /tmp/agent-team-demo app       # 명시적 app 서브커맨드
```

TUI가 열리면 자연어 goal을 입력합니다. 예: `쇼핑몰 만들어줘`

### 4️⃣ 진행 · 결과 확인

```bash
agent-team --root-dir /tmp/agent-team-demo attach <team>   # 상태 요약
agent-team --root-dir /tmp/agent-team-demo watch <team>    # 읽기 전용 대시보드
agent-team --root-dir /tmp/agent-team-demo tui <team>      # 대화형 제어 UI
```

비대화형(batch) 모드:

```bash
agent-team --root-dir /tmp/agent-team-demo \
  run "쇼핑몰 만들어줘" \
  --team shopping-mall \
  --runtime codex-cli \
  --model gpt-5.4-mini
```

---

## 🏗 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                       사용자 진입점                           │
│   atcli.js  ·  agent-team app  ·  agent-team run "goal"     │
└──────────────┬──────────────────────────┬───────────────────┘
               │                          │
       ┌───────▼───────┐         ┌────────▼────────┐
       │  team-tui     │         │  team-cli       │
       │  React / Ink  │         │  25+ commands   │
       └───────┬───────┘         └────────┬────────┘
               │                          │
       ┌───────▼──────────────────────────▼───────┐
       │            team-operator                  │
       │   Dashboard · Actions · Background Proc   │
       └──────────────────┬───────────────────────┘
                          │
       ┌──────────────────▼───────────────────────┐
       │            team-runtime                   │
       │  ┌─────────────────────────────────────┐  │
       │  │ RuntimeTurnBridge (Strategy Pattern) │  │
       │  │ ┌───────────┬───────────┬─────────┐ │  │
       │  │ │ codex-cli │ upstream  │  local   │ │  │
       │  │ │  (표준)   │  (대체)   │ (테스트) │ │  │
       │  │ └───────────┴───────────┴─────────┘ │  │
       │  └─────────────────────────────────────┘  │
       └──────────────────┬───────────────────────┘
                          │
       ┌──────────────────▼───────────────────────┐
       │         team-core  (File-based Storage)   │
       │  team · task · mailbox · session          │
       │  transcript · permission                  │
       └───────────────────────────────────────────┘
```

### 📦 5-Layer 모듈 구조

| # | 레이어 | 파일수 | LOC | 역할 |
|:-:|--------|:------:|:---:|------|
| 1 | **team-core** | 14 | ~2,500 | 파일 기반 영속 저장소 (JSON + 파일 락) |
| 2 | **team-runtime** | 9 | ~2,900 | Agent 실행 엔진 · Codex CLI 브릿지 |
| 3 | **team-cli** | 39 | ~4,500 | 25+ CLI 명령어 |
| 4 | **team-operator** | 6 | ~960 | 대시보드 · 백그라운드 프로세스 오케스트레이션 |
| 5 | **team-tui** | 20 | ~2,800 | React/Ink 터미널 UI (3가지 모드) |
| — | **atcli** | 2 | ~30 | 경량 래퍼 (`app` 기본 라우팅) |

---

## 🔗 Codex CLI 호출 흐름

> 이 프로젝트의 가장 핵심적인 동작 — **LLM을 호출하는 전체 파이프라인**입니다.

### ⚡ RuntimeTurnBridge 인터페이스

```typescript
// src/team-runtime/types.ts — 모든 LLM 호출의 추상화
export type RuntimeTurnBridge = {
  executeTurn(input: RuntimeTurnInput): Promise<RuntimeTurnResult | void>
}
```

| 구현체 | 파일 | 용도 |
|--------|------|------|
| 🟢 **codex-cli** | `codex-cli-bridge.ts` | **프로덕션 표준 경로** |
| 🔵 upstream | `upstream-cli-bridge.ts` | 대체 CLI (Claude CLI 등) |
| ⚪ local/echo | `runtime-adapter.ts` | 테스트 · mock 전용 |

### 📊 전체 실행 파이프라인

```
👤 사용자: "쇼핑몰 만들어줘"
 │
 ├─▶ 1. run command
 │      team 생성 → 5 agent 배정 → background launch
 │
 ├─▶ 2. spawnInProcessTeammate
 │      session 생성 → adapter 선택(codex-cli) → 워크루프 진입
 │
 ├─▶ 3. in-process-runner (워크루프)
 │      while (!abort && iter < max):
 │        heartbeat → resolveNextWorkItem
 │        → buildTurnPrompt → bridge.executeTurn
 │        → 결과 처리 (task 완료, 메시지, transcript)
 │
 └─▶ 4. codex-cli-bridge
        spawn('codex', args) → stdin.write(prompt)
        → stdout/stderr 캡처 → output JSON 파싱
```

### 🔧 Codex CLI Spawn 상세

```typescript
// codex-cli-bridge.ts → buildCodexCliArgs()
const args = [
  'exec',                          // Codex 서브커맨드
  '-',                              // stdin에서 프롬프트 읽기
  '--color', 'never',
  '--skip-git-repo-check',
  '--ephemeral',                    // 일회성 세션
  '-C', cwd,                        // 작업 디렉토리
  '-o', outputPath,                 // 결과 파일 경로
  '--output-schema', schemaPath,    // JSON 스키마 검증
]
if (model) args.push('-m', model)
if (codexArgs) args.push(...codexArgs)  // 예: --full-auto
```

```typescript
// 프로세스 I/O
const child = spawn(executablePath, args, {
  cwd: config.cwd,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: process.env,
})

child.stdin.write(input.prompt)   // 프롬프트 전달
child.stdin.end()                  // EOF 시그널
```

### 📝 프롬프트 조립 구조

```
# Session Context
Session ID: uuid-123  ·  Reopened: no

# Recent Transcript Context
[최근 8턴의 대화 히스토리]

# Agent Team Work Item
Team: shopping-mall-demo  ·  Teammate: frontend

## Base Instructions
[역할별 커스텀 프롬프트]

## Current Work
Task #5: Implement the frontend application
[태스크 subject + description]
```

### 📤 응답 JSON 스키마

`--output-schema` 플래그로 Codex에 전달되는 구조화된 출력:

```json
{
  "summary":           "작업 요약",
  "assistantResponse": "팀에 보낼 메시지",
  "sendTo":            "대상 agent",
  "taskStatus":        "pending | in_progress | completed",
  "completedTaskId":   "완료한 task ID",
  "completedStatus":   "resolved | blocked | failed",
  "failureReason":     "실패 사유",
  "stop":              false,
  "shutdown":          { "approved": true, "reason": "완료됨" }
}
```

### 🛡 응답 파싱 · 폴백 체인

```
output 파일(-o)에서 JSON 읽기
  └─ 실패 → stdout에서 텍스트 읽기
       └─ JSON 파싱 실패 → assistantResponse로 래핑
            └─ exit code ≠ 0 → fallbackBridge 시도 → 최종 실패 반환
```

### ⚙️ Codex CLI 설정 옵션

| 옵션 | CLI 플래그 | 설명 |
|------|-----------|------|
| 런타임 | `--runtime codex-cli` | Codex CLI 사용 |
| 모델 | `--model gpt-5.4-mini` | Codex `-m` 플래그로 전달 |
| 실행 파일 | `--codex-executable /path` | 커스텀 Codex 경로 |
| 추가 인자 | `--codex-arg --full-auto` | Codex에 전달할 추가 플래그 |
| 반복 횟수 | `--max-iterations 50` | 워크루프 최대 턴 수 |
| 폴링 간격 | `--poll-interval 500` | 작업 확인 간격 (ms) |

> 기본 Codex 인자: `['--full-auto']`

---

## 🤖 Software Factory 프리셋

`run` 명령 실행 시 자동 부트스트랩되는 **5-agent 팀**:

```
                    ┌──────────────┐
                    │  📋 planner  │
                    │  plan.md     │
                    │  arch.md     │
                    └──────┬───────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
   │  🔍 search   │ │  🎨 frontend │ │  ⚙️ backend  │
   │  research.md │ │  frontend/   │ │  backend/    │
   └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
          │                │                │
          └────────────────┼────────────────┘
                           ▼
                    ┌──────────────┐
                    │ ✅ reviewer  │ ← blockedBy: 4개 agent
                    │  review.md  │
                    └─────────────┘
```

| 역할 | 태스크 | 산출물 |
|------|--------|--------|
| 📋 **planner** | 제품 구현 계획 수립 | `docs/plan.md` · `architecture.md` · `task-breakdown.md` |
| 🔍 **search** | 요구사항 조사 · 레퍼런스 수집 | `docs/research.md` |
| 🎨 **frontend** | 프론트엔드 구현 | `frontend/` scaffold |
| ⚙️ **backend** | 백엔드 서비스 구현 | `backend/` scaffold · `docs/backend-api.md` |
| ✅ **reviewer** | 산출물 리뷰 · 품질 요약 | `docs/review.md` |

각 agent는 **독립 Codex CLI background process**로 병렬 실행됩니다.

---

## 🧩 모듈별 상세

### 📁 team-core — 데이터 레이어

> 14파일 · ~2,500 LOC · JSON + proper-lockfile 동시성 안전

| 파일 | LOC | 역할 |
|------|:---:|------|
| `types.ts` | 423 | 전체 타입 정의 — `TeamFile`, `TeamMember`, `TeamTask`, 메시지 23종+ |
| `team-store.ts` | 413 | 팀 생성 · 멤버 관리 · heartbeat · 권한 상태 |
| `task-store.ts` | 575 | 태스크 CRUD · claim · 의존성(`blocks`/`blockedBy`) |
| `mailbox-protocol.ts` | 495 | 11종 메시지 타입 검증(`isXxx`) + 생성(`createXxx`) |
| `permission-store.ts` | 404 | 권한 요청 · 승인 · 규칙 매칭 (specificity 기반) |
| `session-store.ts` | 265 | 세션 열기 · 닫기 · 재개 · 이력 관리 |
| `paths.ts` | 236 | 저장소 경로 구성 (`getTeamDir`, `getInboxPath` 등) |
| `mailbox-store.ts` | 158 | agent 간 메시지 수신함 읽기 · 쓰기 · 마킹 |
| `file-utils.ts` | 141 | 원자적 파일 쓰기 · retry 로직 |
| `transcript-store.ts` | 137 | 대화 기록 append · 최근 컨텍스트 조회 |
| `agent-state.ts` | 133 | 에이전트 표시 상태 (`idle`/`executing`/`settling`/`stale`) |
| `lockfile.ts` | 47 | 파일 락 — 20회 재시도, 5-100ms 타임아웃 |
| `task-status.ts` | 44 | 상태 정규화 (`done` → `completed`) |

<details>
<summary>📂 파일 저장소 디렉토리 구조</summary>

```
{root-dir}/
├── teams/{team-name}/
│   ├── config.json              ← TeamFile (메타데이터 + 멤버)
│   ├── .lock
│   ├── inboxes/{agent}.json     ← 메시지 수신함
│   ├── permissions/
│   │   ├── pending/{id}.json    ← 대기중 권한 요청
│   │   └── resolved/{id}.json   ← 처리된 권한 요청
│   ├── sessions/{agent}.json    ← 세션 이력
│   ├── transcripts/{agent}.json ← 대화 기록
│   └── logs/*.stdout.log        ← worker 로그
├── tasks/{team-name}/
│   ├── {id}.json                ← 개별 태스크
│   └── .highwatermark           ← ID 할당 추적
└── workspaces/{team-name}/      ← 작업 결과물
    ├── docs/ · frontend/ · backend/
    └── .agent-team/run.json
```

</details>

### ⚡ team-runtime — 실행 레이어

> 9파일 · ~2,900 LOC · Agent 실행 엔진

| 파일 | LOC | 역할 |
|------|:---:|------|
| `in-process-runner.ts` | 977 | **핵심 워크루프** — 폴링 · 태스크 claim · 턴 실행 · idle 알림 |
| `runtime-adapter.ts` | 523 | 런타임 팩토리 · 프롬프트 조립 · 결과 정규화 |
| `upstream-cli-bridge.ts` | 358 | 대체 CLI 브릿지 (Claude CLI 등) |
| `codex-cli-bridge.ts` | 220 | **Codex CLI spawn** · 인자 빌드 · I/O 캡처 · JSON 파싱 |
| `spawn-in-process.ts` | 173 | Agent 생성 · 세션 관리 · lifecycle 핸들 |
| `types.ts` | 168 | `RuntimeTeammateConfig` · `RuntimeTurnBridge` 등 |
| `context.ts` | 42 | `AsyncLocalStorage` 런타임 컨텍스트 |
| `prompt/team-context.ts` | 30 | 팀 컨텍스트 시스템 프롬프트 |

<details>
<summary>🔄 워크루프 상세 (in-process-runner.ts)</summary>

```
runInProcessTeammate()
└─ while (!abort && iterations < maxIterations):
   └─ runInProcessTeammateOnce():
      ├─ 1. touchMemberHeartbeat()       → stale 방지
      ├─ 2. resolveNextWorkItem()        → shutdown > leader > peer > task
      ├─ 3. 작업 없음 → idle notification
      ├─ 4. 작업 있음 → buildTurnPrompt() → bridge.executeTurn()
      ├─ 5. task 완료 → updateTask()
      ├─ 6. 메시지 → writeToMailbox(sendTo)
      ├─ 7. transcript → appendTranscriptEntry()
      └─ 8. idle notification → summary, completedTaskId
```

</details>

### 🎛 team-operator — 오케스트레이션

> 6파일 · ~960 LOC

| 파일 | LOC | 역할 |
|------|:---:|------|
| `actions.ts` | 513 | spawn · resume · shutdown · approve 래핑 |
| `dashboard.ts` | 283 | 팀 상태 집계 · 활동 피드 |
| `background-process.ts` | 280 | detached 프로세스 spawn · log 리다이렉션 · PID 추적 |
| `types.ts` | 174 | `TeamDashboard` · 입력 타입 |
| `polling.ts` | 37 | 비동기 폴링 유틸 |

---

## 💻 CLI 명령어 전체

### 사용자 핵심 명령

| 명령 | 용도 |
|------|------|
| `agent-team doctor --workspace <path> --probe` | 실행 전 환경 준비 상태 확인 |
| `bun atcli.js [--root-dir <path>]` | 프로젝트 빌더 TUI 시작 |
| `atcli [--root-dir <path>]` | 설치 후 프로젝트 빌더 TUI |
| `agent-team [--root-dir <path>] app` | 대화형 프로젝트 빌더 |
| `agent-team [--root-dir <path>] run <goal>` | 비대화형 goal bootstrap |
| `agent-team [--root-dir <path>] attach [team]` | 팀 상태 · 결과 · 파일 요약 |
| `agent-team [--root-dir <path>] watch <team>` | 읽기 전용 대시보드 |
| `agent-team [--root-dir <path>] tui <team>` | 인터랙티브 운영 UI |
| `agent-team [--root-dir <path>] status <team>` | teammate 상태 상세 |
| `agent-team [--root-dir <path>] tasks <team>` | task 목록 |
| `agent-team [--root-dir <path>] transcript <team> <agent>` | 대화 기록 |

<details>
<summary>📋 전체 명령어 (25+)</summary>

| 명령어 | 용도 |
|--------|------|
| `app` | 대화형 프로젝트 빌더 TUI |
| `run` | 소프트웨어 팩토리 부트스트랩 |
| `doctor` | 환경 검증 (Codex 설치/로그인/실행) |
| `init` | 팀 생성 |
| `spawn` | Agent 생성 |
| `resume` | Agent 재개 (새 세션) |
| `reopen` | Agent 재시작 (기존 세션 유지) |
| `shutdown` | Agent 종료 요청 |
| `attach` | 팀 상태 · 결과 요약 |
| `watch` | 읽기 전용 모니터링 |
| `tui` | 대화형 제어 TUI |
| `status` | Teammate 상태 상세 |
| `tasks` | 태스크 목록 |
| `task-create` | 태스크 생성 |
| `task-update` | 태스크 상태 변경 |
| `transcript` | 대화 기록 조회 |
| `send` | Leader 메시지 전송 |
| `permissions` | 권한 요청 목록 |
| `approve-permission` / `deny-permission` | 권한 승인 · 거부 |
| `approve-sandbox` / `deny-sandbox` | 샌드박스 승인 · 거부 |
| `approve-plan` / `reject-plan` | 플랜 승인 · 거부 |
| `set-mode` | 권한 모드 변경 |
| `cleanup` | 비활성 팀/멤버 정리 |

</details>

---

## 🖥 터미널 UI

### 3가지 모드

| 모드 | 진입 명령 | 용도 |
|------|----------|------|
| 🏗 **Project Builder** | `atcli` / `agent-team app` | Goal 입력 → 자동 팀 구성 → 모니터링 |
| 🎮 **Control TUI** | `agent-team tui <team>` | 대화형 팀 관리 (spawn/shutdown/approve) |
| 👁 **Watch** | `agent-team watch <team>` | 읽기 전용 모니터링 |

### ⌨️ 키보드 단축키

| 키 | 동작 | | 키 | 동작 |
|:--:|------|:-:|:--:|------|
| `Tab` | Tasks ↔ Teammates | | `s` | Agent 생성 |
| `↑` `↓` | 항목 탐색 | | `t` | 태스크 생성 |
| `←` `→` | 상세 탭 전환 | | `m` | 메시지 전송 |
| `Enter` | 선택 · 확인 | | `a` | 승인 모달 |
| `Esc` | 뒤로 · 닫기 | | `u` | Agent resume |
| `f` | 포커스 순환 | | `x` | Agent shutdown |
| `r` | 새로고침 | | `?` | 도움말 |
| `q` | 종료 | | `j` `k` | 스크롤 |

### 💬 Project Builder 입력

| 입력 | 동작 |
|------|------|
| 일반 텍스트 (프로젝트 전) | Goal로 사용 → 팀 부트스트랩 |
| 일반 텍스트 (프로젝트 후) | `planner`에게 follow-up |
| `/to <agent> <msg>` | 특정 teammate로 라우팅 |
| `/doctor` | 환경 점검 재실행 |
| `/quit` | 종료 |

### 📐 레이아웃

| 터미널 너비 | 모드 |
|:----------:|------|
| `> 120` | Wide — 좌우 패인 + 하단 상세 |
| `90-120` | Compact — 좌우 패인 + 하단 상세 |
| `< 90` | Narrow — 세로 스택 + 포커스 토글 |

---

## 🔄 Agent 생명주기

### 상태 머신

```
                    spawn
                      │
                      ▼
              ┌──────────────┐
              │   💤 idle    │ ◄──── 작업 없음
              └──────┬───────┘
                     │ work item
                     ▼
              ┌──────────────┐
              │ ⚡ executing │ ◄──── Codex CLI 실행 중 (heartbeat 갱신)
              └──────┬───────┘
                     │ 턴 완료
                     ▼
              ┌──────────────┐
              │ ⏳ settling  │ ◄──── 5초 안정화
              └──────┬───────┘
                     │
            ┌────────┴────────┐
            ▼                 ▼
     다음 작업 있음       작업 없음
     → ⚡ executing      → 💤 idle

     ⚠️ 15초+ heartbeat 없음 → 🔴 stale
```

### 생명주기 전환

| 명령 | 세션 | 동작 |
|------|------|------|
| ▶️ `spawn` | 새 세션 | 새 agent 생성, 프롬프트/cwd/런타임 지정 |
| 🔁 `resume` | 새 세션 | 기존 agent의 프롬프트/cwd 재사용 |
| 🔂 `reopen` | 기존 세션 | 세션 ID 유지, transcript 컨텍스트 복원 |
| ⏹ `shutdown` | — | Mailbox로 종료 요청 → agent 승인/거부 |

<details>
<summary>📊 RuntimeState 전체 필드</summary>

```typescript
runtimeState: {
  processId, launchMode, launchCommand, lifecycle, runtimeKind,
  sessionId, lastSessionId, reopenCount,
  currentWorkKind, currentTaskId, currentWorkSummary,
  turnStartedAt, lastTurnEndedAt,
  startedAt, lastHeartbeatAt, lastExitAt, lastExitReason,
  prompt, cwd, model, maxIterations, pollIntervalMs,
  codexExecutablePath, codexArgs,
  stdoutLogPath, stderrLogPath,
}
```

</details>

---

## 📨 Inter-Agent 통신

### 메시지 타입 (11종)

| 메시지 | 방향 | 용도 |
|--------|:----:|------|
| 💤 `IdleNotification` | agent → lead | 작업 완료/대기 알림 |
| ⏹ `ShutdownRequest` | lead → agent | 종료 요청 |
| ✅ `ShutdownApproved` / ❌ `Rejected` | agent → lead | 종료 응답 |
| 📋 `PlanApprovalRequest` / `Response` | agent ↔ lead | 계획 승인 |
| 🔑 `PermissionRequest` / `Response` | agent ↔ lead | 도구 권한 |
| 🌐 `SandboxPermissionRequest` / `Response` | agent ↔ lead | 네트워크 접근 |
| 📢 `TeamPermissionUpdate` | lead → all | 권한 규칙 브로드캐스트 |
| 🔧 `ModeSetRequest` | lead → agent | 권한 모드 변경 |

### 작업 우선순위

> `shutdown` → `leader message` → `peer message` → `pending task`

### 🔐 권한 시스템

```
Agent 도구 사용 → cache 확인
  ├─ allow → 즉시 실행
  ├─ deny  → 즉시 거부
  └─ miss  → team-lead에 PermissionRequest
             → 승인/거부 → --persist 시 규칙 영구 저장
```

**Permission Modes**: `default` · `plan` · `acceptEdits` · `bypassPermissions` · `auto`

---

## 🩺 Doctor 명령

```bash
agent-team doctor [--workspace <path>] [--probe] [--codex-executable <path>]
```

| # | 검증 항목 | 방법 |
|:-:|----------|------|
| 1 | Codex CLI executable | `codex --version` |
| 2 | Codex login status | `codex login status` |
| 3 | Workspace write access | probe 파일 생성/삭제 |
| 4 | Codex exec probe *(optional)* | 실제 `codex exec` 턴 (90초 타임아웃) |

---

## 🧪 테스트

> **38개 파일 · 139 tests · 0 failures**

| 레이어 | 파일수 | 주요 검증 |
|--------|:------:|-----------|
| 📁 team-core | 7 | 동시성 안전 (10병렬 mailbox, 8병렬 task), 락, 세션/transcript |
| ⚡ team-runtime | 7 | Codex CLI 브릿지, 5-agent 병렬 대화, 세션 복구, resume/reopen |
| 💻 team-cli | 10 | run 부트스트랩, attach 집계, doctor, 권한 명령 |
| 🎛 team-operator | 2 | 대시보드 집계, 백그라운드 프로세스 |
| 🖥 team-tui | 1 | 대시보드 훅 |

```bash
npm run typecheck       # TypeScript 타입 검증
npm test                # 전체 139 tests 실행
```

### 🔥 반복 Soak 테스트

```bash
npm run soak:codex -- --root-dir /tmp/agent-team-codex-soak --iterations 5
```

| 상황 | 최소 iteration |
|------|:-------------:|
| PR 전 | 1 |
| runtime/loop/session 변경 후 | 3 |
| release 전 | 5 |

---

## 🗺 모듈 의존성 그래프

```
📁 team-core/ (Foundation)
├── types · paths · file-utils · lockfile
├── team-store ──→ paths, file-utils, lockfile
├── task-store ──→ + team-store, task-status
├── mailbox-store · permission-store · transcript-store · session-store
└── mailbox-protocol · agent-state

⚡ team-runtime/ ──→ team-core
├── runtime-adapter ──→ core, in-process-runner
├── codex-cli-bridge · upstream-cli-bridge ──→ types
└── spawn-in-process ──→ core, context, adapter

🎛 team-operator/ ──→ team-core, team-cli
├── dashboard · actions ──→ core
└── background-process ──→ core

💻 team-cli/ ──→ team-core, team-runtime
├── command-registry ──→ all commands
└── commands/ ──→ core, runtime

🖥 team-tui/ ──→ team-operator, React/Ink
├── app.tsx · project-builder-app.tsx ──→ operator
└── hooks · components · modals ──→ Ink

📦 atcli/ ──→ team-cli (경량 래퍼)
```

---

## 🏛 설계 패턴

| 패턴 | 적용 |
|------|------|
| **Strategy** | `RuntimeTurnBridge`로 런타임 교체 (codex-cli / upstream / local) |
| **File-based State Machine** | JSON + 파일 락으로 DB 없이 상태 관리 |
| **Mailbox Protocol** | 구조화된 메시지 11종으로 agent 간 통신 |
| **Background Process** | detached child process로 TUI 독립 실행 |
| **Polling Dashboard** | 500ms~1s 파일 시스템 폴링 |
| **Session Recovery** | resume(새 세션) / reopen(기존 세션) 분리 |
| **DI** | CLI/TUI 모두 테스트용 의존성 주입 지원 |

---

## 🛠 빌드 & 개발

```bash
npm install            # 의존성 설치
npm run build          # TypeScript → dist/
npm run typecheck      # 타입 검증
npm test               # 전체 테스트 (139 tests)
npm link               # agent-team, atcli 바이너리 등록
```

---

## 📚 관련 문서

| 문서 | 용도 |
|------|------|
| [`AGENT.md`](AGENT.md) | 개발 핸드오프 (구현 상태, 설계 결정, 제약) |
| [`CLAUDE.md`](CLAUDE.md) | 프로젝트 컨텍스트 (AI 어시스턴트용) |
| [`docs/USER_QUICKSTART.md`](docs/USER_QUICKSTART.md) | 초보 사용자 빠른 시작 |
| [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) | 문제 해결 |
| [`docs/CLI_SMOKE.md`](docs/CLI_SMOKE.md) | CLI 검증 시나리오 |
| [`docs/TUI_SMOKE.md`](docs/TUI_SMOKE.md) | TUI 검증 시나리오 |
| [`docs/CODEX_REPEATED_SOAK.md`](docs/CODEX_REPEATED_SOAK.md) | 반복 soak 절차 |
| [`docs/PARALLEL_5_AGENT_SMOKE.md`](docs/PARALLEL_5_AGENT_SMOKE.md) | 5-agent 병렬 검증 |

---

## ⚖️ 라이선스 및 법적 고지

<img src="https://img.shields.io/badge/Non--Commercial-Educational%20%2F%20Research%20Only-d63031?style=for-the-badge" alt="Non-Commercial Educational Use Only" />

### 교육 및 연구 목적 전용

이 프로젝트는 **교육 및 연구 목적으로만** 제공됩니다.
상업적 사용, 배포, 재판매는 일체 금지됩니다.

### 원본 프로젝트 권리 고지

이 소프트웨어는 [Anthropic PBC](https://anthropic.com)의 **Claude Code** 아키텍처를 기반으로
학습 및 연구 목적에서 구축된 파생 프로젝트입니다.

- **Claude Code**의 모든 권리는 Anthropic PBC에 귀속됩니다.
- 이 프로젝트는 Anthropic의 공식 제품이 아니며, Anthropic의 후원·보증·승인을 받지 않았습니다.
- 원본 프로젝트의 라이선스: [Anthropic Legal](https://code.claude.com/docs/en/legal-and-compliance)

### 사용 허가 범위

| ✅ 허가 | 🚫 금지 |
|---------|---------|
| 개인 학습 및 연구 | 상업적 사용 |
| 학술 논문·발표 인용 | 재배포 및 재판매 |
| 비공개 수정 및 실험 | 원본 프로젝트 사칭 |
| 교육 자료 참고 | 서비스 운영 (SaaS 포함) |

### 면책 조항

이 소프트웨어는 **"있는 그대로(AS IS)"** 제공되며, 어떠한 종류의 보증도 제공하지 않습니다.
저작자는 이 소프트웨어의 사용으로 인해 발생하는 어떠한 손해에 대해서도 책임을 지지 않습니다.

자세한 내용은 [LICENSE](./LICENSE) 파일을 참조하세요.

---

<div align="center">

**Built with [Codex CLI](https://github.com/openai/codex) as the standard LLM runtime**

</div>

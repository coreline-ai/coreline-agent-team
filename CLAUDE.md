# CLAUDE.md — agent-team 프로젝트 컨텍스트

## 프로젝트 개요

`agent-team`은 기존 `claude-code/package` 내부에 있던 teammate / swarm runtime을
독립 실행형으로 분리한 **CLI 기반 multi-agent team runtime**입니다.

- **총 99개 TypeScript/TSX 소스 파일, 약 17,950 LOC**
- **테스트: 50개 파일, 191 tests pass, 0 failures**
- **프레임워크**: Node.js built-in `test` + `assert/strict`
- **TUI**: React + Ink (터미널 렌더링)
- **빌드**: TypeScript → `dist/`

---

## 핵심 설계 원칙: LLM = Codex CLI Only

이 프로젝트에서 **LLM 사용의 유일한 표준 경로는 Codex CLI subprocess**입니다.

- **표준 경로**: `codex-cli` (child_process.spawn)
- **금지 대상**: OpenAI/Anthropic 등 모든 모델의 direct API 연동
- **비목표**: API key 기반 model 호출 레이어 설계/구현
- 코드 어디에도 OpenAI/Anthropic SDK import나 HTTP API 호출이 없음

---

## 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                      사용자 진입점                            │
│  atcli.js / agent-team app / agent-team run "goal"          │
└──────────────┬──────────────────────────┬───────────────────┘
               │                          │
       ┌───────▼───────┐         ┌────────▼────────┐
       │  team-tui     │         │  team-cli       │
       │  (React/Ink)  │         │  (25+ commands) │
       └───────┬───────┘         └────────┬────────┘
               │                          │
       ┌───────▼──────────────────────────▼───────┐
       │           team-operator                   │
       │  (Dashboard, Actions, Background Process) │
       └──────────────────┬───────────────────────┘
                          │
       ┌──────────────────▼───────────────────────┐
       │           team-runtime                    │
       │  ┌─────────────────────────────────────┐  │
       │  │  RuntimeTurnBridge (Strategy Pattern)│  │
       │  │  ┌───────────┬──────────┬─────────┐ │  │
       │  │  │ codex-cli │ upstream │  local   │ │  │
       │  │  │ (표준경로) │  (대체)  │ (테스트) │ │  │
       │  │  └─────┬─────┴──────────┴─────────┘ │  │
       │  └────────┼────────────────────────────┘  │
       └───────────┼───────────────────────────────┘
                   │
       ┌───────────▼───────────────────────────────┐
       │         team-core (File-based Storage)     │
       │  team-store │ task-store │ mailbox-store   │
       │  session    │ transcript │ permission      │
       └───────────────────────────────────────────┘
```

**5개 레이어**:
1. **team-core** — 파일 기반 영속 저장소 (JSON + 파일 락)
2. **team-runtime** — agent 실행 엔진, Codex CLI 브릿지
3. **team-cli** — 25+ CLI 명령어
4. **team-operator** — 대시보드/백그라운드 프로세스 오케스트레이션
5. **team-tui** — React/Ink 터미널 UI (3가지 모드)

---

## Codex CLI 호출 상세 흐름

### RuntimeTurnBridge 인터페이스

`src/team-runtime/types.ts:166-168` — 모든 LLM 호출의 추상화:

```typescript
export type RuntimeTurnBridge = {
  executeTurn(input: RuntimeTurnInput): Promise<RuntimeTurnResult | void>
}
```

3가지 구현체:

| 구현체 | 파일 | 용도 |
|--------|------|------|
| **codex-cli** | `src/team-runtime/codex-cli-bridge.ts` | **프로덕션 표준 경로** |
| upstream | `src/team-runtime/upstream-cli-bridge.ts` | 대체 CLI (Claude CLI 등) |
| local/echo | `src/team-runtime/runtime-adapter.ts` | 테스트/목 전용 |

런타임 선택은 `createAdapterForRuntimeKind()` 팩토리에서 수행:

```typescript
export function createAdapterForRuntimeKind(config: RuntimeTeammateConfig): RuntimeAdapter {
  if (config.runtimeKind === 'codex-cli') {
    return createLocalRuntimeAdapter({
      bridge: createCodexCliRuntimeTurnBridge({ executablePath: config.codexExecutablePath }),
    })
  }
  // ... upstream, local 분기
}
```

### 전체 실행 흐름: Goal → Codex CLI → 결과 처리

```
사용자: "쇼핑몰 만들어줘"
  │
  ▼ [run command: src/team-cli/commands/run.ts]
  1. team 생성 (planner/search/frontend/backend/reviewer)
  2. 각 agent에 task + leader message 배정
  3. launchBackgroundAgentTeamCommand() — 각 agent를 background process로 실행
  │
  ▼ [spawnInProcessTeammate: src/team-runtime/spawn-in-process.ts]
  4. session 생성/재사용
  5. createAdapterForRuntimeKind('codex-cli')
  6. adapter.startTeammate() → 워크루프 진입
  │
  ▼ [in-process-runner: src/team-runtime/in-process-runner.ts]
  while (!abort && iterations < maxIterations):
    7. heartbeat 갱신
    8. resolveNextWorkItem() — 우선순위: shutdown > leader msg > peer msg > task
    9. buildTurnPrompt() — 프롬프트 조립
   10. bridge.executeTurn() → Codex CLI 호출
   11. 결과 처리 (task 완료, 메시지 전송, transcript 기록)
  │
  ▼ [codex-cli-bridge.ts: src/team-runtime/codex-cli-bridge.ts]
  12. child_process.spawn('codex', args) — 프로세스 생성
  13. child.stdin.write(prompt) — 프롬프트 전달
  14. stdout/stderr 캡처, exit code 대기
  15. output 파일에서 JSON 결과 파싱
```

### Codex CLI 프로세스 spawn 상세

`src/team-runtime/codex-cli-bridge.ts`의 `buildCodexCliArgs()`:

```typescript
const args = [
  'exec',                          // Codex 서브커맨드
  '-',                              // stdin에서 프롬프트 읽기
  '--color', 'never',               // 색상 없음
  '--skip-git-repo-check',          // git 검증 스킵
  '--ephemeral',                    // 일회성 세션
  '-C', cwd,                        // 작업 디렉토리
  '-o', outputPath,                 // 결과 파일 경로
  '--output-schema', schemaPath,    // JSON 스키마 검증
]
if (model) args.push('-m', model)   // 모델 선택
if (codexArgs) args.push(...codexArgs)  // 추가 인자 (예: --full-auto)
```

프로세스 I/O:
```typescript
const child = spawn(executablePath, args, {
  cwd: config.cwd,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: process.env,
})

child.stdin.write(input.prompt)   // 프롬프트 전달
child.stdin.end()                  // EOF 시그널

// stdout/stderr 캡처
child.stdout.on('data', chunk => { stdout += String(chunk) })
child.stderr.on('data', chunk => { stderr += String(chunk) })

// 완료 대기
const exitCode = await new Promise((resolve, reject) => {
  child.on('error', reject)
  child.on('close', code => resolve(code ?? 1))
})
```

### 프롬프트 조립 구조

`src/team-runtime/runtime-adapter.ts`의 `buildTurnPrompt()`:

```
# Session Context
Session ID: uuid-123
Reopened: no

# Recent Transcript Context
[최근 8턴의 대화 히스토리 — getRecentTranscriptContext()]

# Agent Team Work Item
Team: shopping-mall-demo
Teammate: frontend

## Base Instructions
[역할별 커스텀 프롬프트 — config.prompt]

## Current Work
Task #5: Implement the frontend application
[태스크 subject + description]
```

### Codex CLI 응답 JSON 스키마

`buildCodexOutputSchema()` — `--output-schema` 플래그로 Codex에 전달:

```json
{
  "type": "object",
  "properties": {
    "summary":           { "type": ["string", "null"] },
    "assistantResponse": { "type": ["string", "null"] },
    "assistantSummary":  { "type": ["string", "null"] },
    "sendTo":            { "type": ["string", "null"] },
    "taskStatus":        { "enum": ["pending", "in_progress", "completed", null] },
    "completedTaskId":   { "type": ["string", "null"] },
    "completedStatus":   { "enum": ["resolved", "blocked", "failed", null] },
    "failureReason":     { "type": ["string", "null"] },
    "stop":              { "type": ["boolean", "null"] },
    "shutdown": {
      "properties": {
        "approved": { "type": ["boolean", "null"] },
        "reason":   { "type": ["string", "null"] }
      }
    }
  }
}
```

### 응답 파싱 및 폴백

```typescript
// 1차: output 파일에서 읽기 (-o 플래그)
let lastMessage = await readFile(outputPath, 'utf8')

// 2차: output 파일 없으면 stdout으로 폴백
if (!lastMessage) lastMessage = stdout.trim()

// JSON 파싱 시도
try {
  return JSON.parse(lastMessage) as RuntimeTurnResult
} catch {
  // 파싱 실패 → 텍스트 그대로 assistantResponse로 래핑
  return {
    summary: `Codex CLI completed turn`,
    assistantResponse: lastMessage.trim(),
    assistantSummary: lastMessage.trim().slice(0, 120),
  }
}
```

에러 핸들링:
```typescript
// exit code ≠ 0 또는 빈 출력 → fallback bridge 시도
if (result.exitCode !== 0 || result.lastMessage.length === 0) {
  if (options.fallbackBridge) {
    return options.fallbackBridge.executeTurn(input)
  }
  return { summary: 'Codex CLI failed', failureReason: result.stderr, idleReason: 'failed' }
}
```

### Codex CLI 설정 옵션

| 옵션 | CLI 플래그 | 설명 |
|------|-----------|------|
| 런타임 | `--runtime codex-cli` | Codex CLI 사용 |
| 모델 | `--model gpt-5.4-mini` | `-m` 플래그로 전달 |
| 실행 파일 | `--codex-executable /path/to/codex` | 커스텀 경로 |
| 추가 인자 | `--codex-arg --full-auto` | Codex에 추가 플래그 |
| 반복 횟수 | `--max-iterations 50` | 워크루프 최대 턴 |
| 폴링 간격 | `--poll-interval 500` | 작업 확인 간격 (ms) |

기본 Codex 인자: `['--full-auto']` (run 명령 기본값)

---

## 모듈별 상세 구조

### team-core (14파일, ~2,500 LOC) — 데이터 레이어

파일 기반 영속 저장소. JSON 파일 + proper-lockfile로 동시성 안전 보장.

| 파일 | LOC | 역할 | 주요 함수 |
|------|-----|------|----------|
| `types.ts` | 423 | 전체 타입 정의 | TeamFile, TeamMember, TeamTask, TeamSession, 메시지 타입 23종+ |
| `paths.ts` | 236 | 저장소 경로 | getTeamDir(), getTaskListDir(), getTranscriptPath(), getInboxPath() |
| `file-utils.ts` | 141 | 파일 I/O | ensureDir(), readJsonFile(), writeJsonFile(), writeFileAtomically() |
| `lockfile.ts` | 47 | 파일 락 | lockFile(), withFileLock() — 20회 재시도, 5-100ms 타임아웃 |
| `team-store.ts` | 413 | 팀 관리 | createTeam(), upsertTeamMember(), setMemberActive(), touchMemberHeartbeat(), listStaleMembers() |
| `task-store.ts` | 575 | 태스크 관리 | createTask(), claimTask(), updateTask(), blockTask(), unassignTeammateTasks(), getAgentStatuses() |
| `mailbox-store.ts` | 158 | 메시지 수신함 | readMailbox(), writeToMailbox(), readUnreadMessages(), markMessagesAsRead() |
| `permission-store.ts` | 404 | 권한 관리 | writePendingPermissionRequest(), resolvePermissionRequest(), getPersistedPermissionDecision() |
| `transcript-store.ts` | 137 | 대화 기록 | appendTranscriptEntry(), getRecentTranscriptContext(), buildTranscriptContext() |
| `session-store.ts` | 265 | 세션 관리 | openTeamSession(), updateTeamSessionProgress(), closeTeamSession() |
| `mailbox-protocol.ts` | 495 | 메시지 프로토콜 | 11종 메시지 타입 검증(isXxx) + 생성(createXxx) 함수 |
| `task-status.ts` | 44 | 상태 정규화 | normalizeTaskStatus(), isCompletedTaskStatus() |
| `agent-state.ts` | 133 | 에이전트 표시 | getAgentDisplayInfo(), describeAgentWorkLabel() |
| `index.ts` | 13 | 배럴 익스포트 | 전체 모듈 re-export |

#### 디렉토리 구조

```
{root-dir}/                              (기본: ~/.agent-team 또는 --root-dir)
├── teams/{sanitized-team-name}/
│   ├── config.json                      ← TeamFile (팀 메타데이터, 멤버 배열)
│   ├── .lock                            ← 파일 락
│   ├── inboxes/
│   │   ├── {agent-name}.json            ← 메시지 수신함 (TeammateMessage[])
│   │   └── team-lead.json
│   ├── permissions/
│   │   ├── pending/{requestId}.json     ← 대기중 권한 요청
│   │   ├── resolved/{requestId}.json    ← 처리된 권한 요청
│   │   └── .lock
│   ├── sessions/
│   │   └── {agent-name}.json            ← 세션 이력 (TeamSessionState)
│   ├── transcripts/
│   │   └── {agent-name}.json            ← 대화 기록 (TeamTranscriptEntry[])
│   └── logs/
│       ├── {agent-name}.stdout.log      ← worker stdout
│       └── {agent-name}.stderr.log      ← worker stderr
├── tasks/{sanitized-team-name}/
│   ├── .highwatermark                   ← 태스크 ID 할당 추적
│   ├── {id}.json                        ← 개별 태스크 (TeamTask)
│   └── .lock
└── workspaces/{sanitized-team-name}/    ← 기본 작업 결과물 디렉토리
    ├── docs/
    ├── frontend/
    ├── backend/
    └── .agent-team/
        └── run.json                     ← 실행 메타데이터
```

### team-runtime (9파일, ~2,900 LOC) — 실행 레이어

| 파일 | LOC | 역할 |
|------|-----|------|
| `types.ts` | 168 | RuntimeTeammateConfig, RuntimeWorkItem, RuntimeTurnBridge, RuntimeLoopResult |
| `in-process-runner.ts` | 977 | **핵심 워크루프** — 폴링/태스크 claim/턴 실행/idle 알림/권한 요청 처리 |
| `runtime-adapter.ts` | 523 | 런타임 팩토리, 프롬프트 조립(buildTurnPrompt), 결과 정규화, 어댑터 생성 |
| `codex-cli-bridge.ts` | 220 | **Codex CLI 프로세스 spawn**, 인자 빌드, I/O 캡처, JSON 파싱 |
| `upstream-cli-bridge.ts` | 358 | 대체 CLI 브릿지 (Claude CLI 등), JSON 파싱/정규화 |
| `spawn-in-process.ts` | 173 | agent 생성, 세션 관리, lifecycle 핸들 (stop/join) |
| `context.ts` | 42 | AsyncLocalStorage 기반 런타임 컨텍스트 (agentId, teamName, abort) |
| `prompt/team-context.ts` | 30 | renderTeamContextPrompt() — 팀 컨텍스트 시스템 프롬프트 |
| `index.ts` | 9 | 배럴 익스포트 |

#### 워크루프 상세 (in-process-runner.ts)

```
runInProcessTeammate() — 메인 루프
  while (!abortSignal.aborted && iterations < maxIterations):
    runInProcessTeammateOnce():
      1. touchMemberHeartbeat() — heartbeat 갱신
      2. resolveNextWorkItem() — 다음 작업 선택
         우선순위: shutdown > leader_message > peer_message > task
      3. 작업 없음 → idle notification 전송
      4. 작업 있음 → buildTurnPrompt() → executeTrackedTurn()
         - bridge.executeTurn() 호출 (Codex CLI 실행)
         - 결과를 normalizeTurnResultForWorkItem()으로 정규화
      5. task 완료 시 → updateTask(), unassign
      6. 메시지 응답 시 → writeToMailbox() (sendTo 대상)
      7. transcript 기록 → appendTranscriptEntry()
      8. idle notification 전송 → summary, completedTaskId
    iterations += 1
    sleep(pollIntervalMs)
```

### team-cli (39파일, ~4,500 LOC) — CLI 명령어

#### 명령어 전체 목록

| 명령어 | 파일 | LOC | 용도 |
|--------|------|-----|------|
| `app` | `commands/app.tsx` | — | 대화형 프로젝트 빌더 TUI |
| `run` | `commands/run.ts` | 549 | **소프트웨어 팩토리 프리셋 부트스트랩** |
| `doctor` | `commands/doctor.ts` | 308 | 환경 검증 (Codex CLI 설치/로그인/실행) |
| `init` | `commands/init.ts` | — | 팀 생성 |
| `spawn` | `commands/spawn.ts` | — | agent 생성 |
| `resume` | `commands/resume.ts` | — | agent 재개 (새 세션) |
| `reopen` | `commands/reopen.ts` | — | agent 재시작 (기존 세션) |
| `shutdown` | `commands/shutdown.ts` | — | agent 종료 요청 |
| `attach` | `commands/attach.ts` | 331 | 팀 상태/결과 요약 |
| `watch` | `commands/watch.tsx` | — | 읽기 전용 모니터링 TUI |
| `tui` | `commands/tui.tsx` | — | 대화형 제어 TUI |
| `status` | `commands/status.ts` | — | teammate 상태 상세 |
| `tasks` | `commands/tasks.ts` | — | 태스크 목록 |
| `task-create` | `commands/task-create.ts` | — | 태스크 생성 |
| `task-update` | `commands/task-update.ts` | — | 태스크 상태 변경 |
| `transcript` | `commands/transcript.ts` | — | 대화 기록 조회 |
| `send` | `commands/send.ts` | — | leader 메시지 전송 |
| `permissions` | `commands/permissions.ts` | — | 권한 요청 목록 |
| `approve-permission` | `commands/approve-permission.ts` | — | 권한 승인 |
| `deny-permission` | `commands/deny-permission.ts` | — | 권한 거부 |
| `approve-sandbox` | `commands/approve-sandbox.ts` | — | 샌드박스 승인 |
| `deny-sandbox` | `commands/deny-sandbox.ts` | — | 샌드박스 거부 |
| `approve-plan` | `commands/approve-plan.ts` | — | 플랜 승인 |
| `reject-plan` | `commands/reject-plan.ts` | — | 플랜 거부 |
| `set-mode` | `commands/set-mode.ts` | — | 권한 모드 변경 |
| `cleanup` | `commands/cleanup.ts` | — | 비활성 팀/멤버 정리 |

#### 지원 파일

| 파일 | LOC | 역할 |
|------|-----|------|
| `arg-parsers.ts` | 877 | 모든 명령의 인자 파싱 (parseGlobalOptions, parseRunArgs, parseSpawnArgs 등) |
| `command-registry.ts` | 436 | 명령어 → 핸들러 매핑, getCliCommandHandler() |
| `run-cli.ts` | 27 | CLI 진입점, runCli() |
| `bin.ts` | 5 | 실행 파일 진입점 |
| `summary-utils.ts` | 306 | 출력 포맷팅 유틸 |
| `permission-response.ts` | 174 | 권한 응답 처리 |
| `soak/codex-repeated-soak.ts` | 810 | 반복 soak 스트레스 테스트 |

### team-operator (6파일, ~960 LOC) — 오케스트레이션

| 파일 | LOC | 역할 |
|------|-----|------|
| `types.ts` | 174 | TeamListItem, TeamDashboard, 입력 타입 |
| `dashboard.ts` | 283 | loadTeamsList(), loadTeamDashboard(), buildDashboardActivityItems() |
| `actions.ts` | 513 | createTeamOperator(), spawnTrackedTeammate(), sendLeaderMessage() 등 래핑 |
| `background-process.ts` | 280 | **launchBackgroundAgentTeamCommand()**, detached 프로세스 spawn, log 리다이렉션 |
| `polling.ts` | 37 | createPollingHandle() — 비동기 폴링 유틸 |
| `index.ts` | 5 | 배럴 익스포트 |

#### 백그라운드 프로세스 실행

`background-process.ts`의 `launchBackgroundAgentTeamCommand()`:
- agent-team CLI를 detached child process로 spawn
- `AGENT_TEAM_LAUNCH_MODE=detached` 환경변수 설정
- stdout/stderr를 로그 파일로 리다이렉션
- PID 추적, 부모 TUI 종료 후에도 계속 실행

### team-tui (20파일, ~2,800 LOC) — 터미널 UI

#### 3가지 UI 모드

| 모드 | 진입 | 파일 | 용도 |
|------|------|------|------|
| **Project Builder** | `atcli` / `agent-team app` | `project-builder-app.tsx` (874L) | goal 입력 → 자동 팀 부트스트랩 → 모니터링 |
| **Control TUI** | `agent-team tui [team]` | `app.tsx` (837L) | 대화형 팀 관리. team을 생략하면 multi-team picker / overview부터 시작 |
| **Watch** | `agent-team watch <team>` | `commands/watch.tsx` | 읽기 전용 모니터링 |

#### TUI 컴포넌트

| 파일 | 역할 |
|------|------|
| `components/layout.tsx` | Panel, TabLabel, KeyHint 기본 레이아웃 |
| `components/status-bar.tsx` | 팀 이름, 포커스 모드, 승인 카운트 |
| `components/tasks-pane.tsx` | 태스크 목록 + 상태 카운트 + 런타임 라벨 |
| `components/teammates-pane.tsx` | agent 상태 표시 + 상태 인디케이터 |
| `components/activity-feed.tsx` | 최근 메시지 스트림 |
| `components/transcript-drawer.tsx` | 선택한 agent의 대화 기록 |
| `components/help-overlay.tsx` | 키보드 단축키 레퍼런스 |
| `modals/spawn-modal.tsx` | agent 생성 다이얼로그 |
| `modals/task-create-modal.tsx` | 태스크 생성 다이얼로그 |
| `modals/send-message-modal.tsx` | 메시지 작성 다이얼로그 |
| `modals/approval-modal.tsx` | 승인/거부 다이얼로그 |

#### TUI 키보드 단축키

| 키 | 동작 |
|----|------|
| `Tab` | Tasks ↔ Teammates 패인 전환 |
| `↑/↓` | 항목 탐색 |
| `←/→` | 상세 탭 전환 (activity ↔ transcript) |
| `Enter` | 선택/확인 |
| `Escape` | 포커스 해제/모달 닫기 |
| `f` | 포커스 모드 순환: none → primary → detail |
| `s` | agent 생성 모달 |
| `t` | 태스크 생성 모달 |
| `m` | 메시지 전송 모달 |
| `a` | 승인 모달 |
| `u` | agent resume |
| `x` | agent shutdown |
| `r` | 대시보드 새로고침 |
| `?` | 도움말 오버레이 |
| `q` | 종료 |

#### 레이아웃 모드

| 터미널 너비 | 레이아웃 |
|------------|---------|
| > 120 cols | Wide — 좌우 패인 + 하단 상세 |
| 90-120 cols | Compact — 좌우 패인 + 하단 상세 |
| < 90 cols | Narrow — 세로 스택 + 포커스 토글 |

#### Project Builder 입력 처리

```
일반 텍스트:
  - 프로젝트 시작 전: goal로 사용 → 팀 부트스트랩
  - 프로젝트 시작 후: 'planner'에게 follow-up 메시지 전송

/to <agent> <message>:
  - 특정 teammate로 라우팅

/doctor:
  - 환경 점검 실행

/quit:
  - 종료
```

### atcli (2파일, ~30 LOC) — 경량 래퍼

| 파일 | 역할 |
|------|------|
| `bin.ts` | team-cli 래핑 진입점 |
| `forwarded-args.ts` | atcli 인자 → team-cli 인자 변환, 명령 없으면 `app`으로 라우팅 |

---

## Agent 생명주기

### 상태 머신

```
                    spawn
                      │
                      ▼
              ┌──────────────┐
              │   idle       │ ◄──── 작업 없음
              └──────┬───────┘
                     │ work item 발견
                     ▼
              ┌──────────────┐
              │ executing-   │ ◄──── Codex CLI 프로세스 실행 중
              │ turn         │       (heartbeat 갱신 중)
              └──────┬───────┘
                     │ 턴 완료
                     ▼
              ┌──────────────┐
              │  settling    │ ◄──── 5초간 안정화 대기
              └──────┬───────┘
                     │
            ┌────────┴────────┐
            ▼                 ▼
    다음 작업 있음        작업 없음
    → executing-turn     → idle

    ※ 15초+ heartbeat 없음 → stale (stuck 의심)
```

### 생명주기 전환 명령

| 명령 | 세션 | 동작 |
|------|------|------|
| **spawn** | 새 세션 생성 | 새 agent 생성, 프롬프트/cwd/런타임 지정 |
| **resume** | 새 세션 생성 | 기존 agent의 프롬프트/cwd 재사용, 새 세션 시작 |
| **reopen** | 기존 세션 재사용 | 기존 세션 ID 유지, transcript 컨텍스트 복원 |
| **shutdown** | — | mailbox로 종료 요청 → agent가 승인/거부 |

### RuntimeState 주요 필드

```typescript
runtimeState: {
  // 실행 정보
  processId: string
  launchMode: 'attached' | 'detached'
  launchCommand: 'spawn' | 'resume' | 'reopen'
  lifecycle: 'bounded'
  runtimeKind: 'local' | 'codex-cli' | 'upstream'

  // 세션
  sessionId: string
  lastSessionId: string
  reopenCount: number

  // 작업 추적
  currentWorkKind: 'task' | 'leader_message' | 'peer_message' | 'shutdown_request'
  currentTaskId: string
  currentWorkSummary: string
  turnStartedAt: number
  lastTurnEndedAt: number

  // 상태
  startedAt: number
  lastHeartbeatAt: number
  lastExitAt: number
  lastExitReason: string

  // 설정
  prompt: string
  cwd: string
  model: string
  maxIterations: number
  pollIntervalMs: number
  codexExecutablePath: string
  codexArgs: string[]
  stdoutLogPath: string
  stderrLogPath: string
}
```

---

## Software Factory 프리셋

`run` 명령 실행 시 자동 부트스트랩되는 5-agent 팀:

```
                    ┌──────────┐
                    │ planner  │ → docs/plan.md, architecture.md, task-breakdown.md
                    └────┬─────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
   ┌──────────┐  ┌──────────┐  ┌──────────┐
   │  search  │  │ frontend │  │ backend  │
   └────┬─────┘  └────┬─────┘  └────┬─────┘
        │              │              │
        │  docs/       │  frontend/   │  backend/
        │  research.md │  scaffold    │  scaffold + backend-api.md
        │              │              │
        └──────────────┼──────────────┘
                       ▼
                ┌──────────┐
                │ reviewer │ ← 4개 agent 완료 후 실행 (blockedBy 의존성)
                └──────────┘
                docs/review.md
```

각 agent는 **독립 Codex CLI background process**로 병렬 실행. 기본 인자: `['--full-auto']`.

---

## Inter-Agent 통신 프로토콜

### 11종 메시지 타입

| 메시지 | 방향 | 용도 |
|--------|------|------|
| `IdleNotificationMessage` | agent → lead | 작업 완료/대기 상태 알림 |
| `ShutdownRequestMessage` | lead → agent | 종료 요청 |
| `ShutdownApprovedMessage` | agent → lead | 종료 승인 |
| `ShutdownRejectedMessage` | agent → lead | 종료 거부 |
| `PlanApprovalRequestMessage` | agent → lead | 실행 계획 승인 요청 |
| `PlanApprovalResponseMessage` | lead → agent | 계획 승인/거부 |
| `PermissionRequestMessage` | agent → lead | 도구 사용 권한 요청 |
| `PermissionResponseMessage` | lead → agent | 권한 승인/거부 |
| `SandboxPermissionRequestMessage` | agent → lead | 네트워크 접근 권한 요청 |
| `SandboxPermissionResponseMessage` | lead → agent | 네트워크 접근 승인/거부 |
| `TeamPermissionUpdateMessage` | lead → all | 권한 규칙 브로드캐스트 |
| `ModeSetRequestMessage` | lead → agent | 권한 모드 변경 |

### 작업 우선순위 (resolveNextWorkItem)

```
1. shutdown request (최우선)
2. leader message
3. peer message
4. pending task (미배정 태스크 claim)
```

### 권한 시스템

**Permission Request Lifecycle**:
1. Agent가 도구 사용 시 권한 필요 → pending request 생성
2. Persisted decision cache 확인 → 일치하면 즉시 반환
3. 캐시 없으면 → team-lead mailbox에 PermissionRequestMessage 전송
4. Leader가 승인/거부 → PermissionResponseMessage 반환
5. `--persist` 플래그 시 규칙 영구 저장 (이후 자동 적용)

**Rule Matching**: toolName, inputContains, commandContains, cwdPrefix, pathPrefix, hostEquals 조건. 가장 구체적인(specificity 높은) 규칙 우선.

**Permission Modes**: `default` | `plan` | `acceptEdits` | `bypassPermissions` | `auto`

---

## Doctor 명령 (환경 검증)

`agent-team doctor [--workspace <path>] [--probe] [--codex-executable <path>]`

4단계 검증:
1. **Codex CLI executable** — `codex --version` 실행
2. **Codex login status** — `codex login status` 확인
3. **Workspace write access** — probe 파일 생성/삭제
4. **Codex exec probe** (optional) — 실제 `codex exec` 턴 실행 ("Reply with exactly READY", 90초 타임아웃)

정상: `Result: READY` 출력

---

## 테스트 구조

### 레이어별 분포

| 레이어 | 파일수 | 주요 검증 |
|--------|--------|-----------|
| team-core | 7 | 동시성 안전 (10병렬 mailbox, 8병렬 task), 락 안전성, 세션/transcript CRUD |
| team-runtime | 7 | Codex CLI 브릿지, 5-agent 병렬 대화, 세션 복구, resume/reopen |
| team-cli | 10 | run 부트스트랩, attach 상태 집계, doctor 검증, 권한 명령 |
| team-operator | 2 | 대시보드 집계, 백그라운드 프로세스 |
| team-tui | 1 | 대시보드 훅 |

### 실행

```bash
npm run typecheck   # TypeScript 타입 검증
npm test            # 전체 191 tests
```

서브셋 실행:
```bash
node --test dist/tests/team-runtime/recovery.test.js
node --test dist/tests/team-cli/run-command.test.js
```

### 반복 Soak 테스트

```bash
npm run soak:codex -- --root-dir /tmp/agent-team-codex-soak --iterations 5
npm run soak:codex:check -- --summary /tmp/agent-team-codex-soak/soak-artifacts/latest-summary.json --gate runtime
npm run soak:codex:check -- --history /tmp/agent-team-codex-soak/soak-artifacts/history.json --run-label runtime-rc-20260405 --gate runtime
```

Burn-in 규칙:
- PR 전: 1 iteration
- runtime/loop/session 변경 후: 3 iterations
- release 전: 5 iterations

결과: `{root-dir}/soak-artifacts/latest-summary.json`, `summary-*.json`, `history.json`

---

## 모듈 의존성 그래프

```
index.ts
├── team-core/ (Foundation)
│   ├── types.ts
│   ├── paths.ts, file-utils.ts, lockfile.ts
│   ├── team-store.ts → paths, file-utils, lockfile
│   ├── task-store.ts → paths, file-utils, lockfile, team-store, task-status
│   ├── mailbox-store.ts → paths, file-utils, lockfile
│   ├── permission-store.ts → paths, file-utils, lockfile, team-store
│   ├── transcript-store.ts → paths, file-utils, lockfile
│   ├── session-store.ts → paths, file-utils, lockfile
│   ├── mailbox-protocol.ts → types
│   ├── task-status.ts → types
│   └── agent-state.ts → types
│
├── team-runtime/ → team-core
│   ├── types.ts → core/types
│   ├── context.ts (AsyncLocalStorage)
│   ├── runtime-adapter.ts → core, types, in-process-runner
│   ├── spawn-in-process.ts → core, context, runtime-adapter
│   ├── in-process-runner.ts → core, types
│   ├── codex-cli-bridge.ts → types
│   ├── upstream-cli-bridge.ts → types
│   └── prompt/team-context.ts
│
├── team-operator/ → team-core, team-cli
│   ├── dashboard.ts → core
│   ├── actions.ts → core, cli
│   └── background-process.ts → core
│
├── team-cli/ → team-core, team-runtime
│   ├── arg-parsers.ts → core/types
│   ├── command-registry.ts → all commands
│   ├── commands/ → core, runtime
│   └── soak/ → core, runtime
│
├── team-tui/ → team-operator, team-core, React/Ink
│   ├── app.tsx → operator, core
│   ├── project-builder-app.tsx → operator, core
│   ├── hooks/ → operator, core
│   ├── components/ → Ink/React
│   └── modals/ → Ink/React
│
└── atcli/ → team-cli (경량 래퍼)
```

---

## 진입점 요약

| 바이너리 | 소스 | 설명 |
|----------|------|------|
| `bun atcli.js` | `atcli.js` | 직접 실행, app 모드 기본 |
| `atcli` | `src/atcli/bin.ts` | npm link 후 사용, app 모드 기본 |
| `agent-team` | `src/team-cli/bin.ts` | 전체 CLI, 서브커맨드 필수 |

package.json 설정:
```json
{
  "bin": {
    "agent-team": "dist/src/team-cli/bin.js",
    "atcli": "dist/src/atcli/bin.js"
  }
}
```

---

## 핵심 설계 패턴

1. **Strategy Pattern** — RuntimeTurnBridge로 런타임 교체 가능 (codex-cli/upstream/local)
2. **File-based State Machine** — JSON + 파일 락으로 DB 없이 모든 상태 관리
3. **Mailbox Protocol** — 구조화된 메시지 11종으로 agent 간 통신
4. **Background Process Model** — detached child process로 TUI 독립 실행
5. **Polling Dashboard** — 500ms~1s 간격으로 파일 시스템 폴링
6. **Session Recovery** — resume(새 세션)/reopen(기존 세션) 분리
7. **Dependency Injection** — CLI/TUI 모두 테스트용 의존성 주입 지원

---

## 빌드 & 개발

```bash
npm install        # 의존성 설치
npm run build      # TypeScript 빌드 → dist/
npm run typecheck  # 타입 검증
npm test           # 전체 테스트
npm link           # agent-team, atcli 바이너리 등록
```

---

## 관련 문서

| 문서 | 용도 |
|------|------|
| `AGENT.md` | 개발 핸드오프 문서 (구현 상태, 설계 결정, 제약) |
| `docs/USER_QUICKSTART.md` | 초보 사용자 빠른 시작 |
| `docs/TROUBLESHOOTING.md` | 문제 해결 |
| `docs/CLI_SMOKE.md` | CLI 검증 시나리오 |
| `docs/TUI_SMOKE.md` | TUI 검증 시나리오 |
| `docs/CODEX_REPEATED_SOAK.md` | 반복 soak 절차 |
| `docs/PARALLEL_5_AGENT_SMOKE.md` | 5-agent 병렬 검증 |
| `dev-plan/` | 개발 계획 (Phase 1-3 완료) |

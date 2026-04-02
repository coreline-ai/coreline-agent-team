# Agent Team Extraction Targets

## 개요

아래 목록은 현재 `claude-code/package/sourcemap-extracted/src` 기준으로
`agent-team`으로 추출할 때 참고할 대상 파일 정리다.

목표는 한 번에 전부 옮기는 것이 아니라,
`team-core -> team-runtime -> team-cli` 순서로 안전하게 분리하는 것이다.

## 1차 추출 대상: `team-core`

| 현재 소스 파일 | 제안 목적지 | 처리 방식 | 메모 |
|---|---|---|---|
| `utils/swarm/teamHelpers.ts` | `src/team-core/team-store.ts` | 추출 + 단순화 | 팀 파일 읽기/쓰기, 멤버 관리 위주로 축소 |
| `utils/teammateMailbox.ts` | `src/team-core/mailbox-store.ts` | 추출 + 일반화 | 제품 inbox attachment 로직은 제외 |
| `utils/tasks.ts` | `src/team-core/task-store.ts` | 추출 + 분리 | AppState signal, env/session fallback 제거 |
| `utils/swarm/backends/types.ts` | `src/team-core/types.ts` | 부분 복사 | backend type, teammate identity 일부만 유지 |
| `utils/tasks.ts` 의 `sanitizePathComponent` | `src/team-core/paths.ts` | 이동 | 경로 규칙을 core로 고정 |

## 2차 추출 대상: `team-runtime`

| 현재 소스 파일 | 제안 목적지 | 처리 방식 | 메모 |
|---|---|---|---|
| `utils/teammateContext.ts` | `src/team-runtime/context.ts` | 거의 그대로 이동 | AsyncLocalStorage 기반 컨텍스트 |
| `utils/swarm/spawnInProcess.ts` | `src/team-runtime/spawn-in-process.ts` | 추출 + AppState 의존 제거 | task 등록 로직은 runtime state adapter로 분리 |
| `utils/swarm/inProcessRunner.ts` | `src/team-runtime/in-process-runner.ts` | 어댑터 기반 재작성 | 가장 결합도가 높은 파일 |
| `tools/shared/spawnMultiAgent.ts` | `src/team-runtime/spawn-service.ts` | 분해 | backend 선택과 spawn orchestration 분리 |
| `utils/attachments.ts` 의 team context 부분 | `src/team-runtime/prompt/team-context.ts` | 발췌 | 첫 턴 prompt 계약 유지 |
| `utils/messages.ts` 의 team context formatting | `src/team-runtime/prompt/render-team-context.ts` | 발췌 | 시스템 프롬프트 텍스트 유지 |

## 3차 추출 대상: API/CLI 레이어

| 현재 소스 파일 | 제안 목적지 | 처리 방식 | 메모 |
|---|---|---|---|
| `tools/TeamCreateTool/TeamCreateTool.ts` | `src/team-cli/commands/init.ts` | 개념 이식 | tool이 아닌 CLI/API 호출로 재구성 |
| `tools/TaskCreateTool/TaskCreateTool.ts` | `src/team-cli/commands/task-create.ts` | 개념 이식 | hooks는 분리 판단 필요 |
| `tools/TaskListTool/TaskListTool.ts` | `src/team-cli/commands/task-list.ts` | 개념 이식 | 출력 포맷만 CLI에 맞게 변경 |
| `tools/TaskUpdateTool/TaskUpdateTool.ts` | `src/team-cli/commands/task-update.ts` | 개념 이식 | verification nudge는 후순위 |
| `tools/SendMessageTool/SendMessageTool.ts` | `src/team-cli/commands/send.ts` | 분해 | broadcast / structured message는 단계적 이식 |

## 당장 제외할 대상

| 현재 소스 파일 | 이유 |
|---|---|
| `main.tsx` | 앱 부트스트랩과 UI 초기화가 뒤섞여 있음 |
| `utils/agentSwarmsEnabled.ts` | 제품 플래그와 GrowthBook에 결합 |
| `utils/swarm/backends/registry.ts` | tmux / iTerm 감지와 fallback 정책 포함 |
| `utils/swarm/teammateLayoutManager.ts` | pane UI 배치 책임이 커서 1차 범위를 넘음 |
| REPL / dialog / tasks UI 관련 컴포넌트 | headless 모듈 분리 목표와 다름 |

## 우선순위

### Phase 1

- `team-store`
- `mailbox-store`
- `task-store`
- 공용 타입과 경로 유틸

### Phase 2

- teammate context
- in-process spawn
- runtime adapter
- prompt team context

### Phase 3

- CLI 명령어
- pane backend
- 제품 UI 재연결

## 메모

`inProcessRunner.ts`와 `runAgent.ts`는 결합도가 높아서
"파일 복사"보다 "어댑터 경계 재설계"가 먼저다.

즉, 가장 빨리 성과가 나는 부분은 `team-core`를 먼저 안정화하는 것이다.

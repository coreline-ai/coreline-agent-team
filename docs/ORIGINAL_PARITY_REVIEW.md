# Original Project Parity Review

## 개요

이 문서는 `agent-team` Phase 2 구현을
원본 `claude-code/package/sourcemap-extracted`의 swarm/team 동작과 비교한 결과다.

비교 기준:

- 원본 mailbox protocol
- 원본 in-process runner
- 원본 permission sync
- 원본 reconnection / resume 흐름
- 원본 `runAgent()` 결합 수준

## 비교 요약

| 영역 | 현재 상태 | 판단 |
|---|---|---|
| mailbox structured protocol | `permission`, `sandbox`, `plan`, `shutdown`, `mode_set`, `team_permission_update` 구현 | 대체로 정합 |
| file-based task claiming / idle loop | pending task claim, idle notify, shutdown unassign 구현 | 정합 |
| Codex CLI 실행기 | subprocess bridge로 구현 | 독립 대체 구현 |
| upstream Claude CLI 실행기 | `claude -p` subprocess bridge로 구현 | 부분 정합 |
| permission round-trip | mailbox 기반 승인/거절 왕복, structured allow/deny persistence 구현 | 높은 부분 정합 |
| resume / cleanup | runtime metadata, session store, reopen, stale cleanup 구현 | 실사용 정합 / 원본 대비 축약 |
| direct `runAgent()` parity | direct import는 미구현, CLI bridge로 우회 | 갭은 있으나 실사용 가능 |
| transcript/session resume parity | transcript store, session id reopen, recent context injection 구현 | 높은 부분 정합 |
| permission update persistence parity | pending/resolved store, structured allow/deny rule persistence, auto allow/deny 구현 | 높은 부분 정합 |
| leader UI queue / tool confirm parity | 미구현 | 의도적 제외 |

## 맞춘 부분

### 1. structured mailbox message shape

원본은 아래 메시지 타입을 mailbox protocol에 올린다.

- `permission_request`
- `permission_response`
- `sandbox_permission_request`
- `sandbox_permission_response`
- `plan_approval_request`
- `plan_approval_response`
- `shutdown_request`
- `shutdown_approved`
- `shutdown_rejected`
- `team_permission_update`
- `mode_set_request`

`agent-team`도 같은 타입 계열을 `team-core`에 구현했다.

### 2. worker polling 우선순위

원본 in-process runner는 mailbox를 먼저 보고, 이후 task list fallback을 확인한다.
`agent-team`도 같은 흐름으로:

1. shutdown request
2. leader message
3. peer message
4. pending task claim

순서로 next work item을 고른다.

### 3. plan approval / shutdown round-trip

원본처럼 worker가 leader에게 approval을 요청하고,
응답을 기다린 뒤 계속 실행하거나 종료한다.

### 4. permission mailbox fallback

원본은 leader UI queue가 없을 때 mailbox fallback을 사용한다.
`agent-team`은 Phase 2에서 이 fallback 경로를 직접 구현한 셈에 가깝다.

## 축약되었지만 동작하는 부분

### 1. Codex CLI bridge

원본은 `runAgent()` 중심으로 teammate를 돌린다.
`agent-team`은 대신 `RuntimeTurnBridge` 위에 `Codex CLI` subprocess를 연결했다.

즉:

- 원본: in-process `runAgent()` 재사용
- 현재: headless `Codex CLI` command bridge

이건 완전 동일 구현은 아니지만,
독립 프로젝트 목표에는 더 맞는 대체 구현이다.

### 2. upstream Claude CLI bridge

직접 `runAgent()` import는 `bun:` 스킴 의존 때문에 막혀 있었지만,
현재는 원본 패키지의 `claude` CLI를 `-p --output-format json --json-schema ...`
형태로 감싼 subprocess bridge를 추가했다.

즉:

- direct `runAgent()` import parity는 아직 아님
- 하지만 원본 제품 실행 스택을 command bridge로 붙이는 우회 경로는 구현됨

이건 완전 동일성보다 **실행 가능한 완성도**를 우선한 선택이다.

### 3. resume / reopen

원본 reconnection은 transcript/session에 저장된 teammate 정보를 읽어
AppState의 `teamContext`를 복원한다.

현재 `agent-team`은 여기까지 올라왔다.

- member `runtimeState.prompt`
- `cwd`
- `runtimeKind`
- `model`
- loop option
- teammate session store
- same session id reopen
- recent transcript context reinjection

즉, 초반의 **runtime metadata resume**에서
이제는 **session reopen + transcript-aware resume**까지 올라왔다.

다만 원본 대비 아직 축약된 부분은 남아 있다.

- AppState/teamContext exact restore
- original session graph / parentSessionId parity
- full prior conversation replay

### 4. cleanup

원본은 permission pending/resolved 디렉터리, AppState task mirror,
session wiring까지 넓게 연결돼 있다.
현재 구현은 그중에서 실사용에 중요한 최소 항목만 다룬다.

- stale inactive member 감지
- orphan open task reset
- optional inactive member removal

## 아직 빠진 부분

### 1. direct `runAgent()` parity

원본 teammate는 결국 `runAgent()`를 반복 호출하면서
tool context, transcript, compaction, content replacement, custom agent prompt,
permission mode override 등을 함께 처리한다.

현재 `agent-team`은 direct import 레벨까지는 연결하지 않았다.
대신 upstream CLI bridge와 Codex CLI bridge가 같은 adapter contract 위에 올라가 있다.

빠진 효과:

- full session replay / transcript restoration parity
- compaction / content replacement parity
- leader와 동일한 tool execution pipeline
- custom agent definition parity

### 2. leader UI queue parity

원본은 permission dialog queue를 leader UI와 직접 연결할 수 있다.
현재는 mailbox 승인 command만 있다.

따라서 빠진 부분:

- worker badge가 붙은 leader tool confirm UI
- dialog 기반 approve / reject UX
- UI queue recheckPermission 흐름

### 3. permission update persistence parity

원본은 permission updates를 적용하고,
leader shared context로 다시 write-back 하며,
pending/resolved permission 저장소도 유지한다.

현재 구현은 여기까지 올라왔다.

- pending / resolved permission request file store
- team permission update persistence
- `approve-permission --persist`를 통한 allow rule 저장
- `deny-permission --persist`를 통한 deny rule 저장
- `command/cwd/path/host` 기준 structured rule 저장
- persisted rule 기반 auto-approval / auto-denial
- `permissions` CLI를 통한 pending / resolved / rules 조회

다만 아직 아래는 축약 상태다.

- original leader shared context write-back parity
- original UI queue와 완전히 같은 승인 흐름

### 4. transcript-based resume parity

원본 reconnection은 transcript/session metadata를 활용한다.
현재 구현은 여기까지 올라왔다.

- teammate transcript file persistence
- runtime session id 저장
- teammate session lifecycle file store
- `resume`와 `reopen` 시 same session id 재사용
- 다음 spawn/resume 시 recent transcript context prompt 주입
- `transcript` CLI 조회

즉, 기존의 runtime metadata-only resume에서
**recent transcript-aware reopen**까지는 올라왔다.

다만 아직 없는 것:

- full prior conversation replay
- session reopen 시 exact transcript restore
- `parentSessionId` 기반 문맥 재연결
- original AppState/teamContext restore parity

### 5. exact task list identity parity

원본은 일부 경로에서 `parentSessionId`를 task list identity로 쓴다.
현재 프로젝트는 설계상 `sanitize(teamName)`으로 단일화했다.

이건 의도적 단순화이지만, 원본과 완전히 같은 규칙은 아니다.

## 결론

현재 `agent-team`은 원본 swarm/team 기능의 핵심 중에서
**headless 협업 런타임으로 필요한 부분은 충분히 재현**했다.

특히:

- 팀 저장소
- mailbox protocol
- task claim loop
- shutdown / approval flow
- resume / cleanup 최소 운영성
- Codex CLI 실행기
- upstream CLI 실행기
- structured permission persistence

는 실제 사용 가능한 수준이다.

반면 아래는 아직 명확한 후속 과제다.

1. direct `runAgent()` import parity
2. leader UI integration
3. original AppState/teamContext parity
4. long-running real-backend soak coverage

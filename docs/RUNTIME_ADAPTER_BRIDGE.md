# Runtime Adapter Bridge

## 개요

`agent-team`의 runtime adapter는 이제 단순 `noop/mock` 수준을 넘어서
실제 loop를 구동하는 local bridge 구조를 가진다.

이번 단계에서 선택한 방식은:

- upstream `runAgent()`를 직접 import 하지 않는다.
- 대신 `RuntimeTurnBridge` 계약을 고정한다.
- `createLocalRuntimeAdapter()`가 runner를 백그라운드에서 실행한다.
- bridge가 각 work item을 실제 실행 단위로 변환한다.

이 방식은 독립 프로젝트의 목표를 유지하면서도
향후 upstream bridge를 같은 슬롯에 꽂을 수 있게 해 준다.

## 핵심 계약

| 계약 | 역할 |
|---|---|
| `RuntimeWorkItem` | runner가 선택한 실제 작업 단위 |
| `RuntimeWorkExecutorContext` | mailbox send, plan approval, runtime context 접근 |
| `RuntimeTurnInput` | bridge가 실제 실행기에게 넘길 입력 |
| `RuntimeTurnResult` | 실행 결과, 응답 메시지, task 상태 업데이트 |
| `RuntimeTeammateHandle.join()` | background loop 종료를 기다리는 lifecycle API |

## 현재 구현

### 1. `createLocalRuntimeAdapter()`

역할:

- `runInProcessTeammate()`를 background loop로 실행
- `stop()`과 `join()`을 제공
- loop 종료 후 member active 상태 정리

### 2. `RuntimeTurnBridge`

역할:

- `workItem -> prompt + context` 변환 결과를 받아 실행
- 결과로:
  - summary
  - task status 변경
  - idle/shutdown signal
  - leader 메시지 전송용 assistant response
  를 반환

### 3. `createEchoRuntimeTurnBridge()`

역할:

- Phase 1 기본 동작용 local equivalent bridge
- task, message, shutdown을 최소 규칙으로 처리

### 4. `createFunctionRuntimeTurnBridge()`

역할:

- 테스트 또는 host integration에서 함수 기반 bridge를 쉽게 주입

## direct upstream import를 지금 하지 않은 이유

| 항목 | 이유 |
|---|---|
| 결합도 | upstream `runAgent()`는 AppState, tool context, transcript 흐름과 깊게 연결됨 |
| 독립성 | `agent-team`은 headless reusable module을 목표로 함 |
| 테스트성 | local bridge는 Node test 환경에서 쉽게 검증 가능 |
| 확장성 | 나중에 upstream bridge, remote bridge, host bridge를 같은 계약에 연결 가능 |

## 다음 확장 경로

### 1. Codex CLI bridge

Phase 2 기본 대상은 `Codex CLI`다.

현재 구현:

- `RuntimeTurnBridge` 구현체로 Codex CLI subprocess를 실행
- `RuntimeTurnInput`을 Codex CLI prompt로 변환
- `-o` output file과 `--output-schema`를 사용해 structured result를 받는다
- stdout/stderr/exit status를 `RuntimeTurnResult`로 정규화한다
- subprocess 실패 시 failed result 또는 fallback bridge로 복구할 수 있다

### 2. upstream bridge

`RuntimeTurnBridge` 구현체 하나를 추가해서
`runAgent()` 또는 동등한 agent executor를 연결한다.

### 3. command bridge

외부 프로세스나 CLI를 실행해 turn 단위 결과를 받아오는 bridge를 붙일 수 있다.

### 4. host app bridge

데스크톱 앱이나 다른 orchestrator가
`executeTurn()`만 제공하면 그대로 연결 가능하다.

## 구현 완료 기준

이번 단계에서는 아래를 완료한 것으로 본다.

- stable adapter contract
- mock contract test 보강
- local real adapter 구현
- Codex CLI command bridge 구현
- plan approval / shutdown / task execution이 adapter 레벨에서 검증됨

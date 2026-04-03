# Agent Team PRD

## 문서 개요

이 문서는 `agent-team` 프로젝트의 Product Requirements Document다.

목적은 현재 `claude-code/package` 내부에 강하게 결합되어 있는
에이전트 팀 기능을 독립 실행 가능한 모듈과 CLI로 재구성하기 위한
제품 요구사항을 명확히 정의하는 데 있다.

이 PRD는 다음을 기준으로 작성되었다.

- upstream swarm / teammate 기능 분석
- 현재 `agent-team` 스캐폴드 상태
- 구현 전 갭 분석 결과
- 1차 목표를 `headless in-process agent team runtime`으로 제한한 결정
- LLM 사용 경로를 `Codex CLI` 중심으로 두고 direct API를 배제한다는 결정

## 한 줄 정의

`agent-team`은 여러 에이전트가 하나의 팀으로 협업하도록 만드는
파일 기반, headless, in-process 우선, `Codex CLI` 중심의 독립 실행 런타임이다.

## 배경

현재 upstream의 에이전트 팀 기능은 다음 요소에 걸쳐 분산되어 있다.

- CLI 부트스트랩
- REPL UI 및 AppState
- 팀 config 파일
- teammate mailbox
- shared task list
- in-process teammate runtime
- tmux / iTerm pane backend
- team context 프롬프트 주입
- permission 및 shutdown 프로토콜

이 구조는 기존 제품 안에서는 작동하지만 아래 문제가 있다.

- 팀 기능만 독립적으로 재사용하기 어렵다.
- headless 환경에서 실행하기 어렵다.
- 테스트 경계가 불분명하다.
- UI, 런타임, 저장소가 강하게 섞여 있어서 유지보수 비용이 높다.
- 다른 프로젝트에서 agent team 기능만 채택하기 어렵다.

## 문제 정의

우리가 해결하려는 문제는 아래와 같다.

1. 기존 제품 내부에 묶인 agent team 기능을 독립 모듈로 쓸 수 없다.
2. 팀 협업의 핵심 기능이 UI 및 제품 상태 구조에 과도하게 의존한다.
3. 실제로 필요한 핵심은 팀 생성, 팀원 실행, 메시지 전달, 작업 분배인데,
   현재 구조에서는 이 기능만 깔끔하게 분리되어 있지 않다.
4. 구현을 계속 upstream 코드에 얹는 방식은 복잡도만 더 높인다.
5. direct API 기반 모델 호출까지 허용하면 목적이 흐려지고 운영 제약이 커진다.

## 제품 비전

`agent-team`은 아래 조건을 만족하는 독립 런타임이 되어야 한다.

- UI 없이 실행 가능하다.
- 로컬 파일 저장소만으로 팀 상태를 유지할 수 있다.
- 여러 teammate가 하나의 shared task list를 기준으로 협업할 수 있다.
- 메시지, 작업, 승인, 종료 같은 협업 프로토콜을 안정적으로 처리할 수 있다.
- **LLM 실행은 `Codex CLI` 같은 CLI 기반 agent runtime을 통해 수행한다.**
- direct OpenAI API 또는 기타 vendor API 연동은 범위에 포함하지 않는다.

## 목표

### 1차 목표

- `team-core`를 안정적인 파일 기반 저장소 계층으로 완성한다.
- `team-runtime`을 in-process teammate lifecycle 중심으로 구현한다.
- `team-cli`를 통해 팀 생성, 실행, 메시지 전달, task 관리가 가능해야 한다.
- standalone 프로젝트로 실행과 테스트가 가능해야 한다.
- `Codex CLI` 기반 LLM 실행 경로를 표준으로 확보해야 한다.

### 2차 목표

- CLI 기반 real agent runtime adapter를 붙인다.
- structured mailbox protocol을 확장한다.
- session cleanup과 resume을 지원한다.
- pane backend나 host product integration을 후속 확장 가능하게 만든다.

## 비목표

아래 항목은 1차 범위에 포함하지 않는다.

- upstream REPL UI 재현
- tmux / iTerm pane backend 완전 이식
- GrowthBook / analytics / ant-internal 플래그 이식
- Remote bridge, UDS inbox, cross-machine messaging
- 기존 AppState UI 흐름 재현
- OpenAI/기타 vendor direct API integration

## 대상 사용자

### 1. 로컬 개발자

로컬 환경에서 여러 agent를 팀처럼 협업시켜 보고 싶은 개발자.

### 2. 런타임 통합 개발자

이후 다른 CLI, 데스크톱 앱, 서버 프로세스 위에 agent-team을 임베드하려는 개발자.

### 3. 실험용 멀티에이전트 사용자

문제 해결, 코드 수정, 검증 작업을 역할별 teammate로 나눠 병렬화하고 싶은 사용자.

## 핵심 사용자 시나리오

### 시나리오 1. 팀 생성

사용자는 새 팀을 만든다.
시스템은 팀 config와 shared task list를 초기화한다.

### 시나리오 2. teammate 실행

사용자는 `researcher`, `implementer`, `reviewer` 같은 teammate를 실행한다.
시스템은 teammate를 팀에 등록하고, 팀 task list와 mailbox를 연결한다.

### 시나리오 3. 메시지 전달

리더나 teammate는 특정 teammate 또는 팀 리더에게 메시지를 보낸다.
시스템은 mailbox에 안전하게 기록하고, 수신자는 polling 또는 runtime 루프에서 이를 소비한다.

### 시나리오 4. 태스크 기반 협업

teammate는 shared task list에서 작업을 claim하고 진행 상태를 업데이트한다.
작업 완료 또는 실패 시 리더에게 상태가 보고된다.

### 시나리오 5. 안전한 종료

리더가 shutdown 요청을 보낸다.
teammate는 승인 또는 거절 응답을 보낸다.
승인 시 런타임이 종료되고, 미해결 task는 정리된다.

## 제품 원칙

### 1. Core First

저장소와 도메인 규칙을 먼저 안정화한다.
UI나 fancy runtime보다 core correctness를 우선한다.

### 2. Headless First

UI가 없어도 팀 생성, 메시지 전달, task 협업이 가능해야 한다.

### 2-1. CLI Runtime First

LLM 사용은 `Codex CLI` 같은 CLI 기반 agent runtime을 우선한다.
direct API 연동은 이번 프로젝트의 범위 밖이며 금지한다.

### 3. Deterministic Paths

팀 관련 파일은 예측 가능한 경로 규칙으로 저장되어야 한다.

### 4. Safe Concurrency

파일 기반 저장소를 쓸 경우 락 없이 동작하도록 두지 않는다.

### 5. Explicit Contracts

identity, message protocol, task ownership, shutdown, approval 흐름은
암묵적 관습이 아니라 문서화된 계약으로 다룬다.

## 범위 정의

## Phase 1: 구현 가능한 MVP

### 포함

- 팀 생성 / 조회 / 멤버 등록
- 파일 기반 mailbox
- 파일 기반 task list
- task claim / update / complete / unblock / unassign
- in-process teammate spawn
- teammate mailbox polling loop
- idle notification
- shutdown request / approval / rejection
- plan approval request / response
- 얇은 CLI

### 제외

- pane 기반 teammate 실행
- REPL transcript UI
- leader UI permission queue
- MCP / bridge / remote transport

## 확정 설계 결정

아래 항목은 1차 구현에서 확정된 결정으로 본다.

### 저장 루트

- 기본 저장 루트는 `~/.agent-team`
- 테스트 및 임베드 환경을 위해 `rootDir` override 지원

### task list ID 규칙

- `taskListId = sanitize(teamName)`
- session ID 기반 fallback은 1차 구현에서 사용하지 않음

### teammate backend

- 1차 구현은 `in-process`만 지원

### structured protocol 범위

1차 구현에서 반드시 지원하는 structured mailbox 메시지:

- `idle_notification`
- `shutdown_request`
- `shutdown_approved`
- `shutdown_rejected`
- `plan_approval_request`
- `plan_approval_response`

후순위:

- `permission_request`
- `permission_response`
- `sandbox_permission_request`
- `sandbox_permission_response`
- `mode_set_request`
- `team_permission_update`

### permission 모델

- 1차 구현은 mailbox 기반 혹은 adapter 기반의 단순 승인 모델을 우선
- upstream leader UI bridge와 동일한 UX를 재현하는 것은 후순위

## 기능 요구사항

### FR-1. 팀 생성

시스템은 팀 이름을 받아 팀 config를 생성해야 한다.

포함 항목:

- `teamName`
- `leadAgentId`
- `createdAt`
- `members`
- optional description

성공 기준:

- 팀 파일이 생성된다.
- 기본 리더 멤버가 등록된다.
- task list 디렉토리가 초기화된다.

### FR-2. 팀 멤버 등록과 제거

시스템은 teammate를 팀에 추가, 갱신, 제거할 수 있어야 한다.

포함 항목:

- `agentId`
- `name`
- `agentType`
- `model`
- `color`
- `cwd`
- `joinedAt`
- `backendType`
- `isActive`

### FR-3. 메일박스 읽기/쓰기

시스템은 teammate별 inbox를 파일로 유지해야 한다.

요구사항:

- read
- unread read
- append write
- index 기반 read mark
- predicate 기반 read mark
- clear
- structured message parse helper

### FR-4. Task list 관리

시스템은 shared task list를 파일 기반으로 제공해야 한다.

요구사항:

- create
- list
- get
- update
- delete
- block
- claim
- agent status 조회
- unassign
- high water mark 유지

### FR-5. Task claim 규칙

task claim은 아래 규칙을 따라야 한다.

- pending 상태만 claim 가능
- owner 없는 task만 claim 가능
- unresolved blocker가 있으면 claim 불가
- agent busy check가 필요하면 다른 open task 보유 여부도 검사

### FR-6. in-process teammate 실행

시스템은 teammate를 같은 Node process 안에서 실행할 수 있어야 한다.

필요 기능:

- runtime context 생성
- team member 등록
- runtime adapter 호출
- abort / stop handle 제공

### FR-7. teammate loop

시스템은 teammate가 아래 루프를 수행할 수 있어야 한다.

1. mailbox 확인
2. shutdown 요청 우선 처리
3. leader message 우선 처리
4. 일반 peer message 처리
5. claim 가능한 task 탐색
6. agent runtime 수행
7. idle notification 전송
8. 다음 루프 대기

### FR-8. shutdown protocol

리더는 shutdown 요청을 보낼 수 있어야 한다.
teammate는 승인 혹은 거절 응답을 보낼 수 있어야 한다.

승인 시 시스템은:

- runtime stop
- 멤버 상태 정리
- 필요 시 task unassign

### FR-9. plan approval protocol

plan mode required teammate는 계획 승인을 요청할 수 있어야 한다.
리더는 승인 / 거절을 응답할 수 있어야 한다.

### FR-10. CLI

최소 CLI 명령:

- `init`
- `spawn`
- `send`
- `tasks`
- `task create`
- `task update`
- `shutdown`
- `approve-plan`
- `reject-plan`
- `status`

## 비기능 요구사항

### NFR-1. 동시성 안정성

동일 팀 내 여러 프로세스 또는 여러 teammate가 동시에 inbox / tasks를 갱신해도
데이터 손상이 없어야 한다.

### NFR-2. 예측 가능한 저장 구조

사용자는 팀 파일, inbox, task list 경로를 문서만으로 추적할 수 있어야 한다.

### NFR-3. 테스트 가능성

파일 저장소, protocol parsing, runtime loop 핵심 로직은 UI 없이 테스트 가능해야 한다.

### NFR-4. 확장 가능성

후속으로 tmux backend, remote transport, host UI를 붙일 수 있어야 한다.

### NFR-5. 장애 복구 가능성

완전한 resume은 1차 범위가 아니더라도,
적어도 팀 파일과 task list만으로 현재 상태를 재구성할 수 있어야 한다.

## 사용자 경험 요구사항

### CLI UX

- 명령은 짧고 예측 가능해야 한다.
- 에러 메시지는 현재 누락된 인자나 팀 상태를 명확히 설명해야 한다.
- 기본 출력은 사람이 읽기 쉬운 텍스트여야 한다.

### 상태 모델 UX

- teammate 상태는 최소한 `idle`, `busy`, `stopped` 수준으로 해석 가능해야 한다.
- task 상태는 `pending`, `in_progress`, `completed`로 통일한다.

## 데이터 저장 요구사항

기본 경로 규칙:

- root: `~/.agent-team`
- team file: `teams/<sanitized-team>/config.json`
- inbox: `teams/<sanitized-team>/inboxes/<sanitized-agent>.json`
- tasks: `tasks/<sanitized-team>/`
- permissions: `teams/<sanitized-team>/permissions/`

## 성공 기준

다음이 충족되면 Phase 1을 성공으로 본다.

1. 새로운 팀을 생성할 수 있다.
2. teammate를 in-process로 실행할 수 있다.
3. teammate끼리 메시지를 주고받을 수 있다.
4. teammate가 task를 자동 claim하고 진행 상태를 갱신할 수 있다.
5. shutdown / plan approval 흐름이 작동한다.
6. 모든 핵심 기능이 UI 없이 CLI와 코드만으로 테스트 가능하다.

## 측정 지표

### 기능 지표

- team init 성공률
- teammate spawn 성공률
- message delivery 성공률
- task claim 성공률
- shutdown 성공률

### 안정성 지표

- inbox/task file corruption 0건
- race condition으로 인한 task duplicate claim 0건
- graceful shutdown 이후 orphan task 최소화

### 개발 지표

- team-core unit test coverage 확보
- CLI smoke test 확보
- runtime loop e2e smoke test 확보

## 리스크

### 1. 파일 기반 저장소 경쟁 조건

락이 없으면 inbox와 task가 깨질 수 있다.

### 2. runtime adapter 과소설계

너무 빨리 real runtime을 붙이려 하면 upstream 결합이 다시 들어올 수 있다.

### 3. task ownership 규칙 불일치

owner를 `agentId`로 쓸지 `agentName`으로 쓸지 흔들리면 상태 조회와 unassign이 꼬일 수 있다.

권장:

- 내부 canonical owner는 `agentId`
- 호환성 레이어에서만 `agentName` 허용

### 4. protocol 범위 과대확장

permission, sandbox, remote bridge까지 한 번에 넣으면 구현 속도가 크게 느려진다.

### 5. cleanup 누락

종료 시 task, mailbox, 멤버 정리가 불완전하면 orphan state가 생긴다.

## 오픈 이슈

1. Phase 1에서 permission mailbox 프로토콜까지 포함할지 여부
2. resume을 Phase 1.5로 볼지 Phase 2로 볼지 여부
3. task assignment를 plain task polling으로만 갈지 explicit protocol도 넣을지 여부

## 권장 구현 우선순위

1. `team-core` 완성
2. structured mailbox protocol 최소 세트 도입
3. task claim / unassign / agent status 구현
4. runtime loop 구현
5. CLI 확장
6. real runtime adapter 연동

## 정리

`agent-team`의 제품 목표는 UI를 복제하는 것이 아니라,
에이전트 팀 협업의 본질적인 기능을 독립적인 headless 런타임으로 만드는 데 있다.

Phase 1에서는 `in-process + file-based core + structured mailbox + shared tasks`
조합을 안정적으로 완성하는 것이 가장 중요한 성공 조건이다.

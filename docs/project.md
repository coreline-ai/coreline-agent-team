# Agent Team Project

## 개요

`agent-team`은 현재 `claude-code/package` 내부에 결합되어 있는 에이전트 팀 기능을
독립 실행 가능한 모듈과 CLI 형태로 분리하는 프로젝트다.

이 프로젝트의 1차 목적은 UI와 터미널 백엔드에 덜 의존하는
"headless agent team runtime"을 만드는 것이다.
즉, 팀 생성, 팀원 스폰, 메시지 전달, 작업 관리 같은 협업 기능을
REPL 화면 없이도 실행 가능하게 만드는 것이 핵심이다.

또 하나의 중요한 목적 제약은, **LLM 사용 경로를 `Codex CLI` 기반 runtime으로 두는 것**이다.
이 프로젝트는 direct API 호출 계층을 만드는 방향이 아니라,
**CLI 기반 agent runtime을 통해 모델을 사용하는 것**을 전제로 한다.
따라서 OpenAI API나 기타 vendor API를 직접 붙이는 방향은
이번 프로젝트의 범위가 아니며 금지 대상이다.

## 관련 문서

- `docs/module-boundary.md`
- `docs/extraction-targets.md`
- `docs/PRD.md`
- `docs/TRD.md`
- `docs/DEVELOPMENT_PROGRESS.md`
- `docs/RELIABILITY_CHECKLIST.md`
- `docs/ORIGINAL_PARITY_REVIEW.md`

## 배경

현재 에이전트 팀 기능은 다음 요소에 걸쳐 분산되어 있다.

- CLI 부트스트랩과 실행 인자 해석
- AppState와 task UI
- 팀 config, mailbox, shared task list 파일 저장소
- in-process teammate 실행기
- tmux / iTerm 같은 pane backend
- prompt attachment 기반 team context 주입

이 구조는 기존 제품 안에서는 동작하지만, 기능만 따로 재사용하거나
독립적으로 테스트하고 확장하기에는 결합도가 높은 편이다.

## 프로젝트 목적

이 프로젝트는 아래 목적을 가진다.

1. 에이전트 팀 기능의 핵심 코어를 제품 UI에서 분리한다.
2. 독립 실행 가능한 라이브러리 또는 CLI 형태로 재구성한다.
3. 팀 협업 기능을 다른 환경에서도 재사용 가능하게 만든다.
4. 구조를 단순화해서 테스트, 문서화, 유지보수를 쉽게 만든다.
5. **LLM 실행 경로는 `Codex CLI` 기반 runtime을 표준으로 삼고, direct API 연동은 제외한다.**

## 1차 목표

- 팀 생성과 팀 메타데이터 관리
- teammate registry 관리
- 에이전트 간 mailbox 기반 메시지 송수신
- shared task list 생성, 조회, 업데이트
- in-process teammate spawn 및 lifecycle 관리
- headless 실행을 위한 최소 CLI 제공
- `Codex CLI` 기반 LLM 실행 경로 확보

예상 인터페이스 예시는 아래와 같다.

```bash
agent-team init
agent-team spawn researcher
agent-team send researcher "이 이슈 분석해줘"
agent-team tasks
```

## 권장 범위

1차 구현은 아래 범위에 집중한다.

- in-process 실행 모드 우선
- 파일 기반 팀 저장소 유지
- 기존 team context 개념 유지
- 최소한의 실행 로그와 상태 추적 제공
- direct API 연동은 설계 대상에서 제외

이 단계에서는 빠르게 실행 가능한 코어를 만드는 것이 중요하다.

## 당장 제외할 범위

아래 항목은 1차 범위에서 제외하거나 후순위로 둔다.

- tmux / iTerm pane backend 완전 지원
- 기존 REPL 화면과 동일한 UI 재현
- 제품 내부 analytics 의존성 이전
- GrowthBook 등 기존 제품 플래그 시스템 완전 이식
- OpenAI/기타 vendor direct API 연동

## 성공 기준

아래 조건을 만족하면 1차 목표를 달성한 것으로 본다.

- 문서 없이도 `agent-team`만으로 팀을 초기화할 수 있다.
- teammate를 headless로 실행할 수 있다.
- 팀원 간 메시지 전달과 작업 관리가 동작한다.
- 기존 제품 코드에 직접 의존하지 않는 경계가 생긴다.
- 후속으로 UI, pane backend, 외부 런타임을 붙일 수 있는 구조가 된다.

## 제안 아키텍처

프로젝트는 아래 3계층으로 나누는 방향을 권장한다.

### 1. team-core

- team config
- mailbox
- task storage
- teammate identity

### 2. team-runtime

- teammate spawn
- lifecycle
- agent runtime adapter
- message dispatch

### 3. team-cli

- init
- spawn
- send
- tasks
- status

## 정리

`agent-team`의 목적은 기존 제품 안에 묶여 있는 에이전트 팀 기능을
"독립적으로 실행 가능한 협업 런타임"으로 재구성하는 것이다.

핵심은 전체 UI를 옮기는 것이 아니라,
팀 협업의 본질적인 기능을 안정적인 코어 모듈로 추출하는 데 있다.
그리고 LLM 사용 방식은 direct API가 아니라,
**`Codex CLI` 기반 runtime 경로를 표준으로 유지하는 것**이 중요한 제약이다.

# Agent Team Constraints

이 문서는 `agent-team`을 기능 목록이 아니라 **제약, 운영 안정성, 비용 한계** 기준으로
평가하기 위한 기준 문서다.

출발점은 upstream Agent Teams 관련 관찰과 현재 `agent-team` 구현 상태를 함께 참고하되,
두 시스템의 차이를 그대로 구분해서 기록하는 것이다.

핵심 원칙:

- 이 문서는 “무엇을 할 수 있나”보다 **어디까지 안전하게 할 수 있나**를 먼저 본다.
- 모든 제약은 아래 6축 중 하나로 분류한다.
- 각 항목은 `직접 적용`, `부분 적용`, `참고 전용` 중 하나로 판정한다.
- 새 dev-plan은 이 문서를 참조해서 이번 작업이 어떤 축을 다루는지 먼저 고정한다.

## 6축 요약

| 축 | 핵심 질문 | agent-team 적용도 |
|---|---|---|
| 구조적 제한 | 팀 구조를 어디까지 허용하는가 | 직접 적용 |
| 컨텍스트 & 통신 제한 | 팀원들이 어떤 맥락과 통신 경로를 가지는가 | 직접 적용 |
| 권한 제한 | 권한이 어떻게 상속되고 어디까지 분리 가능한가 | 부분 적용 |
| 운영 안정성 제한 | 재개/종료/복구/충돌이 얼마나 안전한가 | 직접 적용, 최우선 |
| 환경 제한 | 어떤 런타임/OS/도구 조건이 필요한가 | 일부만 직접 적용 |
| 비용 제한 | 팀 규모가 커질수록 비용과 조율 오버헤드가 어떻게 늘어나는가 | 직접 적용 |

## 해석 규칙

### 직접 적용
- 현재 `agent-team`의 아키텍처나 운영 방식에 그대로 영향을 주는 제약

### 부분 적용
- 개념은 유효하지만 upstream 설명을 그대로 가져오면 오해가 생기는 제약

### 참고 전용
- upstream 환경이나 특정 제품 버전 제약처럼 `agent-team`에 바로 대응되지 않는 항목

---

## 1. 구조적 제한

### 1-1. 리더 고정
- 적용도: **직접 적용**
- 의미:
  - 팀을 대표하는 lead/leader 정체성은 고정되어 있다.
  - 현재 구조에는 **leader handoff**, **leader 승격**, **리더 교체**가 없다.
- 설계 시사점:
  - recovery/reopen/resume는 “같은 리더 기준 정합성 유지” 관점으로 봐야 한다.
  - 팀 구조 자체를 바꾸는 기능보다, 현재 리더 기준 상태 일관성이 더 중요하다.

### 1-2. 세션당 1팀
- 적용도: **부분 적용**
- upstream 관찰:
  - 한 리더 세션에서 여러 팀을 동시에 운영하지 못하는 제한이 있다.
- `agent-team` 해석:
  - `agent-team`은 여러 팀을 파일 저장소에 유지하고 목록으로 볼 수 있다.
  - 다만 한 번에 attach/tui/app로 **활성 운영하는 대상 팀은 보통 하나**다.
- 설계 시사점:
  - “저장소 차원의 multi-team 존재”와 “단일 운영 화면에서의 active team”을 구분해야 한다.

### 1-3. 중첩 팀 불가
- 적용도: **직접 적용**
- 의미:
  - teammate 아래 또 다른 팀을 두는 계층형 orchestration은 현재 범위 밖이다.
  - worker가 또 다른 agent-team orchestration을 만드는 방향은 지원하지 않는다.
- 이유:
  - 무한 재귀, 비용 폭주, 상태 추적 상실, 권한 경계 붕괴를 막기 위함이다.

### 1-4. 팀원 오케스트레이션 차단
- 적용도: **직접 적용**
- 의미:
  - teammate는 leader와 같은 orchestration 도구 표면을 가지지 않는다.
  - 팀 생성/삭제, 상위 오케스트레이션, 계층형 spawn은 현재 공개 표면이 아니다.
- 설계 시사점:
  - task 분해는 teammate 내부 자유도가 아니라 **leader가 만드는 task/mailbox 구조**로 다뤄야 한다.

---

## 2. 컨텍스트 & 통신 제한

### 2-1. 컨텍스트 윈도우 격리
- 적용도: **직접 적용**
- 의미:
  - teammate끼리 컨텍스트 윈도우를 공유하지 않는다.
  - 공용 상태는 mailbox, task list, transcript, session metadata를 통해서만 전달된다.
- 설계 시사점:
  - “서로 알고 있겠지”라는 가정은 금지한다.
  - 핵심 맥락은 메시지, task description, prompt 조립 단계에서 명시적으로 넣어야 한다.

### 2-2. 리더 히스토리 자동 미전달
- 적용도: **직접 적용**
- 의미:
  - leader와 사용자가 나눈 대화가 teammate에게 자동 fan-out되지 않는다.
  - 필요한 맥락만 선택적으로 전달된다.
- 설계 시사점:
  - bootstrap prompt 품질, follow-up routing, transcript context selection이 중요하다.
  - context loss는 기능 버그가 아니라 구조적 제약일 수 있다.

### 2-3. 메시지 기반 소통만 신뢰
- 적용도: **직접 적용**
- 의미:
  - teammate 간 실질 소통은 mailbox 메시지와 shared task state를 통해서만 이뤄진다.
  - out-of-band implicit coordination을 기대하면 안 된다.
- 설계 시사점:
  - pending task backlog보다 peer dialogue를 우선 처리하는 규칙,
    mailbox unread/mark-read semantics가 안정성 핵심이 된다.

---

## 3. 권한 제한

### 3-1. 스폰 시 권한 상속
- 적용도: **부분 적용**
- 의미:
  - spawn 시점에 runtime/permission 모드가 상속되는 성격이 강하다.
  - 팀원별 세밀한 초기 권한 정책을 바로 주기 어렵다.
- 현재 프로젝트 메모:
  - `set-mode`, permission/sandbox round-trip, persisted rule은 존재한다.
  - 따라서 “완전 불가능”보다는 **사후 조정 중심**에 가깝다.

### 3-2. 개별 설정 비용
- 적용도: **부분 적용**
- 의미:
  - 팀원별 권한 차등은 가능하더라도 운영 비용이 높을 수 있다.
- 설계 시사점:
  - 팀원별 권한 차등을 기능으로 늘리기 전에,
    어떤 권한 조합이 자주 필요한지부터 운영 패턴을 확인해야 한다.

### 3-3. permissive flag 전파 리스크
- 적용도: **부분 적용**
- 의미:
  - leader/launcher가 광범위 permission bypass 성격의 인자를 사용하면
    하위 runtime 실행에도 사실상 같은 위험이 전파될 수 있다.
- 설계 시사점:
  - “전체 완화”를 기본값으로 쓰기보다, 팀 규모와 작업 종류에 맞는 보수적 preset이 필요하다.

---

## 4. 운영 안정성 제한

이 축은 현재 `agent-team`에서 **가장 우선순위가 높은 영역**이다.

### 4-1. 세션 재개/재오픈은 가능하지만 민감하다
- 적용도: **직접 적용**
- upstream 관찰:
  - 재개가 꼬이는 경우가 있어 새 팀원을 다시 스폰하는 전략을 택하기도 한다.
- `agent-team` 해석:
  - `resume` / `reopen`은 현재 프로젝트의 핵심 기능이다.
  - 따라서 “재개 불가”가 아니라 **재개 정합성이 깨지면 가장 치명적**이다.
- 핵심 리스크:
  - stale session metadata
  - leader가 이미 종료된 worker를 여전히 active로 보는 문제
  - reopen 후 transcript/session/task 정합성 붕괴

### 4-2. 태스크 상태 지연
- 적용도: **직접 적용**
- 의미:
  - worker가 실질적으로 작업을 끝냈더라도 task 상태 반영이 늦어질 수 있다.
  - 반대로 task는 pending인데 실제로는 live turn이 진행 중일 수도 있다.
- 설계 시사점:
  - task 상태만으로 운영 판단하지 말고,
    `state=executing-turn`, `heartbeat_age`, `turn_age`를 함께 봐야 한다.
  - 사용자-facing summary/대시보드/TUI에서는 이런 상태를 공통 `effective task state`로 승격해서
    `in_progress`로 보여주는 것이 안전하다.

### 4-3. 종료가 느림
- 적용도: **직접 적용**
- 의미:
  - 장시간 tool call / subprocess turn이 끝나기 전에는 즉시 종료가 어렵다.
- 설계 시사점:
  - graceful shutdown과 forced cleanup 기준을 분리해서 봐야 한다.
  - “종료 요청 보냄”과 “실제 종료 완료”는 다른 상태다.

### 4-4. 파일 충돌
- 적용도: **직접 적용**
- 의미:
  - 여러 teammate가 같은 파일을 동시에 건드리면 덮어쓰기, 충돌, merge 비용이 발생한다.
- 설계 시사점:
  - 병렬 작업은 역할 분리보다 **파일 ownership 분리**가 더 중요하다.
  - worktree, scoped tasks, write-path rules, reviewer 단계가 중요하다.
  - 현재 `task-create` / `tasks` / `attach` / `status` / dashboard / TUI에는
    scoped path 추론, multi-area task 경고, overlapping scope 경고가 들어가 있다.

### 4-5. orphan/stale worker 정리
- 적용도: **직접 적용**
- 의미:
  - detached process 구조에서는 metadata와 실제 프로세스 상태가 어긋날 수 있다.
- 설계 시사점:
  - stale inactive member detection, orphan task cleanup, runtime metadata reconciliation이 핵심이다.

---

## 5. 환경 제한

### 5-1. upstream 환경 제한은 참고 전용
- 적용도: **참고 전용**
- 예:
  - Opus 4.6+
  - 특정 제품 버전
  - tmux/iTerm2 split pane
- 이유:
  - 현재 `agent-team`의 표준 경로는 `Codex CLI` + detached/background worker + Ink TUI다.
  - 따라서 upstream 환경 전제는 그대로 적용되지 않는다.

### 5-2. 현재 프로젝트의 실제 환경 제약
- 적용도: **직접 적용**
- 핵심 조건:
  - `Codex CLI` 실행 파일 접근 가능
  - 로그인/auth 상태 준비
  - workspace write access
  - process spawn이 가능한 OS/셸 환경
  - root-dir/workspace 경로 정합성 유지
- 설계 시사점:
  - 환경 검증은 `doctor --probe`와 smoke 문서 기준으로 본다.

---

## 6. 비용 제한

### 6-1. 토큰/턴 비용 선형 증가
- 적용도: **직접 적용**
- 의미:
  - teammate 수가 늘면 컨텍스트와 subprocess turn 비용도 거의 선형으로 증가한다.
- 설계 시사점:
  - “더 많은 teammate = 항상 더 빠름”이라는 가정은 금지한다.

### 6-2. 적정 팀 규모
- 적용도: **직접 적용**
- 운영 가이드:
  - 일반적인 실전 범위는 **3~5명**을 기본선으로 본다.
  - 그 이상은 속도보다 조율 오버헤드가 커질 수 있다.
  - 현재 `spawn`, `attach`, `status`, dashboard, TUI에는
    recommended 3~5 범위를 넘길 때 cost warning이 표시된다.

### 6-3. 수확 체감과 브로드캐스트 비용
- 적용도: **직접 적용**
- 의미:
  - 모든 teammate에게 동일 메시지를 뿌리는 전략은 비용이 크고,
    응답 정합성과 요약 비용도 늘린다.
- 설계 시사점:
  - targeted routing, ownership 기반 task 분해, 명시적 dependency가 중요하다.
  - 현재 same-message recent fan-out이 4명 이상이면 broadcast cost warning이 표시된다.

---

## dev-plan 작성 시 체크리스트

새 dev-plan을 만들 때는 최소한 아래를 먼저 적는다.

1. 이번 작업이 6축 중 어떤 축을 다루는가
2. 직접 적용 / 부분 적용 / 참고 전용을 어떻게 구분하는가
3. 운영 안정성 축에서 무엇을 강화하는가
4. 비용 축에서 팀 규모나 fan-out을 어떻게 제한하는가
5. 구조적 제한을 깨지 않고도 목표를 달성할 수 있는가

## 한 줄 결론

`agent-team`은 병렬 작업에 유용하지만,
**계층 구조 제한 + 컨텍스트 격리 + 운영 복구 민감성 + 비용 선형 증가**라는 벽을
항상 같이 고려해야 한다.

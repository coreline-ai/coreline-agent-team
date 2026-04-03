# 5-Agent 병렬 대화 시나리오 3종 테스트 결과

## 목적

기존 5-agent 병렬 smoke보다 더 높은 난이도의 시나리오에서,  
**서브 에이전트 간 대화가 실제로 오가는지**를 핵심 기준으로 검증하고 그 결과를 기록한다.

## 범위

- 5개 teammate 병렬 실행
- peer mailbox 기반 서브 에이전트 대화
- 대화 + task 처리 혼합 시나리오
- 실제 테스트 코드 기반 재현 가능한 자체 검증

## 강한 제외 범위

- direct API 호출 검증
- live `codex-cli` / upstream CLI 성능 비교
- 장시간 soak test
- semantic role routing 품질 평가

이 문서는 **병렬 대화 정합성 검증 결과**만 다룬다.  
프로젝트 원칙은 동일하게 **CLI runtime 중심 / direct API 금지**를 유지한다.

## 참조 문서

- [README.md](../README.md)
- [AGENT.md](../AGENT.md)
- [PARALLEL_5_AGENT_SMOKE.md](./PARALLEL_5_AGENT_SMOKE.md)
- [CLI_SMOKE.md](./CLI_SMOKE.md)

## 실행 일시

- `2026-04-03`

## 실행 방식

검증 경로 | 값
---|---
테스트 파일 | `tests/team-runtime/parallel-dialogue.test.ts`
실행 명령 | `npm test`
최종 결과 | `95 tests pass / 0 fail`
대화 검증 기준 | peer mailbox + transcript `work_item` 확인

## 케이스 요약

케이스 | 난이도 | 핵심 목표 | 결과
---|---|---|---
Case 1 | 중 | 5-agent ring round-trip 대화 전달 검증 | 통과
Case 2 | 중상 | fan-out / fan-in / multi-hop 대화 검증 | 통과
Case 3 | 상 | pending task backlog보다 peer dialogue가 먼저 처리되는지 검증 | 통과

---

## Case 1. Ring Round-Trip

### 목적

5개 agent가 병렬 task 처리 중 서로에게 ring message를 보내고,  
다음 agent가 ack를 되돌리는 **왕복 대화**가 실제 mailbox에 기록되는지 확인한다.

### 구성

항목 | 값
---|---
agent | `alpha`, `bravo`, `charlie`, `delta`, `echo`
task 수 | `5`
runtime | `local`
loop | `maxIterations=8`, `pollIntervalMs=10`
대화 패턴 | `ring -> ack`

### 실제 검증 기준

- task `5`개 전부 `completed`
- 각 agent mailbox에 peer message `2개`
  - 이전 agent의 `ring`
  - 다음 agent의 `ack`
- 각 agent transcript에 최소 `1개` 이상의 peer `work_item`
- 이전 agent의 `ring`이 실제로 처리된 흔적 확인

### 결과

항목 | 결과
---|---
completed task | `5 / 5`
agent별 peer mailbox | `2개`씩 확인
agent별 peer transcript | 모두 확인
왕복 대화 전달 | 통과

### 해석

단순 병렬 task 처리뿐 아니라,  
**sub-agent -> sub-agent -> sub-agent 응답** 흐름이 실제 저장소에 남는다는 점을 확인했다.

---

## Case 2. Fan-Out / Fan-In / Multi-Hop

### 목적

한 agent가 여러 agent에게 동시에 요청을 보내고,  
응답과 부가 메시지가 다른 agent를 거쳐 다시 모이는 **다중 홉 대화**를 검증한다.

### 구성

항목 | 값
---|---
agent | `coordinator`, `analyst-a`, `analyst-b`, `reviewer`, `summarizer`
task 수 | `1` (`coordinator` 시작 task)
runtime | `local`
loop | `maxIterations=15`, `pollIntervalMs=10`
대화 패턴 | `broadcast -> ack/evidence -> reviewed -> summary`

### 실제 검증 기준

- `coordinator` task `1개` 완료
- 총 peer message `13개`
- mailbox 분포
  - `coordinator`: `5`
  - `analyst-a`: `1`
  - `analyst-b`: `1`
  - `reviewer`: `3`
  - `summarizer`: `3`
- `coordinator` transcript에
  - `ack:analyst-a`
  - `summary:*`
  가 실제 `work_item`으로 기록
- `reviewer`, `summarizer`에 multi-hop peer `work_item` 각각 `3개`

### 결과

항목 | 결과
---|---
completed task | `1 / 1`
총 peer message | `13`
fan-out 단계 | 통과
fan-in 단계 | 통과
multi-hop transcript 기록 | 통과

### 해석

이 케이스는 단순 1:1 대화가 아니라,  
**브로드캐스트 + 증거 전달 + 리뷰 전달 + 요약 회수** 같은 복합 대화 패턴도  
현재 구조에서 재현 가능함을 보여준다.

---

## Case 3. Dialogue Priority Under Backlog

### 목적

pending task backlog가 있는 상황에서도,  
peer dialogue가 먼저 처리되고 그 뒤에 다음 task가 진행되는지 검증한다.

### 구성

항목 | 값
---|---
agent | `atlas`, `blaze`, `cinder`, `drift`, `ember`
task 수 | `10` (`1차 5개 + 2차 5개`)
runtime | `local`
loop | `maxIterations=8`, `pollIntervalMs=10`
대화 패턴 | `wave1 -> wave1-ack -> second-wave task pickup`

### 실제 검증 기준

- task `10`개 전부 `completed`
- 1차 task owner가 `5명 모두 유일`함
- 각 agent mailbox에 peer message `2개`
- 각 agent transcript에 peer `work_item` `2개`
- 최소 `2명` 이상의 agent에서  
  `첫 task -> peer dialogue 2건 -> 다음 task`
  순서가 실제 transcript 순서로 확인됨

### 결과

항목 | 결과
---|---
completed task | `10 / 10`
1차 owner 분산 | 통과 (`5명 모두 유일`)
peer mailbox | 전 agent `2개` 확인
peer dialogue 우선 처리 | 통과
backlog 이후 task 재개 | 통과

### 해석

이 케이스는 단순 메시지 전달이 아니라,  
**남아 있는 task backlog보다 peer 대화가 우선되는 현재 runner 우선순위**가  
실제 transcript 순서로도 관찰된다는 점을 확인했다.

---

## 최종 결론

이번 3개 추가 시나리오를 통해, 기존 단순 병렬 task smoke보다 더 어려운 조건에서도:

- 서브 에이전트 간 대화가 실제 mailbox/transcript에 남고
- 1:1 왕복, fan-out/fan-in, multi-hop, backlog contention 상황을 모두 처리하며
- 전체 테스트 스위트도 `95 pass / 0 fail` 상태를 유지함을 확인했다.

즉 현재 `agent-team`은 **5-agent 병렬 실행에서 sub-agent dialogue를 포함한 협업 흐름을 실제로 재현 가능한 수준**이다.

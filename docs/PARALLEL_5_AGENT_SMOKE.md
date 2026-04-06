# 5-Agent 병렬 가상 시나리오 테스트 결과

> **참고**: 이 문서는 2026-04-03 기준 고정 5-agent 구성에서의 병렬 정합성 smoke 결과입니다.
> 현재 `run` 명령은 goal 분석 기반 동적 역할 선택(10종 역할 풀)을 지원하며,
> agent 수가 3~8+개로 유동적입니다. 이 문서의 병렬 정합성 검증 결과는 여전히 유효합니다.

## 목적

리뷰 후속 보완 적용 이후, `agent-team`의 파일 기반 task claim/complete 흐름이
5개 worker 병렬 실행에서도 정합성을 유지하는지 실제 결과로 기록한다.

## 범위

- `local` runtime 기준 병렬 `spawn`
- 5개 teammate 동시 실행
- 10개 task 분산 처리
- 최종 task/member/transcript 상태 확인

## 강한 제외 범위

- direct API 호출 검증
- `codex-cli` / upstream CLI live backend 성능 비교
- 역할 의미 기반 task routing 검증
- 장시간 soak test

이 문서는 **병렬 정합성 smoke 결과 기록**만 다룬다.  
LLM 사용 경로 원칙은 기존과 동일하게 **CLI runtime 우선 / direct API 금지**를 유지한다.

## 참조 문서

- [README.md](../README.md)
- [AGENT.md](../AGENT.md)
- [CLI_SMOKE.md](./CLI_SMOKE.md)
- [TUI_SMOKE.md](./TUI_SMOKE.md)

## 실행 일시

- `2026-04-03`

## 테스트 구성

항목 | 값
---|---
팀 이름 | `swarm-five`
worker 수 | `5`
worker 목록 | `planner`, `researcher-a`, `researcher-b`, `reviewer`, `coordinator`
task 수 | `10`
runtime | `local`
spawn 옵션 | `--max-iterations 2 --poll-interval 50`
실행 형태 | 병렬 `spawn`

## 사용한 시나리오 개요

1. `swarm-five` 팀 생성
2. task `10`개 생성
3. worker `5`개를 동시에 `spawn`
4. 각 worker가 `2` iteration 동안 pending task를 claim/complete
5. 최종 `status`, `tasks`, `transcript`, owner 분배를 점검

## 결과 요약

항목 | 결과
---|---
총 task 수 | `10`
완료 task | `10`
pending | `0`
in_progress | `0`
중복 claim | 없음
잔여 ownership 꼬임 | 없음
`inactive + busy` 모순 | 없음
최종 member active 상태 | 전원 `false`
전체 판정 | 통과

## 에이전트별 처리 결과

에이전트 | 처리 task 수 | 최종 상태 | transcript entry 수
---|---:|---|---:|
`planner` | `2` | `idle`, `active=no` | `4`
`researcher-a` | `2` | `idle`, `active=no` | `4`
`researcher-b` | `2` | `idle`, `active=no` | `4`
`reviewer` | `2` | `idle`, `active=no` | `4`
`coordinator` | `2` | `idle`, `active=no` | `4`

## owner 분배 결과

owner | 완료 개수
---|---:|
`planner@swarm-five` | `2`
`researcher-a@swarm-five` | `2`
`researcher-b@swarm-five` | `2`
`reviewer@swarm-five` | `2`
`coordinator@swarm-five` | `2`

## 최종 상태 확인

검증 포인트 | 결과 | 메모
---|---|---
병렬 claim 정상 동작 | 통과 | 5개 worker가 충돌 없이 분산 처리
task 완료 정합성 | 통과 | `10/10 completed`
worker 종료 정합성 | 통과 | 모두 `idle`, `active=no`
transcript 기록 | 통과 | 각 worker `4 entries`
잔여 task 상태 꼬임 | 통과 | `pending=0`, `in_progress=0`
분배 균형 | 통과 | 이번 실행에서는 정확히 `2개`씩 분배

## 관찰 메모

- 이번 시나리오에서는 병렬 worker 간 중복 claim이 발생하지 않았다.
- 기존 이슈였던 `inactive + busy + in_progress` 꼬임도 재발하지 않았다.
- `local` runtime 특성상 역할 이름과 task 의미를 맞춘 semantic routing은 하지 않는다.
- 즉, 분산은 **가용 pending task 기준**으로 일어났고, 이 문서는 그 정합성 검증 결과를 기록한다.

## 결론

리뷰 후속 보완 및 low 이슈 수정 이후에도,  
`agent-team`은 **5-agent 병렬 가상 실행에서 task 분배 / 완료 처리 / 종료 정합성 / transcript 기록을 안정적으로 유지**했다.

# Goal Closure Plan

## 개요

`agent-team`의 현재 핵심 목적은
`독립 실행 가능한 headless 팀 에이전트 런타임`을 만드는 것이다.

`2026-04-03` 기준으로 다음 항목은 완료됐다.

- `team-core / team-runtime / team-cli` 분리
- lock-safe mailbox / task / permission / transcript / session storage
- `Codex CLI` runtime bridge
- upstream `claude` CLI runtime bridge
- one-shot live backend smoke (`Codex CLI`, upstream `claude` CLI)
- long-turn runtime state visibility (`executing-turn`, `settling`, `stale`, `heartbeat_age`, `turn_age`)
- real `Codex CLI` long-running backend visibility 검증

즉, 프로젝트 목적 기준으로는
`실행 가능한 형태`가 이미 성립한다.

## 남은 추가 작업

| 우선순위 | 작업 | 목적과 이유 | 현재 성격 |
|---|---|---|---|
| 1 | repeated live soak / burn-in 확대 | `Codex CLI` 기준 반복 soak 자동화와 real backend `1/3/5 iteration` 검증, long-turn visibility 검증은 완료됐다. 이제 더 긴 burn-in 결과 축적과 실패 패턴 수집이 남아 있다. | 진행 중 |
| 2 | generated files / preview UX polish | 상태 가시성은 개선됐지만, 산출물이 많을 때 상단 요약이 잘리는 UX는 더 다듬을 수 있다. | 권장 |
| 3 | backend auth/setup guide | `Codex CLI`와 upstream `claude` CLI는 각자 로그인 상태에 의존한다. 운영 문서에 요구 조건과 실패 진단 절차를 적어두면 재현성이 높아진다. | 권장 |
| 4 | exact upstream `runAgent()` import parity 재평가 | 현재 목적에는 subprocess bridge로 충분하다. 다만 원본 제품 parity가 정말 필요하면 별도 단계로 검토할 수 있다. | 선택 |
| 5 | original leader UI / pane backend parity | 현재 프로젝트 목적은 headless 실행이다. UI나 pane backend는 필요할 때만 붙이면 된다. | 선택 |

## 참조 소스에서 반영한 핵심 포인트

| 참조 소스 | 반영 내용 |
|---|---|
| `package/sourcemap-extracted/src/utils/auth.ts` | upstream `claude --bare`가 OAuth를 끄는 경로라는 점을 반영해 bridge 기본 인자에서 `--bare`를 제거했다. |
| `package/sourcemap-extracted/src/utils/tasks.ts` | teammate 종료/실패 시 open task를 다시 `pending`으로 돌리고 `owner`를 비우는 방향을 반영했다. |
| `package/sourcemap-extracted/src/utils/swarm/inProcessRunner.ts` | task claim 후 work 처리, idle notification, shutdown 흐름의 우선순위를 계속 유지했다. |

## 현재 판정

| 항목 | 상태 |
|---|---|
| 프로젝트 목적 달성 여부 | 달성 |
| 실제 live backend one-shot 실행 | 통과 |
| 실제 live backend long-turn 상태 가시성 | 통과 |
| 장시간 운영 보강 필요 여부 | 있음 |

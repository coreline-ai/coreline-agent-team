# Codex CLI repeated soak / burn-in

## 목적

이 문서는 `agent-team`의 `Codex CLI` runtime 경로를 대상으로,
반복 `spawn / resume / reopen` 흐름을 재현 가능한 방식으로 검증하기 위한
운영용 soak / burn-in 절차를 정리한다.

## 범위

- `Codex CLI` runtime 반복 실행
- `--root-dir` 기반 상태 저장소 격리
- 반복 task 생성 / 처리 / session 전이 검증
- 실패 시 상태 스냅샷 수집

## 강한 제외 범위

- direct OpenAI API 또는 기타 vendor direct API 연동 검증
- 신규 runtime/backend 추가
- upstream `claude` CLI 중심의 별도 자동화
- TUI 재설계 또는 UI 기능 검증 확대

이 문서는 **`Codex CLI` 경로의 반복 운영 신뢰도 검증**만 다룬다.

## 참조 문서

- [README.md](../README.md)
- [AGENT.md](../AGENT.md)
- [CLI_SMOKE.md](./CLI_SMOKE.md)
- [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md)
- [RELIABILITY_CHECKLIST.md](./RELIABILITY_CHECKLIST.md)

## 사전 준비

```bash
cd <repo-root>
npm ci
npm run build
```

`codex`가 PATH 에 없으면 실행 파일 경로를 직접 지정한다.

```bash
command -v codex
```

## 기본 실행

```bash
npm run soak:codex -- \
  --root-dir /tmp/agent-team-codex-soak \
  --iterations 5 \
  --model gpt-5.4-mini
```

실행 파일 경로를 직접 넘기려면:

```bash
npm run soak:codex -- \
  --root-dir /tmp/agent-team-codex-soak \
  --iterations 5 \
  --codex-executable /path/to/codex
```

release 후보별 artifact를 남기려면 label을 같이 준다.

```bash
npm run soak:codex -- \
  --root-dir /tmp/agent-team-codex-soak \
  --iterations 10 \
  --model gpt-5.4-mini \
  --label runtime-rc-20260405
```

## 동작 개요

한 iteration 안에서 아래 순서를 고정한다.

```text
task 3개 생성
→ spawn (첫 task 처리)
→ attach (spawn 이후 재진입 상태 확인)
→ resume (둘째 task 처리, new-session)
→ attach (resume 이후 재진입 상태 확인)
→ reopen (셋째 task 처리, existing-session)
→ attach (reopen 이후 재진입 상태 확인)
→ status/tasks/transcript/session 상태 검증
```

## 통과 기준

- 각 iteration 에서 새 task 3개가 모두 `completed`가 된다.
- 각 단계 종료 후 worker는 `idle`, `active=no` 상태여야 한다.
- `resume`은 `(new-session)` 의미를 유지해야 한다.
- `reopen`은 `(existing-session)` 의미를 유지해야 한다.
- tracked task에 `in_progress` 잔존이 없어야 한다.
- 각 단계 snapshot에 `attach` 출력이 포함되어야 한다.

실행 artifact 기준으로는 아래도 함께 본다.

- `latest-summary.json`의 `verificationSummary.checksFailed`가 `0`이어야 한다.
- `latest-summary.json`의 `failurePatterns`가 빈 배열이어야 한다.
- 실패 시 `failure-*.json`의 `verification` / `failurePatterns`가 원인 분류를 직접 설명해야 한다.

## failure pattern taxonomy

repeated soak는 실패를 문자열 한 줄로만 남기지 않고 아래 code로 구조화한다.

code | 의미 | 대표 원인
---|---|---
`attach_snapshot_missing` | 단계 snapshot에 attach 결과가 비거나 attach 자체가 실패 | 팀 상태 조회 실패, attach surface 손상
`agent_status_missing` | 상태 출력에 대상 agent가 없음 | member/session 저장 불일치
`heartbeat_stale` | bounded step 이후 agent heartbeat가 stale로 판정 | long-turn 정리 실패, worker hang
`unexpected_active_worker` | bounded step 종료 후에도 worker가 active/busy | shutdown/settle 누락, session close 누락
`orphan_open_task` | task owner 또는 `in_progress`가 남음 | task unassign 누락, worker crash cleanup 누락
`task_completion_mismatch` | 기대한 completed/pending task 집계와 실제 값이 다름 | task transition 손상, completion write 실패
`session_transition_mismatch` | `resume`/`reopen`이 기대한 session semantics와 다름 | new/existing session 전이 오류
`reopen_count_mismatch` | reopen counter가 증가하지 않음 | reopen bookkeeping 누락
`transcript_rollback` | transcript entry count가 이전 step보다 감소 | transcript write rollback, wrong session replay

이 taxonomy는 특히 아래 4개를 Phase 3 핵심 long-running 관찰 대상으로 본다.

- `heartbeat_stale`
- `reopen_count_mismatch`
- `orphan_open_task`
- `transcript_rollback`

## verification artifact fields

`latest-summary.json`와 `failure-*.json`은 아래 공통 구조를 가진다.

field | 위치 | 의미
---|---|---
`verification.checks[]` | `failure-*.json` | 실패 step에서 어떤 기준이 깨졌는지 체크 단위로 기록
`verificationSummary.stepsChecked` | `latest-summary.json` | 실제 검증한 step 수
`verificationSummary.checksRun` | `latest-summary.json` | 실행한 총 체크 수
`verificationSummary.checksFailed` | `latest-summary.json` | 실패한 체크 수
`verificationSummary.failingChecks[]` | `latest-summary.json` | 실패한 체크의 step/code/message 목록
`verificationSummary.failurePatternCounts` | `latest-summary.json` | failure pattern code별 집계
`failurePatterns[]` | 둘 다 | 구조화된 failure pattern 목록

step마다 아래 5개 체크를 고정한다.

- `attach_snapshot_recorded`
- `agent_returns_idle`
- `tracked_tasks_settled`
- `session_transition_consistent`
- `transcript_progress_monotonic`

즉 1 iteration은 기본적으로 `3 step x 5 checks = 15 checks`를 수행한다.

## 실패 시 스냅샷

실패하면 기본적으로 아래 경로에 JSON 스냅샷이 남는다.

```text
<rootDir>/soak-artifacts/failure-*.json
```

스냅샷에는 다음이 포함된다.

- 실패 step / iteration
- preflight 결과
- `status` 출력
- `attach` 출력
- `tasks` 출력
- `transcript` 출력
- agent status 집계
- task 상태
- session record
- structured verification result
- structured failure patterns

매 실행마다 아래 summary 파일도 같이 갱신된다.

```text
<rootDir>/soak-artifacts/latest-summary.json
```

추가로 timestamped archive와 history manifest도 남긴다.

```text
<rootDir>/soak-artifacts/summary-*.json
<rootDir>/soak-artifacts/history.json
```

여기에는 다음이 들어간다.

- 성공/실패 여부
- release 후보 label(`runLabel`)
- 요청 iteration 수 / 실제 완료 iteration 수
- 마지막 `attach` / `status` / `tasks` 요약
- cleanup 결과
- failure snapshot 경로
- verification summary
- failure pattern 집계
- archive 경로 / history manifest 경로

## 주요 옵션

옵션 | 의미
---|---
`--root-dir` | 상태 저장소 격리 경로
`--cwd` | worker 실행 cwd
`--team` | soak 대상 팀 이름
`--agent` | soak 대상 agent 이름
`--label` | release 후보 / burn-in 배치를 구분하는 선택 label
`--iterations` | 반복 횟수
`--max-iterations` | 각 spawn/resume/reopen 당 worker 최대 반복 수
`--poll-interval` | polling 간격(ms)
`--model` | Codex model
`--codex-executable` | Codex 실행 파일 경로
`--artifact-dir` | failure snapshot 저장 경로
`--continue-on-failure` | 향후 확장용 플래그, 현재는 첫 실패에서 종료

## 운영 메모

- 이 soak 는 `Codex CLI` 경로를 기준으로 한다.
- `--root-dir`는 저장소 상태를 격리하지만, CLI auth 자체를 새로 설계하지는 않는다.
- 실패 시 먼저 snapshot JSON을 보고 `status/tasks/transcript/session` 정합성을 확인한다.
- 먼저 `failurePatterns[]`와 `verificationSummary.failingChecks[]`를 보고, 그 다음 원문 `status/tasks/transcript/session`을 확인한다.
- `latest-summary.json`은 반복 burn-in 실행 후 가장 최근 결과를 빠르게 비교할 때 우선 확인한다.
- 기본 soak prompt는 **즉시 완료 / 저장소 미탐색 / 최소 schema 응답** 방향으로 고정되어 있다.
- long-running real backend를 수동 관찰할 때는 `attach` / `status`에서 `state=executing-turn`, `heartbeat_age`, `turn_age`, `stale`를 함께 본다.

release gate를 바로 판정하려면 아래 helper를 쓴다.

```bash
npm run soak:codex:check -- \
  --summary "$ROOT/soak-artifacts/latest-summary.json" \
  --gate runtime
```

history manifest에서 가장 최근 run 또는 특정 labeled run을 바로 판독할 수도 있다.

```bash
npm run soak:codex:check -- \
  --history "$ROOT/soak-artifacts/history.json" \
  --gate runtime
```

```bash
npm run soak:codex:check -- \
  --history "$ROOT/soak-artifacts/history.json" \
  --run-label runtime-rc-20260405 \
  --gate runtime
```

`permission` / `runtime` / `bridge` gate는 각각 `3 / 5 / 10` iteration 기준을 강제한다.

## restart / reopen / attach 관찰 기준

반복 soak 또는 수동 burn-in 중에는 아래 순서를 같이 본다.

1. `spawn` 직후 `attach <team>`
2. `resume` 직후 `attach <team>`
3. `reopen` 직후 `attach <team>`

각 단계에서 아래를 확인한다.

- `result`가 task 정합성과 모순되지 않는지
- worker가 bounded 실행 뒤 `idle`, `active=no`로 돌아오는지
- `session=`이 `resume`에서는 새 값, `reopen`에서는 기존 값으로 유지되는지
- `generated files`, `preview`, `recent activity`가 비정상적으로 비지 않는지

## 최소 burn-in 운영 규칙

- PR 전 최소 `1 iteration`
- runtime/loop/session 변경 후 최소 `3 iteration`
- release 전 또는 장시간 turn 관련 변경 후 최소 `5 iteration`
- release 후보 검증이면 `--label`을 붙이고 `summary-*.json`, `history.json`을 함께 보관한다.
- 실패가 나면 `failure-*.json`과 `latest-summary.json`을 둘 다 보관하고 원인 분류를 남긴다.

## 장시간 turn 관찰 포인트

real `Codex CLI` 작업은 turn 하나가 몇 분 걸릴 수 있다.
이때 아래처럼 보이면 "멈춤"이 아니라 **현재 live turn 실행 중**으로 해석한다.

```text
state=executing-turn
heartbeat_age=0s
turn_age=6m51s
```

반대로 `state=stale`가 보이면 heartbeat 갱신이 끊긴 상태라 추가 점검이 필요하다.

## 실검증 결과

기준 일시: `2026-04-03`

실백엔드 검증 조건:

- runtime: `codex-cli`
- model: `gpt-5.4-mini`
- cwd: `<repo-root>`
- 저장소 상태: `--root-dir` 격리

결과 요약:

항목 | 결과
---|---
직접 `codex exec` probe | 통과
real soak 1 iteration | 통과
real soak 3 iterations | 통과
real soak 5 iterations | 통과
failure snapshot 생성 | 없음

5 iteration 실검증 기준 최종 상태:

항목 | 결과
---|---
총 task 수 | 15
completed | 15
pending | 0
in_progress | 0
worker 최종 상태 | `idle`, `active=no`
session record 수 | 10
transcript entry 수 | 26
artifact 파일 | 없음

실무 해석:

- bounded repeated soak 는 현재 구조에서 실백엔드로도 재현 가능하다.
- `resume` / `reopen` 전이와 task 정합성은 5 iteration 기준으로 유지됐다.
- 다만 실모델 특성상 호출 시간은 iteration/turn 마다 편차가 있으므로, 장시간 burn-in 은 별도 결과 축적이 계속 필요하다.

## 실백엔드 long-turn 가시성 검증

기준 일시: `2026-04-03 17:33:55 KST ~ 17:45:07 KST`

검증 조건:

- command: `agent-team run "쇼핑몰 만들어줘" --runtime codex-cli --model gpt-5.4-mini`
- root dir: `/tmp/agent-team-phase3-root`
- workspace: `/tmp/agent-team-phase3-workspace`

관찰 결과:

항목 | 결과
---|---
초기 5개 worker 동시 실행 | `state=executing-turn`, `heartbeat_age=0s`, `turn_age≈4s`
중간 long-running 단독 worker | `frontend`가 `turn_age=6m51s~10m19s` 동안 `heartbeat_age=0s`, `stale=0` 유지
최종 완료 상태 | `result=completed`, `tasks=5/5 completed`, `active=0`

실무 해석:

- long-running real backend turn도 이제 `attach` / `status`만으로 live 상태를 구분하기 쉬워졌다.
- 특히 `frontend` 단독 장시간 실행 구간에서 기존처럼 "멈춘 것처럼만 보이는 상태"는 줄어들었다.

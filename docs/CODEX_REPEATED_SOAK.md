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

## 동작 개요

한 iteration 안에서 아래 순서를 고정한다.

```text
task 3개 생성
→ spawn (첫 task 처리)
→ resume (둘째 task 처리, new-session)
→ reopen (셋째 task 처리, existing-session)
→ status/tasks/transcript/session 상태 검증
```

## 통과 기준

- 각 iteration 에서 새 task 3개가 모두 `completed`가 된다.
- 각 단계 종료 후 worker는 `idle`, `active=no` 상태여야 한다.
- `resume`은 `(new-session)` 의미를 유지해야 한다.
- `reopen`은 `(existing-session)` 의미를 유지해야 한다.
- tracked task에 `in_progress` 잔존이 없어야 한다.

## 실패 시 스냅샷

실패하면 기본적으로 아래 경로에 JSON 스냅샷이 남는다.

```text
<rootDir>/soak-artifacts/failure-*.json
```

스냅샷에는 다음이 포함된다.

- 실패 step / iteration
- preflight 결과
- `status` 출력
- `tasks` 출력
- `transcript` 출력
- agent status 집계
- task 상태
- session record

## 주요 옵션

옵션 | 의미
---|---
`--root-dir` | 상태 저장소 격리 경로
`--cwd` | worker 실행 cwd
`--team` | soak 대상 팀 이름
`--agent` | soak 대상 agent 이름
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
- 기본 soak prompt는 **즉시 완료 / 저장소 미탐색 / 최소 schema 응답** 방향으로 고정되어 있다.
- long-running real backend를 수동 관찰할 때는 `attach` / `status`에서 `state=executing-turn`, `heartbeat_age`, `turn_age`, `stale`를 함께 본다.

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

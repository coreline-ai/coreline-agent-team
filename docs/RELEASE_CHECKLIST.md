# Release Checklist

## 목적

이 문서는 `agent-team` 릴리즈 전 최소 검증 기준을 고정한다.
특히 `Codex CLI` 중심 runtime 경로에서
반복 `spawn / resume / reopen` 흐름이 장시간 운영에서도 덜 꼬이도록,
테스트 / soak / artifact 판독 순서를 한 문서로 묶는다.

## 적용 범위

- 로컬 릴리즈 후보 검증
- `npm run typecheck`, `npm test`
- `npm run soak:codex` 실백엔드 반복 실행
- `latest-summary.json`, `summary-*.json`, `history.json`, `failure-*.json` 판독

## 제외 범위

- direct API 기반 LLM 경로
- 신규 runtime/backend 추가 검증
- upstream `claude` CLI 장시간 자동화 전면 확대
- 배포 플랫폼별 운영 절차

## 공통 원칙

1. 기본 release gate는 **`Codex CLI` 경로 우선**으로 본다.
2. soak PASS 여부는 문자열 로그보다 **artifact (`latest-summary.json`)** 로 판정한다.
3. failure pattern이 1개라도 있으면 release gate는 실패로 본다.
4. runtime / session / task / recovery 관련 변경은 문서/UX 변경보다 더 강한 soak 기준을 적용한다.

## 사전 준비

```bash
cd <repo-root>
npm ci
npm run build
```

`codex`가 PATH 에 없으면 경로를 직접 지정한다.

```bash
command -v codex
```

## 변경 유형별 최소 release gate

변경 유형 | 최소 검증 | 비고
---|---|---
문서 전용 | 문서 링크/명령 수동 점검 | 코드 테스트 생략 가능
CLI/TUI UX 변경 | `npm run typecheck` + `npm test` | soak는 권장
permission / approval / operator surface 변경 | `npm run typecheck` + `npm test` + real soak 3 iteration | mailbox / persistence 영향 확인
runtime / session / task / recovery 변경 | `npm run typecheck` + `npm test` + real soak 5 iteration | release 전 최소 기준
bridge / subprocess / reopen semantics 변경 | `npm run typecheck` + `npm test` + real soak 10 iteration | release 직전 강화 기준

## 표준 실행 커맨드

### 5 iteration

```bash
export ROOT=/tmp/agent-team-codex-soak-5-$(date +%Y%m%d-%H%M%S)
mkdir -p "$ROOT"

npm run soak:codex -- \
  --root-dir "$ROOT" \
  --cwd "$(pwd)" \
  --iterations 5 \
  --model gpt-5.4-mini \
  --max-iterations 1 \
  2>&1 | tee "$ROOT/run.log"
```

### 10 iteration

```bash
export ROOT=/tmp/agent-team-codex-soak-10-$(date +%Y%m%d-%H%M%S)
mkdir -p "$ROOT"

npm run soak:codex -- \
  --root-dir "$ROOT" \
  --cwd "$(pwd)" \
  --iterations 10 \
  --model gpt-5.4-mini \
  --max-iterations 1 \
  2>&1 | tee "$ROOT/run.log"
```

### release 후보 label 포함 예시

```bash
export ROOT=/tmp/agent-team-codex-soak-rc-$(date +%Y%m%d-%H%M%S)
mkdir -p "$ROOT"

npm run soak:codex -- \
  --root-dir "$ROOT" \
  --cwd "$(pwd)" \
  --iterations 10 \
  --model gpt-5.4-mini \
  --max-iterations 1 \
  --label runtime-rc-20260405 \
  2>&1 | tee "$ROOT/run.log"
```

## PASS / FAIL 판독 기준

항목 | PASS | FAIL
---|---|---
프로세스 종료코드 | `0` | `1`
`latest-summary.json.success` | `true` | `false`
`iterationsCompleted` | 요청값과 동일 | 요청값보다 작음
`verificationSummary.checksFailed` | `0` | `> 0`
`failurePatterns` | 빈 배열 | 1개 이상 존재
`failureSnapshotPath` | 없음 | 존재함
tracked task 상태 | 모두 `completed` | `pending` / `in_progress` 잔존
worker 최종 상태 | `idle`, `active=no` | busy / stale / active 잔존

## gate checker helper

`latest-summary.json`을 더 기계적으로 판독하려면 아래 helper를 쓴다.

```bash
npm run soak:codex:check -- \
  --summary "$ROOT/soak-artifacts/latest-summary.json" \
  --gate runtime
```

history manifest에서 최신 run 또는 특정 labeled run을 판독하려면:

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

지원 gate:

- `permission` → 최소 `3` iteration
- `runtime` → 최소 `5` iteration
- `bridge` → 최소 `10` iteration

exit code 규칙:

- `0` = 선택한 gate 충족
- `1` = iteration 부족 / failed checks / failure pattern / failure snapshot 존재

JSON 출력이 필요하면:

```bash
npm run soak:codex:check -- \
  --summary "$ROOT/soak-artifacts/latest-summary.json" \
  --gate runtime \
  --json
```

## 판독 순서

1. `run.log` 종료코드 확인
2. `soak-artifacts/latest-summary.json` 확인
3. release 후보면 `summary-*.json` / `history.json` 보존 여부 확인
4. `verificationSummary.checksFailed` 확인
5. `failurePatterns[]` 확인
6. 실패 시 `failure-*.json` 원인 확인
7. 마지막으로 `status / attach / tasks / transcript` 원문 확인

빠른 확인 예시:

```bash
cat "$ROOT/soak-artifacts/latest-summary.json"
```

```bash
jq '{
  success,
  iterationsRequested,
  iterationsCompleted,
  checksFailed: .verificationSummary.checksFailed,
  failurePatterns: [.failurePatterns[].code],
  failureSnapshotPath
}' "$ROOT/soak-artifacts/latest-summary.json"
```

## 주요 blocker

- `heartbeat_stale`
- `unexpected_active_worker`
- `orphan_open_task`
- `task_completion_mismatch`
- `session_transition_mismatch`
- `reopen_count_mismatch`
- `transcript_rollback`

위 code는 하나라도 발생하면 release 보류 대상으로 본다.

## 릴리즈 증빙으로 남길 것

- 실행 날짜 / 브랜치 / 커밋 해시
- `npm run typecheck` 결과
- `npm test` 결과
- soak 실행 커맨드 원문
- `ROOT` 경로
- `latest-summary.json`
- `summary-*.json`
- `history.json`
- 사용한 `--label` 값(있다면)
- 실패 시 `failure-*.json`

## 실패 시 기본 대응

1. release 중단
2. `latest-summary.json`의 `failingChecks` / `failurePatternCounts` 확인
3. `failure-*.json`에서 `status / attach / tasks / transcript / session` 순서로 원인 추적
4. runtime/task/session recovery 관련 수정이면 동일 기준으로 soak 재실행

## 참조 문서

- [CODEX_REPEATED_SOAK.md](./CODEX_REPEATED_SOAK.md)
- [RELIABILITY_CHECKLIST.md](./RELIABILITY_CHECKLIST.md)
- [README.md](../README.md)

# NEXT_BACKLOG

작성 일시: `2026-04-05 18:14:51 KST`

이 문서는 2026-04-05 기준 완료된 dev-plan 이후에도 남아 있는 후속 workstream을
우선순위 순으로 다시 정리한 backlog다.

## 완료된 선행 workstream

- `dev-plan/implement_20260405_132843.md` — log observability / TUI log viewer 완료
- `dev-plan/implement_20260405_134934.md` — recovery / guardrail / soak failure taxonomy 완료
- `dev-plan/implement_20260405_171538.md` — code-design cleanup / failure tests / package quality 완료
- `dev-plan/implement_20260405_181634.md` — approval context / permission preset UX / 문서 동기화 완료
- `dev-plan/implement_20260405_185959.md` — burn-in / release checklist / soak gate helper 완료
- `dev-plan/implement_20260405_201816.md` — multi-team picker / overview 개선 완료
- `dev-plan/implement_20260405_203529.md` — generated files / preview large-output UX polish 완료
- `dev-plan/implement_20260405_205926.md` — longer burn-in archive/history/labeling 완료

## 우선순위 재정리

| 우선순위 | workstream | 현재 상태 | 남은 이유 | 권장 시점 |
|---|---|---|---|---|
| P1 | richer global dashboard / global ops surface | 선택적 | multi-team 기본선은 확보됐지만, 전역 운영 surface 확장은 아직 최소 수준에 머물러 있음 | 운영 수요 발생 시 |
| P2 | direct upstream parity / pane backend / remote transport | 미구현 | 현재 제품 목표에는 필수가 아니고, 수요가 생길 때만 여는 확장 축임 | 명시 수요 발생 시 |

## 항목별 메모

### 완료된 P0. approval / permission preset UX hardening

현재 이미 있는 것:
- CLI `approve-permission`, `deny-permission`, `permissions`
- TUI approval inbox
- persisted allow/deny rule 저장
- stored rule auto allow/deny
- `cmd/cwd/path/host` context surface
- matcher preset(`suggested/command/cwd/path/host`)

이번 workstream에서 마감됐으므로 active backlog에서는 내렸다.

### 완료된 P0. long-lived burn-in / release checklist 운영화

현재 이미 있는 것:
- `npm run soak:codex`
- `npm run soak:codex:check`
- `latest-summary.json`, `failure-*.json`
- structured failure pattern taxonomy
- `1/3/5 iteration` repeated soak 기준
- `permission/runtime/bridge` gate(`3/5/10 iteration`)

이번 workstream에서 마감된 것:
- `docs/RELEASE_CHECKLIST.md`
- release gate helper와 exit code 기반 판정
- artifact 우선 PASS/FAIL 규칙 고정

남은 것은 “운영 기준 정리”가 아니라 “실백엔드 결과 축적” 쪽이다.

### 완료된 P0. multi-team picker / overview 개선

현재 이미 있는 것:
- 팀 목록/선택
- 단일 팀 attach/watch/tui
- project builder attached team view

이번 workstream에서 마감된 것:
- team list overview data contract
- attention-needed team 우선 정렬
- TUI team picker row에 approvals/workers/tasks/attention reason 표시

남은 것은 richer global dashboard나 추가 운영 surface 확장 쪽이다.

### 완료된 P0. generated files / preview large-output UX polish

현재 이미 있는 것:
- prioritized file summary
- preview headline/excerpt
- generated files list / workspace preview

이번 workstream에서 마감된 것:
- `showing first ... discovered files`, `+... more discovered files not shown`
- `preview_selection=priority|signal`
- `preview_trimmed=... more line(s) hidden`
- project builder Files / Preview 탭과 `attach`의 공통 어휘 정리

남은 것은 richer global dashboard나 burn-in 결과 축적 쪽이다.

### 완료된 P0. longer burn-in 결과 추가 축적

현재 이미 있는 것:
- release checklist
- gate checker
- `latest-summary.json` / `failure-*.json` 판독 기준
- `summary-*.json` archive
- `history.json` manifest
- `--label`, `--history`, `--run-label`

이번 workstream에서 마감된 것:
- release 후보별 artifact/history 보존 baseline
- labeled gate checker surface
- runner/checker history surface

남은 것은 “기능 부재”가 아니라 실제 release 후보가 생길 때 더 긴 실백엔드 burn-in 결과를 운영적으로 누적하는 일이다.

### P1. 선택적 parity / 확장 축

아래는 현재 backlog에는 남기되, 기본 우선순위는 낮다.

- direct upstream `runAgent()` import parity
- tmux / iTerm pane backend parity
- cross-process / remote transport

## 현재 권장 다음 dev-plan

다음 workstream은 **P1. richer global dashboard / global ops surface**가 가장 자연스럽다.

이유:
1. single-team, multi-team, burn-in, release checklist 기본선이 모두 갖춰졌다.
2. 다음 남은 사용자 체감 갭은 richer global dashboard 같은 전역 운영 surface 쪽이다.
3. direct parity / remote transport는 아직 명시 수요가 생길 때 여는 편이 안전하다.

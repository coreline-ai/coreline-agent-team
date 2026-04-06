# agent-team

`agent-team`은 기존 `claude-code/package` 내부에 있던 teammate / swarm runtime을
독립 실행형으로 분리한 **CLI 기반 multi-agent team runtime**입니다.

현재는 단순 엔진 수준을 넘어서, 사용자가 아래 흐름으로 실제 사용을 시작할 수 있습니다.

1. 설치
2. `doctor`로 환경 점검
3. `bun atcli.js` / `atcli` / `agent-team app`으로 자연어 입력 대기형 프로젝트 빌더 실행
4. 같은 화면에서 상태를 보고 필요하면 follow-up 입력
5. `attach` / `watch` / `tui` / workspace 파일로 결과 확인

## 중요한 목적 제약

이 프로젝트에서 **LLM 사용의 표준 경로는 `Codex CLI` runtime**입니다.

- 표준 경로: `codex-cli`
- 금지 대상: OpenAI/기타 모델의 direct API 연동
- 비목표: API key 기반 model 호출 레이어 설계/구현

즉, 이 프로젝트는 **CLI 기반 agent runtime 사용을 전제로 하며, API 사용은 고려 대상이 아니고 금지**합니다.

## 실사용 빠른 시작

가장 빠른 시작 경로는 아래 4단계입니다.

### 1) 설치

```bash
npm install
npm run build
npm link
```

### 2) 환경 점검

```bash
agent-team doctor --workspace /tmp/agent-team-demo --probe
```

정상이라면 아래를 확인할 수 있어야 합니다.

- `Codex CLI executable: OK`
- `Codex CLI login: OK`
- `Workspace write access: OK`
- `Codex exec probe: OK`
- 마지막 줄 `Result: READY`

### 3) 대화형 프로젝트 빌더 실행

가장 제품형에 가까운 진입점은 아래 셋 중 하나입니다.

```bash
bun atcli.js --root-dir /tmp/agent-team-demo
atcli --root-dir /tmp/agent-team-demo
agent-team --root-dir /tmp/agent-team-demo app
```

실행하면 Codex 스타일의 TUI가 열리고 곧바로 자연어 goal 입력 대기 상태가 됩니다.
예: `쇼핑몰 만들어줘`

앱 오른쪽 패널에서 바로 볼 수 있는 것:

- 현재 결과 상태(`waiting-for-goal`, `pending`, `running`, `completed`, `attention`)
- 생성된 파일 요약과 우선순위 높은 산출물 목록
- 핵심 산출물 preview(`headline`, `excerpt`)
- large-output일 때도 `Generated Files (24+)`, `showing first ... discovered files`, `selection`, `trimmed` 같은 힌트로 요약 상태를 알 수 있음
- teammate / task 상태
- live teammate 상태(`executing-turn`, `settling`, `stale`, `pid`, `launch`)

앱이 자동 팀 이름을 만들었다면, 이후 팀 이름이 기억나지 않을 때는 `agent-team --root-dir <path> attach`로 목록부터 확인하면 됩니다.

`--workspace`를 생략하면 결과물은 더 이상 현재 저장소 아래가 아니라,
기본적으로 `<root-dir>/workspaces/<team-name>`에 생성됩니다.
예: `--root-dir /tmp/agent-team-demo`라면 기본 workspace는
`/tmp/agent-team-demo/workspaces/<team-name>` 입니다.

같은 내용을 비대화형으로 바로 시작하고 싶다면 기존 `run`도 계속 사용할 수 있습니다.

```bash
agent-team --root-dir /tmp/agent-team-demo \
  run "쇼핑몰 만들어줘" \
  --team shopping-mall-demo \
  --workspace /tmp/agent-team-demo-workspace \
  --runtime codex-cli \
  --model gpt-5.4-mini
```

이 경로는 `software-factory` preset 기반으로 아래를 자동 수행합니다.

- workspace 생성
- team 생성
- **goal 분석 기반 동적 역할 선택** (또는 `--roles`로 수동 지정)
- 선택된 역할별 task 생성
- leader message 생성
- background teammate launch

`--roles`를 생략하면 goal 텍스트에서 키워드를 분석해 필요한 역할만 자동 선택합니다.

사용 가능한 역할 (10종):

| 역할 | 담당 | 자동 선택 키워드 예시 |
|------|------|----------------------|
| `planner` | 구현 계획 & 아키텍처 | 항상 포함 |
| `search` | 요구사항 리서치 | research, reference, requirement |
| `frontend` | 프론트엔드 개발 | frontend, react, web, dashboard, ui |
| `backend` | 백엔드/API 개발 | backend, api, server, endpoint |
| `database` | DB 스키마 & 데이터 레이어 | database, postgresql, schema, migration |
| `devops` | 인프라 & CI/CD | docker, kubernetes, deploy, ci/cd |
| `testing` | 테스트 스위트 | test, e2e, playwright, jest |
| `mobile` | 모바일 앱 | mobile, ios, android, react native |
| `security` | 보안 아키텍처 | auth, oauth, encryption, security |
| `reviewer` | 전체 리뷰 | 항상 포함 |

복합 키워드도 인식합니다:
- `full-stack` / `fullstack` / `풀스택` → frontend + backend
- `쇼핑몰` / `e-commerce` → frontend + backend + database
- `web app` / `웹앱` → frontend + backend

예시:

```bash
# goal 분석 자동: "React dashboard" → planner, frontend, reviewer (3개)
agent-team run "Build a React dashboard"

# goal 분석 자동: "Full-stack + PostgreSQL + Docker" → planner, frontend, backend, database, devops, reviewer (6개)
agent-team run "Full-stack app with PostgreSQL and Docker"

# 수동 지정: 원하는 역할만 콤마로 나열 (planner/reviewer 자동 추가)
agent-team run "Build X" --roles frontend,database,testing
```

매칭되는 키워드가 없는 범용 goal은 기본으로 `planner, search, frontend, backend, reviewer` 5개가 선택됩니다.

### 4) 진행 / 결과 확인

```bash
agent-team --root-dir /tmp/agent-team-demo attach shopping-mall-demo
agent-team --root-dir /tmp/agent-team-demo watch shopping-mall-demo
agent-team --root-dir /tmp/agent-team-demo tui shopping-mall-demo
```

`attach`에서 바로 확인할 수 있는 것:

- goal / workspace
- 결과 상태(`running`, `completed`, `attention`, `pending`)
- teammate 상태 요약
- worker 요약(`worker`, `launch`, `lifecycle`, `pid`)
- live 상태 집계(`executing`, `settling`, `stale`)
- long-running turn 표시(`work`, `turn_age`, `heartbeat_age`)
- task 집계
- 최근 activity
- 현재 workspace에서 감지된 생성 파일 summary (`showing first ... discovered files`, hidden-file count 포함)
- 핵심 preview(`preview_headline`, `preview_excerpt`, `preview_selection`, `preview_trimmed`)
- 다음 추천 명령

## 문서만 보고 따라가려면

초보 사용자용 문서는 아래 순서로 보면 됩니다.

- [USER_QUICKSTART.md](docs/USER_QUICKSTART.md) — 설치 → doctor → atcli/app → attach 흐름
- [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — 설치 실패 / 로그인 실패 / 권한 실패 대응
- [TEAM_CONSTRAINTS.md](docs/TEAM_CONSTRAINTS.md) — 구조적 제한 / 운영 안정성 / 비용 기준
- [NEXT_BACKLOG.md](docs/NEXT_BACKLOG.md) — 현재 기준 남은 후속 workstream 우선순위
- [CLI_SMOKE.md](docs/CLI_SMOKE.md) — 재현 가능한 CLI smoke 절차
- [TUI_SMOKE.md](docs/TUI_SMOKE.md) — PTY 기준 watch / tui 확인 절차

## 사용자가 실제로 쓰는 핵심 명령

| 명령 | 용도 |
|---|---|
| `agent-team doctor --workspace <path> --probe` | 실행 전 환경 준비 상태 확인 |
| `bun atcli.js [--root-dir <path>]` | 단일 실행 파일로 프로젝트 빌더 TUI 시작 |
| `atcli [--root-dir <path>]` | 설치 후 바로 쓰는 프로젝트 빌더 TUI 명령 |
| `agent-team [--root-dir <path>] app` | 확인용/대체용 대화형 프로젝트 빌더 명령 |
| `agent-team [--root-dir <path>] run <goal...>` | 비대화형으로 자연어 goal bootstrap |
| `agent-team [--root-dir <path>] attach [team]` | 현재 팀 상태 / 결과 / 생성 파일 요약 |
| `agent-team [--root-dir <path>] watch <team>` | 읽기 전용 진행 대시보드 |
| `agent-team [--root-dir <path>] tui [team]` | 인터랙티브 운영 UI. team을 생략하면 multi-team picker / overview부터 시작 |
| `agent-team [--root-dir <path>] status <team>` | teammate 상태 상세 확인 |
| `agent-team [--root-dir <path>] logs <team> <agent> [stdout|stderr|both]` | worker 로그 tail 확인 |
| `agent-team [--root-dir <path>] tasks <team>` | task 목록 확인 |
| `agent-team [--root-dir <path>] permissions <team> [pending|resolved|rules]` | approval/persisted rule 상태 확인 |
| `agent-team [--root-dir <path>] approve-permission ... --persist --preset <preset>` | approval 요청을 승인하고 matcher preset 저장 |
| `agent-team [--root-dir <path>] deny-permission ... --persist --preset <preset>` | approval 요청을 거부하고 matcher preset 저장 |
| `agent-team [--root-dir <path>] transcript <team> <agent>` | transcript 확인 |

전체 명령:

```bash
agent-team --help
```

## 대화형 앱 사용법

프로젝트 빌더 TUI에서 바로 goal을 입력할 수 있습니다.

```bash
bun atcli.js --root-dir /tmp/agent-team-demo
```

또는

```bash
atcli --root-dir /tmp/agent-team-demo
agent-team --root-dir /tmp/agent-team-demo app
```

앱 안에서는:

- 첫 입력: 프로젝트 goal
- 이후 plain text: 기본적으로 `planner`에게 follow-up 전송
- `/to <agent> <message>`: 특정 teammate로 라우팅
- `/doctor`: Codex 준비 상태 재확인
- `/quit`: 종료

## 결과 확인 방법

goal 실행 후 결과는 기본적으로 아래 세 군데에서 확인합니다.

1. `attach <team>` 요약
2. workspace 파일
3. `status`, `tasks`, `transcript`

예:

```bash
agent-team --root-dir /tmp/agent-team-demo attach shopping-mall-demo
agent-team --root-dir /tmp/agent-team-demo status shopping-mall-demo
agent-team --root-dir /tmp/agent-team-demo logs shopping-mall-demo frontend stderr --lines 40
agent-team --root-dir /tmp/agent-team-demo permissions shopping-mall-demo pending
agent-team --root-dir /tmp/agent-team-demo approve-permission shopping-mall-demo frontend perm-123 --persist --preset suggested
agent-team --root-dir /tmp/agent-team-demo tasks shopping-mall-demo
agent-team --root-dir /tmp/agent-team-demo transcript shopping-mall-demo planner --limit 20
```

상태 해석 예:

- `state=executing-turn` + `heartbeat_age=0s` + `turn_age` 증가  
  → 멈춘 것이 아니라 현재 live turn 실행 중
- `state=stale`  
  → heartbeat 갱신이 오래 끊긴 상태이므로 stuck 가능성 점검 필요

`attach`와 `status`에서 함께 보면 좋은 worker 필드:

- `worker=attached|detached`
- `launch=spawn|resume|reopen`
- `lifecycle=running|idle|completed|failed`
- `pid=<number>`
- `stdout_log=<path>`
- `stderr_log=<path>`
- `stderr_tail=<latest lines>`

실행 중 자주 보게 되는 패턴:

- task가 아직 `pending`이어도, 특정 teammate가
  `state=executing-turn`, `heartbeat_age=0s`, `work=leader-message`로 보이면
  실제로는 그 task를 처리 중일 수 있습니다.
- 예를 들어 `planner/search/backend/reviewer`가 먼저 끝나고
  `frontend`만 마지막 산출물을 오래 만드는 동안,
  task 집계는 `pending=1`, `completed=4`처럼 보일 수 있습니다.
  이때는 `status`, `attach`, `stderr_tail`을 함께 보고 stuck인지 live turn인지 구분합니다.

permission approval을 처리할 때는 아래 흐름을 자주 씁니다.

```bash
agent-team --root-dir /tmp/agent-team-demo permissions shopping-mall-demo pending
agent-team --root-dir /tmp/agent-team-demo approve-permission shopping-mall-demo frontend perm-123 --persist --preset suggested
agent-team --root-dir /tmp/agent-team-demo deny-permission shopping-mall-demo frontend perm-124 "Denied by lead" --persist --preset host
agent-team --root-dir /tmp/agent-team-demo permissions shopping-mall-demo rules
```

지원 preset:

- `suggested`
- `command`
- `cwd`
- `path`
- `host`

## TUI 사용법

```bash
agent-team --root-dir /tmp/agent-team-demo tui
agent-team --root-dir /tmp/agent-team-demo tui shopping-mall-demo
```

- `tui`만 실행하면 현재 `--root-dir` 안의 team picker / overview가 먼저 열립니다.
- attention-needed 팀은 목록 상단에 오고, `approvals / workers / tasks / attention reason` 요약이 함께 보입니다.
- `Enter`로 선택한 팀을 열고, `c`로 새 팀을 만들 수 있습니다.
- 새 팀 생성 화면으로 들어간 뒤에도 기존 팀이 하나 이상 있으면 `Esc`로 다시 team list로 돌아갈 수 있습니다.
- picker 정렬은 대략 `attention → running → pending → completed` 순서를 따릅니다.

핵심 단축키:

| 키 | 동작 |
|---|---|
| `Tab`, 방향키 | pane / selection 이동 |
| `s` | teammate spawn modal |
| `t` | task 생성 modal |
| `m` | leader message 전송 modal |
| `a` | approval inbox |
| `u` | 선택한 teammate resume |
| `x` | 선택한 teammate shutdown request |
| `r` | refresh |
| `?` | help overlay |
| `q` | 종료 |

## 현재 `run "<goal>"` 범위

- preset은 `software-factory` 1개를 기반으로 합니다.
- 역할은 **goal 분석 기반 동적 선택** (10종 중 키워드 매칭)이며, `--roles`로 수동 오버라이드도 가능합니다.
- `planner`와 `reviewer`는 항상 포함됩니다.
- 매칭 키워드 없는 범용 goal은 기본 5개(`planner, search, frontend, backend, reviewer`)로 fallback합니다.
- 완전 자율 recursive team spawning은 아직 구현하지 않았습니다.
- **사용자 goal → 자동 bootstrap → attach/watch/tui 관찰**의 실사용 경로를 제공합니다.

## low-level 명령도 계속 사용할 수 있음

더 세밀하게 제어하고 싶다면 기존 low-level 명령도 그대로 사용할 수 있습니다.

```bash
agent-team --root-dir /tmp/agent-team-demo init alpha-team
agent-team --root-dir /tmp/agent-team-demo task-create alpha-team "Investigate parser" "Review the parsing failure"
agent-team --root-dir /tmp/agent-team-demo spawn alpha-team researcher --prompt "Help with the current task list" --runtime codex-cli --model gpt-5.4-mini --max-iterations 50
```

## Runtime / Backend

지원 런타임:

- `local`
- `codex-cli`
- `upstream`

실사용 표준 경로는 `codex-cli` 입니다.

## 백그라운드 worker 동작

`run`, `spawn`, `resume`, `reopen`으로 띄운 teammate는 detached CLI 프로세스로 실행될 수 있습니다.

의미:

- 상위 TUI/터미널이 종료되어도 worker는 계속 돌 수 있습니다.
- 상태는 `--root-dir` 저장소에 반영됩니다.
- bounded worker 기본 lifecycle은 `maxIterations=50`, `pollInterval=500ms` 입니다.
- 상태 확인은 `attach`, `status`, `tasks`, `transcript`로 합니다.
- `attach` / `status` / TUI에서는 detached worker의 `worker`, `launch`, `lifecycle`, `pid`도 함께 볼 수 있습니다.
- detached worker의 최근 stderr preview도 `attach`, `status`, TUI teammate pane에서 볼 수 있습니다.
- 상세 로그 파일은 `<root-dir>/teams/<team>/logs/*.stdout.log`, `*.stderr.log` 아래에 남습니다.
- `--workspace`를 생략하면 기본 결과물 경로는 `<root-dir>/workspaces/<team-name>` 입니다.

## 운영 검증 문서

- [CLI_SMOKE.md](docs/CLI_SMOKE.md)
- [CODEX_REPEATED_SOAK.md](docs/CODEX_REPEATED_SOAK.md)
- [RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)
- [PARALLEL_5_AGENT_SMOKE.md](docs/PARALLEL_5_AGENT_SMOKE.md)
- [PARALLEL_5_AGENT_DIALOGUE_CASES.md](docs/PARALLEL_5_AGENT_DIALOGUE_CASES.md)
- [TUI_SMOKE.md](docs/TUI_SMOKE.md)

반복 soak:

```bash
npm run soak:codex -- --root-dir /tmp/agent-team-codex-soak --iterations 5
```

release 후보별로 결과를 묶고 싶다면 label을 같이 남깁니다.

```bash
npm run soak:codex -- \
  --root-dir /tmp/agent-team-codex-soak \
  --iterations 10 \
  --label runtime-rc-20260405
```

반복 soak 실행 후에는 아래 artifact를 같이 봅니다.

- `<root-dir>/soak-artifacts/latest-summary.json`
- `<root-dir>/soak-artifacts/summary-*.json`
- `<root-dir>/soak-artifacts/history.json`
- 실패 시 `<root-dir>/soak-artifacts/failure-*.json`

현재 soak는 `spawn -> attach -> resume -> attach -> reopen -> attach` 순서를 기준으로 검증하며,
빠른 repeated soak 최소 규칙은 아래와 같습니다.

- PR 전: `1 iteration`
- runtime/loop/session 변경 후: `3 iterations`
- release 전 또는 장시간 turn 관련 변경 후: `5 iterations`

release gate를 더 기계적으로 판정하려면 아래 checker를 씁니다.

```bash
npm run soak:codex:check -- \
  --summary /tmp/agent-team-codex-soak/soak-artifacts/latest-summary.json \
  --gate runtime
```

history manifest에서 특정 release 후보(label)를 바로 판독할 수도 있습니다.

```bash
npm run soak:codex:check -- \
  --history /tmp/agent-team-codex-soak/soak-artifacts/history.json \
  --run-label runtime-rc-20260405 \
  --gate runtime
```

지원 gate:

- `permission` → `3 iteration`
- `runtime` → `5 iteration`
- `bridge` → `10 iteration`

자세한 절차는 [CODEX_REPEATED_SOAK.md](docs/CODEX_REPEATED_SOAK.md)와
[RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)를 기준으로 봅니다.

## 현재 상태

- `bun atcli.js`, `atcli`, `agent-team app`을 포함한 **대화형 프로젝트 빌더 시작 경로**가 정리되어 있습니다.
- `doctor`, `run`, `attach`, `watch`, `tui`를 포함한 **보조/운영 경로**도 함께 유지됩니다.
- 최근 마감 작업으로 background worker visibility, generated preview large-output UX polish, repeated soak hardening이 완료됐습니다.
- longer burn-in 결과 축적용 `--label`, `summary-*.json`, `history.json`, labeled gate checker도 완료됐습니다.
- detached worker `stdout/stderr` log capture와 `stderr_tail` visibility도 완료됐습니다.
- approval / permission / recovery / build-quality 관련 2026-04-05 workstream도 문서 기준 완료 상태입니다.
- `Codex CLI` repeated soak는 실백엔드 기준 `1 / 3 / 5 iteration` 검증을 통과했고, `latest-summary.json`뿐 아니라 `summary-*.json`, `history.json` artifact도 남깁니다.
- `docs/RELEASE_CHECKLIST.md`와 `npm run soak:codex:check` helper로 `permission/runtime/bridge` gate(`3/5/10 iteration`)를 최신 summary 또는 history+label 기준으로 기계적으로 판정할 수 있습니다.
- TUI는 read-only `watch`와 interactive `tui` 둘 다 제공하며, `tui`는 team을 생략하면 multi-team picker / overview부터 시작할 수 있습니다.
- `attach`와 project builder는 large-output workspace에서도 `showing first ... discovered files`, `preview_selection`, `preview_trimmed`를 같은 어휘로 보여줍니다.
- `run` 명령의 역할 선택이 goal 키워드 분석 기반 동적 선택으로 전환되었습니다. 10종 역할 풀에서 goal에 맞는 역할만 자동 선택하며, `--roles` 플래그로 수동 오버라이드도 가능합니다.
- `npm run typecheck`, `npm test` 기준 현재 테스트는 통과 상태이며, 최신 로컬 기준 `209 tests pass` 입니다.

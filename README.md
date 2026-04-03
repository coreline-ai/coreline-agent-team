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
- 생성된 파일 목록
- 핵심 산출물 preview
- teammate / task 상태

앱이 자동 팀 이름을 만들었다면, 이후 팀 이름이 기억나지 않을 때는 `agent-team --root-dir <path> attach`로 목록부터 확인하면 됩니다.

같은 내용을 비대화형으로 바로 시작하고 싶다면 기존 `run`도 계속 사용할 수 있습니다.

```bash
agent-team --root-dir /tmp/agent-team-demo \
  run "쇼핑몰 만들어줘" \
  --team shopping-mall-demo \
  --workspace /tmp/agent-team-demo-workspace \
  --runtime codex-cli \
  --model gpt-5.4-mini
```

이 경로는 현재 최소 실사용 preset인 `software-factory` 경로로 아래를 자동 수행합니다.

- workspace 생성
- team 생성
- `planner`, `search`, `frontend`, `backend`, `reviewer` bootstrap
- 초기 task 생성
- leader message 생성
- background teammate launch

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
- task 집계
- 최근 activity
- 현재 workspace에서 감지된 생성 파일
- 다음 추천 명령

## 문서만 보고 따라가려면

초보 사용자용 문서는 아래 순서로 보면 됩니다.

- [USER_QUICKSTART.md](docs/USER_QUICKSTART.md) — 설치 → doctor → atcli/app → attach 흐름
- [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — 설치 실패 / 로그인 실패 / 권한 실패 대응
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
| `agent-team [--root-dir <path>] tui <team>` | 인터랙티브 운영 UI |
| `agent-team [--root-dir <path>] status <team>` | teammate 상태 상세 확인 |
| `agent-team [--root-dir <path>] tasks <team>` | task 목록 확인 |
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
agent-team --root-dir /tmp/agent-team-demo tasks shopping-mall-demo
agent-team --root-dir /tmp/agent-team-demo transcript shopping-mall-demo planner --limit 20
```

## TUI 사용법

```bash
agent-team --root-dir /tmp/agent-team-demo tui shopping-mall-demo
```

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

현재 범위는 의도적으로 제한되어 있습니다.

- preset은 `software-factory` 1개만 지원합니다.
- 역할은 `planner`, `search`, `frontend`, `backend`, `reviewer`로 고정입니다.
- 완전 자율 recursive team spawning은 아직 구현하지 않았습니다.
- 대신 **사용자 goal → 자동 bootstrap → attach/watch/tui 관찰**의 최소 실사용 경로를 제공합니다.

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

## 운영 검증 문서

- [CLI_SMOKE.md](docs/CLI_SMOKE.md)
- [CODEX_REPEATED_SOAK.md](docs/CODEX_REPEATED_SOAK.md)
- [PARALLEL_5_AGENT_SMOKE.md](docs/PARALLEL_5_AGENT_SMOKE.md)
- [PARALLEL_5_AGENT_DIALOGUE_CASES.md](docs/PARALLEL_5_AGENT_DIALOGUE_CASES.md)
- [TUI_SMOKE.md](docs/TUI_SMOKE.md)

반복 soak:

```bash
npm run soak:codex -- --root-dir /tmp/agent-team-codex-soak --iterations 5
```

## 현재 상태

- `bun atcli.js`, `atcli`, `agent-team app`을 포함한 **대화형 프로젝트 빌더 시작 경로**가 정리되어 있습니다.
- `doctor`, `run`, `attach`, `watch`, `tui`를 포함한 **보조/운영 경로**도 함께 유지됩니다.
- `Codex CLI` repeated soak는 실백엔드 기준 `1 / 3 / 5 iteration` 검증을 통과했습니다.
- TUI는 read-only `watch`와 interactive `tui` 둘 다 제공합니다.
- `npm run typecheck`, `npm test` 기준 현재 테스트는 통과 상태입니다.

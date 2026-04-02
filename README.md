# agent-team

`agent-team` is a reusable extraction of the teammate / swarm runtime that was
previously embedded inside `claude-code/package`.

현재는 `headless runtime + operator layer + Ink TUI`까지 올라와 있어서,
터미널 안에서 팀을 생성하고 task, approval, transcript, teammate lifecycle을
직접 운영할 수 있습니다.

## 개요

| 모듈 | 역할 |
|---|---|
| `team-core` | 팀, 태스크, 메일박스, permission, transcript, session 저장소 |
| `team-runtime` | teammate loop, runtime bridge, Codex CLI / upstream bridge |
| `team-cli` | `init`, `spawn`, `resume`, `cleanup`, `status` 같은 명령 표면 |
| `team-operator` | TUI와 앱이 재사용할 UI-neutral orchestration 계층 |
| `team-tui` | `watch`, `tui` 기반 Ink 운영 UI |

## 빠른 시작

```bash
npm install
npm run build
```

상태를 별도 경로로 격리해서 써보려면 `--root-dir`를 같이 넘기면 됩니다.

```bash
node dist/src/team-cli/bin.js --root-dir /tmp/agent-team-demo init alpha-team
node dist/src/team-cli/bin.js --root-dir /tmp/agent-team-demo task-create alpha-team "Investigate parser" "Review the parsing failure"
node dist/src/team-cli/bin.js --root-dir /tmp/agent-team-demo watch alpha-team
```

## 주요 명령

| 명령 | 용도 |
|---|---|
| `agent-team [--root-dir <path>] init <team>` | 팀 생성 |
| `agent-team [--root-dir <path>] watch <team>` | 읽기 전용 대시보드 |
| `agent-team [--root-dir <path>] tui [team]` | 인터랙티브 운영 UI |
| `agent-team [--root-dir <path>] spawn <team> <agent> --prompt <text>` | one-shot / long-running teammate 실행 |
| `agent-team [--root-dir <path>] resume <team> <agent>` | inactive teammate 재개 |
| `agent-team [--root-dir <path>] transcript <team> <agent>` | transcript 확인 |
| `agent-team [--root-dir <path>] permissions <team> [pending|resolved|rules]` | permission 상태 확인 |

전체 명령은 아래로 확인할 수 있습니다.

```bash
node dist/src/team-cli/bin.js --help
```

## TUI 사용법

```bash
node dist/src/team-cli/bin.js --root-dir /tmp/agent-team-demo tui alpha-team
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

## Runtime / Backend

지원 런타임:

- `local`
- `codex-cli`
- `upstream`

예시:

```bash
node dist/src/team-cli/bin.js --root-dir /tmp/agent-team-demo spawn alpha-team researcher \
  --prompt "Help with the current task list" \
  --runtime codex-cli \
  --model gpt-5.4-mini \
  --max-iterations 50
```

## 백그라운드 worker 동작

TUI에서 `spawn`, `resume`, `reopen`으로 띄운 teammate는 이제 같은 TUI
프로세스 안에서 도는 in-process handle이 아니라, 별도 `agent-team` CLI
프로세스로 detached 실행됩니다.

의미:

- TUI를 종료해도 worker는 계속 돌 수 있습니다.
- 상태는 `--root-dir` 기준 저장소에 계속 반영됩니다.
- worker 정리는 `shutdown`, `cleanup`, `status`, `tasks` 명령으로 확인합니다.

## 실사용 smoke 시나리오

TUI로 실제 운영 흐름을 확인하는 재현 시나리오는 아래 문서에 정리했습니다.

- [TUI_SMOKE.md](/Users/hwanchoi/projects/claude-code/agent-team/docs/TUI_SMOKE.md)

## 현재 상태

- `team-core`는 lock-safe 저장소, cleanup, permission persistence를 갖고 있습니다.
- `team-runtime`은 local / `Codex CLI` / upstream `claude` bridge를 포함합니다.
- `team-cli`와 `team-tui`는 실제 live backend smoke와 병렬 teammate 소통 시뮬레이션을 통과했습니다.
- Ink TUI는 read-only `watch`와 interactive `tui` 둘 다 제공합니다.

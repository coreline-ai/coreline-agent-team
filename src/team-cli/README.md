# team-cli

`team-cli`는 `agent-team`의 headless command surface입니다.

## 사용자가 먼저 봐야 하는 문서

- [../../docs/USER_QUICKSTART.md](../../docs/USER_QUICKSTART.md)
- [../../docs/TROUBLESHOOTING.md](../../docs/TROUBLESHOOTING.md)
- [../../README.md](../../README.md)

## 현재 지원 명령

- `app [--team <name>] [--workspace <path>] [--runtime <kind>]`
- `attach [team-name]`
- `doctor [--workspace <path>] [--probe] [--codex-executable <path>]`
- `init <team-name>`
- `run <goal...> [--workspace <path>] [--team <name>] [--preset <software-factory>]`
- `watch <team-name>`
- `tui [team-name]`
- `spawn <team-name> <agent-name> --prompt <prompt> [--cwd <path>] [--plan-mode] [--max-iterations <n>] [--runtime <local|codex-cli|upstream>]`
- `resume <team-name> <agent-name>`
- `reopen <team-name> <agent-name>`
- `cleanup <team-name>`
- `permissions <team-name> [pending|resolved|rules]`
- `transcript <team-name> <agent-name> [--limit <n>]`
- `tasks <team-name>`
- `send <team-name> <recipient> <message>`
- `status <team-name>`
- `task-create <team-name> <subject> <description>`
- `task-update <team-name> <task-id> <status> [owner|-]`
- `shutdown <team-name> <recipient> [reason]`
- `approve-permission <team-name> <recipient> <request-id>`
- `deny-permission <team-name> <recipient> <request-id> <error>`
- `approve-sandbox <team-name> <recipient> <request-id> <host>`
- `deny-sandbox <team-name> <recipient> <request-id> <host>`
- `approve-plan <team-name> <recipient> <request-id>`
- `reject-plan <team-name> <recipient> <request-id> <feedback>`
- `set-mode <team-name> <recipient> <mode>`

## 가장 사용자 친화적인 경로

1. `agent-team doctor --workspace <path> --probe`
2. `bun atcli.js --root-dir <path>` 또는 `atcli --root-dir <path>`
3. TUI 안에서 자연어 goal 입력
4. 필요 시 `attach`, `watch`, `tui`, `status`, `tasks`, `transcript`

## 중요 메모

- global option `--root-dir`를 모든 명령에서 지원합니다.
- 가장 사용자 친화적인 시작 경로는 `bun atcli.js` / `atcli` / `agent-team app` 입니다.
- 비대화형 시작 경로는 `run "<goal>"` 입니다.
- 실행 전에는 `doctor --workspace <path> --probe` 로 Codex CLI와 workspace 준비 상태를 점검하는 흐름을 권장합니다.
- 실행 후 다시 붙어서 결과를 요약해 보려면 `attach [team-name]` 을 사용합니다.
- 실사용 표준 runtime은 `codex-cli` 입니다.
- 활성 runtime 표면은 `local`, `codex-cli`, `upstream`만 유지합니다.
- direct API 호출 경로는 제공하지 않습니다.

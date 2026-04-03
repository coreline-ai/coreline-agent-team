# TROUBLESHOOTING

## 목적

이 문서는 `agent-team`을 처음 실행할 때 자주 만나는 실패 상황을 빠르게 진단하고 복구하기 위한 안내서입니다.

## 범위

현재 문서는 아래 문제만 다룹니다.

- `npm install` / `npm run build` / `npm link` 실패
- `atcli` 또는 `bun atcli.js` 실행 실패
- `agent-team doctor` 실패
- `Codex CLI` 실행 파일 미발견
- `Codex CLI` 로그인 실패
- workspace 쓰기 권한 실패
- `attach`에서 팀을 찾지 못하는 경우
- 작업이 멈춘 것처럼 보이는 경우
- `watch` / `tui`가 PTY 없이 실행된 경우

## 가장 먼저 할 일

문제가 생기면 먼저 아래를 실행하세요.

```bash
agent-team doctor --workspace /tmp/agent-team-demo --probe
```

이 출력이 현재 환경 문제를 가장 빠르게 요약해 줍니다.

## 문제별 빠른 대응표

문제 | 증상 | 확인 명령 | 조치
---|---|---|---
`agent-team` 명령이 없음 | `command not found: agent-team` | `npm link` / `which agent-team` | 프로젝트 루트에서 `npm run build && npm link` 다시 실행
`atcli` 명령이 없음 | `command not found: atcli` | `npm link` / `which atcli` | 프로젝트 루트에서 `npm run build && npm link` 다시 실행
`bun atcli.js`가 안 됨 | `bun: command not found` 또는 실행 실패 | `bun --version` / `node atcli.js --help` | Bun 미설치면 `atcli` 또는 `node atcli.js` 경로 사용
Codex 실행 파일 없음 | `Codex CLI executable: FAIL` | `which codex` / `codex --version` | Codex CLI를 설치하거나 `--codex-executable <path>` 지정
Codex 로그인 안 됨 | `Codex CLI login: FAIL` | `codex login status` | `codex login` 후 다시 `doctor --probe`
workspace 권한 문제 | `Workspace write access: FAIL` | `ls -ld <workspace>` | 쓰기 가능한 경로로 변경하거나 권한 수정
probe 실패 | `Codex exec probe: FAIL` | `codex login status` / `codex exec - --full-auto ...` | 로그인/권한/네트워크 상태 재확인
attach할 팀이 없음 | `No teams found.` | `agent-team --root-dir <path> attach` | 먼저 `run` 또는 `init` 수행, 또는 올바른 `--root-dir` 사용
작업이 멈춘 것처럼 보임 | 출력이 오래 안 바뀜 | `attach` / `status` | `state=executing-turn`, `heartbeat_age`, `turn_age`, `stale` 여부 확인
TUI 실행 실패 | raw mode / stdin 관련 오류 | 실제 터미널에서 재실행 | PTY 터미널에서 직접 `watch`/`tui` 실행

## 1. 설치/링크 문제

### 증상

- `command not found: agent-team`
- `command not found: atcli`
- `bun atcli.js` 실행 실패
- `npm link` 이후에도 `agent-team --help` 또는 `atcli --help`가 동작하지 않음

### 확인

```bash
npm run build
npm link
which agent-team
which atcli
agent-team --help
atcli --help
node atcli.js --help
```

### 조치

- 반드시 `npm run build` 이후 `npm link`를 실행합니다.
- Bun이 없다면 `bun atcli.js` 대신 `atcli` 또는 `node atcli.js`를 사용합니다.
- 현재 셸이 새로 연결한 글로벌 bin 경로를 인식하지 못하면 새 터미널을 열어 다시 시도합니다.

## 2. Codex CLI를 찾지 못하는 경우

### 증상

`doctor`에서 아래와 비슷하게 나옵니다.

```text
Codex CLI executable: FAIL
```

### 확인

```bash
which codex
codex --version
```

### 조치

- Codex CLI를 설치합니다.
- 실행 파일이 표준 PATH 밖에 있다면 아래처럼 직접 지정합니다.

```bash
agent-team doctor --workspace /tmp/agent-team-demo --codex-executable /absolute/path/to/codex --probe
```

## 3. Codex 로그인 실패

### 증상

`doctor`에서 아래와 비슷하게 나옵니다.

```text
Codex CLI login: FAIL
```

### 확인

```bash
codex login status
```

### 조치

```bash
codex login
agent-team doctor --workspace /tmp/agent-team-demo --probe
```

`agent-team`은 direct API key 경로를 사용하지 않으므로, **Codex CLI 로그인 상태가 준비되어 있어야** 합니다.

## 4. workspace 권한 실패

### 증상

```text
Workspace write access: FAIL
```

### 확인

```bash
ls -ld /tmp/agent-team-demo
mkdir -p /tmp/agent-team-demo
```

### 조치

- 가장 쉬운 방법은 `/tmp/...` 같은 쓰기 가능한 경로를 사용하는 것입니다.
- 또는 현재 사용자에게 쓰기 권한이 있는 디렉터리로 workspace를 바꿉니다.

예:

```bash
agent-team doctor --workspace /tmp/agent-team-demo --probe
agent-team --root-dir /tmp/agent-team-demo run "쇼핑몰 만들어줘" --workspace /tmp/agent-team-demo-workspace --runtime codex-cli --model gpt-5.4-mini
```

## 5. `attach`에서 팀이 안 보이는 경우

### 증상

```text
No teams found.
```

또는 원하는 팀이 목록에 없음.

### 확인

```bash
agent-team --root-dir /tmp/agent-team-demo attach
```

### 조치

- `run` 또는 `init`를 먼저 실행했는지 확인합니다.
- 실행 당시와 같은 `--root-dir`를 사용했는지 확인합니다.
- 다른 root-dir를 썼다면 그 경로로 다시 attach 합니다.

## 6. `watch` / `tui`가 안 열리는 경우

### 증상

- raw mode 관련 에러
- stdin / TTY 관련 에러

### 조치

- 실제 터미널(PTY)에서 직접 실행하세요.
- 파이프 환경, 일부 비대화형 실행기에서는 정상 동작하지 않을 수 있습니다.

정상 예:

```bash
agent-team --root-dir /tmp/agent-team-demo watch shopping-mall-demo
agent-team --root-dir /tmp/agent-team-demo tui shopping-mall-demo
```

## 7. 작업이 멈춘 것처럼 보이는 경우

### 증상

- frontend/backend 같은 worker가 몇 분 이상 같은 task에 머무는 것처럼 보임
- `attach` 결과가 오래 안 변해서 stuck처럼 느껴짐

### 확인

```bash
agent-team --root-dir /tmp/agent-team-demo attach shopping-mall-demo
agent-team --root-dir /tmp/agent-team-demo status shopping-mall-demo
```

아래처럼 보이면 **실제로는 live turn 실행 중**일 가능성이 큽니다.

```text
state=executing-turn
heartbeat_age=0s
turn_age=6m51s
```

해석 기준:

- `state=executing-turn` + `heartbeat_age=0s`
  - 현재 Codex turn이 계속 실행 중
- `turn_age`만 길고 heartbeat가 계속 0~몇 초 이내
  - 느리지만 살아 있는 작업
- `state=stale`
  - heartbeat가 오래 끊긴 상태라 stuck 가능성 점검 필요

### 조치

- 먼저 `state`, `heartbeat_age`, `turn_age`를 보고 실제 live turn인지 확인합니다.
- `state=executing-turn`이면 바로 실패로 판단하지 말고 조금 더 기다립니다.
- `state=stale`로 바뀌거나 heartbeat가 오래 갱신되지 않으면 transcript / tasks / 세션 상태를 추가로 점검합니다.

## 8. 그래도 안 되면 최소 재현 순서

아래 순서대로 다시 확인합니다.

```bash
npm install
npm run build
npm link
agent-team doctor --workspace /tmp/agent-team-demo --probe
agent-team --root-dir /tmp/agent-team-demo run "간단한 문서 프로젝트 만들어줘" --team quick-check --workspace /tmp/agent-team-demo-workspace --runtime local
agent-team --root-dir /tmp/agent-team-demo attach quick-check
```

이 최소 흐름까지 실패한다면, 실패 출력과 함께 `doctor` 결과를 기준으로 원인을 먼저 좁히는 것이 좋습니다.

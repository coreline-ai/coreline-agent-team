# USER_QUICKSTART

## 목적

이 문서는 `agent-team`을 처음 쓰는 사용자가 **설치 → 환경 점검 → goal 실행 → 결과 확인**까지 실제로 따라 할 수 있게 돕기 위한 빠른 시작 가이드입니다.

## 범위

이 문서는 현재 지원되는 실사용 경로만 다룹니다.

- `npm install` / `npm run build` / `npm link`
- `agent-team doctor`
- `bun atcli.js` / `atcli` / `agent-team app`
- `agent-team run "<goal>"`
- `agent-team attach`
- `agent-team watch`, `agent-team tui`

## 중요한 제약

- 표준 LLM 경로는 `Codex CLI` 입니다.
- direct OpenAI API / 기타 vendor API 경로는 지원하지 않으며 금지입니다.
- 현재 `run` preset은 `software-factory` 1개입니다.

## 1. 설치

프로젝트 루트에서 실행합니다.

```bash
npm install
npm run build
npm link
```

설치 후 아래 명령이 동작해야 합니다.

```bash
agent-team --help
```

## 2. 실행 전 환경 점검

workspace를 하나 정하고 `doctor`를 먼저 실행합니다.

```bash
agent-team doctor --workspace /tmp/agent-team-demo --probe
```

정상 기대 결과:

- `Codex CLI executable: OK`
- `Codex CLI login: OK`
- `Workspace write access: OK`
- `Codex exec probe: OK`
- 마지막 줄 `Result: READY`

문제가 있으면 [TROUBLESHOOTING.md](TROUBLESHOOTING.md)를 먼저 확인하세요.

## 3. 대화형 프로젝트 빌더 실행

아래 셋 중 하나가 현재 가장 사용자 친화적인 시작 경로입니다.

```bash
bun atcli.js --root-dir /tmp/agent-team-demo
# 또는
atcli --root-dir /tmp/agent-team-demo
# 또는
agent-team --root-dir /tmp/agent-team-demo app
```

실행하면 자연어 goal 입력 대기 화면이 뜹니다.
예: `쇼핑몰 만들어줘`

앱 안에서 바로 확인할 수 있는 것:

- 결과 상태(`pending`, `running`, `completed`, `attention`)
- 생성된 파일 목록
- 핵심 결과물 preview
- large-output일 때 `Generated Files (24+)`, `showing first ... discovered files`, `trimmed=...` 같은 요약 힌트
- teammate / task 진행 상태
- live teammate 상태(`executing-turn`, `settling`, `stale`)

앱이 자동 팀 이름을 만들었다면, 이후 팀 이름이 기억나지 않을 때는 `agent-team --root-dir <path> attach`로 목록부터 확인하면 됩니다.

앱 내부 명령:

- plain text: 기본적으로 `planner`에게 follow-up 전송
- `/to <agent> <message>`: 특정 teammate 지정
- `/doctor`: 준비 상태 재검사
- `/quit`: 종료

동일한 작업을 비대화형으로 바로 시작하고 싶다면 아래 명령도 계속 지원합니다.

```bash
agent-team --root-dir /tmp/agent-team-demo \
  run "쇼핑몰 만들어줘" \
  --team shopping-mall-demo \
  --workspace /tmp/agent-team-demo-workspace \
  --runtime codex-cli \
  --model gpt-5.4-mini
```

이 경로는 아래를 자동으로 수행합니다.

- team 생성
- workspace 생성
- `planner`, `search`, `frontend`, `backend`, `reviewer` bootstrap
- 초기 task 생성
- background teammate launch

## 4. 진행 상황 보기

대화형 앱 안에서도 상태를 계속 볼 수 있지만, 외부 터미널에서 다시 붙어 확인하려면 `attach`가 가장 먼저 권장됩니다.

```bash
agent-team --root-dir /tmp/agent-team-demo attach shopping-mall-demo
```

여기서 확인할 수 있는 것:

- goal
- workspace 경로
- 결과 상태
- teammate 상태
- live 상태 집계(`executing`, `settling`, `stale`)
- long-running turn 표시(`work`, `turn_age`, `heartbeat_age`)
- task 집계
- 최근 activity
- 감지된 생성 파일
- large-output일 때 `showing first ... discovered files`, `preview_selection`, `preview_trimmed` 같은 summary/preview metadata
- 다음 추천 명령

진행 화면이 필요하면 아래를 사용합니다.

```bash
agent-team --root-dir /tmp/agent-team-demo watch shopping-mall-demo
agent-team --root-dir /tmp/agent-team-demo tui
agent-team --root-dir /tmp/agent-team-demo tui shopping-mall-demo
```

- `tui`만 실행하면 현재 root-dir 아래 팀 목록과 overview를 먼저 볼 수 있습니다.
- `attention` 상태 팀이 먼저 올라오고, 각 row에 approvals / workers / tasks 요약이 같이 보입니다.
- `Enter`로 팀을 열고, `c`로 새 팀을 만들 수 있습니다.
- create 화면으로 들어가도 기존 팀이 있으면 `Esc`로 다시 team picker로 돌아갈 수 있습니다.

## 5. 결과 더 자세히 보기

```bash
agent-team --root-dir /tmp/agent-team-demo status shopping-mall-demo
agent-team --root-dir /tmp/agent-team-demo tasks shopping-mall-demo
agent-team --root-dir /tmp/agent-team-demo transcript shopping-mall-demo planner --limit 20
```

특히 `status`는 long-running turn을 읽을 때 유용합니다.

- `state=executing-turn` + `heartbeat_age=0s` → 현재 작업 중
- `turn_age=6m...` 같이 길어져도 heartbeat가 계속 갱신되면 live turn
- `state=stale` → heartbeat가 오래 멈춘 상태라 추가 점검 필요

workspace 파일도 같이 확인합니다.

```bash
find /tmp/agent-team-demo-workspace -maxdepth 2 -type f | sort
```

## 6. attach를 다시 사용하는 방법

팀 이름이 기억나지 않으면 인자 없이 실행하면 됩니다.

```bash
agent-team --root-dir /tmp/agent-team-demo attach
```

그러면 현재 root-dir 안에서 attach 가능한 팀 목록을 보여줍니다.

## 7. TUI 사용 시 주의

- `watch`, `tui`는 실제 터미널(PTY)에서 실행하세요.
- 파이프 환경에서는 Ink raw mode 제약으로 정상 동작하지 않을 수 있습니다.

## 8. 처음 검증만 빠르게 해보고 싶다면

real Codex 작업 전에 빠른 smoke만 보고 싶다면 `local` runtime을 사용할 수 있습니다.

```bash
agent-team --root-dir /tmp/agent-team-demo-local \
  run "간단한 문서 프로젝트 만들어줘" \
  --team quick-local-demo \
  --workspace /tmp/agent-team-demo-local-workspace \
  --runtime local
```

다만 **실제 사용 표준 경로는 `codex-cli`** 입니다.

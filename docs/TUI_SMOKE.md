# TUI Smoke Scenario

## 개요

이 문서는 `agent-team`의 Ink TUI를 실제 유저 시점에서 빠르게 확인하는
재현 가능한 smoke 시나리오입니다.

목표:

1. 팀 생성
2. task 생성
3. TUI 진입
4. teammate spawn
5. 상태 변화, transcript, approval 흐름 확인
6. TUI 종료 후에도 background worker가 상태를 계속 반영하는지 확인

## 준비

```bash
cd <repo-root>
npm install
npm run build
```

권장 격리 경로:

```bash
export AGENT_TEAM_ROOT=/tmp/agent-team-tui-smoke
rm -rf "$AGENT_TEAM_ROOT"
```

## 1. 팀과 초기 task 만들기

```bash
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" init alpha-team
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" task-create alpha-team "Investigate parser" "Review the parser failure"
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" task-create alpha-team "Write notes" "Summarize findings for the lead"
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" init beta-team
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" task-create beta-team "Check backlog" "Review the second team overview row"
```

## 2. team picker / overview 먼저 확인

```bash
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" tui
```

확인 포인트:

- team picker가 바로 열린다.
- `alpha-team`, `beta-team` 두 팀이 모두 보인다.
- 각 row에 `pending approvals`, `workers`, `tasks` 요약이 같이 보인다.
- attention-needed 팀이 있으면 목록 상단으로 올라온다.
- `Enter`로 선택한 팀을 열 수 있다.
- `c`로 create mode로 들어간 뒤 `Esc`로 다시 team list로 복귀할 수 있다.

## 3. 읽기 전용 대시보드 먼저 확인

```bash
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" watch alpha-team
```

확인 포인트:

- `Tasks` pane에 방금 만든 task 2개가 보인다.
- `Teammates` pane은 아직 비어 있거나 `team-lead`만 있다.
- `Root`가 `/tmp/agent-team-tui-smoke`로 표시된다.

## 4. Interactive TUI 진입

```bash
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" tui alpha-team
```

기본 단축키:

- `Tab`: Tasks / Teammates pane 전환
- `[` `]`: Activity / Transcript / Logs detail tab 전환
- `,` `.`: Logs tab에서 `stderr` / `stdout` 전환
- `j` `k`: detail pane 스크롤
- `s`: teammate spawn
- `t`: task 생성
- `m`: leader message 전송
- `a`: approval inbox
- `u`: resume
- `x`: shutdown request
- `r`: refresh
- `q`: quit

## 5. teammate spawn

TUI 안에서:

1. `s` 입력
2. 아래 값으로 spawn

권장 예시:

- Agent: `researcher`
- Prompt: `Help with the current task list and reply to leader messages.`
- Runtime: `codex-cli`
- Model: `gpt-5.4-mini`

기대 결과:

- spawn 직후 toast가 뜬다.
- 잠시 후 `Teammates` pane에 `researcher`가 나타난다.
- `Tasks` pane에서 한 task가 `in_progress` 또는 `completed`로 바뀐다.
- `Activity Feed`에 idle notification 또는 assistant summary가 추가된다.

## 6. direct message / transcript 확인

TUI 안에서:

1. `m` 입력
2. recipient를 `researcher`로 두고 짧은 메시지 전송
3. 예시 메시지: `Reply with exactly STATUS_OK.`

기대 결과:

- `Activity Feed` 또는 transcript drawer에 응답 흔적이 남는다.
- `researcher`를 선택하면 transcript 영역에 task 처리와 direct message 응답이 같이 보인다.

CLI로도 확인 가능:

```bash
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" transcript alpha-team researcher --limit 10
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" status alpha-team
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" tasks alpha-team
```

## 6-1. TUI log viewer 확인

TUI 안에서:

1. `Tab`으로 `Teammates` pane을 선택
2. `researcher`를 선택
3. `]`를 눌러 `Logs` tab으로 이동
4. `.` 또는 `,`로 `stderr` / `stdout`을 전환
5. `j` / `k`로 최근 log tail을 스크롤

확인 포인트:

- detail tab에 `Logs / researcher [stderr]` 또는 `[stdout]`가 보인다.
- log path가 `path=...researcher.stderr.log` 또는 `path=...researcher.stdout.log`로 보인다.
- tail이 bounded read라면 `showing bounded tail ... bytes` 안내가 보인다.
- 긴 한 줄 로그는 `trimmed ... long line(s) for the TUI`로 표시된다.
- 비어 있는 파일은 `log file is empty`, 없는 파일은 `log file is missing`으로 구분된다.

## 6-2. project builder large-output preview 확인

이 항목은 control TUI가 아니라 `agent-team app` / `atcli` 쪽 확인 포인트다.

확인 포인트:

- generated files가 많은 goal/workspace라면 Files 탭 title이 `Generated Files (24+)`처럼 lower-bound count로 보인다.
- Files 탭에 `showing first ... discovered files`, `+... more discovered files not shown`가 보인다.
- Preview 탭에 `excerpt=...`, `selection=priority|signal`, `trimmed=... more line(s) hidden`가 보인다.
- 파일 수가 적은 run에서는 위 large-output metadata가 나타나지 않을 수 있다.

## 7. approval 흐름 확인

permission이나 sandbox approval이 발생하면:

1. TUI에서 `a` 입력
2. pending approval item 선택
3. `Approve` 또는 `Deny`

확인 포인트:

- approval item이 inbox에서 사라진다.
- `Activity Feed`에 관련 메시지가 남는다.
- permission approval이면 selected detail 영역에 `cmd=` / `cwd=` / `path=` / `host=` 중 해당 맥락이 보인다.
- permission approval이면 `Suggested persistence:` 아래에 `match command~...`, `match cwd^=...` 같은 힌트가 보인다.
- permission approval이면 `Preset:` / `Available presets:` 줄이 보이고, 가능한 preset(`suggested`, `cwd`, `path`, `host` 등)이 노출된다.
- 필요하면 `1`~`5` 또는 `←/→`로 preset을 바꾼 뒤 persist decision과 함께 저장할 수 있다.
- 필요하면 아래로 persisted rule 상태 확인 가능

```bash
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" permissions alpha-team pending
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" permissions alpha-team rules
```

## 8. background worker 확인

중요:

- TUI에서 띄운 `spawn`, `resume`, `reopen`은 detached background process입니다.
- TUI를 닫아도 worker는 계속 돌 수 있습니다.
- 기본 lifecycle은 `maxIterations=50`, `pollIntervalMs=500`인 bounded loop입니다.

검증:

1. `q`로 TUI 종료
2. 아래 명령으로 상태 재확인

```bash
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" status alpha-team
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" tasks alpha-team
```

기대 결과:

- worker 상태와 task 상태가 저장소 기준으로 계속 보인다.
- open task가 있으면 background worker가 처리 중일 수 있다.

## 9. 정리

worker 종료:

```bash
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" shutdown alpha-team researcher "smoke complete"
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" cleanup alpha-team --remove-inactive
```

마지막 확인:

```bash
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" status alpha-team
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" tasks alpha-team
```

## 통과 기준

- TUI가 정상적으로 뜬다.
- task 목록과 teammate 상태가 보인다.
- team picker에서 여러 팀 row와 overview count가 보인다.
- selected teammate 기준으로 `Logs` tab에서 `stdout` / `stderr`를 전환할 수 있다.
- empty / missing / bounded-tail 상태가 TUI에 명확히 표시된다.
- `spawn`으로 worker를 띄울 수 있다.
- task 상태가 `pending -> in_progress/completed`로 변한다.
- transcript와 activity feed에 기록이 남는다.
- approval이 있다면 TUI 안에서 처리 가능하다.
- TUI 종료 후에도 background worker 상태가 CLI에서 이어진다.

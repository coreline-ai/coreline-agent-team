# CLI 최종 smoke 시나리오

## 목적

`agent-team`의 현재 CLI 표면이 실제 파일 저장소 기준으로 끝까지 동작하는지
재현 가능한 절차로 검증한다.

## 범위

- `init`
- `task-create`
- `spawn`
- `status`
- `logs`
- `tasks`
- `transcript`
- `resume`
- `reopen`
- `shutdown`
- `approve-permission`
- `deny-permission`

## 강한 제외 범위

- direct API 호출 검증
- 새로운 runtime/backend 추가 검증
- TUI 상호작용 검증
- soak test / 장시간 burn-in

이 문서는 **독립 실행 CLI smoke**만 다룬다.  
LLM 사용 경로는 프로젝트 원칙대로 `Codex CLI` / upstream CLI 같은 **CLI runtime**
기준으로 유지하며, API 경로는 이 smoke 범위에 포함하지 않는다.

## 참조 문서

- [README.md](../README.md)
- [AGENT.md](../AGENT.md)
- [TUI_SMOKE.md](./TUI_SMOKE.md)

## 사전 준비

```bash
cd <repo-root>
npm ci
npm run build
```

```bash
export AGENT_TEAM_ROOT=/tmp/agent-team-cli-smoke
rm -rf "$AGENT_TEAM_ROOT"
mkdir -p "$AGENT_TEAM_ROOT"
```

## 1) 팀 초기화

```bash
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" init alpha-team
```

기대 결과

- `Initialized team "alpha-team"` 문구가 출력된다.
- `team-lead`가 기본 member로 생성된다.

## 2) task 생성

```bash
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" task-create alpha-team "Investigate parser" "Check the parser regression"
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" task-create alpha-team "Write notes" "Summarize the findings"
```

기대 결과

- task `#1`, `#2`가 생성된다.

## 3) local runtime one-shot spawn

```bash
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" spawn alpha-team researcher \
  --prompt "Complete one task and report progress" \
  --cwd "$PWD" \
  --runtime local \
  --max-iterations 1
```

기대 결과

- `Spawned researcher` 문구가 출력된다.
- worker는 실행 후 종료되어 `inactive`가 된다.
- 첫 번째 pending task가 `completed`가 된다.

## 4) 상태 확인

```bash
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" status alpha-team
```

기대 결과

- `researcher [idle]`가 보인다.
- `state=idle`이 보인다.
- `active=no`가 보인다.
- `runtime=local`이 보인다.
- `heartbeat_age=` 정보가 출력된다.
- `session=` 정보가 출력된다.
- detached worker였다면 `stdout_log=`, `stderr_log=`, `stderr_tail=`이 함께 보인다.

추가로 재진입 요약도 같이 확인한다.

```bash
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" attach alpha-team
```

기대 결과

- `Attached to team "alpha-team"`가 보인다.
- `result=running` 또는 현재 task 상태와 모순되지 않는 결과가 보인다.
- `generated files:` / `preview:` / `recent activity:` 섹션이 정상 출력된다.
- detached worker가 있으면 teammate 줄에 `stdout_log=`, `stderr_log=`, `stderr_tail=` 요약이 포함된다.
- raw task store가 아직 `pending`이어도 특정 teammate가 `state=executing-turn`, `heartbeat_age=0s`이면 live turn으로 해석한다.
- `attach` / `status` / dashboard / TUI task pane의 summary count와 task badge는 이런 live turn을 `effective in_progress`로 보여준다.
- overlapping scope 또는 broad task가 있으면 `guardrails:` 경고가 함께 출력된다.
- team size가 5명을 넘거나 recent same-message fan-out이 넓으면 `cost:` 경고가 함께 출력된다.
- workspace 파일이 많으면 `summary: total>=...`, `showing first ... discovered files`, `+... more discovered files not shown`, `preview_selection=...`, `preview_trimmed=...` 같은 large-output metadata가 함께 출력된다.

## 4-1) detached worker log surface 확인

```bash
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" logs alpha-team researcher stderr --lines 20 --bytes 16384
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" logs alpha-team researcher stdout --lines 20 --bytes 16384
```

기대 결과

- `=== researcher stderr ===` / `=== researcher stdout ===` 헤더가 보인다.
- 경로가 recorded 되어 있으면 `path=`가 출력된다.
- 파일이 비어 있으면 `state=empty`, 없으면 `state=missing`, 읽을 수 없으면 `state=unreadable`가 보인다.
- bounded read가 잘렸다면 `truncated=yes` 와 `bytes=` 정보가 보인다.

## 5) task 목록 확인

```bash
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" tasks alpha-team
```

기대 결과

- `#1 [completed] Investigate parser`
- `#2 [pending] Write notes`

즉, worker가 종료된 뒤에도 `inactive + busy + in_progress` 같은 모순 상태가 없어야 한다.

## 6) transcript 확인

```bash
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" transcript alpha-team researcher --limit 10
```

기대 결과

- `work_item` 또는 작업 요약 entry가 보인다.
- `assistant` summary가 보인다.

## 6-1) permission surface 확인

```bash
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" permissions alpha-team pending
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" permissions alpha-team rules
```

기대 결과

- pending approval이 있으면 각 항목 아래에 `cmd=`, `cwd=`, `path=`, `host=` 중 구조화된 맥락이 함께 보인다.
- pending approval이 있으면 `match command~...`, `match cwd^=...` 같은 suggested matcher 줄도 같이 보인다.
- persisted rule이 있으면 `rules` 출력에 `contains=...`, `command~...`, `cwd^=...` 같은 저장 규칙 정보가 보인다.

선택적으로 persisted preset rule도 확인한다.

```bash
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" approve-permission alpha-team researcher perm-ctx-1 --persist --preset suggested
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" deny-permission alpha-team researcher perm-ctx-2 "Denied by lead" --persist --preset host
```

기대 결과

- `--preset suggested|command|cwd|path|host` surface가 동작한다.
- `--preset`과 explicit `--match-*`를 함께 쓰면 parser 단계에서 거부된다.
- persisted rule 메시지에 실제로 저장된 matcher가 반영된다.

## 7) resume 확인

```bash
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" resume alpha-team researcher --max-iterations 1
```

기대 결과

- `Resumed researcher` 문구가 출력된다.
- `(new-session)`이 포함된다.
- 남아 있던 pending task가 처리된다.

바로 이어서:

```bash
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" attach alpha-team
```

기대 결과

- `result=completed` 또는 최종 task 집계와 모순되지 않는 상태가 보인다.
- `teammates:`에서 `researcher`가 `active=no`로 보인다.

## 8) reopen 확인

```bash
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" reopen alpha-team researcher --max-iterations 1
```

기대 결과

- `Reopened researcher` 문구가 출력된다.
- `(existing-session)`이 포함된다.
- reopen 명령이 저장된 session metadata를 재사용한다.

바로 이어서:

```bash
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" attach alpha-team
```

기대 결과

- `session=` 의미가 `resume` 단계의 최신 세션과 이어진다.
- `recent activity:`와 `transcript` 해석이 모순되지 않는다.

## 9) 종료 요청 확인

```bash
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" shutdown alpha-team researcher "cli smoke complete"
```

기대 결과

- shutdown request가 기록된다.
- 이미 inactive 상태라면 안전하게 no-op에 가까운 종료 흐름이어도 괜찮다.

## 10) 최종 점검

```bash
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" status alpha-team
node dist/src/team-cli/bin.js --root-dir "$AGENT_TEAM_ROOT" tasks alpha-team
```

최종 확인 기준

- CLI 명령이 끝까지 오류 없이 실행된다.
- task/status/transcript가 서로 모순되지 않는다.
- `resume`은 새 session, `reopen`은 기존 session 의미를 유지한다.
- detached worker의 log path와 recent stderr tail이 attach/status에서 읽힌다.
- raw task 상태와 runtime turn 상태가 잠시 어긋날 수 있지만, 사용자 surface에서는 이를 `effective in_progress`로 승격해 보여준다.
- 여전히 live turn 판단은 `state`, `heartbeat_age`, `turn_age`, `stderr_tail`을 함께 본다.
- broad task / overlapping scope는 guardrail warning으로 보여야 하며, 필요 시 `blockedBy`나 scoped path로 분해한다.
- team size / fan-out / recent broadcast가 넓으면 cost warning이 보여야 하며, 가능하면 3~5명 / targeted routing / staged fan-out으로 줄인다.
- 이번 smoke는 **CLI runtime 경로 검증**이며, API 호출 검증이 아니다.

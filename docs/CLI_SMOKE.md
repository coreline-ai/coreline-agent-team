# CLI 최종 smoke 시나리오

## 목적

`agent-team`의 현재 CLI 표면이 실제 파일 저장소 기준으로 끝까지 동작하는지
재현 가능한 절차로 검증한다.

## 범위

- `init`
- `task-create`
- `spawn`
- `status`
- `tasks`
- `transcript`
- `resume`
- `reopen`
- `shutdown`

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
- task가 아직 `pending`이어도 특정 teammate가 `state=executing-turn`, `heartbeat_age=0s`이면 live turn으로 해석한다.

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
- `pending task`와 `executing-turn`이 동시에 보일 수 있으며, 이 경우 heartbeat와 stderr tail을 함께 보고 live turn 여부를 판단한다.
- 이번 smoke는 **CLI runtime 경로 검증**이며, API 호출 검증이 아니다.

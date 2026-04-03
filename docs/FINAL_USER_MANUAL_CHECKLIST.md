# FINAL_USER_MANUAL_CHECKLIST

## 목적

이 문서는 실제 사용자가 `agent-team`을 설치 후 실행해
`doctor -> atcli -> attach -> 결과 확인`
흐름을 문제 없이 수행할 수 있는지 최종 수동 검증하기 위한 체크리스트다.

## 범위

- `Codex CLI` 기준 실사용 경로만 검증한다.
- `atcli` 대화형 실행 경로를 우선 검증한다.
- 결과 확인은 `attach`, `tasks`, `transcript`, workspace 파일 기준으로 확인한다.

## 제외 범위

- cosmetic UI polishing
- preset/role 고도화
- direct API 기반 LLM 연동
- remote/multi-machine 환경

## 사전 조건

- `npm install`
- `npm run build`
- `npm link`
- `codex login status` 정상

## 최종 수동 체크리스트

- [x] `npm run build` 성공
- [x] `npm link` 후 `atcli` 명령 사용 가능
- [x] `agent-team doctor --workspace <path> --probe` 결과가 `READY`
- [x] `atcli --root-dir <path> --runtime codex-cli --workspace <path>` 실행 시 자연어 goal 입력 대기 화면이 열린다
- [x] goal 입력 후 팀이 자동 bootstrap 된다
- [x] `attach <team>` 에서 `goal`, `workspace`, `result`, `tasks`, `teammates`, `generated files` 가 보인다
- [x] 진행 중 최소 1회 이상 `result=running` 상태를 확인한다
- [x] workspace에 `docs/*` 산출물이 실제 생성된다
- [x] workspace에 `frontend/*` 산출물이 실제 생성된다
- [x] workspace에 `backend/*` 산출물이 실제 생성된다
- [x] `transcript <team> frontend --limit 20` 또는 구현 agent transcript에 assistant completion이 기록된다
- [x] 최종적으로 `attach <team>` 에서 `result=completed` 가 보인다
- [x] 최종적으로 `tasks <team>` 에서 `pending=0`, `in_progress=0`, `completed=5` 상태가 된다
- [x] 최종적으로 모든 teammate가 `idle`, `active=no` 상태가 된다

## 실행 기록

- 실행 일시: `2026-04-03 15:42:49 KST`
- root-dir: `/tmp/agent-team-final-user-root`
- workspace: `/tmp/agent-team-final-user-workspace`
- team: `create-a-tiny-shopping-m-mniiyyvq`

## 실행 결과 요약

- 결과: `PASS`
- 메모:
  - `agent-team doctor --workspace /tmp/agent-team-final-user-workspace --probe` 결과 `READY`
  - `atcli --root-dir /tmp/agent-team-final-user-root --runtime codex-cli --workspace /tmp/agent-team-final-user-workspace` 로 실제 사용자 흐름 검증
  - 진행 중 `attach` 에서 `result=running` 확인
  - 최종 `attach` 에서 `result=completed`, `pending=0`, `in_progress=0`, `completed=5` 확인
  - 실제 생성 산출물 확인:
    - `docs/*`
    - `frontend/*`
    - `backend/*`
  - `transcript create-a-tiny-shopping-m-mniiyyvq frontend --limit 20` 에 assistant completion 기록 확인

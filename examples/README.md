# examples

이 디렉터리는 `agent-team`의 실제 사용 예시를 모아두는 자리입니다.

## 가장 먼저 볼 문서

- [../docs/USER_QUICKSTART.md](../docs/USER_QUICKSTART.md)
- [../docs/TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md)
- [../docs/CLI_SMOKE.md](../docs/CLI_SMOKE.md)

## 가장 중요한 사용 예시

현재 가장 사용자 친화적인 경로는 아래 4단계입니다.

### 1. 설치

```bash
npm install
npm run build
npm link
```

### 2. 환경 점검

```bash
agent-team doctor --workspace /tmp/agent-team-demo --probe
```

### 3. 대화형 프로젝트 빌더 실행

```bash
bun atcli.js --root-dir /tmp/agent-team-demo
# 또는
atcli --root-dir /tmp/agent-team-demo
# 또는
agent-team --root-dir /tmp/agent-team-demo app
```

화면이 뜨면 자연어로 `쇼핑몰 만들어줘` 같은 goal을 입력합니다.

### 4. 진행 / 결과 확인

```bash
agent-team --root-dir /tmp/agent-team-demo attach shopping-mall-demo
agent-team --root-dir /tmp/agent-team-demo watch shopping-mall-demo
agent-team --root-dir /tmp/agent-team-demo tui shopping-mall-demo
agent-team --root-dir /tmp/agent-team-demo status shopping-mall-demo
```

## `run`이 자동으로 하는 일

- workspace 생성
- team 생성
- **goal 분석 기반 동적 역할 선택** (10종 역할 풀에서 키워드 매칭, `--roles`로 수동 오버라이드 가능)
- 선택된 역할별 task 생성
- 초기 leader mailbox message 생성
- background teammate launch

## attach에서 보는 내용

`attach`는 아래를 한 번에 요약합니다.

- goal / workspace
- 결과 상태
- teammate 상태
- task 집계
- 최근 activity
- 생성 파일
- 다음 추천 명령

## 참고

- 이 프로젝트의 기본 LLM 경로는 `Codex CLI` 입니다.
- direct API 기반 실행 경로는 지원하지 않으며 범위 밖입니다.
- `run` 경로는 `software-factory` preset 기반이며, goal 키워드 분석으로 역할을 동적 선택합니다.
- 빠른 smoke만 필요하면 `--runtime local`로 먼저 검증할 수 있지만, 실사용 표준 경로는 `codex-cli` 입니다.

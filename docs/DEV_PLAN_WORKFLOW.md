# DEV_PLAN_WORKFLOW

## 개요

이 문서는 `coreline-ai/dev-plan-skill`의 워크플로를 `agent-team` 저장소에
맞게 적용한 로컬 운영 규칙이다.

원본 스킬의 핵심 의도는 다음과 같다.

- 구현 전에 **이번 작업의 목적**을 먼저 고정한다.
- **개발 범위**와 **제외 범위**를 문서 상단에 고정한다.
- 작업을 **Phase 단위**로 나누고, 각 Phase마다 **자체 테스트**를 둔다.
- 같은 workstream은 같은 문서를 계속 업데이트하고, 새 workstream은 새 문서를 만든다.
- 구현 이슈와 수정 내역을 해당 Phase 안에 남겨서 히스토리를 쌓는다.

`agent-team`은 이미 `dev-plan/` 이력을 사용하고 있었기 때문에, 이번 적용은
원본 스킬을 그대로 복제하는 대신 **현재 저장소 흐름과 맞는 로컬 규칙**으로
정리하는 방식으로 반영했다.

## 이 저장소에서의 적용 원칙

1. 새 구현 workstream이 시작되면 `dev-plan/implement_YYYYMMDD_HHMMSS.md`를 만든다.
2. 같은 workstream을 이어가는 동안에는 같은 문서를 계속 업데이트한다.
3. 문서 상단에는 반드시 아래 항목을 넣는다.
   - `개발 목적`
   - `개발 범위`
   - `제외 범위`
   - `참조 문서`
   - `공통 진행 규칙`
4. 작업은 Phase 기반으로 나누고, 각 Phase에 아래를 넣는다.
   - `구현 태스크`
   - `자체 테스트`
   - `이슈 및 수정`
   - `완료 조건`
5. 테스트 완료 전에는 다음 Phase로 넘어가지 않는다.
6. 문서에 없는 범위 확장은 하지 않는다.

## 이 저장소에서 먼저 읽을 문서

새 implement 문서를 만들기 전에 아래 문서를 먼저 읽는 것을 기본 규칙으로 둔다.

1. [README.md](../README.md)
2. [AGENT.md](../AGENT.md)
3. [USER_QUICKSTART.md](./USER_QUICKSTART.md)
4. [GOAL_CLOSURE_PLAN.md](./GOAL_CLOSURE_PLAN.md)
5. [DEVELOPMENT_PROGRESS.md](./DEVELOPMENT_PROGRESS.md)

필요한 경우 추가로:

- [RELIABILITY_CHECKLIST.md](./RELIABILITY_CHECKLIST.md)
- [ORIGINAL_PARITY_REVIEW.md](./ORIGINAL_PARITY_REVIEW.md)
- [CLI_SMOKE.md](./CLI_SMOKE.md)
- [TUI_SMOKE.md](./TUI_SMOKE.md)
- [CODEX_REPEATED_SOAK.md](./CODEX_REPEATED_SOAK.md)

## 현재 저장소에서 주의할 점

- 기존 `dev-plan/implement_*.md` 파일 중 일부는 이번 스킬 적용 이전에 작성되어,
  섹션 이름이나 H1 형식이 원본 스킬과 완전히 같지 않을 수 있다.
- **앞으로 새로 만드는 문서부터는 원본 스킬 구조에 더 가깝게 맞춘다.**
- 현재 프로젝트의 표준 LLM/runtime 경로는 항상 `Codex CLI`이다.
- direct API 기반 모델 연동은 dev-plan 범위에 포함하지 않는다.

## 새 문서 만들기

프로젝트에는 스킬 원문을 참고해서 만든 로컬 스캐폴더가 들어 있다.

파일:

- [scripts/new_dev_plan.py](/Users/hwanchoi/projects/claude-code/agent-team/scripts/new_dev_plan.py)

예시:

```bash
cd /Users/hwanchoi/projects/claude-code/agent-team

python3 scripts/new_dev_plan.py \
  --root . \
  --purpose "background worker 관측성과 generated preview UX를 개선한다." \
  --scope "status/attach/project builder의 가시성과 soak/burn-in 운영성 개선에 한정한다." \
  --reference "README.md" \
  --reference "AGENT.md" \
  --reference "docs/GOAL_CLOSURE_PLAN.md" \
  --exclude "새 runtime/backend 추가" \
  --exclude "direct API 기반 LLM 경로 추가" \
  --phase "관측성 보강" \
  --phase "preview UX 개선" \
  --phase "burn-in 검증 문서화"
```

## 생성 문서 규칙

- 파일명은 반드시 `implement_YYYYMMDD_HHMMSS.md`
- 첫 번째 H1은 파일명을 `.md`까지 포함해 그대로 사용
- 상단에 `작성 일시` 포함
- markdown checkbox 사용
- 각 Phase는 테스트 없이는 완료 표시 금지

## 현재 추천 다음 workstream

현재 상태 기준으로 다음 implement 문서 후보는 아래 흐름이 가장 자연스럽다.

1. background worker log / PID visibility
2. generated files / preview UX polish
3. longer soak / restart validation

이 workstream을 위해 이미 새 문서를 하나 만들었다.

- [implement_20260403_185856.md](../dev-plan/implement_20260403_185856.md)

## 원본 스킬 대비 적용 방식

| 항목 | 원본 스킬 | 현재 저장소 적용 |
|---|---|---|
| 목적 | scope-first phased doc | 동일 |
| 문서 위치 | `dev-plan/` | 동일 |
| 스캐폴더 | `new_dev_plan.py` | 로컬 `scripts/new_dev_plan.py` 추가 |
| Codex skill 설치 | 외부 skill 폴더 설치 | 저장소 내부 workflow로 흡수 |
| Claude command/agent | 선택 제공 | 현재는 문서/스크립트 중심 적용 |

## 한 줄 정리

`agent-team`은 이제 `dev-plan-skill`의 핵심 워크플로를 로컬 규칙으로 흡수했고,
앞으로 새 구현 작업은 `dev-plan/implement_*.md` 기준으로 목적, 범위, Phase,
자체 테스트를 먼저 고정한 뒤 진행하는 것을 기본 원칙으로 한다.

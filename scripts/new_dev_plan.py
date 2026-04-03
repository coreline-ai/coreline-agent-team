#!/usr/bin/env python3
"""Create a lightweight phased development plan markdown file."""

from __future__ import annotations

import argparse
import re
from datetime import datetime
from pathlib import Path


def clean_items(values: list[str] | None) -> list[str]:
    if not values:
        return []
    return [value.strip() for value in values if value and value.strip()]


def format_heading(index: int, name: str) -> str:
    stripped = name.strip() or f"Phase {index}"
    if re.match(r"^(P\d+\.|Phase\s+\d+\.)", stripped):
        return stripped
    return f"Phase {index}. {stripped}"


def phase_status_line(index: int, name: str) -> str:
    return f"- [ ] {format_heading(index, name)} 완료"


def phase_block(index: int, name: str) -> str:
    heading = format_heading(index, name)
    return f"""## {heading}

### 목표
- 이 Phase의 목표를 적는다.

### 구현 태스크
- [ ] 세부 구현 작업을 추가한다.
- [ ] 구현 완료 기준을 만족하도록 마무리한다.

### 자체 테스트
- [ ] 테스트 케이스를 정의한다.
- [ ] 테스트를 실행한다.
- [ ] 결과를 확인한다.

### 이슈 및 수정
- [ ] 발견 이슈 없음

### 완료 조건
- [ ] 구현 완료
- [ ] 자체 테스트 완료
- [ ] 다음 Phase 진행 가능
"""


def format_references(refs: list[str], previous_plan: str | None) -> str:
    items = list(refs)
    if previous_plan and previous_plan.strip():
        items.insert(0, f"이전 개발 계획: {previous_plan.strip()}")
    if not items:
        return "- 없음"
    return "\n".join(f"- {item}" for item in items)


def build_content(
    filename: str,
    created_at: str,
    purpose: str,
    scope: str,
    excludes: list[str],
    refs: list[str],
    phases: list[str],
    previous_plan: str | None,
) -> str:
    exclude_lines = (
        "\n".join(f"- {item}" for item in excludes)
        if excludes
        else "- 문서에 없는 신규 기능 또는 무관한 리팩토링 추가 금지"
    )
    ref_lines = format_references(refs, previous_plan)
    phase_names = phases or ["TODO"]
    phase_status = "\n".join(
        phase_status_line(index, name)
        for index, name in enumerate(phase_names, start=1)
    )
    phase_sections = "\n\n".join(
        phase_block(index, name)
        for index, name in enumerate(phase_names, start=1)
    )

    return f"""# {filename}

작성 일시: `{created_at}`

이 문서는 이번 개발의 범위를 고정하고, 구현이 목적 밖으로 확장되지 않도록 하기 위한 작업 문서다.

## 개발 목적
{purpose}

## 개발 범위
{scope}

## 제외 범위
{exclude_lines}

## 참조 문서
{ref_lines}

## 공통 진행 규칙
- 각 Phase는 앞선 Phase의 자체 테스트 완료 후에만 시작한다.
- 구현 중 발생한 이슈는 해당 Phase에서 수정하고 기록한다.
- 체크박스 상태를 실제 진행 상태와 맞게 업데이트한다.
- 문서에 없는 범위 확장은 하지 않는다.

## Phase 상태 요약
{phase_status}

---

{phase_sections}
"""


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Create a lightweight phased development plan markdown file."
    )
    parser.add_argument(
        "--root", default=".", help="Project root where dev-plan/ will be created"
    )
    parser.add_argument(
        "--purpose", default="[TODO] 이번 개발의 목적을 명확하게 적는다."
    )
    parser.add_argument(
        "--scope", default="[TODO] 이번 개발의 범위를 구체적으로 적는다."
    )
    parser.add_argument(
        "--exclude", action="append", default=[], help="Out-of-scope item (repeatable)"
    )
    parser.add_argument(
        "--reference",
        action="append",
        default=[],
        help="Reference doc path or URL (repeatable)",
    )
    parser.add_argument(
        "--phase", action="append", default=[], help="Phase name (repeatable)"
    )
    parser.add_argument(
        "--previous-plan", help="Previous development plan path to include in references"
    )
    args = parser.parse_args()

    root = Path(args.root).expanduser().resolve()
    plan_dir = root / "dev-plan"
    plan_dir.mkdir(parents=True, exist_ok=True)

    now = datetime.now().astimezone()
    timestamp = now.strftime("%Y%m%d_%H%M%S")
    created_at = now.strftime("%Y-%m-%d %H:%M:%S %Z")
    filename = f"implement_{timestamp}.md"
    output_path = plan_dir / filename

    if output_path.exists():
        raise SystemExit(f"Refusing to overwrite existing file: {output_path}")

    content = build_content(
        filename=filename,
        created_at=created_at,
        purpose=args.purpose.strip(),
        scope=args.scope.strip(),
        excludes=clean_items(args.exclude),
        refs=clean_items(args.reference),
        phases=clean_items(args.phase),
        previous_plan=args.previous_plan,
    )
    output_path.write_text(content, encoding="utf-8")
    print(output_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Lint Celery task definitions for proper base class usage.

Scans task files for @celery_app.task() decorators and checks:
- Tasks with organization_id param MUST use base=OrgTask
- All tasks SHOULD use base=OrgTask or base=SystemTask
- Tasks should not manually call create_app() (use base class instead)

Modeled on lint_migrations.py.

Usage:
    python scripts/lint_celery_tasks.py

Exit codes:
    0 = pass
    1 = lint errors found
"""
import ast
import sys
from pathlib import Path

TASKS_DIR = Path(__file__).resolve().parent.parent / "app" / "tasks"

# Files to skip (base classes, init, celery app config)
SKIP_FILES = {"__init__.py", "base.py", "rls_helpers.py"}


def _get_decorator_base(decorator_node: ast.Call) -> str | None:
    """Extract the base= keyword argument from a decorator call."""
    for kw in decorator_node.keywords:
        if kw.arg == "base":
            if isinstance(kw.value, ast.Name):
                return kw.value.id
            if isinstance(kw.value, ast.Attribute):
                return kw.value.attr
    return None


def _has_org_id_param(func_node: ast.FunctionDef) -> bool:
    """Check if function has an organization_id parameter."""
    for arg in func_node.args.args:
        if arg.arg == "organization_id":
            return True
    return False


def _body_calls_create_app(func_node: ast.FunctionDef) -> list[int]:
    """Find line numbers where create_app() is called in function body."""
    lines = []
    for node in ast.walk(func_node):
        if isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Name) and func.id == "create_app":
                lines.append(node.lineno)
            elif isinstance(func, ast.Attribute) and func.attr == "create_app":
                lines.append(node.lineno)
    return lines


def lint_file(filepath: Path) -> tuple[list[str], list[str]]:
    """Lint a single task file. Returns (errors, warnings)."""
    errors = []
    warnings = []

    try:
        source = filepath.read_text()
        tree = ast.parse(source, filename=str(filepath))
    except SyntaxError as e:
        errors.append(f"  Syntax error: {e}")
        return errors, warnings

    for node in ast.walk(tree):
        if not isinstance(node, ast.FunctionDef):
            continue

        # Find @celery_app.task(...) decorator
        for dec in node.decorator_list:
            if not isinstance(dec, ast.Call):
                continue

            func = dec.func
            is_celery_task = False

            if isinstance(func, ast.Attribute) and func.attr == "task":
                if isinstance(func.value, ast.Name) and func.value.id == "celery_app":
                    is_celery_task = True

            if not is_celery_task:
                continue

            base = _get_decorator_base(dec)
            has_org_id = _has_org_id_param(node)
            create_app_lines = _body_calls_create_app(node)

            task_name = node.name

            # ERROR: has organization_id but no base=OrgTask
            if has_org_id and base != "OrgTask":
                errors.append(
                    f"  L{node.lineno} {task_name}: has organization_id param "
                    f"but {'base=' + base if base else 'no base='} "
                    f"(expected base=OrgTask)"
                )

            # WARNING: no base= at all
            if base is None:
                warnings.append(
                    f"  L{node.lineno} {task_name}: no base= class "
                    f"(should use OrgTask or SystemTask)"
                )

            # WARNING: manually calls create_app()
            if create_app_lines:
                for line in create_app_lines:
                    warnings.append(
                        f"  L{line} {task_name}: manually calls create_app() "
                        f"(should use base=SystemTask or base=OrgTask instead)"
                    )

    return errors, warnings


def main():
    files = sorted(TASKS_DIR.glob("*.py"))
    files = [f for f in files if f.name not in SKIP_FILES]

    total_errors = 0
    total_warnings = 0

    for filepath in files:
        errors, warnings = lint_file(filepath)
        if errors or warnings:
            print(f"\n{filepath.name}:")
            for w in warnings:
                print(f"  WARN: {w}")
                total_warnings += 1
            for e in errors:
                print(f"  ERROR: {e}")
            if errors:
                total_errors += len(errors)

    print(f"\n{'=' * 60}")
    print(f"Checked {len(files)} task file(s): ", end="")

    if total_errors:
        print(f"{total_errors} ERROR(s), {total_warnings} warning(s)")
        return 1
    else:
        print(f"0 errors, {total_warnings} warning(s)")
        return 0


if __name__ == "__main__":
    sys.exit(main())

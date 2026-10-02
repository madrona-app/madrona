#!/usr/bin/env python3
"""
Lint for naive-datetime vs tz-aware-datetime comparisons.

Catches the bug class that 500'd /api/auth/activate today (May 2026):

    if invitation.expires_at < datetime.now(timezone.utc):
        ...

Postgres `TIMESTAMP WITHOUT TIME ZONE` columns load as naive datetimes
in Python. Comparing a naive datetime against a tz-aware one raises
``TypeError: can't compare offset-naive and offset-aware datetimes``.

Heuristic
---------
Flag any comparison (`<`, `<=`, `>`, `>=`, `==`, `!=`) where:
  - One side is `datetime.now(...)` or `datetime.now(timezone.utc)`
  - The OTHER side is an attribute access (e.g. `invitation.expires_at`,
    `token.used_at`)

The codebase's correct pattern lifts the attribute into a local first
and guards `tzinfo is None`, so the comparison ends up between two
`ast.Name` nodes — those are not flagged. Direct attribute comparisons
are the smell.

Exit codes
----------
0 — clean
1 — at least one offending comparison found

Usage
-----
    cd backend && ./venv/bin/python scripts/lint_naive_datetime.py
    cd backend && ./venv/bin/python scripts/lint_naive_datetime.py app/fastapi_app/routers/auth.py

Defaults to scanning `app/` if no paths are passed.
"""
from __future__ import annotations

import argparse
import ast
import sys
from pathlib import Path

# Attribute names that are commonly Postgres TIMESTAMP WITHOUT TIME ZONE
# in this codebase. Used to keep false-positive rate down — comparing
# `obj.SOMETHING` against datetime.now() where SOMETHING isn't a known
# datetime field is probably a non-datetime comparison the lint should
# not flag.
#
# When adding columns of datetime type, extend this set if the column
# name doesn't already match.
DATETIME_ATTR_HINTS = frozenset({
    "expires_at",
    "expiration",
    "created_at",
    "updated_at",
    "deleted_at",
    "used_at",
    "last_sent_at",
    "started_at",
    "completed_at",
    "scheduled_at",
    "due_at",
    "issued_at",
    "revoked_at",
    "verified_at",
    "activated_at",
    "deactivated_at",
    "welcome_email_sent_at",
    "approved_at",
    "rejected_at",
    "submitted_at",
    "received_at",
    "sent_at",
    "mfa_at",
    "last_login_at",
    "last_seen_at",
    "last_check",
    "last_run",
    "next_run",
    "storage_metered_at",
    "checked_at",
    "next_condition_check_date",
})


def _is_datetime_now_call(node: ast.AST) -> bool:
    """True if node is `datetime.now(...)` or `dt.datetime.now(...)`."""
    if not isinstance(node, ast.Call):
        return False
    fn = node.func
    if isinstance(fn, ast.Attribute) and fn.attr == "now":
        # datetime.now(...) where 'datetime' is a Name OR Attribute
        return True
    return False


def _attr_root_name(node: ast.Attribute) -> str | None:
    """Walk to the leftmost Name of an Attribute chain, return its id."""
    cur: ast.AST = node.value
    while isinstance(cur, ast.Attribute):
        cur = cur.value
    if isinstance(cur, ast.Name):
        return cur.id
    return None


def _is_attribute_lookup(node: ast.AST) -> bool:
    """True if node is `obj.attr` where attr is a known datetime hint
    AND `obj` looks like an instance (not a SQLAlchemy class).

    `OrganizationInvitation.expires_at` (root Name `OrganizationInvitation`,
    PascalCase → class attribute in a filter clause) is skipped. Instance
    attributes like `invitation.expires_at` (root Name `invitation`,
    snake_case) are flagged.
    """
    if not isinstance(node, ast.Attribute):
        return False
    if node.attr not in DATETIME_ATTR_HINTS:
        return False
    root = _attr_root_name(node)
    if root is None:
        # Walk hit a non-Name root (e.g., a Call or Subscript) — be
        # conservative and flag. False positives are easier to whitelist
        # than false negatives.
        return True
    # PascalCase → likely SQLAlchemy model class used in a query filter.
    # Skip to avoid flagging SQL expression builders.
    if root and root[0].isupper():
        return False
    return True


def _attr_str(node: ast.Attribute) -> str:
    """`obj.x` → 'obj.x'; `outer.obj.x` → 'outer.obj.x'."""
    parts: list[str] = [node.attr]
    cur: ast.AST = node.value
    while isinstance(cur, ast.Attribute):
        parts.append(cur.attr)
        cur = cur.value
    if isinstance(cur, ast.Name):
        parts.append(cur.id)
    return ".".join(reversed(parts))


class NaiveDatetimeChecker(ast.NodeVisitor):
    def __init__(self, path: Path):
        self.path = path
        self.issues: list[tuple[int, str]] = []

    def visit_Compare(self, node: ast.Compare):
        # A compare expression has `node.left` and `node.comparators`.
        # For our pattern we only care about binary comparisons.
        operands = [node.left] + list(node.comparators)
        if len(operands) != 2:
            self.generic_visit(node)
            return
        # Order-independent: one side datetime.now(...), other side attr
        sides = [(operands[0], operands[1]), (operands[1], operands[0])]
        for now_side, other_side in sides:
            if _is_datetime_now_call(now_side) and _is_attribute_lookup(other_side):
                op = node.ops[0].__class__.__name__
                attr_repr = _attr_str(other_side) if isinstance(other_side, ast.Attribute) else "?"
                self.issues.append((
                    node.lineno,
                    f"compares datetime.now(...) ({op}) against potentially naive "
                    f"attribute `{attr_repr}`. Lift it into a local and guard "
                    "`if x.tzinfo is None: x = x.replace(tzinfo=timezone.utc)` "
                    "before comparing (see /api/auth/activate for the canonical pattern).",
                ))
                break
        self.generic_visit(node)


def scan_path(target: Path) -> list[tuple[Path, int, str]]:
    """Return list of (path, lineno, message) findings under `target`."""
    issues: list[tuple[Path, int, str]] = []
    files: list[Path]
    if target.is_file() and target.suffix == ".py":
        files = [target]
    elif target.is_dir():
        files = sorted(
            p for p in target.rglob("*.py")
            # Skip __pycache__, venv, tests dirs (tests intentionally
            # exercise the broken case).
            if "__pycache__" not in p.parts
            and "venv" not in p.parts
            and "tests" not in p.parts
            and ".venv" not in p.parts
        )
    else:
        return issues

    for f in files:
        try:
            src = f.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        try:
            tree = ast.parse(src, filename=str(f))
        except SyntaxError:
            continue
        checker = NaiveDatetimeChecker(f)
        checker.visit(tree)
        for ln, msg in checker.issues:
            issues.append((f, ln, msg))
    return issues


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "paths",
        nargs="*",
        default=["app"],
        help="Files or directories to scan (default: app/)",
    )
    args = parser.parse_args(argv)

    all_issues: list[tuple[Path, int, str]] = []
    for raw in args.paths:
        p = Path(raw)
        if not p.exists():
            print(f"lint_naive_datetime: skipping non-existent path {raw!r}", file=sys.stderr)
            continue
        all_issues.extend(scan_path(p))

    if not all_issues:
        print("lint_naive_datetime: clean")
        return 0

    for f, ln, msg in all_issues:
        # Format mirrors `flake8` / `ruff`: path:line: message
        print(f"{f}:{ln}: {msg}")
    print(f"\nlint_naive_datetime: {len(all_issues)} issue(s) — fix or whitelist", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Lint Alembic migration files for RLS safety.

Scans migration files for INSERT/UPDATE/DELETE statements that reference
org-scoped tables (tables with RLS policies).  If found, the migration must
contain the marker comment:

    # MADRONA_MIGRATION_STRATEGY: owner

This ensures developers consciously acknowledge that the migration runs as
the DB owner and must set organization_id explicitly on every row.

Also warns (but does not fail) on use of the legacy pattern:
    SET LOCAL row_security = off

Usage:
    # Check all migrations
    python scripts/lint_migrations.py

    # Check only files changed vs main (for CI)
    python scripts/lint_migrations.py --changed

    # Check a specific file
    python scripts/lint_migrations.py migrations/versions/20260213_0100_*.py

Exit codes:
    0 = pass
    1 = lint failures found
"""
import argparse
import re
import subprocess
import sys
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations" / "versions"

MARKER = "MADRONA_MIGRATION_STRATEGY:"

# Patterns to extract the DML target table name (schema.table or bare table).
# These capture the table name from actual DML statements, not trigger/policy DDL.
DML_TARGET_PATTERNS = [
    # INSERT INTO [schema.]table
    re.compile(r"\bINSERT\s+INTO\s+(?:[\w]+\.)?(\w+)", re.IGNORECASE),
    # UPDATE [schema.]table
    re.compile(r"\bUPDATE\s+(?:[\w]+\.)?(\w+)", re.IGNORECASE),
    # DELETE FROM [schema.]table
    re.compile(r"\bDELETE\s+FROM\s+(?:[\w]+\.)?(\w+)", re.IGNORECASE),
]

# Lines matching these are DDL that happen to contain DML keywords (triggers, policies).
# Skip them to avoid false positives.
DDL_SKIP_PATTERNS = [
    re.compile(r"\bAFTER\s+(?:INSERT|UPDATE|DELETE)\b", re.IGNORECASE),
    re.compile(r"\bBEFORE\s+(?:INSERT|UPDATE|DELETE)\b", re.IGNORECASE),
    re.compile(r"\bCREATE\s+POLICY\b", re.IGNORECASE),
    re.compile(r"\bDROP\s+POLICY\b", re.IGNORECASE),
    re.compile(r"\bCREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\b", re.IGNORECASE),
]

# Legacy pattern to warn about
LEGACY_PATTERN = re.compile(r"SET\s+LOCAL\s+row_security\s*=\s*off", re.IGNORECASE)

# Org-scoped table names extracted from seed_rls_policies.py at check time.
# We parse the RLS_TABLES list rather than hard-coding to stay in sync.
_org_tables: set[str] | None = None


def _load_org_tables() -> set[str]:
    """Parse RLS_TABLES from seed_rls_policies.py to get org-scoped tables."""
    global _org_tables
    if _org_tables is not None:
        return _org_tables

    seed_file = Path(__file__).resolve().parent.parent / "seeds" / "seed_rls_policies.py"
    if not seed_file.exists():
        print(f"WARNING: {seed_file} not found, skipping org-table check", file=sys.stderr)
        _org_tables = set()
        return _org_tables

    content = seed_file.read_text()

    # Extract table names from RLS_TABLES = [ ... ] list
    # Each entry is ("schema", "table_name", bool)
    table_pattern = re.compile(r'\(\s*"[^"]+"\s*,\s*"([^"]+)"\s*,\s*(?:True|False)\s*\)')
    match_start = content.find("RLS_TABLES")
    if match_start == -1:
        print("WARNING: RLS_TABLES not found in seed_rls_policies.py", file=sys.stderr)
        _org_tables = set()
        return _org_tables

    # Only search from RLS_TABLES to the closing bracket
    bracket_section = content[match_start:]
    end_bracket = bracket_section.find("]")
    if end_bracket != -1:
        bracket_section = bracket_section[:end_bracket]

    _org_tables = set(table_pattern.findall(bracket_section))
    return _org_tables


def _extract_dml_target(line: str) -> str | None:
    """Extract the target table name from a DML statement, if it's org-scoped.

    Returns the table name if the DML targets an org-scoped table, else None.
    Skips DDL that contains DML keywords (triggers, policies).
    """
    # Skip lines that are DDL containing DML keywords
    for skip in DDL_SKIP_PATTERNS:
        if skip.search(line):
            return None

    org_tables = _load_org_tables()

    for pattern in DML_TARGET_PATTERNS:
        m = pattern.search(line)
        if m:
            target_table = m.group(1).lower()
            if target_table in org_tables:
                return target_table
    return None


def lint_file(filepath: Path) -> list[str]:
    """Lint a single migration file. Returns list of error messages."""
    errors = []
    warnings = []

    content = filepath.read_text()
    lines = content.splitlines()

    has_marker = MARKER in content
    has_legacy = bool(LEGACY_PATTERN.search(content))

    # Find DML lines that target org-scoped tables
    dml_org_lines: list[tuple[int, str, str]] = []  # (lineno, table, line)

    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        # Skip comments and blank lines
        if stripped.startswith("#") or not stripped:
            continue

        table = _extract_dml_target(stripped)
        if table:
            dml_org_lines.append((i, table, stripped))

    if dml_org_lines and not has_marker:
        errors.append(
            f"  DML on org-scoped table(s) without {MARKER} marker."
        )
        for lineno, table, line_text in dml_org_lines[:5]:
            errors.append(f"    L{lineno} ({table}): {line_text[:100]}")
        errors.append(
            f"  Add '# {MARKER} owner' to acknowledge this migration runs as DB owner."
        )

    if has_legacy:
        for i, line in enumerate(lines, 1):
            if LEGACY_PATTERN.search(line):
                warnings.append(
                    f"  L{i}: SET LOCAL row_security = off (legacy pattern, do not copy)"
                )

    return errors, warnings


def get_changed_files() -> list[Path]:
    """Get migration files changed vs main branch."""
    try:
        result = subprocess.run(
            ["git", "diff", "--name-only", "main", "--", "migrations/versions/"],
            capture_output=True, text=True, check=True,
            cwd=MIGRATIONS_DIR.parent.parent,
        )
        files = []
        for line in result.stdout.strip().splitlines():
            p = MIGRATIONS_DIR.parent.parent / line
            if p.exists() and p.suffix == ".py":
                files.append(p)
        return files
    except subprocess.CalledProcessError:
        return []


def main():
    parser = argparse.ArgumentParser(description="Lint Alembic migrations for RLS safety")
    parser.add_argument("files", nargs="*", help="Specific files to check")
    parser.add_argument("--changed", action="store_true",
                        help="Only check files changed vs main branch")
    args = parser.parse_args()

    if args.files:
        files = [Path(f) for f in args.files]
    elif args.changed:
        files = get_changed_files()
        if not files:
            print("No changed migration files found.")
            return 0
    else:
        files = sorted(MIGRATIONS_DIR.glob("*.py"))
        # Exclude __init__.py / __pycache__
        files = [f for f in files if not f.name.startswith("_")]

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
                total_errors += 1

    print(f"\n{'=' * 60}")
    print(f"Checked {len(files)} migration(s): ", end="")

    if total_errors:
        print(f"{total_errors} ERROR(s), {total_warnings} warning(s)")
        return 1
    else:
        print(f"0 errors, {total_warnings} warning(s) (legacy)")
        return 0


if __name__ == "__main__":
    sys.exit(main())

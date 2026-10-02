#!/usr/bin/env python3
"""
Schema Deprecation Entry Generator

Reads audit output JSON and generates markdown table entries for schema_deprecations.md.
Does NOT make any database changes - only generates documentation.

Usage:
    # Generate entries for all unused fields
    python scripts/audit_schema_usage.py > audit.json
    python scripts/schema_deprecate.py audit.json

    # Generate entries for specific table
    python scripts/schema_deprecate.py audit.json --table connector_instances

    # Output as CSV instead of markdown
    python scripts/schema_deprecate.py audit.json --format csv
"""

import argparse
import json
import sys
from datetime import date
from pathlib import Path
from typing import Dict, List


def load_audit_report(audit_file: Path) -> Dict:
    """Load audit JSON report"""
    with open(audit_file) as f:
        return json.load(f)


def generate_markdown_entries(audit_data: Dict, table_filter: str = None) -> List[str]:
    """
    Generate markdown table rows for unused fields.
    
    Returns:
        List of markdown table rows
    """
    rows = []
    unused = audit_data.get("unused_by_table", {})
    
    for table_name, fields in sorted(unused.items()):
        if table_filter and table_name != table_filter:
            continue
        
        for field_info in fields:
            field_name = field_info["field"]
            nullable = "YES" if field_info["nullable"] else "NO"
            default = "NULL" if field_info["nullable"] else "-"
            
            # Generate markdown row
            row = f"| `{table_name}` | `{field_name}` | {nullable} | {default} | {date.today()} (schema audit) | TBD | TBD | ⏳ Nominated |"
            rows.append(row)
    
    return rows


def generate_csv_entries(audit_data: Dict, table_filter: str = None) -> List[str]:
    """
    Generate CSV rows for unused fields.
    
    Returns:
        List of CSV rows (with header)
    """
    rows = ["table,field,nullable,default,first_unused,removal_plan,target_migration,status"]
    unused = audit_data.get("unused_by_table", {})
    
    for table_name, fields in sorted(unused.items()):
        if table_filter and table_name != table_filter:
            continue
        
        for field_info in fields:
            field_name = field_info["field"]
            nullable = "YES" if field_info["nullable"] else "NO"
            default = "NULL" if field_info["nullable"] else "-"
            
            row = f"{table_name},{field_name},{nullable},{default},{date.today()},TBD,TBD,Nominated"
            rows.append(row)
    
    return rows


def generate_removal_script(audit_data: Dict, table_filter: str = None) -> str:
    """
    Generate Alembic migration template for dropping unused fields.
    
    Returns:
        Python code for migration upgrade/downgrade functions
    """
    unused = audit_data.get("unused_by_table", {})
    
    upgrade_lines = []
    downgrade_lines = []
    
    for table_name, fields in sorted(unused.items()):
        if table_filter and table_name != table_filter:
            continue
        
        for field_info in fields:
            field_name = field_info["field"]
            nullable = field_info["nullable"]
            
            # Generate drop column command
            upgrade_lines.append(f"    op.drop_column('{table_name}', '{field_name}')")
            
            # Generate add column command (for downgrade)
            # Note: This is a template - actual column type needs to be filled in
            col_type = "sa.String()"  # Placeholder
            nullable_str = "nullable=True" if nullable else "nullable=False"
            downgrade_lines.append(
                f"    op.add_column('{table_name}', sa.Column('{field_name}', {col_type}, {nullable_str}))"
            )
    
    script = f"""
def upgrade() -> None:
    '''Drop unused columns identified by schema audit'''
{chr(10).join(upgrade_lines) if upgrade_lines else '    pass'}


def downgrade() -> None:
    '''Restore dropped columns (WARNING: data will be lost)'''
{chr(10).join(downgrade_lines) if downgrade_lines else '    pass'}
"""
    
    return script


def generate_summary(audit_data: Dict) -> str:
    """Generate summary of deprecation candidates"""
    summary = audit_data.get("summary", {})
    unused = audit_data.get("unused_by_table", {})
    
    total_unused = summary.get("unused_fields", 0)
    table_count = len(unused)
    
    # Count nullable vs non-nullable
    nullable_count = 0
    for fields in unused.values():
        nullable_count += sum(1 for f in fields if f["nullable"])
    
    nonnullable_count = total_unused - nullable_count
    
    lines = [
        f"📊 Deprecation Summary",
        f"",
        f"Total unused fields: {total_unused}",
        f"Tables affected: {table_count}",
        f"",
        f"Breakdown:",
        f"  - Nullable (safe to drop): {nullable_count}",
        f"  - Non-nullable (needs review): {nonnullable_count}",
        f"",
        f"Fast-track candidates (nullable):",
    ]
    
    for table_name, fields in sorted(unused.items()):
        for field_info in fields:
            if field_info["nullable"]:
                lines.append(f"  - {table_name}.{field_info['field']}")
    
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Generate deprecation entries from schema audit output"
    )
    parser.add_argument(
        "audit_file",
        type=Path,
        help="Path to audit JSON output file",
    )
    parser.add_argument(
        "--table",
        type=str,
        help="Filter to specific table only",
    )
    parser.add_argument(
        "--format",
        choices=["markdown", "csv", "migration", "summary"],
        default="markdown",
        help="Output format (default: markdown)",
    )
    
    args = parser.parse_args()
    
    if not args.audit_file.exists():
        print(f"Error: Audit file not found: {args.audit_file}", file=sys.stderr)
        sys.exit(1)
    
    try:
        audit_data = load_audit_report(args.audit_file)
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON in audit file: {e}", file=sys.stderr)
        sys.exit(1)
    
    if args.format == "markdown":
        rows = generate_markdown_entries(audit_data, args.table)
        if rows:
            print("\n".join(rows))
        else:
            print("No unused fields found.", file=sys.stderr)
    
    elif args.format == "csv":
        rows = generate_csv_entries(audit_data, args.table)
        print("\n".join(rows))
    
    elif args.format == "migration":
        script = generate_removal_script(audit_data, args.table)
        print(script)
    
    elif args.format == "summary":
        summary = generate_summary(audit_data)
        print(summary)


if __name__ == "__main__":
    main()

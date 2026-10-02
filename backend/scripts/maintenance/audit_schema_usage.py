#!/usr/bin/env python3
"""
Schema Usage Audit Script

Analyzes database models and migrations to report:
1. Unused columns (defined in schema but never accessed in code)
2. Ghost references (used in code but not in DB)
3. Orphaned tables (0% usage)
4. Structural fields (PKs/FKs marked as structurally necessary)

The script treats Alembic migrations as the authoritative source of schema truth.

Usage:
    python scripts/audit_schema_usage.py [--fail-on-unused]

Options:
    --fail-on-unused    Exit with code 1 if unused fields found (default: exit 0)

Output:
    - JSON report to stdout
    - Exit code 0 by default, 1 if --fail-on-unused and unused fields found
"""

import ast
import re
import sys
from pathlib import Path
from typing import Dict, List, Set, Tuple


class FieldUsageVisitor(ast.NodeVisitor):
    """AST visitor to find field accesses in various patterns"""
    
    def __init__(self):
        self.accessed_fields: Set[str] = set()
    
    def visit_Attribute(self, node: ast.Attribute):
        """
        Track attribute access patterns:
        - obj.field_name (instance access)
        - Model.field (class attribute access)
        - model.c.field (SQLAlchemy Core)
        """
        self.accessed_fields.add(node.attr)
        self.generic_visit(node)
    
    def visit_Subscript(self, node: ast.Subscript):
        """
        Track dictionary-style access:
        - row['field_name']
        - result["field_name"]
        """
        if isinstance(node.slice, ast.Constant) and isinstance(node.slice.value, str):
            self.accessed_fields.add(node.slice.value)
        self.generic_visit(node)


def extract_model_fields_from_migrations(migrations_dir: Path) -> Dict[str, Dict[str, dict]]:
    """
    Parse Alembic migrations to extract authoritative schema.
    
    Returns:
        {
            "table_name": {
                "field_name": {
                    "nullable": True/False,
                    "is_pk": True/False,
                    "is_fk": True/False,
                }
            }
        }
    """
    versions_dir = migrations_dir / "versions"
    migration_files = sorted(versions_dir.glob("*.py"))
    
    # Track schema evolution (later migrations override earlier ones)
    schema = {}
    
    for migration_file in migration_files:
        with open(migration_file) as f:
            content = f.read()
        
        # Parse create_table calls
        create_table_pattern = r"op\.create_table\(\s*['\"](\w+)['\"]"
        for match in re.finditer(create_table_pattern, content):
            table_name = match.group(1)
            if table_name not in schema:
                schema[table_name] = {}
            
            # Find columns in this create_table block
            table_start = match.start()
            # Find matching closing parenthesis
            paren_count = 0
            table_end = table_start
            for i in range(table_start, len(content)):
                if content[i] == '(':
                    paren_count += 1
                elif content[i] == ')':
                    paren_count -= 1
                    if paren_count == 0:
                        table_end = i
                        break
            
            table_block = content[table_start:table_end]
            
            # Extract column definitions
            column_pattern = r"sa\.Column\(['\"](\w+)['\"].*?nullable=(True|False).*?\)"
            for col_match in re.finditer(column_pattern, table_block):
                field_name = col_match.group(1)
                nullable = col_match.group(2) == "True"
                
                # Detect primary keys
                is_pk = "primary_key=True" in col_match.group(0)
                
                # Detect foreign keys
                is_fk = "ForeignKey" in col_match.group(0)
                
                schema[table_name][field_name] = {
                    "nullable": nullable,
                    "is_pk": is_pk,
                    "is_fk": is_fk,
                }
        
        # Parse add_column calls
        add_column_pattern = r"op\.add_column\(\s*['\"](\w+)['\"]\s*,\s*sa\.Column\(['\"](\w+)['\"].*?nullable=(True|False).*?\)"
        for match in re.finditer(add_column_pattern, content):
            table_name = match.group(1)
            field_name = match.group(2)
            nullable = match.group(3) == "True"
            
            if table_name not in schema:
                schema[table_name] = {}
            
            schema[table_name][field_name] = {
                "nullable": nullable,
                "is_pk": False,
                "is_fk": "ForeignKey" in match.group(0),
            }
        
        # Parse drop_column calls (remove from schema)
        drop_column_pattern = r"op\.drop_column\(['\"](\w+)['\"]\s*,\s*['\"](\w+)['\"]"
        for match in re.finditer(drop_column_pattern, content):
            table_name = match.group(1)
            field_name = match.group(2)
            if table_name in schema and field_name in schema[table_name]:
                del schema[table_name][field_name]
    
    return schema


def find_field_accesses(code_dir: Path) -> Set[str]:
    """
    Find all field accesses in Python files using multiple patterns.
    
    Returns:
        Set of field names accessed in code
    """
    accessed_fields = set()
    
    for py_file in code_dir.rglob("*.py"):
        if "migrations" in str(py_file) or "alembic" in str(py_file):
            continue
        
        try:
            with open(py_file) as f:
                content = f.read()
                tree = ast.parse(content)
            
            # AST-based detection
            visitor = FieldUsageVisitor()
            visitor.visit(tree)
            accessed_fields.update(visitor.accessed_fields)
            
            # Regex patterns for SQLAlchemy query patterns
            # Matches: filter(Model.field == ...), filter_by(field=...), order_by(Model.field)
            query_patterns = [
                r'\.filter\(\w+\.(\w+)\s*[=!<>]',  # Model.field in filter
                r'\.filter_by\((\w+)\s*=',  # filter_by(field=...)
                r'\.order_by\(\w+\.(\w+)',  # order_by(Model.field)
                r'\.group_by\(\w+\.(\w+)',  # group_by(Model.field)
                r'\.having\(\w+\.(\w+)',  # having(Model.field)
            ]
            
            for pattern in query_patterns:
                for match in re.finditer(pattern, content):
                    accessed_fields.add(match.group(1))
            
        except (SyntaxError, UnicodeDecodeError):
            # Skip files with syntax errors or encoding issues
            continue
    
    return accessed_fields


def classify_fields(schema: Dict[str, Dict[str, dict]], accessed_fields: Set[str]) -> Dict:
    """
    Classify fields as used/unused and identify structural fields.
    
    Returns report structure with classifications
    """
    unused_by_table = {}
    structural_fields = {}
    total_fields = 0
    unused_count = 0
    
    for table_name, fields in schema.items():
        unused = []
        structural = []
        
        for field_name, metadata in fields.items():
            total_fields += 1
            
            # Mark PKs and FKs as structurally used
            if metadata["is_pk"] or metadata["is_fk"]:
                structural.append({
                    "field": field_name,
                    "reason": "primary_key" if metadata["is_pk"] else "foreign_key",
                    "nullable": metadata["nullable"],
                })
                continue
            
            # Check if field is accessed in code
            if field_name not in accessed_fields:
                unused.append({
                    "field": field_name,
                    "nullable": metadata["nullable"],
                })
                unused_count += 1
        
        if unused:
            unused_by_table[table_name] = unused
        
        if structural:
            structural_fields[table_name] = structural
    
    usage_pct = ((total_fields - unused_count) / total_fields * 100) if total_fields > 0 else 100
    
    return {
        "summary": {
            "total_fields": total_fields,
            "used_fields": total_fields - unused_count,
            "unused_fields": unused_count,
            "usage_percentage": round(usage_pct, 1),
        },
        "unused_by_table": unused_by_table,
        "structural_fields": structural_fields,
        "tables_analyzed": list(schema.keys()),
    }


def audit_schema_usage() -> Tuple[Dict, bool]:
    """
    Audit schema usage against Alembic migrations.
    
    Returns:
        (report_dict, has_unused_fields)
    """
    # backend/scripts/maintenance/<this file> -> parents[2] is backend/.
    # This used to be `parent.parent / "backend"`, i.e.
    # backend/scripts/backend, which does not exist — so the migrations
    # directory was empty, zero tables were analysed, and the audit reported
    # "0 unused fields" no matter what the schema looked like.
    backend_dir = Path(__file__).resolve().parents[2]
    migrations_dir = backend_dir / "migrations"
    app_dir = backend_dir / "app"
    tests_dir = backend_dir / "tests"
    
    # Extract authoritative schema from migrations
    schema = extract_model_fields_from_migrations(migrations_dir)
    
    # Find all field accesses in app and tests
    app_accesses = find_field_accesses(app_dir)
    test_accesses = find_field_accesses(tests_dir)
    all_accesses = app_accesses | test_accesses
    
    # Classify fields
    report = classify_fields(schema, all_accesses)
    
    return report, report["summary"]["unused_fields"] > 0


def main():
    """Run audit and print report"""
    import json
    
    # Parse command line args
    fail_on_unused = "--fail-on-unused" in sys.argv
    
    report, has_unused = audit_schema_usage()
    
    print(json.dumps(report, indent=2))
    
    if has_unused:
        print(f"\n⚠️  Found {report['summary']['unused_fields']} unused fields", file=sys.stderr)
        print(f"💡 Structural fields (PKs/FKs) are excluded from unused count", file=sys.stderr)
        
        if fail_on_unused:
            print("❌ Exiting with code 1 due to --fail-on-unused flag", file=sys.stderr)
            sys.exit(1)
        else:
            print("✅ Exiting with code 0 (default behavior, use --fail-on-unused to change)", file=sys.stderr)
            sys.exit(0)
    else:
        print(f"\n✅ All {report['summary']['total_fields']} fields are used", file=sys.stderr)
        sys.exit(0)


if __name__ == "__main__":
    main()

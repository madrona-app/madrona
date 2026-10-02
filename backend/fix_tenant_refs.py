#!/usr/bin/env python3
"""
Script to replace Tenant references with Organization in test files.
"""
import re
import sys
from pathlib import Path

def fix_file(filepath):
    """Fix Tenant references in a single file."""
    with open(filepath, 'r') as f:
        content = f.read()
    
    original = content
    
    # Replace simple Tenant instantiations
    content = re.sub(
        r'(\s+)tenant = Tenant\(name="Test Tenant", slug="test-tenant", status="active"\)',
        r'\1organization = Organization(name="Test Organization", slug="test-org", is_demo=False, status="active", role_profile_key="enterprise")',
        content
    )
    
    # Replace tenant1/tenant2 instantiations
    content = re.sub(
        r'tenant1 = Tenant\(name="Tenant 1", slug="tenant-1", status="active"\)',
        r'org1 = Organization(name="Organization 1", slug="org-1", is_demo=False, status="active", role_profile_key="enterprise")',
        content
    )
    content = re.sub(
        r'tenant2 = Tenant\(name="Tenant 2", slug="tenant-2", status="active"\)',
        r'org2 = Organization(name="Organization 2", slug="org-2", is_demo=False, status="active", role_profile_key="enterprise")',
        content
    )
    
    # Replace other Tenant( patterns
    content = re.sub(
        r'Tenant\(name="([^"]+)", slug="([^"]+)"(, status="active")?\)',
        r'Organization(name="\1", slug="\2", is_demo=False, status="active", role_profile_key="enterprise")',
        content
    )
    
    # Replace tenant_id references with organization_id
    content = re.sub(r'tenant_id=tenant\.tenant_id', r'organization_id=organization.organization_id', content)
    content = re.sub(r'tenant_id=tenant1\.tenant_id', r'organization_id=org1.organization_id', content)
    content = re.sub(r'tenant_id=tenant2\.tenant_id', r'organization_id=org2.organization_id', content)
    
    # Replace variable name references in API calls
    content = re.sub(r'\?tenant_id={tenant\.tenant_id}', r'?organization_id={organization.organization_id}', content)
    content = re.sub(r'\?tenant_id={tenant1\.tenant_id}', r'?organization_id={org1.organization_id}', content)
    content = re.sub(r'\?tenant_id={tenant2\.tenant_id}', r'?organization_id={org2.organization_id}', content)
    
    # Update filter_by_tenant method names
    content = re.sub(r'test_list_runs_filter_by_tenant\(', r'test_list_runs_filter_by_organization(', content)
    content = re.sub(r'"""Test listing runs filtered by tenant_id."""', r'"""Test listing runs filtered by organization_id."""', content)
    
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f"✓ Updated {filepath}")
        return True
    else:
        print(f"- No changes needed in {filepath}")
        return False

def main():
    test_dir = Path(__file__).parent / "tests"
    files_to_fix = [
        "test_api_entity_types.py",
        "test_api_republish.py",
        "test_api_runs.py",
        "test_integration_pipeline.py"
    ]
    
    updated = 0
    for filename in files_to_fix:
        filepath = test_dir / filename
        if filepath.exists():
            if fix_file(filepath):
                updated += 1
        else:
            print(f"! File not found: {filepath}")
    
    print(f"\nUpdated {updated} files")

if __name__ == "__main__":
    main()

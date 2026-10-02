"""
Test RBAC permissions for schedule management endpoints.

Verifies that the schedules.manage permission is properly defined
and assigned to the correct roles in the seed data.
"""

import pytest
from app.permissions import Permission


def test_schedules_manage_permission_exists():
    """Verify SCHEDULES_MANAGE permission exists in enum"""
    assert hasattr(Permission, 'SCHEDULES_MANAGE')
    assert Permission.SCHEDULES_MANAGE.value == 'schedules.manage'


def test_schedules_manage_in_correct_roles():
    """Verify schedules.manage is assigned to the right roles in seed data."""
    from seeds.seed_roles_and_permissions import ROLE_PERMISSIONS

    roles_with_perm = [
        role for role, perms in ROLE_PERMISSIONS.items()
        if 'schedules.manage' in perms
    ]

    assert 'admin' in roles_with_perm
    assert 'registrar' in roles_with_perm
    assert 'curator' not in roles_with_perm
    assert 'publisher' not in roles_with_perm
    assert 'viewer' not in roles_with_perm


def test_schedules_manage_metadata():
    """Verify permission metadata is correctly configured"""
    from app.permissions import PERMISSION_REGISTRY

    meta = PERMISSION_REGISTRY.get(Permission.SCHEDULES_MANAGE)
    assert meta is not None, "SCHEDULES_MANAGE metadata should exist"
    assert meta.scope == 'schedules'
    assert meta.action == 'manage'
    assert meta.display_name == 'Manage Schedules'
    assert 'create' in meta.description.lower()
    assert 'edit' in meta.description.lower()
    assert 'delete' in meta.description.lower()

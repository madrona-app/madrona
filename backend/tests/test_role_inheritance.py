"""
Tests for role inheritance system.

Verifies:
- Role inheritance hierarchy is well-formed (no cycles)
- Permissions are correctly inherited
- Each role includes all permissions from lower roles
- Role inheritance chain resolution works correctly
"""

import pytest
from app.permissions import (
    InternalRole,
    ROLE_INHERITANCE_MAP,
    get_role_inheritance_chain,
    validate_role_inheritance,
)
from app.database import _current_session


class TestRoleInheritanceStructure:
    """Test the role inheritance map structure."""

    def test_all_roles_in_inheritance_map(self):
        """All internal roles must be present in inheritance map."""
        for role in InternalRole:
            assert role.value in ROLE_INHERITANCE_MAP, (
                f"Role {role.value} missing from inheritance map"
            )

    def test_no_unknown_roles_in_map(self):
        """Inheritance map should only contain valid roles."""
        valid_roles = {role.value for role in InternalRole}

        for role_key, parent_key in ROLE_INHERITANCE_MAP.items():
            assert role_key in valid_roles, f"Unknown role in map: {role_key}"
            if parent_key is not None:
                assert parent_key in valid_roles, f"Unknown parent role: {parent_key}"

    def test_validate_role_inheritance(self):
        """validate_role_inheritance() should pass without errors."""
        assert validate_role_inheritance() is True

    def test_viewer_has_no_parent(self):
        """Viewer is the base role and should have no parent."""
        assert ROLE_INHERITANCE_MAP[InternalRole.VIEWER.value] is None

    def test_platform_admin_at_top(self):
        """Platform admin should be at the top of the hierarchy."""
        chain = get_role_inheritance_chain(InternalRole.PLATFORM_ADMIN.value)
        assert InternalRole.PLATFORM_ADMIN.value == chain[0]
        assert InternalRole.VIEWER.value in chain
        assert InternalRole.ORG_ADMIN.value in chain

    def test_org_admin_below_platform_admin(self):
        """org_admin chain should NOT include platform_admin."""
        chain = get_role_inheritance_chain(InternalRole.ORG_ADMIN.value)
        assert InternalRole.PLATFORM_ADMIN.value not in chain


class TestRoleInheritanceChain:
    """Test role inheritance chain resolution."""

    def test_viewer_chain(self):
        """Viewer has no parents, so chain is just [viewer]."""
        chain = get_role_inheritance_chain(InternalRole.VIEWER.value)
        assert chain == ["viewer"]

    def test_data_publisher_chain(self):
        """data_publisher inherits from viewer."""
        chain = get_role_inheritance_chain(InternalRole.DATA_PUBLISHER.value)
        assert chain == ["publisher", "viewer"]

    def test_data_analyst_chain(self):
        """data_analyst inherits from data_publisher and viewer."""
        chain = get_role_inheritance_chain(InternalRole.DATA_ANALYST.value)
        assert chain == ["curator", "publisher", "viewer"]

    def test_data_engineer_chain(self):
        """data_engineer inherits from data_analyst, data_publisher, and viewer."""
        chain = get_role_inheritance_chain(InternalRole.DATA_ENGINEER.value)
        assert chain == ["registrar", "curator", "publisher", "viewer"]

    def test_org_admin_chain(self):
        """org_admin inherits from all roles below it."""
        chain = get_role_inheritance_chain(InternalRole.ORG_ADMIN.value)
        assert chain == [
            "admin",
            "registrar",
            "curator",
            "publisher",
            "viewer",
        ]

    def test_platform_admin_chain(self):
        """platform_admin inherits from org_admin and all roles below."""
        chain = get_role_inheritance_chain(InternalRole.PLATFORM_ADMIN.value)
        assert chain == [
            "platform_admin",
            "admin",
            "registrar",
            "curator",
            "publisher",
            "viewer",
        ]

    def test_invalid_role_raises_error(self):
        """get_role_inheritance_chain should raise ValueError for unknown role."""
        with pytest.raises(ValueError, match="Unknown role"):
            get_role_inheritance_chain("invalid_role")

    def test_chain_includes_self(self):
        """Inheritance chain should always include the role itself."""
        for role in InternalRole:
            chain = get_role_inheritance_chain(role.value)
            assert chain[0] == role.value, (
                f"Chain for {role.value} should start with itself"
            )


class TestNoCycles:
    """Test that there are no cycles in the inheritance hierarchy."""

    def test_no_cycles_in_hierarchy(self):
        """Walking up the inheritance chain should never revisit a role."""
        for role in InternalRole:
            chain = get_role_inheritance_chain(role.value)
            assert len(chain) == len(set(chain)), (
                f"Cycle detected in chain for {role.value}: {chain}"
            )

    def test_chain_length_reasonable(self):
        """Inheritance chains should not be too long (safety check)."""
        for role in InternalRole:
            chain = get_role_inheritance_chain(role.value)
            assert len(chain) <= 10, (
                f"Chain too long for {role.value}: {len(chain)} roles"
            )

    def test_all_chains_terminate_at_viewer(self):
        """All inheritance chains should terminate at viewer (base role)."""
        for role in InternalRole:
            chain = get_role_inheritance_chain(role.value)
            assert chain[-1] == "viewer", (
                f"Chain for {role.value} should end at viewer, got {chain[-1]}"
            )


class TestPermissionInheritance:
    """Test that permissions are correctly inherited via DB (integration tests)."""

    def test_permission_resolver_exists(self):
        """resolve_permissions_with_inheritance should be importable."""
        from app.services.rbac_service import resolve_permissions_with_inheritance

        assert callable(resolve_permissions_with_inheritance)

    def test_viewer_permissions_are_base(self, app, db_session):
        """Viewer should have the smallest permission set."""
        from app.services.rbac_service import resolve_permissions_with_inheritance

        _current_session.set(db_session)
        if True:  # session-set-above
            viewer_perms = resolve_permissions_with_inheritance("viewer")

            for role in InternalRole:
                if role.value == "viewer":
                    continue
                role_perms = resolve_permissions_with_inheritance(role.value)
                assert len(role_perms) >= len(viewer_perms), (
                    f"{role.value} should have at least as many permissions as viewer"
                )

    def test_higher_roles_include_lower_permissions(self, app, db_session):
        """Each role should include all permissions from roles it inherits from."""
        from app.services.rbac_service import resolve_permissions_with_inheritance

        _current_session.set(db_session)
        if True:  # session-set-above
            viewer_perms = resolve_permissions_with_inheritance("viewer")
            publisher_perms = resolve_permissions_with_inheritance("publisher")
            analyst_perms = resolve_permissions_with_inheritance("curator")
            engineer_perms = resolve_permissions_with_inheritance("registrar")
            admin_perms = resolve_permissions_with_inheritance("admin")
            platform_perms = resolve_permissions_with_inheritance("platform_admin")

            assert viewer_perms.issubset(publisher_perms), (
                "data_publisher should include all viewer permissions"
            )
            assert publisher_perms.issubset(analyst_perms), (
                "data_analyst should include all data_publisher permissions"
            )
            assert analyst_perms.issubset(engineer_perms), (
                "data_engineer should include all data_analyst permissions"
            )
            assert engineer_perms.issubset(admin_perms), (
                "org_admin should include all data_engineer permissions"
            )
            assert admin_perms.issubset(platform_perms), (
                "platform_admin should include all org_admin permissions"
            )

    def test_platform_admin_has_most_permissions(self, app, db_session):
        """platform_admin should have the most permissions."""
        from app.services.rbac_service import resolve_permissions_with_inheritance

        _current_session.set(db_session)
        if True:  # session-set-above
            platform_perms = resolve_permissions_with_inheritance("platform_admin")

            for role in InternalRole:
                if role.value == "platform_admin":
                    continue
                role_perms = resolve_permissions_with_inheritance(role.value)
                assert len(platform_perms) >= len(role_perms), (
                    f"platform_admin should have at least as many permissions as {role.value}"
                )

    def test_permission_inheritance_is_transitive(self, app, db_session):
        """If A inherits B and B inherits C, then A should have all of C's permissions."""
        from app.services.rbac_service import resolve_permissions_with_inheritance

        _current_session.set(db_session)
        if True:  # session-set-above
            viewer_perms = resolve_permissions_with_inheritance("viewer")
            admin_perms = resolve_permissions_with_inheritance("admin")

            assert viewer_perms.issubset(admin_perms), (
                "org_admin should transitively inherit all viewer permissions"
            )

    def test_role_permissions_are_additive(self, app, db_session):
        """Each role should add new permissions, not lose any from parents."""
        from app.services.rbac_service import resolve_permissions_with_inheritance

        _current_session.set(db_session)
        if True:  # session-set-above
            viewer_perms = resolve_permissions_with_inheritance("viewer")
            publisher_perms = resolve_permissions_with_inheritance("publisher")
            analyst_perms = resolve_permissions_with_inheritance("curator")
            engineer_perms = resolve_permissions_with_inheritance("registrar")
            admin_perms = resolve_permissions_with_inheritance("admin")
            platform_perms = resolve_permissions_with_inheritance("platform_admin")

            assert len(publisher_perms) >= len(viewer_perms)
            assert len(analyst_perms) >= len(publisher_perms)
            assert len(engineer_perms) >= len(analyst_perms)
            assert len(admin_perms) >= len(engineer_perms)
            assert len(platform_perms) >= len(admin_perms)


class TestDebugUtilities:
    """Test debug utility functions."""

    def test_print_user_permissions_exists(self):
        """print_user_permissions should be importable."""
        from app.services.rbac_service import print_user_permissions

        assert callable(print_user_permissions)

    def test_compare_role_permissions_exists(self):
        """compare_role_permissions should be importable."""
        from app.services.rbac_service import compare_role_permissions

        assert callable(compare_role_permissions)

    def test_compare_viewer_and_admin(self, app, db_session):
        """Comparing viewer and admin should show clear differences."""
        from app.services.rbac_service import (
            resolve_permissions_with_inheritance,
            compare_role_permissions,
        )

        _current_session.set(db_session)
        if True:  # session-set-above
            # This should not raise an error
            compare_role_permissions("viewer", "admin")

            viewer_perms = resolve_permissions_with_inheritance("viewer")
            admin_perms = resolve_permissions_with_inheritance("admin")

            assert len(admin_perms) >= len(viewer_perms)
            assert viewer_perms.issubset(admin_perms)


class TestEdgeCases:
    """Test edge cases and error handling."""

    def test_invalid_role_in_resolver(self, app, db_session):
        """resolve_permissions_with_inheritance should handle invalid roles gracefully."""
        from app.services.rbac_service import resolve_permissions_with_inheritance

        _current_session.set(db_session)
        if True:  # session-set-above
            perms = resolve_permissions_with_inheritance("nonexistent_role")
            assert perms == set()

    def test_get_user_permissions_with_inheritance(self):
        """get_user_permissions should use the inheritance resolver."""
        from app.services.rbac_service import get_user_permissions

        assert callable(get_user_permissions)

    def test_inheritance_chain_deterministic(self):
        """Calling get_role_inheritance_chain multiple times should return same result."""
        chain1 = get_role_inheritance_chain("registrar")
        chain2 = get_role_inheritance_chain("registrar")
        chain3 = get_role_inheritance_chain("registrar")

        assert chain1 == chain2 == chain3

    def test_validation_is_idempotent(self):
        """validate_role_inheritance should always return True."""
        assert validate_role_inheritance() is True
        assert validate_role_inheritance() is True
        assert validate_role_inheritance() is True

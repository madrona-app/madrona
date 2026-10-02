"""
Edge case tests for Madrona backend.

Tests for:
- Concurrent updates to same record
- Foreign key cascade behavior
- Unicode in text fields
- Boundary conditions

NOTE: Most tests require PostgreSQL due to complex foreign key relationships.
Run with: TEST_DATABASE_URL=postgresql://... pytest tests/test_edge_cases.py
"""

import pytest
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4
import threading
import time

# Mark all tests as requiring postgres since SQLite can't handle the complex schema
pytestmark = pytest.mark.postgres


class TestUnicodeHandling:
    """Test that Unicode is handled correctly in all text fields."""

    # Test strings with various Unicode characters
    UNICODE_TEST_STRINGS = [
        # Basic Unicode (accented characters)
        "Café Museum",
        "Müller Collection",
        "Naïve Art Gallery",
        # Asian scripts
        "東京美術館",  # Tokyo Art Museum (Japanese)
        "北京博物馆",  # Beijing Museum (Chinese)
        "서울 박물관",  # Seoul Museum (Korean)
        # Arabic script (right-to-left)
        "متحف القاهرة",  # Cairo Museum
        # Emoji
        "Modern Art 🎨",
        # Mixed scripts
        "Musée d'Art 现代美术馆",
        # Special characters
        "Art & Design™ © 2024",
        # Long Unicode string
        "测试" * 100,  # 200 Chinese characters
    ]

    def test_organization_name_unicode(self, db_session):
        """Organization names should support Unicode."""
        from app.models import Organization

        for test_string in self.UNICODE_TEST_STRINGS[:5]:  # Test subset
            org = Organization(
                name=test_string,
                slug=f"unicode-test-{uuid4().hex[:8]}",
                status="active",
            )
            db_session.add(org)
            db_session.commit()

            # Verify it was saved correctly
            saved_org = db_session.query(Organization).filter_by(
                organization_id=org.organization_id
            ).first()
            assert saved_org.name == test_string
            db_session.delete(saved_org)
            db_session.commit()

    def test_user_name_unicode(self, db_session, demo_tenant):
        """User display names should support Unicode."""
        from app.models import User

        test_names = [
            "José García",
            "张伟",  # Chinese name
            "محمد أحمد",  # Arabic name
            "Müller-Schmidt",
        ]

        for name in test_names:
            user = User(
                email=f"test-{uuid4().hex[:8]}@example.com",
                display_name=name,
                status="active",
            )
            db_session.add(user)
            db_session.commit()

            saved_user = db_session.query(User).filter_by(
                user_id=user.user_id
            ).first()
            assert saved_user.display_name == name
            db_session.delete(saved_user)
            db_session.commit()


class TestBoundaryConditions:
    """Test boundary conditions and edge cases."""

    def test_empty_string_fields(self, db_session, demo_tenant):
        """Empty strings should be handled correctly."""
        from app.models import User

        user = User(
            email="empty-test@example.com",
            display_name="",  # Empty name
            status="active",
        )
        db_session.add(user)
        db_session.commit()

        saved_user = db_session.query(User).filter_by(user_id=user.user_id).first()
        assert saved_user.display_name == ""

    def test_very_long_strings(self, db_session, demo_tenant):
        """Very long strings should be handled (or truncated)."""
        from app.models import User

        # display_name is Text so this stores fully
        long_name = "A" * 250
        user = User(
            email="long-test@example.com",
            display_name=long_name,
            status="active",
        )
        db_session.add(user)
        db_session.commit()

        saved_user = db_session.query(User).filter_by(user_id=user.user_id).first()
        assert saved_user.display_name == long_name

    def test_special_characters_in_search(self, db_session, demo_tenant):
        """Special characters in search should be handled safely."""
        from app.models import User

        # These should not cause SQL injection or errors
        test_names = [
            "O'Brien",
            'Test "Quoted"',
            "Back\\slash",
            "Semi;colon",
            "Percent%sign",
            "Under_score",
        ]

        for name in test_names:
            user = User(
                email=f"special-{uuid4().hex[:8]}@example.com",
                display_name=name,
                status="active",
            )
            db_session.add(user)
            db_session.commit()

            # Verify we can search for it
            found = db_session.query(User).filter(
                User.display_name == name
            ).first()
            assert found is not None
            assert found.display_name == name

    def test_null_vs_empty_string(self, db_session, demo_tenant):
        """NULL and empty string should be distinct."""
        from app.models import User

        user_null = User(
            email="null-test@example.com",
            display_name=None,  # NULL
            status="active",
        )
        user_empty = User(
            email="empty-test2@example.com",
            display_name="",  # Empty string
            status="active",
        )
        db_session.add_all([user_null, user_empty])
        db_session.commit()

        # Query for NULL names
        null_users = db_session.query(User).filter(
            User.display_name.is_(None)
        ).all()
        null_ids = [u.user_id for u in null_users]
        assert user_null.user_id in null_ids

        # Query for empty string names
        empty_users = db_session.query(User).filter(
            User.display_name == ""
        ).all()
        empty_ids = [u.user_id for u in empty_users]
        assert user_empty.user_id in empty_ids

    def test_date_boundary_conditions(self, db_session, demo_tenant):
        """Test date boundary conditions."""
        from app.models import ObjectEntry, Constituent

        # Create a constituent first
        contact = Constituent(
            organization_id=demo_tenant.organization_id,
            name="Date Test Contact",
            constituent_type="person",
        )
        db_session.add(contact)
        db_session.commit()

        # Test with various dates
        test_dates = [
            date(1900, 1, 1),  # Very old date
            date(2000, 2, 29),  # Leap year
            date(2024, 12, 31),  # End of year
            date.today(),  # Today
        ]

        for test_date in test_dates:
            entry = ObjectEntry(
                organization_id=demo_tenant.organization_id,
                entry_number=f"DATE-{test_date.isoformat()}",
                entry_date=test_date,
                entry_reason="loan_consideration",
                depositor_id=contact.constituent_id,
                objects_description="Date test",
                status="pending",
            )
            db_session.add(entry)
            db_session.commit()

            saved = db_session.query(ObjectEntry).filter_by(
                entry_id=entry.entry_id
            ).first()
            assert saved.entry_date == test_date


class TestDecimalPrecision:
    """Test decimal/numeric field precision."""

    def test_currency_precision(self, db_session, demo_tenant):
        """Currency values should maintain precision."""
        from app.models import ObjectEntry, Constituent

        contact = Constituent(
            organization_id=demo_tenant.organization_id,
            name="Currency Test Contact",
            constituent_type="person",
        )
        db_session.add(contact)
        db_session.commit()

        # Test various currency values. insurance_value is Numeric(15,2)
        # so anything beyond 13 digits before the decimal overflows.
        test_values = [
            Decimal("0.01"),  # Minimum cents
            Decimal("1234.56"),  # Normal value
            Decimal("9999999999999.99"),  # Largest value that fits
            Decimal("0.00"),  # Zero
        ]

        for value in test_values:
            entry = ObjectEntry(
                organization_id=demo_tenant.organization_id,
                entry_number=f"CURR-{uuid4().hex[:8]}",
                entry_date=date.today(),
                entry_reason="loan_consideration",
                depositor_id=contact.constituent_id,
                objects_description="Currency test",
                insurance_value=value,
                insurance_currency="USD",
                status="pending",
            )
            db_session.add(entry)
            db_session.commit()

            saved = db_session.query(ObjectEntry).filter_by(
                entry_id=entry.entry_id
            ).first()
            assert saved.insurance_value == value


class TestConcurrentUpdates:
    """
    Test behavior under concurrent updates.

    Note: Full concurrency testing requires PostgreSQL.
    These tests are marked as postgres-only.
    """

    @pytest.mark.postgres
    @pytest.mark.skip(reason="Threads can't share the test's savepoint session; get_session() in worker threads doesn't see the seeded entry")
    def test_concurrent_status_updates(self, app, db_session, demo_tenant):
        """
        Test that concurrent status updates are handled correctly.

        This test verifies that optimistic locking or last-write-wins
        behavior is consistent.
        """
        from app.models import ObjectEntry, Constituent
        from app.database import current_session, get_session

        # Create test data
        contact = Constituent(
            organization_id=demo_tenant.organization_id,
            name="Concurrent Test Contact",
            constituent_type="person",
        )
        db_session.add(contact)
        db_session.commit()

        entry = ObjectEntry(
            organization_id=demo_tenant.organization_id,
            entry_number="CONC-001",
            entry_date=date.today(),
            entry_reason="loan_consideration",
            depositor_id=contact.constituent_id,
            objects_description="Concurrent test",
            status="pending",
        )
        db_session.add(entry)
        db_session.commit()
        entry_id = entry.entry_id

        results = []
        errors = []

        def update_status(status, delay=0):
            """Update status after optional delay."""
            try:
                time.sleep(delay)
                with get_session() as session:
                    entry = session.query(ObjectEntry).filter_by(
                        entry_id=entry_id
                    ).first()
                    entry.status = status
                    session.commit()
                    results.append(status)
            except Exception as e:
                errors.append(str(e))

        # Start concurrent updates
        t1 = threading.Thread(target=update_status, args=("received", 0))
        t2 = threading.Thread(target=update_status, args=("processed", 0.01))

        t1.start()
        t2.start()
        t1.join()
        t2.join()

        # One of the updates should have succeeded
        assert len(results) >= 1
        # Check final state
        final = db_session.query(ObjectEntry).filter_by(
            entry_id=entry_id
        ).first()
        assert final.status in ["received", "processed"]


class TestForeignKeyCascades:
    """
    Test foreign key cascade behavior.

    Verifies that deleting parent records properly cascades
    or is blocked as expected.
    """

    @pytest.mark.postgres
    def test_organization_deletion_cascades_memberships(self, db_session):
        """Deleting an organization should cascade to its memberships."""
        from app.models import Organization, OrganizationMembership, User

        org = Organization(
            name="Cascade Test Org",
            slug=f"cascade-{uuid4().hex[:8]}",
            status="active",
        )
        db_session.add(org)
        db_session.flush()

        user = User(
            email="cascade-test@example.com",
            display_name="Cascade Test User",
            status="active",
        )
        db_session.add(user)
        db_session.flush()

        # Seed a Role so membership.role_id NOT NULL is satisfied.
        from app.models import Role
        role = Role(role_key=f"edge-admin-{uuid4().hex[:8]}", display_name="Edge Admin", is_system=False)
        db_session.add(role)
        db_session.flush()
        membership = OrganizationMembership(
            organization_id=org.organization_id,
            user_id=user.user_id,
            role="admin",
            role_id=role.role_id,
            status="active",
        )
        db_session.add(membership)
        db_session.commit()

        membership_id = membership.membership_id
        user_id = user.user_id

        # Deleting the org cascades memberships but leaves users intact.
        db_session.delete(org)
        db_session.commit()

        assert (
            db_session.query(OrganizationMembership)
            .filter_by(membership_id=membership_id)
            .first()
            is None
        )
        assert (
            db_session.query(User).filter_by(user_id=user_id).first()
            is not None
        )

    @pytest.mark.postgres
    def test_contact_soft_delete(self, db_session, demo_tenant):
        """
        Contacts linked to entries should use SET NULL on delete.

        This verifies that depositor_id is set to NULL when contact is deleted,
        rather than cascading the delete to the entry.
        """
        from app.models import Constituent, ObjectEntry

        contact = Constituent(
            organization_id=demo_tenant.organization_id,
            name="Deletable Contact",
            constituent_type="person",
        )
        db_session.add(contact)
        db_session.commit()

        entry = ObjectEntry(
            organization_id=demo_tenant.organization_id,
            entry_number=f"FK-{uuid4().hex[:8]}",
            entry_date=date.today(),
            entry_reason="loan_consideration",
            depositor_id=contact.constituent_id,
            depositor_name=contact.name,
            objects_description="FK test",
            status="pending",
        )
        db_session.add(entry)
        db_session.commit()
        entry_id = entry.entry_id

        # Delete contact - should SET NULL on entry.depositor_id
        db_session.delete(contact)
        db_session.commit()
        db_session.expire_all()  # force re-fetch after cascade SET NULL

        # Entry should still exist with NULL depositor_id
        saved_entry = db_session.query(ObjectEntry).filter_by(
            entry_id=entry_id
        ).first()
        assert saved_entry is not None
        assert saved_entry.depositor_id is None
        # depositor_name should still be preserved
        assert saved_entry.depositor_name == "Deletable Contact"

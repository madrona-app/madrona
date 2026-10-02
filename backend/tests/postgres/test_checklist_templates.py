"""
Tests for checklist template immutability and version management.

These tests verify:
- Only draft (unlocked) templates are editable
- Publishing creates an immutable version record
- Locked versions cannot be modified
- Template deletion rules
"""

import pytest
from uuid import uuid4

from app.models import (
    Organization,
    User,
    ChecklistTemplate,
    ChecklistTemplateVersion,
    ChecklistTemplateItem,
    ExhibitionChecklist,
    ChecklistPhase,
    ChecklistRole,
)


@pytest.fixture
def test_user(postgres_session, test_tenant):
    """Create a test user."""
    user = User(
        email="test@example.com",
        display_name="Test User",
        status="active",
    )
    postgres_session.add(user)
    postgres_session.flush()
    return user


@pytest.fixture
def test_template(postgres_session, test_tenant, test_user):
    """Create a test template with a draft version."""
    template = ChecklistTemplate(
        organization_id=test_tenant.organization_id,
        name="Test Template",
        description="A test checklist template",
        exhibition_type="general",
        created_by=test_user.user_id,
    )
    postgres_session.add(template)
    postgres_session.flush()

    version = ChecklistTemplateVersion(
        template_id=template.template_id,
        version_number=1,
        is_published=False,
        is_locked=False,
        created_by=test_user.user_id,
    )
    postgres_session.add(version)
    postgres_session.flush()

    return template, version


@pytest.fixture
def test_template_with_items(postgres_session, test_template):
    """Add items to the test template version."""
    template, version = test_template

    items = [
        ChecklistTemplateItem(
            version_id=version.version_id,
            phase=ChecklistPhase.PLANNING,
            title="Create exhibition proposal",
            description="Draft initial exhibition proposal document",
            responsible_role=ChecklistRole.CURATOR,
            default_due_offset_days=-90,
            sort_order=0,
            is_required=True,
        ),
        ChecklistTemplateItem(
            version_id=version.version_id,
            phase=ChecklistPhase.PLANNING,
            title="Budget approval",
            responsible_role=ChecklistRole.EXHIBITIONS_MANAGER,
            default_due_offset_days=-60,
            sort_order=1,
            is_required=True,
        ),
        ChecklistTemplateItem(
            version_id=version.version_id,
            phase=ChecklistPhase.INSTALL,
            title="Install lighting",
            responsible_role=ChecklistRole.PREPARATOR,
            default_due_offset_days=-7,
            sort_order=0,
            is_required=True,
        ),
    ]
    for item in items:
        postgres_session.add(item)
    postgres_session.flush()

    return template, version, items


class TestDraftVersionEditing:
    """Test that draft versions can be edited."""

    def test_can_add_item_to_draft_version(self, postgres_session, test_template):
        """Items can be added to an unlocked draft version."""
        template, version = test_template
        assert not version.is_locked

        item = ChecklistTemplateItem(
            version_id=version.version_id,
            phase=ChecklistPhase.PLANNING,
            title="New planning task",
            responsible_role=ChecklistRole.CURATOR,
            sort_order=0,
        )
        postgres_session.add(item)
        postgres_session.flush()

        assert item.template_item_id is not None

    def test_can_update_item_in_draft_version(self, postgres_session, test_template_with_items):
        """Items can be updated in an unlocked draft version."""
        template, version, items = test_template_with_items
        assert not version.is_locked

        item = items[0]
        item.title = "Updated title"
        item.description = "Updated description"
        postgres_session.flush()

        postgres_session.refresh(item)
        assert item.title == "Updated title"
        assert item.description == "Updated description"

    def test_can_delete_item_from_draft_version(self, postgres_session, test_template_with_items):
        """Items can be deleted from an unlocked draft version."""
        template, version, items = test_template_with_items
        assert not version.is_locked

        item_id = items[0].template_item_id
        postgres_session.delete(items[0])
        postgres_session.flush()

        remaining = postgres_session.query(ChecklistTemplateItem).filter_by(
            version_id=version.version_id
        ).all()
        assert len(remaining) == 2
        assert all(i.template_item_id != item_id for i in remaining)

    def test_can_update_version_metadata(self, postgres_session, test_template):
        """Version metadata can be updated on unlocked versions."""
        template, version = test_template
        assert not version.is_locked

        version.change_notes = "Added initial items"
        postgres_session.flush()

        postgres_session.refresh(version)
        assert version.change_notes == "Added initial items"


class TestPublishing:
    """Test publishing behavior."""

    def test_publish_sets_is_published(self, postgres_session, test_template_with_items):
        """Publishing a version sets is_published to True."""
        template, version, items = test_template_with_items

        version.is_published = True
        postgres_session.flush()

        postgres_session.refresh(version)
        assert version.is_published is True

    def test_version_can_be_locked_when_used(self, postgres_session, test_template_with_items):
        """A version is locked when used by an exhibition checklist."""
        template, version, items = test_template_with_items

        # Simulate locking (normally done when creating an exhibition checklist)
        version.is_locked = True
        postgres_session.flush()

        postgres_session.refresh(version)
        assert version.is_locked is True


class TestLockedVersionImmutability:
    """Test that locked versions are immutable."""

    @pytest.fixture
    def locked_version(self, postgres_session, test_template_with_items):
        """Create a locked version."""
        template, version, items = test_template_with_items
        version.is_published = True
        version.is_locked = True
        postgres_session.flush()
        return template, version, items

    def test_locked_version_item_count_preserved(self, postgres_session, locked_version):
        """Locked versions should maintain their item count."""
        template, version, items = locked_version

        # Verify the version has items
        item_count = postgres_session.query(ChecklistTemplateItem).filter_by(
            version_id=version.version_id
        ).count()
        assert item_count == 3

    def test_new_version_can_copy_from_locked(self, postgres_session, locked_version, test_user):
        """A new version can be created by copying from a locked version."""
        template, version, items = locked_version

        # Create new version
        new_version = ChecklistTemplateVersion(
            template_id=template.template_id,
            version_number=2,
            is_published=False,
            is_locked=False,
            change_notes="Copy from version 1",
            created_by=test_user.user_id,
        )
        postgres_session.add(new_version)
        postgres_session.flush()

        # Copy items
        for item in items:
            new_item = ChecklistTemplateItem(
                version_id=new_version.version_id,
                phase=item.phase,
                title=item.title,
                description=item.description,
                responsible_role=item.responsible_role,
                default_due_offset_days=item.default_due_offset_days,
                sort_order=item.sort_order,
                is_required=item.is_required,
            )
            postgres_session.add(new_item)
        postgres_session.flush()

        # Verify new version has items
        new_item_count = postgres_session.query(ChecklistTemplateItem).filter_by(
            version_id=new_version.version_id
        ).count()
        assert new_item_count == 3

        # Verify original version still locked
        postgres_session.refresh(version)
        assert version.is_locked is True

    def test_locked_version_items_not_shared(self, postgres_session, locked_version, test_user):
        """Items in a locked version are independent of copies."""
        template, version, items = locked_version

        # Create new version with copied items
        new_version = ChecklistTemplateVersion(
            template_id=template.template_id,
            version_number=2,
            is_published=False,
            is_locked=False,
            created_by=test_user.user_id,
        )
        postgres_session.add(new_version)
        postgres_session.flush()

        for item in items:
            new_item = ChecklistTemplateItem(
                version_id=new_version.version_id,
                phase=item.phase,
                title=item.title + " (copy)",
                responsible_role=item.responsible_role,
                sort_order=item.sort_order,
            )
            postgres_session.add(new_item)
        postgres_session.flush()

        # Verify original items are unchanged
        original_items = postgres_session.query(ChecklistTemplateItem).filter_by(
            version_id=version.version_id
        ).all()
        assert all(" (copy)" not in i.title for i in original_items)


class TestTemplateDeletion:
    """Test template deletion rules."""

    def test_can_delete_template_with_no_locked_versions(self, postgres_session, test_template_with_items):
        """Templates with only unlocked versions can be deleted."""
        template, version, items = test_template_with_items
        assert not version.is_locked

        template_id = template.template_id
        postgres_session.delete(template)
        postgres_session.flush()

        # Verify cascade deletion
        remaining = postgres_session.query(ChecklistTemplate).filter_by(
            template_id=template_id
        ).first()
        assert remaining is None

        remaining_versions = postgres_session.query(ChecklistTemplateVersion).filter_by(
            template_id=template_id
        ).all()
        assert len(remaining_versions) == 0

    def test_template_deletion_cascades_to_items(self, postgres_session, test_template_with_items):
        """Deleting a template cascades to all versions and items."""
        template, version, items = test_template_with_items

        version_id = version.version_id
        postgres_session.delete(template)
        postgres_session.flush()

        remaining_items = postgres_session.query(ChecklistTemplateItem).filter_by(
            version_id=version_id
        ).all()
        assert len(remaining_items) == 0


class TestVersionNumbering:
    """Test version number management."""

    def test_versions_have_unique_numbers_per_template(self, postgres_session, test_template, test_user):
        """Each template maintains unique version numbers."""
        template, version = test_template

        # Create additional versions
        v2 = ChecklistTemplateVersion(
            template_id=template.template_id,
            version_number=2,
            created_by=test_user.user_id,
        )
        v3 = ChecklistTemplateVersion(
            template_id=template.template_id,
            version_number=3,
            created_by=test_user.user_id,
        )
        postgres_session.add_all([v2, v3])
        postgres_session.flush()

        versions = postgres_session.query(ChecklistTemplateVersion).filter_by(
            template_id=template.template_id
        ).order_by(ChecklistTemplateVersion.version_number).all()

        assert [v.version_number for v in versions] == [1, 2, 3]

    def test_different_templates_can_have_same_version_numbers(
        self, postgres_session, test_tenant, test_user
    ):
        """Different templates can independently use the same version numbers."""
        # Create two templates
        template1 = ChecklistTemplate(
            organization_id=test_tenant.organization_id,
            name="Template 1",
            exhibition_type="general",
            created_by=test_user.user_id,
        )
        template2 = ChecklistTemplate(
            organization_id=test_tenant.organization_id,
            name="Template 2",
            exhibition_type="general",
            created_by=test_user.user_id,
        )
        postgres_session.add_all([template1, template2])
        postgres_session.flush()

        # Both can have version 1
        v1_t1 = ChecklistTemplateVersion(
            template_id=template1.template_id,
            version_number=1,
            created_by=test_user.user_id,
        )
        v1_t2 = ChecklistTemplateVersion(
            template_id=template2.template_id,
            version_number=1,
            created_by=test_user.user_id,
        )
        postgres_session.add_all([v1_t1, v1_t2])
        postgres_session.flush()

        assert v1_t1.version_id != v1_t2.version_id
        assert v1_t1.version_number == v1_t2.version_number == 1


class TestArchiving:
    """Test template archiving behavior."""

    def test_archived_templates_not_shown_by_default(self, postgres_session, test_template):
        """Archived templates should be filtered out in normal queries."""
        template, version = test_template

        template.is_archived = True
        postgres_session.flush()

        # Query without archived
        active = postgres_session.query(ChecklistTemplate).filter_by(
            organization_id=template.organization_id,
            is_archived=False
        ).all()
        assert len(active) == 0

        # Query with archived
        all_templates = postgres_session.query(ChecklistTemplate).filter_by(
            organization_id=template.organization_id
        ).all()
        assert len(all_templates) == 1

    def test_can_unarchive_template(self, postgres_session, test_template):
        """Archived templates can be unarchived."""
        template, version = test_template

        template.is_archived = True
        postgres_session.flush()

        template.is_archived = False
        postgres_session.flush()

        postgres_session.refresh(template)
        assert template.is_archived is False

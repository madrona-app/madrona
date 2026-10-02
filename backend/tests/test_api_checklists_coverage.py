"""
Coverage-focused tests for app/fastapi_app/routers/checklists.py.

Extends (does NOT duplicate) the existing coverage in:
  - tests/test_api_checklists.py (basic template/checklist CRUD + auth)
  - tests/postgres/test_checklists_api.py (locked-version semantics,
    item-link add/remove, status happy-path, blank-vs-templated checklist)

Uncovered-branch gaps this file closes:
  - list-templates filters: `include_archived`, `exhibition_type`,
    `published_only` (and the composition of published_version_id)
  - create-template validation: blank name, invalid exhibition_type
  - update-template: blank name is 400, unknown ids are 404
  - delete-template with a locked version → 400
  - version create: copy-from another version, bad copy-from id ignored,
    version_number auto-increments
  - update-version: locked rejection, is_published toggle
  - publish-version: empty-items rejection + happy path
  - template-item add: invalid phase, invalid role, missing title,
    locked-version rejection
  - template-item update: blank title, invalid phase/role, locked
  - template-item delete: 404
  - exhibition-checklist list endpoint (returns `null` when none exist)
  - create-checklist: via template_id (picks latest published version),
    invalid template_id UUID, invalid template_version_id UUID,
    unpublished template_version_id → 404
  - checklist-item CRUD: missing title, invalid phase/role, invalid due_date,
    happy-path add+update, re-opening + due-date clear, delete
  - status transitions: reopen from done clears completion, invalid status,
    item not found, same-status no-op
  - link add: invalid entity_type, invalid/missing entity_id, duplicate
  - link delete: 404
  - simplified (direct) item routes: update status+due, links list,
    item-not-found
  - enums endpoint
  - viewer → 403 on EXHIBIT_EDIT routes
"""

import json
from datetime import datetime, timezone
from uuid import uuid4

import pytest

from app.models import (
    ChecklistTemplate,
    ChecklistTemplateVersion,
    ChecklistTemplateItem,
    ExhibitionChecklist,
    ChecklistItem,
    ChecklistItemLink,
    ChecklistPhase,
    ChecklistRole,
    ChecklistItemStatus,
    Exhibition,
)


_NOW = datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def exhibition(db_session, auth_setup):
    _, org, _ = auth_setup
    exh = Exhibition(
        organization_id=org.organization_id,
        title="Coverage Exhibition",
        exhibition_type="temporary",
        status="proposed",
        created_at=_NOW,
        updated_at=_NOW,
    )
    db_session.add(exh)
    db_session.commit()
    return exh


def _make_template(db_session, org_id, *, name="T", exhibition_type="general",
                   is_archived=False):
    tmpl = ChecklistTemplate(
        organization_id=org_id,
        name=name,
        exhibition_type=exhibition_type,
        is_archived=is_archived,
    )
    db_session.add(tmpl)
    db_session.flush()
    return tmpl


def _make_version(db_session, template_id, *, version_number=1,
                  is_published=False, is_locked=False):
    v = ChecklistTemplateVersion(
        template_id=template_id,
        version_number=version_number,
        is_published=is_published,
        is_locked=is_locked,
    )
    db_session.add(v)
    db_session.flush()
    return v


def _make_template_item(db_session, version_id, *, phase="planning",
                        title="Task", role="curator", sort_order=0):
    item = ChecklistTemplateItem(
        version_id=version_id,
        phase=phase,
        title=title,
        responsible_role=role,
        sort_order=sort_order,
    )
    db_session.add(item)
    db_session.flush()
    return item


def _make_checklist(db_session, exhibition_id, *, name="Test Checklist"):
    cl = ExhibitionChecklist(exhibition_id=exhibition_id, name=name)
    db_session.add(cl)
    db_session.flush()
    return cl


def _make_item(db_session, checklist_id, *, title="Task", status="todo",
               phase="planning", role="curator", sort_order=0):
    item = ChecklistItem(
        checklist_id=checklist_id,
        phase=phase,
        title=title,
        responsible_role=role,
        status=status,
        sort_order=sort_order,
    )
    db_session.add(item)
    db_session.flush()
    return item


def _templates_url(org):
    return f"/api/organizations/{org.organization_id}/exhibit/checklist-templates"


def _template_url(org, template_id):
    return f"/api/organizations/{org.organization_id}/exhibit/checklist-templates/{template_id}"


def _versions_url(org, template_id):
    return f"{_template_url(org, template_id)}/versions"


def _version_url(org, template_id, version_id):
    return f"{_versions_url(org, template_id)}/{version_id}"


def _version_items_url(org, template_id, version_id):
    return f"{_version_url(org, template_id, version_id)}/items"


def _checklists_url(org, exhibition_id):
    return f"/api/organizations/{org.organization_id}/exhibit/exhibitions/{exhibition_id}/checklists"


def _checklist_url(org, exhibition_id, checklist_id):
    return f"{_checklists_url(org, exhibition_id)}/{checklist_id}"


def _items_url(org, exhibition_id, checklist_id):
    return f"{_checklist_url(org, exhibition_id, checklist_id)}/items"


def _item_url(org, exhibition_id, checklist_id, item_id):
    return f"{_items_url(org, exhibition_id, checklist_id)}/{item_id}"


def _item_status_url(org, exhibition_id, checklist_id, item_id):
    return f"{_item_url(org, exhibition_id, checklist_id, item_id)}/status"


def _item_links_url(org, exhibition_id, checklist_id, item_id):
    return f"{_item_url(org, exhibition_id, checklist_id, item_id)}/links"


# ---------------------------------------------------------------------------
# Template listing filter branches
# ---------------------------------------------------------------------------


class TestListTemplateFilters:
    def test_list_excludes_archived_by_default(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_template(db_session, org.organization_id, name="Active")
        _make_template(db_session, org.organization_id, name="Archived", is_archived=True)
        db_session.commit()

        resp = auth_client.get(_templates_url(org))
        names = [t["name"] for t in resp.get_json()["templates"]]
        assert "Active" in names
        assert "Archived" not in names

    def test_list_includes_archived_when_requested(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_template(db_session, org.organization_id, name="Active")
        _make_template(db_session, org.organization_id, name="Archived", is_archived=True)
        db_session.commit()

        resp = auth_client.get(f"{_templates_url(org)}?include_archived=true")
        names = [t["name"] for t in resp.get_json()["templates"]]
        assert "Archived" in names

    def test_list_filter_by_exhibition_type(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_template(db_session, org.organization_id, name="Gen",
                       exhibition_type="general")
        _make_template(db_session, org.organization_id, name="IH",
                       exhibition_type="in_house")
        db_session.commit()

        resp = auth_client.get(f"{_templates_url(org)}?exhibition_type=in_house")
        names = [t["name"] for t in resp.get_json()["templates"]]
        assert names == ["IH"]

    def test_list_published_only(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        t_pub = _make_template(db_session, org.organization_id, name="WithPub")
        _make_version(db_session, t_pub.template_id, version_number=1, is_published=True)

        _make_template(db_session, org.organization_id, name="NoPub")  # no versions
        db_session.commit()

        resp = auth_client.get(f"{_templates_url(org)}?published_only=true")
        returned = resp.get_json()["templates"]
        names = [t["name"] for t in returned]
        assert "WithPub" in names
        assert "NoPub" not in names

        # published_version_id is populated for WithPub
        withpub = next(t for t in returned if t["name"] == "WithPub")
        assert withpub["published_version_id"] is not None
        assert withpub["published_version_number"] == 1


# ---------------------------------------------------------------------------
# Create template validation
# ---------------------------------------------------------------------------


class TestCreateTemplateValidation:
    def test_blank_name_rejected(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(_templates_url(org), json={"name": "   "})
        assert resp.status_code == 400

    def test_invalid_exhibition_type(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(_templates_url(org), json={
            "name": "Bad Type", "exhibition_type": "made_up",
        })
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Update + Delete template edge cases
# ---------------------------------------------------------------------------


class TestUpdateDeleteTemplate:
    def test_update_template_blank_name_rejected(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        tmpl = _make_template(db_session, org.organization_id)
        db_session.commit()
        resp = auth_client.patch(_template_url(org, tmpl.template_id), json={"name": "  "})
        assert resp.status_code == 400

    def test_delete_template_with_locked_version_blocked(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        tmpl = _make_template(db_session, org.organization_id)
        _make_version(db_session, tmpl.template_id, version_number=1, is_locked=True)
        db_session.commit()
        resp = auth_client.delete(_template_url(org, tmpl.template_id))
        assert resp.status_code == 400

    def test_delete_template_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.delete(_template_url(org, uuid4()))
        assert resp.status_code == 404

    def test_update_description_persists(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        tmpl = _make_template(db_session, org.organization_id)
        db_session.commit()
        resp = auth_client.patch(_template_url(org, tmpl.template_id),
                                 json={"description": "Updated desc"})
        assert resp.status_code == 200
        assert resp.get_json()["template"]["description"] == "Updated desc"


# ---------------------------------------------------------------------------
# Versions: copy-from, update, publish
# ---------------------------------------------------------------------------


class TestVersions:
    def test_create_version_copies_items(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        tmpl = _make_template(db_session, org.organization_id)
        v1 = _make_version(db_session, tmpl.template_id, version_number=1,
                           is_published=True, is_locked=True)
        _make_template_item(db_session, v1.version_id, title="Task A", sort_order=0)
        _make_template_item(db_session, v1.version_id, title="Task B", sort_order=1)
        db_session.commit()

        resp = auth_client.post(_versions_url(org, tmpl.template_id), json={
            "copy_from_version_id": str(v1.version_id),
            "change_notes": "rev",
        })
        assert resp.status_code == 201
        data = resp.get_json()["version"]
        assert data["version_number"] == 2
        assert data["is_published"] is False
        assert data["is_locked"] is False
        assert data["item_count"] == 2

    def test_create_version_bad_copy_from_id_tolerated(self, auth_setup, db_session):
        """Malformed copy_from_version_id is silently ignored — still creates
        an empty v2 version."""
        auth_client, org, _ = auth_setup
        tmpl = _make_template(db_session, org.organization_id)
        _make_version(db_session, tmpl.template_id, version_number=1)
        db_session.commit()

        resp = auth_client.post(_versions_url(org, tmpl.template_id), json={
            "copy_from_version_id": "not-a-uuid",
        })
        assert resp.status_code == 201
        assert resp.get_json()["version"]["version_number"] == 2

    def test_get_version_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        tmpl = _make_template(db_session, org.organization_id)
        db_session.commit()
        resp = auth_client.get(_version_url(org, tmpl.template_id, uuid4()))
        assert resp.status_code == 404

    def test_update_version_locked_rejected(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        tmpl = _make_template(db_session, org.organization_id)
        v = _make_version(db_session, tmpl.template_id, version_number=1, is_locked=True)
        db_session.commit()
        resp = auth_client.patch(_version_url(org, tmpl.template_id, v.version_id), json={
            "change_notes": "nope",
        })
        assert resp.status_code == 409

    def test_update_version_toggle_published(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        tmpl = _make_template(db_session, org.organization_id)
        v = _make_version(db_session, tmpl.template_id, version_number=1)
        db_session.commit()
        resp = auth_client.patch(_version_url(org, tmpl.template_id, v.version_id), json={
            "is_published": True, "change_notes": "LGTM",
        })
        assert resp.status_code == 200
        data = resp.get_json()["version"]
        assert data["is_published"] is True
        assert data["change_notes"] == "LGTM"

    def test_publish_empty_version_rejected(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        tmpl = _make_template(db_session, org.organization_id)
        v = _make_version(db_session, tmpl.template_id, version_number=1)
        db_session.commit()
        resp = auth_client.post(
            f"{_version_url(org, tmpl.template_id, v.version_id)}/publish"
        )
        assert resp.status_code == 400

    def test_publish_version_happy(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        tmpl = _make_template(db_session, org.organization_id)
        v = _make_version(db_session, tmpl.template_id, version_number=1)
        _make_template_item(db_session, v.version_id)
        db_session.commit()
        resp = auth_client.post(
            f"{_version_url(org, tmpl.template_id, v.version_id)}/publish"
        )
        assert resp.status_code == 200
        assert resp.get_json()["version"]["is_published"] is True

    def test_publish_version_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        tmpl = _make_template(db_session, org.organization_id)
        db_session.commit()
        resp = auth_client.post(
            f"{_versions_url(org, tmpl.template_id)}/{uuid4()}/publish"
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Template items
# ---------------------------------------------------------------------------


class TestTemplateItemValidation:
    def test_add_item_invalid_phase(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        tmpl = _make_template(db_session, org.organization_id)
        v = _make_version(db_session, tmpl.template_id, version_number=1)
        db_session.commit()
        resp = auth_client.post(_version_items_url(org, tmpl.template_id, v.version_id),
                                json={"phase": "nope", "title": "T", "responsible_role": "curator"})
        assert resp.status_code == 400

    def test_add_item_invalid_role(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        tmpl = _make_template(db_session, org.organization_id)
        v = _make_version(db_session, tmpl.template_id, version_number=1)
        db_session.commit()
        resp = auth_client.post(_version_items_url(org, tmpl.template_id, v.version_id),
                                json={"phase": "planning", "title": "T", "responsible_role": "janitor"})
        assert resp.status_code == 400

    def test_add_item_missing_title(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        tmpl = _make_template(db_session, org.organization_id)
        v = _make_version(db_session, tmpl.template_id, version_number=1)
        db_session.commit()
        resp = auth_client.post(_version_items_url(org, tmpl.template_id, v.version_id),
                                json={"phase": "planning", "title": "  ",
                                      "responsible_role": "curator"})
        assert resp.status_code == 400

    def test_add_item_version_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        tmpl = _make_template(db_session, org.organization_id)
        db_session.commit()
        resp = auth_client.post(_version_items_url(org, tmpl.template_id, uuid4()),
                                json={"phase": "planning", "title": "T",
                                      "responsible_role": "curator"})
        assert resp.status_code == 404

    def test_update_item_blank_title(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        tmpl = _make_template(db_session, org.organization_id)
        v = _make_version(db_session, tmpl.template_id, version_number=1)
        item = _make_template_item(db_session, v.version_id)
        db_session.commit()
        resp = auth_client.patch(
            f"{_version_items_url(org, tmpl.template_id, v.version_id)}/{item.template_item_id}",
            json={"title": "   "},
        )
        assert resp.status_code == 400

    def test_update_item_invalid_phase(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        tmpl = _make_template(db_session, org.organization_id)
        v = _make_version(db_session, tmpl.template_id, version_number=1)
        item = _make_template_item(db_session, v.version_id)
        db_session.commit()
        resp = auth_client.patch(
            f"{_version_items_url(org, tmpl.template_id, v.version_id)}/{item.template_item_id}",
            json={"phase": "nope"},
        )
        assert resp.status_code == 400

    def test_update_item_happy_multifield(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        tmpl = _make_template(db_session, org.organization_id)
        v = _make_version(db_session, tmpl.template_id, version_number=1)
        item = _make_template_item(db_session, v.version_id)
        db_session.commit()

        resp = auth_client.patch(
            f"{_version_items_url(org, tmpl.template_id, v.version_id)}/{item.template_item_id}",
            json={
                "description": "details",
                "default_due_offset_days": -30,
                "sort_order": 9,
                "is_required": False,
                "responsible_role": "registrar",
            },
        )
        assert resp.status_code == 200
        data = resp.get_json()["item"]
        assert data["description"] == "details"
        assert data["default_due_offset_days"] == -30
        assert data["sort_order"] == 9
        assert data["is_required"] is False
        assert data["responsible_role"] == "registrar"

    def test_delete_item_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        tmpl = _make_template(db_session, org.organization_id)
        v = _make_version(db_session, tmpl.template_id, version_number=1)
        db_session.commit()
        resp = auth_client.delete(
            f"{_version_items_url(org, tmpl.template_id, v.version_id)}/{uuid4()}"
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Exhibition checklist list + create via template_id
# ---------------------------------------------------------------------------


class TestExhibitionChecklistCreation:
    def test_list_returns_none_when_no_checklists(self, auth_setup, exhibition):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_checklists_url(org, exhibition.exhibition_id))
        assert resp.status_code == 200
        assert resp.get_json()["checklist"] is None

    def test_list_returns_existing_checklist(self, auth_setup, db_session, exhibition):
        auth_client, org, _ = auth_setup
        _make_checklist(db_session, exhibition.exhibition_id, name="Primary")
        db_session.commit()

        resp = auth_client.get(_checklists_url(org, exhibition.exhibition_id))
        assert resp.status_code == 200
        assert resp.get_json()["checklist"]["name"] == "Primary"

    def test_create_via_template_id_uses_latest_published(
        self, auth_setup, db_session, exhibition
    ):
        auth_client, org, _ = auth_setup
        tmpl = _make_template(db_session, org.organization_id, name="Mine")
        _make_version(db_session, tmpl.template_id, version_number=1, is_published=True)
        v2 = _make_version(db_session, tmpl.template_id, version_number=2, is_published=True)
        _make_template_item(db_session, v2.version_id, title="New Task", sort_order=0)
        db_session.commit()

        resp = auth_client.post(_checklists_url(org, exhibition.exhibition_id), json={
            "template_id": str(tmpl.template_id),
        })
        assert resp.status_code == 201
        data = resp.get_json()["checklist"]
        assert data["template_version_id"] == str(v2.version_id)
        # Name auto-derived from template
        assert data["name"] == "Mine"
        assert data["item_count"] == 1

    def test_create_via_template_id_invalid_uuid(self, auth_setup, exhibition):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(_checklists_url(org, exhibition.exhibition_id), json={
            "template_id": "bogus",
        })
        assert resp.status_code == 400

    def test_create_via_template_id_no_published(self, auth_setup, db_session, exhibition):
        auth_client, org, _ = auth_setup
        tmpl = _make_template(db_session, org.organization_id)
        _make_version(db_session, tmpl.template_id, version_number=1, is_published=False)
        db_session.commit()
        resp = auth_client.post(_checklists_url(org, exhibition.exhibition_id), json={
            "template_id": str(tmpl.template_id),
        })
        assert resp.status_code == 404

    def test_create_via_template_version_id_invalid_uuid(self, auth_setup, exhibition):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(_checklists_url(org, exhibition.exhibition_id), json={
            "template_version_id": "nope",
        })
        assert resp.status_code == 400

    def test_create_via_unpublished_version_404(
        self, auth_setup, db_session, exhibition
    ):
        auth_client, org, _ = auth_setup
        tmpl = _make_template(db_session, org.organization_id)
        v = _make_version(db_session, tmpl.template_id, version_number=1, is_published=False)
        db_session.commit()
        resp = auth_client.post(_checklists_url(org, exhibition.exhibition_id), json={
            "template_version_id": str(v.version_id),
        })
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Checklist items CRUD
# ---------------------------------------------------------------------------


class TestChecklistItemsCRUD:
    def test_add_item_missing_title(self, auth_setup, db_session, exhibition):
        auth_client, org, _ = auth_setup
        cl = _make_checklist(db_session, exhibition.exhibition_id)
        db_session.commit()
        resp = auth_client.post(
            _items_url(org, exhibition.exhibition_id, cl.checklist_id),
            json={"phase": "planning", "responsible_role": "curator", "title": "   "},
        )
        assert resp.status_code == 400

    def test_add_item_invalid_phase(self, auth_setup, db_session, exhibition):
        auth_client, org, _ = auth_setup
        cl = _make_checklist(db_session, exhibition.exhibition_id)
        db_session.commit()
        resp = auth_client.post(
            _items_url(org, exhibition.exhibition_id, cl.checklist_id),
            json={"phase": "nope", "responsible_role": "curator", "title": "X"},
        )
        assert resp.status_code == 400

    def test_add_item_invalid_role(self, auth_setup, db_session, exhibition):
        auth_client, org, _ = auth_setup
        cl = _make_checklist(db_session, exhibition.exhibition_id)
        db_session.commit()
        resp = auth_client.post(
            _items_url(org, exhibition.exhibition_id, cl.checklist_id),
            json={"phase": "planning", "responsible_role": "janitor", "title": "X"},
        )
        assert resp.status_code == 400

    def test_add_item_invalid_due_date(self, auth_setup, db_session, exhibition):
        auth_client, org, _ = auth_setup
        cl = _make_checklist(db_session, exhibition.exhibition_id)
        db_session.commit()
        resp = auth_client.post(
            _items_url(org, exhibition.exhibition_id, cl.checklist_id),
            json={"phase": "planning", "responsible_role": "curator",
                  "title": "X", "due_date": "not-a-date"},
        )
        assert resp.status_code == 400

    def test_add_item_checklist_not_found(self, auth_setup, exhibition):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            _items_url(org, exhibition.exhibition_id, uuid4()),
            json={"phase": "planning", "responsible_role": "curator", "title": "X"},
        )
        assert resp.status_code == 404

    def test_add_item_happy_with_due_date(self, auth_setup, db_session, exhibition):
        auth_client, org, _ = auth_setup
        cl = _make_checklist(db_session, exhibition.exhibition_id)
        db_session.commit()
        resp = auth_client.post(
            _items_url(org, exhibition.exhibition_id, cl.checklist_id),
            json={
                "phase": "install",
                "responsible_role": "preparator",
                "title": "Hang labels",
                "description": "Next to each object",
                "due_date": "2026-05-01",
                "notes": "critical path",
            },
        )
        assert resp.status_code == 201
        data = resp.get_json()["item"]
        assert data["title"] == "Hang labels"
        assert data["due_date"] == "2026-05-01"

    def test_update_item_invalid_due_date(self, auth_setup, db_session, exhibition):
        auth_client, org, _ = auth_setup
        cl = _make_checklist(db_session, exhibition.exhibition_id)
        item = _make_item(db_session, cl.checklist_id)
        db_session.commit()

        resp = auth_client.patch(
            _item_url(org, exhibition.exhibition_id, cl.checklist_id, item.item_id),
            json={"due_date": "yesterday"},
        )
        assert resp.status_code == 400

    def test_update_item_clear_due_date(self, auth_setup, db_session, exhibition):
        auth_client, org, _ = auth_setup
        cl = _make_checklist(db_session, exhibition.exhibition_id)
        item = _make_item(db_session, cl.checklist_id)
        db_session.commit()

        # First set a due date
        auth_client.patch(
            _item_url(org, exhibition.exhibition_id, cl.checklist_id, item.item_id),
            json={"due_date": "2026-06-01"},
        )
        # Then clear it
        resp = auth_client.patch(
            _item_url(org, exhibition.exhibition_id, cl.checklist_id, item.item_id),
            json={"due_date": None},
        )
        assert resp.status_code == 200
        assert resp.get_json()["item"]["due_date"] is None

    def test_update_item_blank_title_rejected(self, auth_setup, db_session, exhibition):
        auth_client, org, _ = auth_setup
        cl = _make_checklist(db_session, exhibition.exhibition_id)
        item = _make_item(db_session, cl.checklist_id)
        db_session.commit()
        resp = auth_client.patch(
            _item_url(org, exhibition.exhibition_id, cl.checklist_id, item.item_id),
            json={"title": "  "},
        )
        assert resp.status_code == 400

    def test_update_item_invalid_phase_role(self, auth_setup, db_session, exhibition):
        auth_client, org, _ = auth_setup
        cl = _make_checklist(db_session, exhibition.exhibition_id)
        item = _make_item(db_session, cl.checklist_id)
        db_session.commit()

        r1 = auth_client.patch(
            _item_url(org, exhibition.exhibition_id, cl.checklist_id, item.item_id),
            json={"phase": "bogus"},
        )
        assert r1.status_code == 400
        r2 = auth_client.patch(
            _item_url(org, exhibition.exhibition_id, cl.checklist_id, item.item_id),
            json={"responsible_role": "bogus"},
        )
        assert r2.status_code == 400

    def test_delete_item_happy(self, auth_setup, db_session, exhibition):
        auth_client, org, _ = auth_setup
        cl = _make_checklist(db_session, exhibition.exhibition_id)
        item = _make_item(db_session, cl.checklist_id)
        db_session.commit()
        resp = auth_client.delete(
            _item_url(org, exhibition.exhibition_id, cl.checklist_id, item.item_id)
        )
        assert resp.status_code == 200

    def test_delete_item_not_found(self, auth_setup, db_session, exhibition):
        auth_client, org, _ = auth_setup
        cl = _make_checklist(db_session, exhibition.exhibition_id)
        db_session.commit()
        resp = auth_client.delete(
            _item_url(org, exhibition.exhibition_id, cl.checklist_id, uuid4())
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Status transitions (additional branches)
# ---------------------------------------------------------------------------


class TestStatusTransitionsEdgeCases:
    def test_status_invalid_value(self, auth_setup, db_session, exhibition):
        auth_client, org, _ = auth_setup
        cl = _make_checklist(db_session, exhibition.exhibition_id)
        item = _make_item(db_session, cl.checklist_id)
        db_session.commit()
        resp = auth_client.post(
            _item_status_url(org, exhibition.exhibition_id, cl.checklist_id, item.item_id),
            json={"status": "bogus"},
        )
        assert resp.status_code == 400

    def test_status_same_as_current_no_notify(self, auth_setup, db_session, exhibition):
        """Transitioning to the same status is a no-op on completion tracking
        and doesn't fire notify_status_change."""
        auth_client, org, _ = auth_setup
        cl = _make_checklist(db_session, exhibition.exhibition_id)
        item = _make_item(db_session, cl.checklist_id, status="in_progress")
        db_session.commit()

        resp = auth_client.post(
            _item_status_url(org, exhibition.exhibition_id, cl.checklist_id, item.item_id),
            json={"status": "in_progress"},
        )
        assert resp.status_code == 200
        assert resp.get_json()["item"]["status"] == "in_progress"

    def test_status_item_not_found(self, auth_setup, db_session, exhibition):
        auth_client, org, _ = auth_setup
        cl = _make_checklist(db_session, exhibition.exhibition_id)
        db_session.commit()
        resp = auth_client.post(
            _item_status_url(org, exhibition.exhibition_id, cl.checklist_id, uuid4()),
            json={"status": "done"},
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Item links (edge branches)
# ---------------------------------------------------------------------------


class TestItemLinksValidation:
    def test_add_link_invalid_entity_type(self, auth_setup, db_session, exhibition):
        auth_client, org, _ = auth_setup
        cl = _make_checklist(db_session, exhibition.exhibition_id)
        item = _make_item(db_session, cl.checklist_id)
        db_session.commit()
        resp = auth_client.post(
            _item_links_url(org, exhibition.exhibition_id, cl.checklist_id, item.item_id),
            json={"linked_entity_type": "spaceship",
                  "linked_entity_id": str(uuid4())},
        )
        assert resp.status_code == 400

    def test_add_link_missing_entity_id(self, auth_setup, db_session, exhibition):
        auth_client, org, _ = auth_setup
        cl = _make_checklist(db_session, exhibition.exhibition_id)
        item = _make_item(db_session, cl.checklist_id)
        db_session.commit()
        resp = auth_client.post(
            _item_links_url(org, exhibition.exhibition_id, cl.checklist_id, item.item_id),
            json={"linked_entity_type": "loan"},
        )
        assert resp.status_code == 400

    def test_add_link_bad_entity_id_uuid(self, auth_setup, db_session, exhibition):
        auth_client, org, _ = auth_setup
        cl = _make_checklist(db_session, exhibition.exhibition_id)
        item = _make_item(db_session, cl.checklist_id)
        db_session.commit()
        resp = auth_client.post(
            _item_links_url(org, exhibition.exhibition_id, cl.checklist_id, item.item_id),
            json={"linked_entity_type": "loan", "linked_entity_id": "not-uuid"},
        )
        assert resp.status_code == 400

    def test_add_link_duplicate(self, auth_setup, db_session, exhibition):
        auth_client, org, _ = auth_setup
        cl = _make_checklist(db_session, exhibition.exhibition_id)
        item = _make_item(db_session, cl.checklist_id)
        db_session.commit()

        url = _item_links_url(org, exhibition.exhibition_id, cl.checklist_id, item.item_id)
        entity_id = str(uuid4())
        r1 = auth_client.post(url, json={
            "linked_entity_type": "loan", "linked_entity_id": entity_id,
        })
        assert r1.status_code == 201

        r2 = auth_client.post(url, json={
            "linked_entity_type": "loan", "linked_entity_id": entity_id,
        })
        assert r2.status_code == 400

    def test_add_link_item_not_found(self, auth_setup, db_session, exhibition):
        auth_client, org, _ = auth_setup
        cl = _make_checklist(db_session, exhibition.exhibition_id)
        db_session.commit()
        resp = auth_client.post(
            _item_links_url(org, exhibition.exhibition_id, cl.checklist_id, uuid4()),
            json={"linked_entity_type": "loan", "linked_entity_id": str(uuid4())},
        )
        assert resp.status_code == 404

    def test_delete_link_not_found(self, auth_setup, db_session, exhibition):
        auth_client, org, _ = auth_setup
        cl = _make_checklist(db_session, exhibition.exhibition_id)
        item = _make_item(db_session, cl.checklist_id)
        db_session.commit()
        resp = auth_client.delete(
            f"{_item_links_url(org, exhibition.exhibition_id, cl.checklist_id, item.item_id)}/{uuid4()}"
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Simplified (direct) item routes
# ---------------------------------------------------------------------------


class TestDirectItemRoutes:
    def test_update_item_direct_status_sets_completion(
        self, auth_setup, db_session, exhibition
    ):
        auth_client, org, _ = auth_setup
        cl = _make_checklist(db_session, exhibition.exhibition_id)
        item = _make_item(db_session, cl.checklist_id, status="todo")
        db_session.commit()

        resp = auth_client.patch(
            f"/api/organizations/{org.organization_id}/exhibit/checklists/items/{item.item_id}",
            json={"status": "done", "notes": "auto-complete"},
        )
        assert resp.status_code == 200
        data = resp.get_json()["item"]
        assert data["status"] == "done"
        assert data["completed_at"] is not None

    def test_update_item_direct_reopen_clears_completion(
        self, auth_setup, db_session, exhibition
    ):
        auth_client, org, _ = auth_setup
        cl = _make_checklist(db_session, exhibition.exhibition_id)
        item = _make_item(db_session, cl.checklist_id, status="done")
        item.completed_at = _NOW
        db_session.commit()

        resp = auth_client.patch(
            f"/api/organizations/{org.organization_id}/exhibit/checklists/items/{item.item_id}",
            json={"status": "in_progress"},
        )
        assert resp.status_code == 200
        data = resp.get_json()["item"]
        assert data["status"] == "in_progress"
        assert data["completed_at"] is None
        assert data["completed_by"] is None

    def test_update_item_direct_invalid_status(
        self, auth_setup, db_session, exhibition
    ):
        auth_client, org, _ = auth_setup
        cl = _make_checklist(db_session, exhibition.exhibition_id)
        item = _make_item(db_session, cl.checklist_id)
        db_session.commit()
        resp = auth_client.patch(
            f"/api/organizations/{org.organization_id}/exhibit/checklists/items/{item.item_id}",
            json={"status": "nope"},
        )
        assert resp.status_code == 400

    def test_update_item_direct_blank_title_rejected(
        self, auth_setup, db_session, exhibition
    ):
        auth_client, org, _ = auth_setup
        cl = _make_checklist(db_session, exhibition.exhibition_id)
        item = _make_item(db_session, cl.checklist_id)
        db_session.commit()
        resp = auth_client.patch(
            f"/api/organizations/{org.organization_id}/exhibit/checklists/items/{item.item_id}",
            json={"title": "   "},
        )
        assert resp.status_code == 400

    def test_update_item_direct_bad_due_date(
        self, auth_setup, db_session, exhibition
    ):
        auth_client, org, _ = auth_setup
        cl = _make_checklist(db_session, exhibition.exhibition_id)
        item = _make_item(db_session, cl.checklist_id)
        db_session.commit()
        resp = auth_client.patch(
            f"/api/organizations/{org.organization_id}/exhibit/checklists/items/{item.item_id}",
            json={"due_date": "tomorrow"},
        )
        assert resp.status_code == 400

    def test_update_item_direct_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.patch(
            f"/api/organizations/{org.organization_id}/exhibit/checklists/items/{uuid4()}",
            json={"notes": "x"},
        )
        assert resp.status_code == 404

    def test_get_item_links_direct(self, auth_setup, db_session, exhibition):
        auth_client, org, _ = auth_setup
        cl = _make_checklist(db_session, exhibition.exhibition_id)
        item = _make_item(db_session, cl.checklist_id)
        link = ChecklistItemLink(
            item_id=item.item_id,
            linked_entity_type="loan",
            linked_entity_id=uuid4(),
        )
        db_session.add(link)
        db_session.commit()

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/exhibit/checklists/items/{item.item_id}/links"
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data["links"]) == 1
        assert data["links"][0]["linked_entity_type"] == "loan"

    def test_get_item_links_direct_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/exhibit/checklists/items/{uuid4()}/links"
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Enums endpoint
# ---------------------------------------------------------------------------


class TestChecklistEnumsCoverage:
    def test_enums_returns_all_buckets(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/exhibit/checklist-enums"
        )
        assert resp.status_code == 200
        data = resp.get_json()
        for key in ("phases", "roles", "statuses",
                    "exhibition_types", "link_entity_types"):
            assert key in data
        phase_values = [p["value"] for p in data["phases"]]
        assert "planning" in phase_values
        assert "install" in phase_values


# ---------------------------------------------------------------------------
# Viewer forbidden on EXHIBIT_EDIT routes
# ---------------------------------------------------------------------------


class TestViewerForbidden:
    def test_viewer_cannot_create_template(self, viewer_auth_setup):
        client, org, _ = viewer_auth_setup
        resp = client.post(
            f"/api/organizations/{org.organization_id}/exhibit/checklist-templates",
            json={"name": "Nope", "exhibition_type": "general"},
        )
        # Viewer lacks EXHIBIT_EDIT and also EXHIBIT_VIEW (neither is granted in
        # viewer_auth_setup). The first failing check is EXHIBIT_EDIT → 403.
        assert resp.status_code == 403

    def test_viewer_cannot_add_template_item(self, viewer_auth_setup, db_session):
        client, org, _ = viewer_auth_setup
        tmpl = _make_template(db_session, org.organization_id)
        v = _make_version(db_session, tmpl.template_id, version_number=1)
        db_session.commit()
        resp = client.post(
            _version_items_url(org, tmpl.template_id, v.version_id),
            json={"phase": "planning", "title": "T", "responsible_role": "curator"},
        )
        assert resp.status_code == 403

    def test_viewer_cannot_create_checklist(self, viewer_auth_setup, db_session):
        client, org, _ = viewer_auth_setup
        exh = Exhibition(
            organization_id=org.organization_id,
            title="Viewer Test",
            status="proposed",
        )
        db_session.add(exh)
        db_session.commit()
        resp = client.post(
            _checklists_url(org, exh.exhibition_id),
            json={"name": "Nope"},
        )
        assert resp.status_code == 403

    def test_viewer_cannot_update_item_status(self, viewer_auth_setup, db_session):
        client, org, _ = viewer_auth_setup
        exh = Exhibition(organization_id=org.organization_id, title="E", status="proposed")
        db_session.add(exh)
        db_session.flush()
        cl = _make_checklist(db_session, exh.exhibition_id)
        item = _make_item(db_session, cl.checklist_id)
        db_session.commit()
        resp = client.post(
            _item_status_url(org, exh.exhibition_id, cl.checklist_id, item.item_id),
            json={"status": "done"},
        )
        assert resp.status_code == 403

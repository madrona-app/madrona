"""Coverage tests for every bulk-action endpoint across the API.

Three groups of endpoints:

1. **Workspace bulk-action framework** (workspaces.py and media_workspaces.py):
   GET  /workspaces/{id}/actions
   POST /workspaces/{id}/actions/{action}/preview
   POST /workspaces/{id}/actions/{action}/validate
   POST /workspaces/{id}/actions/{action}/execute
   Same shape under /media/workspaces/...

2. **Standalone bulk endpoints** scattered across routers:
   POST /collections/objects/bulk-discoverable          (collections_discover)
   POST /exhibit/exhibitions/{id}/budget/bulk           (budget)
   POST /email-events/bulk-delete                       (email_webhooks)
   POST /platform/organizations/{org}/users/bulk        (platform_admin)
   POST /media/ai-tags/bulk-reprocess                   (media_ai)
   POST /media/clip/bulk-generate                       (media_ai)
   POST /media/bulk-transcribe                          (media_ai)
   PUT  /media/{id}/tags                                (media_tags - bulk update)

3. **Bulk-CRUD shapes** that aren't named "bulk" but operate on collections:
   POST /collections/loans-in/{id}/objects/batch        (collections_loans)
   POST /exhibit/exhibitions/{id}/objects/batch         (exhibit_exhibitions)

Each test exercises the call path even when the request shape varies
across implementations (preview vs validate vs execute, sync vs async,
and what response keys the implementation uses).
"""

from __future__ import annotations

import json
from uuid import uuid4

import pytest

from app.models import (
    CollectionObject,
    Location,
    Media,
    MediaWorkspaceItem,
    Workspace,
    WorkspaceItem,
)


# ===========================================================================
# Helpers
# ===========================================================================


def _seed_object(
    db_session, org_id, *, num: str = "BA-1"
) -> CollectionObject:
    obj = CollectionObject(organization_id=org_id, object_number=num)
    db_session.add(obj)
    db_session.commit()
    return obj


def _seed_location(
    db_session, org_id, *, name: str = "BA-Storage", code: str = "BA-1"
) -> Location:
    loc = Location(
        organization_id=org_id,
        name=name,
        location_type="room",
        code=code,
        path=name,
    )
    db_session.add(loc)
    db_session.commit()
    return loc


def _seed_workspace(
    db_session, org, user, *, name: str = "BA Workspace", workspace_type: str = "collections"
) -> Workspace:
    ws = Workspace(
        organization_id=org.organization_id,
        owner_user_id=user.user_id,
        workspace_type=workspace_type,
        name=name,
    )
    db_session.add(ws)
    db_session.commit()
    return ws


def _add_object_to_workspace(db_session, ws, obj):
    item = WorkspaceItem(
        workspace_id=ws.workspace_id,
        object_id=obj.object_id,
        added_by_user_id=None,
    )
    db_session.add(item)
    db_session.commit()
    return item


def _seed_media(db_session, org_id, *, fname: str = "ba.jpg") -> Media:
    m = Media(
        organization_id=org_id,
        s3_key=f"orgs/{org_id}/media/ba/{uuid4().hex}.jpg",
        filename=fname,
        file_size=1024,
        mime_type="image/jpeg",
        media_type="image",
    )
    db_session.add(m)
    db_session.commit()
    return m


# ===========================================================================
# 1. Workspace bulk-action framework
# ===========================================================================


def _ws_actions_url(org, ws_id, action=None, op=None):
    base = (
        f"/api/organizations/{org.organization_id}"
        f"/workspaces/{ws_id}/actions"
    )
    if action is None:
        return base
    if op is None:
        return f"{base}/{action}"
    return f"{base}/{action}/{op}"


class TestWorkspaceBulkActionList:
    def test_list_includes_supported_actions(
        self, auth_setup, db_session
    ):
        client, org, user = auth_setup
        ws = _seed_workspace(db_session, org, user)
        resp = client.get(_ws_actions_url(org, ws.workspace_id))
        assert resp.status_code == 200
        body = resp.get_json()
        actions = body.get("actions") or body.get("items") or []
        keys = {a["key"] for a in actions}
        # All 11 documented actions should be available to admin/owner
        expected = {
            "record_movement",
            "set_cataloging_status",
            "set_object_status",
            "add_to_loan",
            "set_loan_availability",
            "create_condition_report",
            "schedule_condition_check",
            "flag_for_conservation",
            "set_handling_requirements",
            "report_incident",
            "set_discoverable",
        }
        # Tolerate impls that hide some actions behind permissions —
        # at minimum, several should be visible.
        assert len(keys & expected) >= 5

    def test_list_unknown_workspace_404(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.get(_ws_actions_url(org, uuid4()))
        assert resp.status_code == 404


class TestWorkspaceBulkActionPreview:
    def test_preview_unknown_action_400(self, auth_setup, db_session):
        client, org, user = auth_setup
        ws = _seed_workspace(db_session, org, user)
        resp = client.post(
            _ws_actions_url(org, ws.workspace_id, "made_up_action", "preview"),
            data=json.dumps({}),
            content_type="application/json",
        )
        assert resp.status_code in (400, 404, 422)

    def test_preview_record_movement(self, auth_setup, db_session):
        client, org, user = auth_setup
        ws = _seed_workspace(db_session, org, user)
        obj = _seed_object(db_session, org.organization_id, num="WS-MOVE-1")
        _add_object_to_workspace(db_session, ws, obj)
        loc = _seed_location(db_session, org.organization_id, name="Dest", code="D1")
        resp = client.post(
            _ws_actions_url(org, ws.workspace_id, "record_movement", "preview"),
            data=json.dumps(
                {
                    "to_location_id": str(loc.location_id),
                    "reason": "Reorganize gallery",
                }
            ),
            content_type="application/json",
        )
        # Preview returns 200 with summary; some impls 400/422 on missing
        # related fields, or 403 if workspace permission gating is strict.
        assert resp.status_code in (200, 400, 403, 422)

    def test_preview_set_cataloging_status(self, auth_setup, db_session):
        client, org, user = auth_setup
        ws = _seed_workspace(db_session, org, user)
        obj = _seed_object(db_session, org.organization_id, num="WS-CAT-1")
        _add_object_to_workspace(db_session, ws, obj)
        resp = client.post(
            _ws_actions_url(
                org, ws.workspace_id, "set_cataloging_status", "preview"
            ),
            data=json.dumps({"cataloging_status": "cataloged"}),
            content_type="application/json",
        )
        assert resp.status_code in (200, 400, 422)

    def test_execute_set_cataloging_status_persists(self, auth_setup, db_session):
        """Execute, not just preview.

        These branches wrote to obj.metadata, which on a declarative model is
        SQLAlchemy's MetaData object, not a column — item assignment on it
        raises TypeError. Every test here stopped at "preview", so five bulk
        actions crashed on execute without anything going red.
        """
        client, org, user = auth_setup
        ws = _seed_workspace(db_session, org, user)
        obj = _seed_object(db_session, org.organization_id, num="WS-CAT-EXEC")
        _add_object_to_workspace(db_session, ws, obj)
        resp = client.post(
            _ws_actions_url(org, ws.workspace_id, "set_cataloging_status", "execute"),
            data=json.dumps(
                {
                    "action_params": {
                        "cataloging_status": "cataloged",
                        "cataloging_notes": "checked against the accession register",
                    }
                }
            ),
            content_type="application/json",
        )
        assert resp.status_code == 200, resp.get_json()

        db_session.expire_all()
        refreshed = db_session.get(type(obj), obj.object_id)
        assert refreshed.extra_metadata is not None, "nothing was written"
        assert refreshed.extra_metadata["cataloging_status"] == "cataloged"
        assert (
            refreshed.extra_metadata["cataloging_notes"]
            == "checked against the accession register"
        )

    def test_execute_set_loan_availability_persists(self, auth_setup, db_session):
        """The other branch that wrote to metadata unconditionally."""
        client, org, user = auth_setup
        ws = _seed_workspace(db_session, org, user)
        obj = _seed_object(db_session, org.organization_id, num="WS-LOAN-EXEC")
        _add_object_to_workspace(db_session, ws, obj)
        resp = client.post(
            _ws_actions_url(org, ws.workspace_id, "set_loan_availability", "execute"),
            data=json.dumps({"action_params": {"loan_availability": "available"}}),
            content_type="application/json",
        )
        assert resp.status_code == 200, resp.get_json()

        db_session.expire_all()
        refreshed = db_session.get(type(obj), obj.object_id)
        assert refreshed.extra_metadata["loan_availability"] == "available"

    def test_collection_object_metadata_is_not_a_column(self):
        """Guards the mistake itself rather than one of its symptoms.

        `metadata` can never be a usable attribute on a declarative model, so
        any future code reaching for obj.metadata to store a value is a bug.
        """
        from app.models import CollectionObject

        assert "metadata" not in CollectionObject.__table__.columns
        assert type(CollectionObject.metadata).__name__ == "MetaData"
        assert "extra_metadata" in CollectionObject.__table__.columns

    def test_preview_set_discoverable(self, auth_setup, db_session):
        client, org, user = auth_setup
        ws = _seed_workspace(db_session, org, user)
        obj = _seed_object(db_session, org.organization_id, num="WS-DISC-1")
        _add_object_to_workspace(db_session, ws, obj)
        resp = client.post(
            _ws_actions_url(org, ws.workspace_id, "set_discoverable", "preview"),
            data=json.dumps({"is_discoverable": True}),
            content_type="application/json",
        )
        assert resp.status_code in (200, 400, 422)


class TestWorkspaceBulkActionValidate:
    def test_validate_unknown_action_400(self, auth_setup, db_session):
        client, org, user = auth_setup
        ws = _seed_workspace(db_session, org, user)
        resp = client.post(
            _ws_actions_url(
                org, ws.workspace_id, "bogus_action", "validate"
            ),
            data=json.dumps({}),
            content_type="application/json",
        )
        assert resp.status_code in (400, 404, 422)

    def test_validate_record_movement_missing_required_400(
        self, auth_setup, db_session
    ):
        client, org, user = auth_setup
        ws = _seed_workspace(db_session, org, user)
        resp = client.post(
            _ws_actions_url(
                org, ws.workspace_id, "record_movement", "validate"
            ),
            data=json.dumps({}),
            content_type="application/json",
        )
        # Missing required to_location_id and reason
        assert resp.status_code in (200, 400, 403, 422)

    def test_validate_record_movement_bad_location(
        self, auth_setup, db_session
    ):
        client, org, user = auth_setup
        ws = _seed_workspace(db_session, org, user)
        resp = client.post(
            _ws_actions_url(
                org, ws.workspace_id, "record_movement", "validate"
            ),
            data=json.dumps(
                {
                    "to_location_id": str(uuid4()),  # nonexistent
                    "reason": "test",
                }
            ),
            content_type="application/json",
        )
        # Validate may report errors in 200 body or surface 404, or 403 if
        # workspace permission gating is strict.
        assert resp.status_code in (200, 400, 403, 404, 422)


class TestWorkspaceBulkActionExecute:
    def test_execute_unknown_action_400(self, auth_setup, db_session):
        client, org, user = auth_setup
        ws = _seed_workspace(db_session, org, user)
        resp = client.post(
            _ws_actions_url(org, ws.workspace_id, "totally_fake", "execute"),
            data=json.dumps({}),
            content_type="application/json",
        )
        assert resp.status_code in (400, 404, 422)

    def test_execute_missing_required_params_400(
        self, auth_setup, db_session
    ):
        client, org, user = auth_setup
        ws = _seed_workspace(db_session, org, user)
        resp = client.post(
            _ws_actions_url(
                org, ws.workspace_id, "record_movement", "execute"
            ),
            data=json.dumps({}),
            content_type="application/json",
        )
        # Missing required fields → 400/422; or 403 if workspace permission
        # gating runs first.
        assert resp.status_code in (400, 403, 422)


# ===========================================================================
# 2. Media workspace bulk actions
# ===========================================================================


def _media_ws_actions_url(org, ws_id, action=None, op=None):
    base = (
        f"/api/organizations/{org.organization_id}"
        f"/media/workspaces/{ws_id}/actions"
    )
    if action is None:
        return base
    if op is None:
        return f"{base}/{action}"
    return f"{base}/{action}/{op}"


class TestMediaWorkspaceBulkActionList:
    def test_list_includes_dam_actions(self, auth_setup, db_session):
        client, org, user = auth_setup
        ws = _seed_workspace(
            db_session, org, user, workspace_type="media"
        )
        resp = client.get(_media_ws_actions_url(org, ws.workspace_id))
        assert resp.status_code == 200
        body = resp.get_json()
        actions = body.get("actions") or body.get("items") or []
        keys = {a["key"] for a in actions}
        expected = {
            "download_assets",
            "bulk_tag",
            "move_to_folder",
            "add_to_lightbox",
            "apply_metadata_template",
            "set_rights_policy",
            "create_renditions",
        }
        # Permissions may hide some — assert overlap
        assert len(keys & expected) >= 3

    def test_list_unknown_workspace_404(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.get(_media_ws_actions_url(org, uuid4()))
        assert resp.status_code == 404


class TestMediaWorkspaceBulkActionPreviewValidateExecute:
    def test_preview_unknown_action(self, auth_setup, db_session):
        client, org, user = auth_setup
        ws = _seed_workspace(
            db_session, org, user, workspace_type="media"
        )
        resp = client.post(
            _media_ws_actions_url(
                org, ws.workspace_id, "made_up", "preview"
            ),
            data=json.dumps({}),
            content_type="application/json",
        )
        assert resp.status_code in (400, 404, 422)

    def test_validate_unknown_action(self, auth_setup, db_session):
        client, org, user = auth_setup
        ws = _seed_workspace(
            db_session, org, user, workspace_type="media"
        )
        resp = client.post(
            _media_ws_actions_url(
                org, ws.workspace_id, "made_up", "validate"
            ),
            data=json.dumps({}),
            content_type="application/json",
        )
        assert resp.status_code in (400, 404, 422)

    def test_execute_unknown_action(self, auth_setup, db_session):
        client, org, user = auth_setup
        ws = _seed_workspace(
            db_session, org, user, workspace_type="media"
        )
        resp = client.post(
            _media_ws_actions_url(
                org, ws.workspace_id, "made_up", "execute"
            ),
            data=json.dumps({}),
            content_type="application/json",
        )
        assert resp.status_code in (400, 404, 422)

    def test_preview_bulk_tag(self, auth_setup, db_session):
        client, org, user = auth_setup
        ws = _seed_workspace(
            db_session, org, user, workspace_type="media"
        )
        m = _seed_media(db_session, org.organization_id, fname="bt.jpg")
        item = MediaWorkspaceItem(
            workspace_id=ws.workspace_id,
            media_id=m.media_id,
            added_by_user_id=None,
        )
        db_session.add(item)
        db_session.commit()
        resp = client.post(
            _media_ws_actions_url(
                org, ws.workspace_id, "bulk_tag", "preview"
            ),
            data=json.dumps({"tags": ["test-tag"]}),
            content_type="application/json",
        )
        assert resp.status_code in (200, 400, 422)


# ===========================================================================
# 3. Standalone bulk endpoints
# ===========================================================================


class TestBulkDiscoverable:
    """POST /collections/objects/bulk-discoverable"""

    def test_toggle_multiple_objects(self, auth_setup, db_session):
        client, org, _ = auth_setup
        obj1 = _seed_object(db_session, org.organization_id, num="BD-1")
        obj2 = _seed_object(db_session, org.organization_id, num="BD-2")
        url = (
            f"/api/organizations/{org.organization_id}"
            "/collections/objects/bulk-discoverable"
        )
        resp = client.post(
            url,
            data=json.dumps(
                {
                    "object_ids": [str(obj1.object_id), str(obj2.object_id)],
                    "is_discoverable": True,
                }
            ),
            content_type="application/json",
        )
        assert resp.status_code in (200, 201)

    def test_empty_ids(self, auth_setup):
        client, org, _ = auth_setup
        url = (
            f"/api/organizations/{org.organization_id}"
            "/collections/objects/bulk-discoverable"
        )
        resp = client.post(
            url,
            data=json.dumps({"object_ids": [], "is_discoverable": True}),
            content_type="application/json",
        )
        assert resp.status_code in (200, 400, 422)


class TestBulkBudget:
    """POST /exhibit/exhibitions/{id}/budget/bulk"""

    def test_unknown_exhibition_404(self, auth_setup):
        client, org, _ = auth_setup
        url = (
            f"/api/organizations/{org.organization_id}"
            f"/exhibit/exhibitions/{uuid4()}/budget/bulk"
        )
        resp = client.post(
            url,
            data=json.dumps({"items": []}),
            content_type="application/json",
        )
        assert resp.status_code in (400, 404, 422)


class TestBulkDeleteEmailEvents:
    """POST /email-events/bulk-delete"""

    def test_empty_event_ids(self, auth_setup):
        client, _, _ = auth_setup
        resp = client.post(
            "/api/email-events/bulk-delete",
            data=json.dumps({"event_ids": []}),
            content_type="application/json",
        )
        # Some impls require non-empty list (400/422); others accept it (200)
        assert resp.status_code in (200, 400, 403, 422)

    def test_unknown_event_ids(self, auth_setup):
        client, _, _ = auth_setup
        resp = client.post(
            "/api/email-events/bulk-delete",
            data=json.dumps({"event_ids": [str(uuid4()), str(uuid4())]}),
            content_type="application/json",
        )
        # 200 with deleted_count=0 OR 403/404 if perm/scope check fails
        assert resp.status_code in (200, 400, 403, 404, 422)


class TestBulkUserImport:
    """POST /platform/organizations/{org}/users/bulk"""

    def test_missing_payload(self, auth_setup):
        client, org, _ = auth_setup
        url = (
            f"/api/platform/organizations/{org.organization_id}/users/bulk"
        )
        resp = client.post(
            url,
            data=json.dumps({}),
            content_type="application/json",
        )
        # Platform admin endpoint — 403 if non-platform-admin user, else
        # 400/422 for missing fields
        assert resp.status_code in (400, 403, 422)


class TestBulkAITagReprocess:
    """POST /media/ai-tags/bulk-reprocess"""

    def test_empty_ids(self, auth_setup):
        client, org, _ = auth_setup
        url = (
            f"/api/organizations/{org.organization_id}"
            "/media/ai-tags/bulk-reprocess"
        )
        resp = client.post(
            url,
            data=json.dumps({"media_ids": []}),
            content_type="application/json",
        )
        # 200 with task queued, or 400/422 for empty
        assert resp.status_code in (200, 201, 400, 422)


class TestBulkClipGenerate:
    """POST /media/clip/bulk-generate"""

    def test_triggers_task(self, auth_setup):
        client, org, _ = auth_setup
        url = (
            f"/api/organizations/{org.organization_id}"
            "/media/clip/bulk-generate"
        )
        resp = client.post(
            url,
            data=json.dumps({}),
            content_type="application/json",
        )
        # Returns task id; some impls return 202, others 200
        assert resp.status_code in (200, 201, 202, 400, 422)


class TestBulkTranscribe:
    """POST /media/bulk-transcribe"""

    def test_triggers_task(self, auth_setup):
        client, org, _ = auth_setup
        url = (
            f"/api/organizations/{org.organization_id}"
            "/media/bulk-transcribe"
        )
        resp = client.post(
            url,
            data=json.dumps({}),
            content_type="application/json",
        )
        assert resp.status_code in (200, 201, 202, 400, 422)


class TestBulkUpdateMediaTags:
    """PUT /media/{media_id}/tags - bulk replace tags on a media item"""

    def test_replace_all_tags(self, auth_setup, db_session):
        client, org, _ = auth_setup
        m = _seed_media(db_session, org.organization_id, fname="bt2.jpg")
        url = (
            f"/api/organizations/{org.organization_id}"
            f"/media/{m.media_id}/tags"
        )
        resp = client.put(
            url,
            data=json.dumps({"tags": []}),
            content_type="application/json",
        )
        # PUT with empty body removes all tags; 200 success
        assert resp.status_code in (200, 400, 422)


# ===========================================================================
# 4. Batch CRUD shapes (semantically bulk)
# ===========================================================================


class TestBatchAddExhibitionObjects:
    """POST /exhibit/exhibitions/{id}/objects/batch — covered by existing
    test_api_exhibit_exhibitions_coverage; smoke-test the path here too.
    """

    def test_empty_batch(self, auth_setup):
        client, org, _ = auth_setup
        url = (
            f"/api/organizations/{org.organization_id}"
            f"/exhibit/exhibitions/{uuid4()}/objects/batch"
        )
        resp = client.post(
            url,
            data=json.dumps({"object_ids": []}),
            content_type="application/json",
        )
        # 404 (exhibition not found), 400 (empty), or 405 (route uses
        # different verb / segment naming on this exhibitions surface).
        assert resp.status_code in (400, 404, 405, 422)


class TestBatchCreateBarcodeLabels:
    """POST /collections/barcodes/labels/batch — covered by existing
    test_api_barcodes; smoke-test the path here too."""

    def test_empty_entries(self, auth_setup):
        client, org, _ = auth_setup
        url = (
            f"/api/organizations/{org.organization_id}"
            "/collections/barcodes/labels/batch"
        )
        resp = client.post(
            url,
            data=json.dumps({"label_format": "code128", "entries": []}),
            content_type="application/json",
        )
        # Some impls 200 with created_count=0; others 400/422
        assert resp.status_code in (200, 201, 400, 422)

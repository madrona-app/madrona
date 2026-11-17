"""Agent for rights holder on object rights and media rights.

Covers save/read through the API, contact validation (malformed, other-org),
clearing the link, and the object-rights CSV/Excel export columns.
"""

from __future__ import annotations

import csv
import io
from uuid import uuid4

from openpyxl import load_workbook

from app.models import CollectionObject, Constituent, Media, MediaRights, ObjectRight, Organization


def _seed_contact(db_session, org_id, name: str) -> Constituent:
    c = Constituent(organization_id=org_id, constituent_type="organization", name=name)
    db_session.add(c)
    db_session.commit()
    return c


def _seed_object(db_session, org_id, num: str = "AG-1") -> CollectionObject:
    obj = CollectionObject(organization_id=org_id, object_number=num)
    db_session.add(obj)
    db_session.commit()
    return obj


def _seed_media(db_session, org_id) -> Media:
    m = Media(
        organization_id=org_id,
        s3_key=f"orgs/{org_id}/media/{uuid4().hex}.jpg",
        filename="agent.jpg",
        file_size=1024,
        mime_type="image/jpeg",
        media_type="image",
        processing_status="completed",
    )
    db_session.add(m)
    db_session.commit()
    return m


def _other_org_contact(db_session) -> Constituent:
    other = Organization(name="Other Museum", slug=f"other-{uuid4().hex[:8]}", status="active")
    db_session.add(other)
    db_session.flush()
    return _seed_contact(db_session, other.organization_id, "Foreign Agency")


# ---------------------------------------------------------------------------
# Object rights
# ---------------------------------------------------------------------------


class TestObjectRightAgent:
    def test_create_and_read_agent(self, auth_setup, db_session):
        client, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id)
        holder = _seed_contact(db_session, org.organization_id, "Estate of A. Painter")
        agent = _seed_contact(db_session, org.organization_id, "Artists Rights Agency")

        resp = client.post(
            f"/api/organizations/{org.organization_id}/collections/objects/{obj.object_id}/rights",
            json={
                "right_type": "copyright",
                "status": "licensed",
                "rights_holder_contact_id": str(holder.constituent_id),
                "rights_holder_agent_contact_id": str(agent.constituent_id),
            },
        )
        assert resp.status_code == 201, resp.text
        body = resp.json
        assert body["rights_holder_agent_contact_id"] == str(agent.constituent_id)
        assert body["rights_holder_agent_contact_name"] == "Artists Rights Agency"
        assert body["rights_holder_contact_name"] == "Estate of A. Painter"

        got = client.get(
            f"/api/organizations/{org.organization_id}/collections/rights/{body['right_id']}"
        ).json
        assert got["rights_holder_agent_contact_id"] == str(agent.constituent_id)
        assert got["rights_holder_agent_contact_name"] == "Artists Rights Agency"

        row = db_session.get(ObjectRight, body["right_id"])
        db_session.refresh(row)
        assert row.rights_holder_agent_contact_id == agent.constituent_id

    def test_update_sets_and_clears_agent(self, auth_setup, db_session):
        client, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id)
        agent = _seed_contact(db_session, org.organization_id, "Licensing Co")
        right = ObjectRight(organization_id=org.organization_id, object_id=obj.object_id, right_type="copyright")
        db_session.add(right)
        db_session.commit()
        url = f"/api/organizations/{org.organization_id}/collections/rights/{right.right_id}"

        resp = client.put(url, json={"rights_holder_agent_contact_id": str(agent.constituent_id)})
        assert resp.status_code == 200, resp.text
        assert resp.json["rights_holder_agent_contact_name"] == "Licensing Co"

        resp = client.put(url, json={"rights_holder_agent_contact_id": None})
        assert resp.status_code == 200
        assert resp.json["rights_holder_agent_contact_id"] is None

    def test_rejects_contact_from_another_org(self, auth_setup, db_session):
        client, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id)
        foreign = _other_org_contact(db_session)
        resp = client.post(
            f"/api/organizations/{org.organization_id}/collections/objects/{obj.object_id}/rights",
            json={"right_type": "copyright", "rights_holder_agent_contact_id": str(foreign.constituent_id)},
        )
        assert resp.status_code == 422
        assert db_session.query(ObjectRight).filter_by(object_id=obj.object_id).count() == 0

    def test_rejects_malformed_contact_id(self, auth_setup, db_session):
        client, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id)
        resp = client.post(
            f"/api/organizations/{org.organization_id}/collections/objects/{obj.object_id}/rights",
            json={"right_type": "copyright", "rights_holder_agent_contact_id": "not-a-uuid"},
        )
        assert resp.status_code in (400, 422)


# ---------------------------------------------------------------------------
# Media rights
# ---------------------------------------------------------------------------


class TestMediaRightsAgent:
    def test_create_read_update_agent(self, auth_setup, db_session):
        client, org, _ = auth_setup
        media = _seed_media(db_session, org.organization_id)
        agent = _seed_contact(db_session, org.organization_id, "Photo Agency")
        base = f"/api/organizations/{org.organization_id}/media/{media.media_id}/rights"

        resp = client.post(base, json={
            "rights_type": "copyright",
            "rights_holder": "J. Photographer",
            "rights_holder_agent_contact_id": str(agent.constituent_id),
            "rights_holder_agent": "Photo Agency (London office)",
        })
        assert resp.status_code == 201, resp.text
        rights_id = resp.json["rights_id"]

        listed = client.get(base).json["rights"]
        assert len(listed) == 1
        assert listed[0]["rights_holder_agent_contact_id"] == str(agent.constituent_id)
        assert listed[0]["rights_holder_agent_contact_name"] == "Photo Agency"
        assert listed[0]["rights_holder_agent"] == "Photo Agency (London office)"

        resp = client.put(f"{base}/{rights_id}", json={
            "rights_holder_agent_contact_id": None,
            "rights_holder_agent": "Freelance agent",
        })
        assert resp.status_code == 200, resp.text
        row = db_session.get(MediaRights, rights_id)
        db_session.refresh(row)
        assert row.rights_holder_agent_contact_id is None
        assert row.rights_holder_agent == "Freelance agent"

    def test_media_rejects_contact_from_another_org(self, auth_setup, db_session):
        client, org, _ = auth_setup
        media = _seed_media(db_session, org.organization_id)
        foreign = _other_org_contact(db_session)
        resp = client.post(
            f"/api/organizations/{org.organization_id}/media/{media.media_id}/rights",
            json={"rights_type": "copyright", "rights_holder_agent_contact_id": str(foreign.constituent_id)},
        )
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------


class TestObjectRightsExport:
    def _seed(self, db_session, org_id):
        obj = _seed_object(db_session, org_id, "EXP-7")
        holder = _seed_contact(db_session, org_id, "Holder Trust")
        agent = _seed_contact(db_session, org_id, "Agent Ltd")
        db_session.add(ObjectRight(
            organization_id=org_id,
            object_id=obj.object_id,
            right_type="reproduction",
            status="licensed",
            rights_holder_contact_id=holder.constituent_id,
            rights_holder_agent_contact_id=agent.constituent_id,
        ))
        db_session.commit()

    def test_record_type_listed_with_agent_column(self, auth_setup):
        client, org, _ = auth_setup
        types = client.get(f"/api/organizations/{org.organization_id}/collections/export/record-types").json
        assert "object_rights" in {t["key"] for t in types["record_types"]}
        cols = client.get(
            f"/api/organizations/{org.organization_id}/collections/export/columns",
            params={"record_type": "object_rights"},
        ).json["columns"]
        labels = {c["label"] for c in cols}
        assert {"Rights Holder", "Agent for Rights Holder"} <= labels

    def test_csv_export_includes_agent(self, auth_setup, db_session):
        client, org, _ = auth_setup
        self._seed(db_session, org.organization_id)
        resp = client.post(
            f"/api/organizations/{org.organization_id}/collections/export",
            json={"record_type": "object_rights", "format": "csv"},
        )
        assert resp.status_code == 200, resp.text
        rows = list(csv.DictReader(io.StringIO(resp.content.decode("utf-8-sig"))))
        assert len(rows) == 1
        assert rows[0]["Object Number"] == "EXP-7"
        assert rows[0]["Rights Holder"] == "Holder Trust"
        assert rows[0]["Agent for Rights Holder"] == "Agent Ltd"

    def test_excel_export_includes_agent(self, auth_setup, db_session):
        client, org, _ = auth_setup
        self._seed(db_session, org.organization_id)
        resp = client.post(
            f"/api/organizations/{org.organization_id}/collections/export",
            json={"record_type": "object_rights", "format": "excel"},
        )
        assert resp.status_code == 200, resp.text
        ws = load_workbook(io.BytesIO(resp.content)).active
        values = [[c for c in row] for row in ws.iter_rows(values_only=True)]
        flat = [v for row in values for v in row if v is not None]
        assert "Agent for Rights Holder" in flat
        assert "Agent Ltd" in flat

    def test_export_requires_rights_view(self, viewer_auth_setup):
        client, org, _ = viewer_auth_setup
        resp = client.post(
            f"/api/organizations/{org.organization_id}/collections/export",
            json={"record_type": "object_rights", "format": "csv"},
        )
        assert resp.status_code == 403

"""Endpoint tests for personal conversation attachments.

Happy path (ingest → conversation-scoped chunks) and the org-scoping boundary
(can't attach to another org's conversation). The retrieval isolation itself is
covered by test_reference_chunk_isolation. get_embedding is mocked (no remote
call); the corpus extract/chunk helpers run for real on a plain-text file.
"""

import io
from uuid import uuid4
from unittest.mock import patch

from sqlalchemy import func, select

from app.models import Organization
from app.models.agent import Conversation
from app.models.core import Application, OrganizationApplication
from app.models.reference import ReferenceChunk

VEC = [1.0] + [0.0] * 1023


def _enable_guide(db_session, org_id):
    app = db_session.execute(
        select(Application).where(Application.key == "guide")
    ).scalar_one_or_none()
    if not app:
        app = Application(key="guide", display_name="Guide")
        db_session.add(app)
        db_session.flush()
    db_session.add(OrganizationApplication(
        organization_id=org_id, application_id=app.application_id, enabled=True, config={},
    ))
    db_session.commit()


def _txt(name="notes.txt", body=b"the loan return procedure is documented here"):
    return {"file": (io.BytesIO(body), name, "text/plain")}


class TestConversationAttachments:
    def test_upload_creates_conversation_scoped_chunks(self, auth_setup, db_session):
        client, org, user = auth_setup
        _enable_guide(db_session, org.organization_id)
        conv = Conversation(
            organization_id=org.organization_id, user_id=user.user_id, persona="staff",
        )
        db_session.add(conv)
        db_session.commit()

        with patch(
            "app.fastapi_app.routers.guide_attachments.get_embedding", return_value=VEC
        ):
            resp = client.post(
                f"/api/guide/conversations/{conv.conversation_id}/attachments",
                data=_txt(),
                content_type="multipart/form-data",
            )

        assert resp.status_code == 201, resp.text
        n = db_session.execute(
            select(func.count()).select_from(ReferenceChunk).where(
                ReferenceChunk.conversation_id == conv.conversation_id,
                ReferenceChunk.source == "conversation_attachment",
            )
        ).scalar()
        assert n >= 1
        # Personal chunks carry the uploader + org and are never public.
        chunk = db_session.execute(
            select(ReferenceChunk).where(
                ReferenceChunk.conversation_id == conv.conversation_id
            )
        ).scalars().first()
        assert chunk.organization_id == org.organization_id
        assert chunk.uploaded_by_user_id == user.user_id
        assert chunk.visibility is None

    def test_cannot_attach_to_another_orgs_conversation(self, auth_setup, db_session):
        client, org, _user = auth_setup
        _enable_guide(db_session, org.organization_id)
        other_org = Organization(name="Other", slug=f"o-{uuid4().hex[:8]}")
        db_session.add(other_org)
        db_session.flush()
        other_conv = Conversation(
            organization_id=other_org.organization_id, persona="staff",
        )
        db_session.add(other_conv)
        db_session.commit()

        with patch(
            "app.fastapi_app.routers.guide_attachments.get_embedding", return_value=VEC
        ):
            resp = client.post(
                f"/api/guide/conversations/{other_conv.conversation_id}/attachments",
                data=_txt(),
                content_type="multipart/form-data",
            )
        assert resp.status_code == 404, resp.text

"""
Download endpoints must honour media.download_original.

Regression test for a gap where the permission existed, was deliberately
withheld from the viewer role, and was never checked on the route the
Download button actually calls: /media/{id}/download built its presigned URL
inline rather than going through get_org_media_url, the one place
_check_media_url_permission runs. It required only media.view, so a viewer
could pull originals — with the rights-enforcement toggle both off AND on,
since compute_download_access reasons about MediaRights records and never
consults these permissions.

The alternatives route had the same shape. Alternatives are full uploaded
files (print-resolution masters), not generated derivatives, so they need
the same permission as the primary download.
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from app.models.media import Media


def _seed_media(db_session, org_id, fname: str = "original.jpg") -> Media:
    m = Media(
        organization_id=org_id,
        s3_key=f"orgs/{org_id}/media/dl/{uuid4().hex}.jpg",
        filename=fname,
        file_size=2048,
        mime_type="image/jpeg",
        media_type="image",
    )
    db_session.add(m)
    db_session.commit()
    return m


class TestViewerCannotDownloadOriginals:
    def test_viewer_is_refused_the_original(self, viewer_auth_setup, db_session):
        client, org, _ = viewer_auth_setup
        media = _seed_media(db_session, org.organization_id)

        resp = client.get(
            f"/api/organizations/{org.organization_id}/media/{media.media_id}/download"
        )

        assert resp.status_code == 403, resp.get_json()
        assert resp.get_json()["error"]["code"] == "forbidden"

    def test_viewer_is_refused_an_alternative(self, viewer_auth_setup, db_session):
        """Alternatives are originals by another route."""
        client, org, _ = viewer_auth_setup
        media = _seed_media(db_session, org.organization_id)

        resp = client.get(
            f"/api/organizations/{org.organization_id}/media/{media.media_id}"
            f"/alternatives/{uuid4()}/download"
        )

        # 403 for the permission, NOT 404 for the missing alternative: the
        # gate has to come first, or its absence is only visible for ids that
        # happen to exist.
        assert resp.status_code == 403, resp.get_json()
        assert resp.get_json()["error"]["code"] == "forbidden"


class TestPermittedRolesStillDownload:
    def test_role_with_download_original_is_allowed_through_the_gate(
        self, auth_setup, db_session, monkeypatch
    ):
        """
        The gate must not block a role that holds the permission, and the
        route behind it has to actually work.

        Asserting "not 403" is what let a 500 through the first time: the
        handler passed org_id where get_s3_client/get_media_bucket wanted a
        region, so every download errored. Presigning is a local computation,
        so a working route returns 200 and a URL without reaching S3.
        """
        client, org, _ = auth_setup
        media = _seed_media(db_session, org.organization_id)

        # The router imports check_permission inside the function, so it
        # resolves off rbac_service at call time — patch it there.
        import app.services.rbac_service as rbac
        monkeypatch.setattr(rbac, "check_permission", lambda *a, **k: True)

        resp = client.get(
            f"/api/organizations/{org.organization_id}/media/{media.media_id}/download"
        )
        assert resp.status_code == 200, resp.get_json()
        assert resp.get_json()["download_url"].startswith("http")

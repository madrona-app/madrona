"""
Display URLs must not carry the original master.

`url` was minted from media.s3_key with url_type=VIEW, so it needed only
media.view. Every surface that rendered an image therefore also handed the
viewer a working link to the full-resolution file — which is how Copy Direct
Link and the Download button could produce originals no matter what
media.download_original or the asset's rights said.

Images now display from a rendition. Video, audio and documents keep the
original because there is no rendition that stands in for the file itself —
closing those needs transcoded proxies, not a serializer change.
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from app.models.media import Media, MediaDerivative


def _media(db_session, org_id, media_type="image") -> Media:
    m = Media(
        organization_id=org_id,
        s3_key=f"orgs/{org_id}/media/orig/{uuid4().hex}.tif",
        filename="master.tif",
        file_size=90_000_000,
        mime_type="image/tiff" if media_type == "image" else "video/mp4",
        media_type=media_type,
        is_published=True,
    )
    db_session.add(m)
    db_session.commit()
    return m


def _derivative(db_session, media, kind: str) -> MediaDerivative:
    d = MediaDerivative(
        media_id=media.media_id,
        organization_id=media.organization_id,
        derivative_type=kind,
        format="jpeg",
        s3_key=f"orgs/{media.organization_id}/media/derivatives/{uuid4().hex}/{kind}.jpeg",
        width=1600 if kind == "large" else 600,
        height=1200 if kind == "large" else 450,
        file_size=250_000,
    )
    db_session.add(d)
    db_session.commit()
    return d


def _detail(client, org, media):
    return client.get(
        f"/api/organizations/{org.organization_id}/media/{media.media_id}"
    )


class TestImagesDisplayFromARendition:
    def test_url_is_not_the_master(self, auth_setup, db_session):
        client, org, _ = auth_setup
        media = _media(db_session, org.organization_id)
        _derivative(db_session, media, "large")

        body = _detail(client, org, media).get_json()

        assert body["url"], "an image still needs something to display from"
        assert media.s3_key not in body["url"], (
            "the original master is in the display URL"
        )

    def test_prefers_the_largest_rendition(self, auth_setup, db_session):
        client, org, _ = auth_setup
        media = _media(db_session, org.organization_id)
        _derivative(db_session, media, "small")
        large = _derivative(db_session, media, "large")

        body = _detail(client, org, media).get_json()
        assert large.s3_key in body["url"]

    def test_falls_back_to_thumbnail_not_the_master(self, auth_setup, db_session):
        """
        A missing rendition must degrade to a smaller image, never escalate
        to the original.
        """
        client, org, _ = auth_setup
        media = _media(db_session, org.organization_id)
        media.thumbnail_s3_key = f"orgs/{org.organization_id}/media/thumb/{uuid4().hex}.jpg"
        db_session.commit()

        body = _detail(client, org, media).get_json()
        assert media.s3_key not in (body["url"] or "")

    def test_no_rendition_at_all_yields_no_url(self, auth_setup, db_session):
        client, org, _ = auth_setup
        media = _media(db_session, org.organization_id)

        body = _detail(client, org, media).get_json()
        assert body["url"] is None, "nothing to display beats leaking the master"


class TestOtherTypesKeepTheOriginal:
    @pytest.mark.parametrize("media_type", ["video", "audio", "document"])
    def test_playable_types_still_point_at_the_file(self, auth_setup, db_session, media_type):
        """
        These play or render from this URL and have no image rendition to
        substitute. Swapping it breaks playback.
        """
        client, org, _ = auth_setup
        media = _media(db_session, org.organization_id, media_type=media_type)

        body = _detail(client, org, media).get_json()
        assert body["url"] and media.s3_key in body["url"]

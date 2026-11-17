"""Discover record pages: audio, video and document media, with captions.

The public object payload used to drop every non-image file. These tests pin
the public shape for each media type, the same-origin caption/transcript
endpoint, and the gates (published media, discoverable object, same org)
that keep non-public files unreachable.
"""

import uuid
from unittest.mock import patch

import pytest

from app.database import get_db


@pytest.fixture(scope="module")
def discover_app():
    from fastapi import FastAPI
    from app.fastapi_app.routers.discover_public import router as discover_public_router
    from app.fastapi_app.exception_handlers import register_exception_handlers

    app = FastAPI()
    register_exception_handlers(app)
    app.include_router(discover_public_router)
    return app


@pytest.fixture()
def client(discover_app, app, db_session):
    from fastapi.testclient import TestClient
    from app.database import get_admin_db

    def _override():
        yield db_session

    discover_app.dependency_overrides[get_db] = _override
    discover_app.dependency_overrides[get_admin_db] = _override
    with TestClient(discover_app) as c:
        yield c
    discover_app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def fake_signing():
    """Signed storage URLs become readable fakes that echo the key."""
    with patch(
        "app.services.discover_media.get_org_media_url",
        side_effect=lambda key, **kw: f"https://media.test/{key}",
    ), patch(
        "app.services.discovery_service.get_org_media_url",
        side_effect=lambda key, **kw: f"https://media.test/{key}",
    ):
        yield


@pytest.fixture()
def org(db_session):
    from app.models import Organization

    o = Organization(
        name="Media Portal Museum",
        slug=f"media-portal-{uuid.uuid4().hex[:8]}",
        status="active",
        is_demo=False,
        timezone="UTC",
    )
    db_session.add(o)
    db_session.flush()
    return o


@pytest.fixture()
def obj(db_session, org):
    from app.models import CollectionObject

    o = CollectionObject(
        object_id=uuid.uuid4(),
        organization_id=org.organization_id,
        object_number=f"AV.{uuid.uuid4().hex[:6]}",
        brief_description="Oral history",
        is_discoverable=True,
    )
    db_session.add(o)
    db_session.flush()
    return o


def _media(db_session, org, media_type, mime, *, published=True, **kw):
    from app.models import Media

    tag = uuid.uuid4().hex[:8]
    m = Media(
        organization_id=org.organization_id,
        filename=kw.pop("filename", f"file-{tag}"),
        s3_key=f"orgs/{org.organization_id}/media/MASTER-{tag}",
        media_type=media_type,
        mime_type=mime,
        file_size=kw.pop("file_size", 1_234_567),
        is_published=published,
        **kw,
    )
    db_session.add(m)
    db_session.flush()
    return m


def _link(db_session, obj, media, sort_order=0, primary=False):
    from app.models import CollectionObjectMedia

    db_session.add(CollectionObjectMedia(
        object_id=obj.object_id,
        media_id=media.media_id,
        sort_order=sort_order,
        is_primary=primary,
    ))
    db_session.flush()


def _alt(db_session, media, alt_type, key, **kw):
    from app.models.media import MediaAlternative

    a = MediaAlternative(
        media_id=media.media_id,
        organization_id=media.organization_id,
        alternative_type=alt_type,
        s3_key=key,
        filename=key.rsplit("/", 1)[-1],
        **kw,
    )
    db_session.add(a)
    db_session.flush()
    return a


def _image_with_rendition(db_session, org):
    from app.models import MediaDerivative

    m = _media(db_session, org, "image", "image/tiff", alt_text="A painted vase")
    db_session.add(MediaDerivative(
        media_id=m.media_id, organization_id=org.organization_id,
        derivative_type="large", format="jpeg", s3_key=f"derivs/{m.media_id}/large.jpeg",
        width=1600, height=1200, file_size=200_000,
    ))
    db_session.flush()
    return m


def _get(client, org, obj):
    with patch("app.fastapi_app.routers.discover_public.pub_cache_get", return_value=None), \
            patch("app.fastapi_app.routers.discover_public.pub_cache_set"):
        resp = client.get(f"/api/discover/{org.slug}/objects/{obj.object_id}")
    assert resp.status_code == 200, resp.text
    return resp.json()


def _by_type(payload):
    return {m["media_type"]: m for m in payload["media"]}


class TestPublicMediaPayload:
    def test_audio_video_and_document_are_present(self, client, db_session, org, obj):
        image = _image_with_rendition(db_session, org)
        audio = _media(db_session, org, "audio", "audio/mpeg", title="Interview, part 1",
                       duration_seconds=1800, transcript="Hello and welcome.",
                       transcription_model="whisper-large-v3")
        video = _media(db_session, org, "video", "video/quicktime", title="Gallery walkthrough")
        doc = _media(db_session, org, "document", "application/pdf", title="Exhibition catalogue",
                     page_count=48, file_size=2_400_000)
        for i, m in enumerate((image, audio, video, doc)):
            _link(db_session, obj, m, sort_order=i, primary=(i == 0))

        data = _get(client, org, obj)
        media = _by_type(data)
        assert set(media) == {"image", "audio", "video", "document"}
        assert data["has_image"] is True

        assert media["audio"]["name"] == "Interview, part 1"
        assert media["audio"]["duration_seconds"] == 1800
        assert media["audio"]["transcript"] == "Hello and welcome."
        assert media["audio"]["transcript_machine_generated"] is True
        # No access copy and no right to the original: nothing plays yet.
        assert media["audio"]["url"] is None
        assert media["audio"]["playback_status"] in ("preparing", "unavailable")

        assert media["document"]["name"] == "Exhibition catalogue"
        assert media["document"]["mime_type"] == "application/pdf"
        assert media["document"]["file_size"] == 2_400_000
        assert media["document"]["page_count"] == 48

        assert media["video"]["name"] == "Gallery walkthrough"

    def test_image_still_never_serves_the_master(self, client, db_session, org, obj):
        image = _image_with_rendition(db_session, org)
        _link(db_session, obj, image)
        item = _by_type(_get(client, org, obj))["image"]
        assert image.s3_key not in item["url"]
        assert item["url"].endswith("large.jpeg")

    def test_video_prefers_web_proxy_over_master(self, client, db_session, org, obj):
        from app.models import MediaDerivative

        video = _media(db_session, org, "video", "video/quicktime")
        # A real row: the format CHECK allows the transcoder's mp4/webm proxies.
        db_session.add(MediaDerivative(
            media_id=video.media_id, organization_id=org.organization_id,
            derivative_type="web_mp4_720p", format="mp4",
            s3_key=f"derivs/{video.media_id}/web.mp4", width=1280, height=720, file_size=10,
        ))
        db_session.commit()
        _link(db_session, obj, video)
        item = _by_type(_get(client, org, obj))["video"]
        assert item["url"].endswith("web.mp4")
        assert item["playback_mime_type"] == "video/mp4"

    def test_captions_and_text_alternatives_are_public_api_paths(self, client, db_session, org, obj):
        video = _media(db_session, org, "video", "video/mp4", transcript_language="en")
        vtt = _alt(db_session, video, "subtitle_vtt", "alts/cap.vtt", generated_by="whisper",
                   generation_params={"language": "en"})
        _alt(db_session, video, "subtitle_srt", "alts/cap.srt", generated_by="whisper")
        txt = _alt(db_session, video, "transcript_txt", "alts/t.txt", label="Full transcript", file_size=900)
        _link(db_session, obj, video)

        item = _by_type(_get(client, org, obj))["video"]
        # Whisper's SRT duplicates its VTT; only one track is offered.
        assert len(item["captions"]) == 1
        cap = item["captions"][0]
        assert cap["url"] == f"/api/discover/{org.slug}/media/{video.media_id}/alternatives/{vtt.alternative_id}"
        assert cap["kind"] == "captions"
        assert cap["srclang"] == "en"
        assert cap["label"] == "Captions (machine-generated)"
        assert cap["default"] is True
        # No storage key or presigned URL leaks through the caption field.
        assert "alts/" not in cap["url"]

        assert item["text_alternatives"] == [{
            "url": f"/api/discover/{org.slug}/media/{video.media_id}/alternatives/{txt.alternative_id}",
            "label": "Full transcript",
            "kind": "transcript",
            "file_size": 900,
        }]

    def test_unpublished_media_is_not_in_the_payload(self, client, db_session, org, obj):
        audio = _media(db_session, org, "audio", "audio/mpeg", published=False)
        _link(db_session, obj, audio)
        assert _get(client, org, obj)["media"] == []

    def test_model_3d_is_not_offered(self, client, db_session, org, obj):
        model = _media(db_session, org, "model_3d", "model/gltf-binary")
        _link(db_session, obj, model)
        assert _get(client, org, obj)["media"] == []


class _FakeStorage:
    def __init__(self, blobs):
        self.blobs = blobs

    def get_object_sync(self, key):
        return self.blobs[key], None


class TestPublicAlternativeEndpoint:
    def _fetch(self, client, org, media, alt, blobs):
        with patch("app.services.storage.get_storage_backend", return_value=_FakeStorage(blobs)):
            return client.get(f"/api/discover/{org.slug}/media/{media.media_id}/alternatives/{alt.alternative_id}")

    def test_vtt_is_served_as_webvtt(self, client, db_session, org, obj):
        video = _media(db_session, org, "video", "video/mp4")
        alt = _alt(db_session, video, "subtitle_vtt", "alts/a.vtt")
        _link(db_session, obj, video)
        resp = self._fetch(client, org, video, alt, {"alts/a.vtt": b"WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi\n"})
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/vtt")
        assert resp.text.startswith("WEBVTT")

    def test_srt_is_converted_to_webvtt(self, client, db_session, org, obj):
        audio = _media(db_session, org, "audio", "audio/mpeg")
        alt = _alt(db_session, audio, "subtitle_srt", "alts/a.srt")
        _link(db_session, obj, audio)
        srt = b"1\n00:00:01,500 --> 00:00:03,000\nHello\n"
        resp = self._fetch(client, org, audio, alt, {"alts/a.srt": srt})
        assert resp.status_code == 200
        assert resp.text.startswith("WEBVTT\n\n")
        assert "00:00:01.500 --> 00:00:03.000" in resp.text

    def test_transcript_text_is_plain_text(self, client, db_session, org, obj):
        audio = _media(db_session, org, "audio", "audio/mpeg")
        alt = _alt(db_session, audio, "transcript_txt", "alts/t.txt")
        _link(db_session, obj, audio)
        resp = self._fetch(client, org, audio, alt, {"alts/t.txt": b"Full words."})
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/plain")
        assert resp.text == "Full words."

    def test_unpublished_media_track_is_404(self, client, db_session, org, obj):
        audio = _media(db_session, org, "audio", "audio/mpeg", published=False)
        alt = _alt(db_session, audio, "subtitle_vtt", "alts/x.vtt")
        _link(db_session, obj, audio)
        assert self._fetch(client, org, audio, alt, {"alts/x.vtt": b"WEBVTT"}).status_code == 404

    def test_media_on_a_non_discoverable_object_is_404(self, client, db_session, org, obj):
        audio = _media(db_session, org, "audio", "audio/mpeg")
        alt = _alt(db_session, audio, "subtitle_vtt", "alts/y.vtt")
        _link(db_session, obj, audio)
        obj.is_discoverable = False
        db_session.flush()
        assert self._fetch(client, org, audio, alt, {"alts/y.vtt": b"WEBVTT"}).status_code == 404

    def test_unlinked_published_media_is_404(self, client, db_session, org, obj):
        audio = _media(db_session, org, "audio", "audio/mpeg")
        alt = _alt(db_session, audio, "subtitle_vtt", "alts/z.vtt")
        assert self._fetch(client, org, audio, alt, {"alts/z.vtt": b"WEBVTT"}).status_code == 404

    def test_another_orgs_slug_cannot_reach_the_track(self, client, db_session, org, obj):
        from app.models import Organization

        other = Organization(name="Other", slug=f"other-{uuid.uuid4().hex[:8]}", status="active",
                             is_demo=False, timezone="UTC")
        db_session.add(other)
        db_session.flush()
        audio = _media(db_session, org, "audio", "audio/mpeg")
        alt = _alt(db_session, audio, "subtitle_vtt", "alts/o.vtt")
        _link(db_session, obj, audio)
        assert self._fetch(client, other, audio, alt, {"alts/o.vtt": b"WEBVTT"}).status_code == 404

    def test_non_text_alternative_is_404(self, client, db_session, org, obj):
        image = _media(db_session, org, "image", "image/tiff")
        alt = _alt(db_session, image, "crop", "alts/crop.tif")
        _link(db_session, obj, image)
        assert self._fetch(client, org, image, alt, {"alts/crop.tif": b"\x00"}).status_code == 404


def test_srt_to_vtt_handles_bom_and_crlf():
    from app.services.discover_media import srt_to_vtt

    out = srt_to_vtt("﻿1\r\n00:00:00,000 --> 00:00:02,250\r\nHi\r\n")
    assert out == "WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.250\nHi\n"


# ---------------------------------------------------------------------------
# Per-file public download level
# ---------------------------------------------------------------------------


def _open_rights(db_session, media):
    """An active open-access grant, as rights-enforcing orgs require for originals."""
    from app.models.media import MediaRights

    db_session.add(MediaRights(
        media_id=media.media_id,
        organization_id=media.organization_id,
        rights_type="license",
        rights_status="public_domain",
        is_active=True,
    ))
    db_session.flush()


class TestDownloadLinksInPayload:
    def _image(self, db_session, org, obj, level):
        m = _image_with_rendition(db_session, org)
        m.public_download_level = level
        db_session.flush()
        _link(db_session, obj, m)
        return m

    def test_unset_level_offers_no_downloads(self, client, db_session, org, obj):
        self._image(db_session, org, obj, None)
        assert _by_type(_get(client, org, obj))["image"]["downloads"] == []

    def test_none_offers_no_downloads(self, client, db_session, org, obj):
        self._image(db_session, org, obj, "none")
        assert _by_type(_get(client, org, obj))["image"]["downloads"] == []

    def test_derivatives_offers_the_access_copy_only(self, client, db_session, org, obj):
        m = self._image(db_session, org, obj, "derivatives")
        downloads = _by_type(_get(client, org, obj))["image"]["downloads"]
        assert [d["variant"] for d in downloads] == ["access"]
        assert downloads[0]["url"] == f"/api/discover/{org.slug}/media/{m.media_id}/download?variant=access"
        assert downloads[0]["format"] == "JPEG"
        assert downloads[0]["file_size"] == 200_000

    def test_originals_offers_both(self, client, db_session, org, obj):
        m = self._image(db_session, org, obj, "originals")
        downloads = _by_type(_get(client, org, obj))["image"]["downloads"]
        assert [d["variant"] for d in downloads] == ["access", "original"]
        original = downloads[1]
        assert original["url"].endswith(f"/media/{m.media_id}/download?variant=original")
        assert original["mime_type"] == "image/tiff"
        # The link is the enforcing endpoint, never a storage URL for the master.
        assert m.s3_key not in original["url"]

    def test_audio_has_no_access_copy(self, client, db_session, org, obj):
        a = _media(db_session, org, "audio", "audio/mpeg", public_download_level="derivatives")
        _link(db_session, obj, a)
        assert _by_type(_get(client, org, obj))["audio"]["downloads"] == []

    def test_expired_rights_withdraw_downloads(self, client, db_session, org, obj):
        from datetime import date, timedelta
        from app.models.media import MediaRights

        m = self._image(db_session, org, obj, "originals")
        db_session.add(MediaRights(
            media_id=m.media_id, organization_id=org.organization_id,
            rights_type="license", rights_status="in_copyright", is_active=True,
            end_date=date.today() - timedelta(days=1),
        ))
        db_session.flush()
        assert _by_type(_get(client, org, obj))["image"]["downloads"] == []


class TestDownloadEndpoint:
    def _dl(self, client, org, media, variant):
        with patch(
            "app.services.uploads.get_org_media_url_byob",
            side_effect=lambda key, **kw: f"https://media.test/{key}?dl={kw.get('filename')}",
        ):
            return client.get(
                f"/api/discover/{org.slug}/media/{media.media_id}/download",
                params={"variant": variant},
                follow_redirects=False,
            )

    def test_original_is_refused_when_level_is_derivatives(self, client, db_session, org, obj):
        m = _image_with_rendition(db_session, org)
        m.public_download_level = "derivatives"
        _link(db_session, obj, m)
        resp = self._dl(client, org, m, "original")
        assert resp.status_code == 403
        assert resp.json()["error"]["code"] == "download_not_permitted"

    def test_everything_is_refused_when_level_is_unset(self, client, db_session, org, obj):
        m = _image_with_rendition(db_session, org)
        _link(db_session, obj, m)
        assert self._dl(client, org, m, "original").status_code == 403
        assert self._dl(client, org, m, "access").status_code == 403

    def test_access_copy_redirects_to_the_rendition(self, client, db_session, org, obj):
        m = _image_with_rendition(db_session, org)
        m.public_download_level = "derivatives"
        m.filename = "vase.tif"
        _link(db_session, obj, m)
        resp = self._dl(client, org, m, "access")
        assert resp.status_code == 302
        assert resp.headers["location"].startswith(f"https://media.test/derivs/{m.media_id}/large.jpeg")
        assert "dl=vase_access.jpeg" in resp.headers["location"]
        assert m.s3_key not in resp.headers["location"]
        assert resp.headers["cache-control"] == "no-store"

    def test_original_redirects_to_the_master_when_allowed(self, client, db_session, org, obj):
        m = _image_with_rendition(db_session, org)
        m.public_download_level = "originals"
        m.filename = "vase.tif"
        _link(db_session, obj, m)
        resp = self._dl(client, org, m, "original")
        assert resp.status_code == 302
        assert resp.headers["location"].startswith(f"https://media.test/{m.s3_key}")
        assert "dl=vase.tif" in resp.headers["location"]

    def test_rights_enforcement_requires_open_access_for_originals(self, client, db_session, org, obj):
        m = _image_with_rendition(db_session, org)
        m.public_download_level = "originals"
        _link(db_session, obj, m)
        org.media_rights_enforcement = True
        db_session.flush()
        # No rights records -> "request" -> refused for the public.
        assert self._dl(client, org, m, "original").status_code == 403
        # The access copy is not gated on an open-access grant.
        assert self._dl(client, org, m, "access").status_code == 302
        _open_rights(db_session, m)
        assert self._dl(client, org, m, "original").status_code == 302

    def test_unpublished_media_is_404_even_at_originals(self, client, db_session, org, obj):
        m = _media(db_session, org, "document", "application/pdf", published=False,
                   public_download_level="originals")
        _link(db_session, obj, m)
        assert self._dl(client, org, m, "original").status_code == 404

    def test_media_not_linked_to_a_discoverable_object_is_404(self, client, db_session, org, obj):
        m = _media(db_session, org, "document", "application/pdf", public_download_level="originals")
        assert self._dl(client, org, m, "original").status_code == 404

    def test_unknown_variant_is_422(self, client, db_session, org, obj):
        m = _media(db_session, org, "document", "application/pdf", public_download_level="originals")
        _link(db_session, obj, m)
        assert self._dl(client, org, m, "thumbnail").status_code == 422


def test_file_level_only_narrows_a_share():
    from types import SimpleNamespace
    from app.services.discover_media import narrow_share_level

    assert narrow_share_level("originals", SimpleNamespace(public_download_level=None)) == "originals"
    assert narrow_share_level("originals", SimpleNamespace(public_download_level="derivatives")) == "derivatives"
    assert narrow_share_level("derivatives", SimpleNamespace(public_download_level="originals")) == "derivatives"
    assert narrow_share_level("none", SimpleNamespace(public_download_level="originals")) == "none"
    assert narrow_share_level("originals", SimpleNamespace(public_download_level="none")) == "none"


# ---------------------------------------------------------------------------
# Playback never serves the original unless the level is 'originals'
# ---------------------------------------------------------------------------

import json  # noqa: E402


def _deriv(db_session, media, derivative_type, fmt, key, **kw):
    from app.models import MediaDerivative

    d = MediaDerivative(
        media_id=media.media_id, organization_id=media.organization_id,
        derivative_type=derivative_type, format=fmt, s3_key=key,
        width=kw.pop("width", 0), height=kw.pop("height", 0), file_size=kw.pop("file_size", 4096),
    )
    db_session.add(d)
    db_session.flush()
    return d


def _job(db_session, media, job_type, status):
    from app.models import MediaProcessingJob

    db_session.add(MediaProcessingJob(
        media_id=media.media_id, organization_id=media.organization_id,
        job_type=job_type, status=status,
    ))
    db_session.flush()


@pytest.fixture()
def queued():
    """Capture queue requests instead of running the tasks; generation is possible."""
    calls = {"access_copy": [], "transcode": []}
    with patch(
        "app.tasks.media.generate_access_copy_task.delay",
        side_effect=lambda **kw: calls["access_copy"].append(kw),
    ), patch(
        "app.tasks.media.transcode_video_task.delay",
        side_effect=lambda **kw: calls["transcode"].append(kw),
    ), patch(
        "app.services.public_access_copy.can_generate", return_value=True,
    ), patch(
        "app.services.discover_media._claim_queue_slot", return_value=True,
    ):
        yield calls


def _payload_text(payload) -> str:
    return json.dumps(payload)


class TestPlaybackHonoursTheDownloadLevel:
    @pytest.mark.parametrize("level", [None, "none", "derivatives"])
    def test_audio_without_proxy_never_plays_the_master(self, client, db_session, org, obj, queued, level):
        audio = _media(db_session, org, "audio", "audio/wav", public_download_level=level,
                       transcript="Words spoken.")
        vtt = _alt(db_session, audio, "subtitle_vtt", "alts/a.vtt")
        _link(db_session, obj, audio)

        payload = _get(client, org, obj)
        item = _by_type(payload)["audio"]
        assert item["url"] is None
        assert item["playback_status"] == "preparing"
        assert item["playback_source"] is None
        assert audio.s3_key not in _payload_text(payload)
        # Captions and transcript stay available without a playable copy.
        assert item["transcript"] == "Words spoken."
        assert item["captions"][0]["url"].endswith(str(vtt.alternative_id))
        assert queued["access_copy"] == [{"media_id": str(audio.media_id), "organization_id": str(org.organization_id)}]

    @pytest.mark.parametrize("level", [None, "none", "derivatives"])
    def test_audio_plays_its_proxy(self, client, db_session, org, obj, queued, level):
        audio = _media(db_session, org, "audio", "audio/wav", public_download_level=level)
        _deriv(db_session, audio, "web_audio_aac", "mp4", f"derivs/{audio.media_id}/web_audio_aac.m4a")
        _link(db_session, obj, audio)
        payload = _get(client, org, obj)
        item = _by_type(payload)["audio"]
        assert item["url"].endswith("web_audio_aac.m4a")
        assert item["playback_mime_type"] == "audio/mp4"
        assert item["playback_source"] == "access_copy"
        assert item["playback_status"] == "ready"
        assert audio.s3_key not in _payload_text(payload)
        assert queued["access_copy"] == []

    def test_audio_proxy_is_the_access_copy_download(self, client, db_session, org, obj, queued):
        audio = _media(db_session, org, "audio", "audio/wav", public_download_level="derivatives")
        _deriv(db_session, audio, "web_audio_aac", "mp4", "derivs/a.m4a", file_size=5000)
        _link(db_session, obj, audio)
        downloads = _by_type(_get(client, org, obj))["audio"]["downloads"]
        assert [(d["variant"], d["format"], d["mime_type"]) for d in downloads] == [("access", "M4A", "audio/mp4")]

    def test_original_level_may_play_the_master(self, client, db_session, org, obj, queued):
        audio = _media(db_session, org, "audio", "audio/mpeg", public_download_level="originals")
        _link(db_session, obj, audio)
        item = _by_type(_get(client, org, obj))["audio"]
        assert item["url"] == f"https://media.test/{audio.s3_key}"
        assert item["playback_source"] == "original"
        assert item["playback_status"] == "ready"
        assert queued["access_copy"] == []

    def test_original_level_still_prefers_the_proxy_for_audio(self, client, db_session, org, obj, queued):
        audio = _media(db_session, org, "audio", "audio/wav", public_download_level="originals")
        _deriv(db_session, audio, "web_audio_aac", "mp4", "derivs/p.m4a")
        _link(db_session, obj, audio)
        assert _by_type(_get(client, org, obj))["audio"]["url"].endswith("derivs/p.m4a")

    def test_original_level_with_rights_refusal_does_not_play_the_master(self, client, db_session, org, obj, queued):
        audio = _media(db_session, org, "audio", "audio/mpeg", public_download_level="originals")
        _link(db_session, obj, audio)
        org.media_rights_enforcement = True  # no open-access grant -> original refused
        db_session.flush()
        payload = _get(client, org, obj)
        assert _by_type(payload)["audio"]["url"] is None
        assert audio.s3_key not in _payload_text(payload)

    def test_video_without_proxy_never_plays_the_master(self, client, db_session, org, obj, queued):
        video = _media(db_session, org, "video", "video/quicktime", public_download_level="derivatives")
        _link(db_session, obj, video)
        payload = _get(client, org, obj)
        item = _by_type(payload)["video"]
        assert item["url"] is None
        assert item["playback_status"] == "preparing"
        assert video.s3_key not in _payload_text(payload)
        assert queued["transcode"] == [{"media_id": str(video.media_id), "organization_id": str(org.organization_id)}]

    def test_running_job_is_preparing_and_not_queued_again(self, client, db_session, org, obj, queued):
        audio = _media(db_session, org, "audio", "audio/wav")
        _job(db_session, audio, "access_copy", "processing")
        _link(db_session, obj, audio)
        item = _by_type(_get(client, org, obj))["audio"]
        assert item["playback_status"] == "preparing"
        assert queued["access_copy"] == []

    def test_failed_job_is_unavailable_and_not_retried_by_visitors(self, client, db_session, org, obj, queued):
        audio = _media(db_session, org, "audio", "audio/wav")
        _job(db_session, audio, "access_copy", "failed")
        _link(db_session, obj, audio)
        item = _by_type(_get(client, org, obj))["audio"]
        assert item["url"] is None
        assert item["playback_status"] == "unavailable"
        assert queued["access_copy"] == []

    def test_no_transcoder_is_unavailable_and_nothing_is_queued(self, client, db_session, org, obj, queued):
        audio = _media(db_session, org, "audio", "audio/wav")
        _link(db_session, obj, audio)
        with patch("app.services.public_access_copy.can_generate", return_value=False):
            item = _by_type(_get(client, org, obj))["audio"]
        assert item["url"] is None
        assert item["playback_status"] == "unavailable"
        assert queued["access_copy"] == []


class TestPdfAccessCopy:
    def _pdf(self, db_session, org, obj, level, **kw):
        doc = _media(db_session, org, "document", "application/pdf", public_download_level=level,
                     filename="catalogue.pdf", page_count=2, **kw)
        _link(db_session, obj, doc)
        return doc

    @pytest.mark.parametrize("level", [None, "none", "derivatives"])
    def test_pdf_opens_its_page_image_copy(self, client, db_session, org, obj, queued, level):
        doc = self._pdf(db_session, org, obj, level,
                        extra_metadata={"access_text_pages": ["Page one words.", "Page two words."]})
        _deriv(db_session, doc, "access_pdf", "pdf", f"derivs/{doc.media_id}/access_pdf.pdf", width=816, height=1056)
        payload = _get(client, org, obj)
        item = _by_type(payload)["document"]
        assert item["url"].endswith("access_pdf.pdf")
        assert item["playback_source"] == "access_copy"
        assert item["playback_mime_type"] == "application/pdf"
        assert item["text_url"] == f"/api/discover/{org.slug}/media/{doc.media_id}/text"
        assert doc.s3_key not in _payload_text(payload)

    def test_pdf_without_copy_serves_nothing_and_queues_one(self, client, db_session, org, obj, queued):
        doc = self._pdf(db_session, org, obj, "none")
        payload = _get(client, org, obj)
        item = _by_type(payload)["document"]
        assert item["url"] is None
        assert item["playback_status"] == "preparing"
        assert item["text_url"] is None
        assert doc.s3_key not in _payload_text(payload)
        assert [c["media_id"] for c in queued["access_copy"]] == [str(doc.media_id)]

    def test_pdf_at_originals_opens_the_original(self, client, db_session, org, obj, queued):
        doc = self._pdf(db_session, org, obj, "originals",
                        extra_metadata={"access_text_pages": ["Text."]})
        _deriv(db_session, doc, "access_pdf", "pdf", "derivs/access.pdf")
        item = _by_type(_get(client, org, obj))["document"]
        # The original keeps its text layer and tags, so it is preferred.
        assert item["url"] == f"https://media.test/{doc.s3_key}"
        assert item["playback_source"] == "original"

    def test_access_pdf_is_the_access_copy_download(self, client, db_session, org, obj, queued):
        doc = self._pdf(db_session, org, obj, "derivatives")
        _deriv(db_session, doc, "access_pdf", "pdf", f"derivs/{doc.media_id}/access_pdf.pdf", file_size=9000)
        downloads = _by_type(_get(client, org, obj))["document"]["downloads"]
        assert [(d["variant"], d["format"], d["mime_type"], d["width"]) for d in downloads] == [
            ("access", "PDF", "application/pdf", None)
        ]
        with patch(
            "app.services.uploads.get_org_media_url_byob",
            side_effect=lambda key, **kw: f"https://media.test/{key}?dl={kw.get('filename')}",
        ):
            resp = client.get(f"/api/discover/{org.slug}/media/{doc.media_id}/download",
                              params={"variant": "access"}, follow_redirects=False)
        assert resp.status_code == 302
        assert "access_pdf.pdf?dl=catalogue_access.pdf" in resp.headers["location"]
        assert doc.s3_key not in resp.headers["location"]

    def test_non_pdf_document_is_text_only(self, client, db_session, org, obj, queued):
        doc = _media(db_session, org, "document",
                     "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                     extra_metadata={"extracted_text": "Minutes of the meeting."})
        _link(db_session, obj, doc)
        payload = _get(client, org, obj)
        item = _by_type(payload)["document"]
        assert item["url"] is None
        assert item["playback_status"] == "text_only"
        assert item["text_url"].endswith(f"/media/{doc.media_id}/text")
        assert doc.s3_key not in _payload_text(payload)
        assert queued["access_copy"] == []


class TestDocumentTextEndpoint:
    def _text(self, client, org, media):
        return client.get(f"/api/discover/{org.slug}/media/{media.media_id}/text")

    def test_pdf_text_is_served_page_by_page(self, client, db_session, org, obj):
        doc = _media(db_session, org, "document", "application/pdf",
                     extra_metadata={"access_text_pages": ["First page.", "", "Third page."]})
        _link(db_session, obj, doc)
        resp = self._text(client, org, doc)
        assert resp.status_code == 200
        assert resp.json() == {"pages": [
            {"page": 1, "text": "First page."},
            {"page": 2, "text": ""},
            {"page": 3, "text": "Third page."},
        ], "truncated": False}

    def test_other_document_text_is_one_entry(self, client, db_session, org, obj):
        doc = _media(db_session, org, "document", "text/plain", extra_metadata={"extracted_text": "Plain."})
        _link(db_session, obj, doc)
        assert self._text(client, org, doc).json() == {"pages": [{"page": None, "text": "Plain."}], "truncated": False}

    def test_long_text_is_truncated(self, client, db_session, org, obj):
        doc = _media(db_session, org, "document", "text/plain", extra_metadata={"extracted_text": "x" * 50})
        _link(db_session, obj, doc)
        with patch("app.services.discover_media.MAX_DOCUMENT_TEXT_CHARS", 10):
            body = self._text(client, org, doc).json()
        assert body == {"pages": [{"page": None, "text": "x" * 10}], "truncated": True}

    def test_unpublished_or_unlinked_or_textless_is_404(self, client, db_session, org, obj):
        hidden = _media(db_session, org, "document", "application/pdf", published=False,
                        extra_metadata={"access_text_pages": ["Secret."]})
        _link(db_session, obj, hidden)
        unlinked = _media(db_session, org, "document", "application/pdf",
                          extra_metadata={"access_text_pages": ["Loose."]})
        textless = _media(db_session, org, "document", "application/pdf")
        _link(db_session, obj, textless)
        audio = _media(db_session, org, "audio", "audio/mpeg", extra_metadata={"extracted_text": "No."})
        _link(db_session, obj, audio)
        for m in (hidden, unlinked, textless, audio):
            assert self._text(client, org, m).status_code == 404


# ---------------------------------------------------------------------------
# Making the access copies
# ---------------------------------------------------------------------------


def _pdf_with_text(pages: list[str]) -> bytes:
    """A real PDF whose pages carry a text layer."""
    import ctypes
    import io as _io

    import pypdfium2 as pdfium
    import pypdfium2.raw as raw

    doc = pdfium.PdfDocument.new()
    for words in pages:
        page = doc.new_page(612, 792)
        text_obj = raw.FPDFPageObj_NewTextObj(doc.raw, b"Helvetica", 24)
        buf = ctypes.create_string_buffer((words + "\x00").encode("utf-16-le"))
        raw.FPDFText_SetText(text_obj, ctypes.cast(buf, ctypes.POINTER(raw.FPDF_WCHAR)))
        raw.FPDFPageObj_Transform(text_obj, 1, 0, 0, 1, 72, 700)
        raw.FPDFPage_InsertObject(page.raw, text_obj)
        page.gen_content()
        page.close()
    out = _io.BytesIO()
    doc.save(out)
    doc.close()
    return out.getvalue()


class _MemoryStorage:
    def __init__(self, blobs):
        self.blobs = dict(blobs)
        self.types = {}

    def get_object_sync(self, key):
        return self.blobs[key], None

    def put_object_sync(self, key, body, content_type=None, **kw):
        self.blobs[key] = body
        self.types[key] = content_type


class TestGenerateAccessCopy:
    def test_pdf_copy_is_page_images_with_the_text_kept(self, db_session, org):
        import pypdfium2 as pdfium
        from app.models import MediaDerivative
        from app.services.public_access_copy import generate_access_copy

        doc = _media(db_session, org, "document", "application/pdf")
        storage = _MemoryStorage({doc.s3_key: _pdf_with_text(["Hello reader", "Second page"])})
        with patch("app.services.storage.get_storage_backend", return_value=storage):
            summary = generate_access_copy(doc, db_session)

        assert summary["status"] == "created" and summary["pages"] == 2
        d = db_session.query(MediaDerivative).filter_by(media_id=doc.media_id, derivative_type="access_pdf").one()
        assert d.format == "pdf" and d.s3_key != doc.s3_key
        assert storage.types[d.s3_key] == "application/pdf"
        copy = pdfium.PdfDocument(storage.blobs[d.s3_key])
        assert len(copy) == 2
        # Page images only: no text layer, no vector content.
        assert copy[0].get_textpage().get_text_bounded() == ""
        assert {o.type for o in copy[0].get_objects()} == {pdfium.raw.FPDF_PAGEOBJ_IMAGE}
        db_session.refresh(doc)
        assert doc.extra_metadata["access_text_pages"] == ["Hello reader", "Second page"]
        assert doc.extra_metadata["extracted_text"] == "Hello reader\n\nSecond page"

    @pytest.mark.skipif(__import__("shutil").which("ffmpeg") is None, reason="ffmpeg not installed")
    def test_audio_proxy_is_aac_in_mp4(self, db_session, org):
        import subprocess
        import tempfile
        from app.models import MediaDerivative
        from app.services.public_access_copy import generate_access_copy

        with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
            subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi",
                            "-i", "sine=frequency=440:duration=1", tmp.name], check=True)
            with open(tmp.name, "rb") as fh:
                wav = fh.read()
        audio = _media(db_session, org, "audio", "audio/wav", filename="tone.wav")
        storage = _MemoryStorage({audio.s3_key: wav})
        with patch("app.services.storage.get_storage_backend", return_value=storage):
            summary = generate_access_copy(audio, db_session)
        assert summary["status"] == "created"
        d = db_session.query(MediaDerivative).filter_by(media_id=audio.media_id, derivative_type="web_audio_aac").one()
        assert d.format == "mp4" and d.s3_key.endswith(".m4a")
        assert storage.blobs[d.s3_key][4:8] == b"ftyp"
        # A second run leaves the copy alone.
        with patch("app.services.storage.get_storage_backend", return_value=storage):
            assert generate_access_copy(audio, db_session) == {"status": "exists"}

    def test_audio_without_ffmpeg_goes_to_mediaconvert(self, db_session, org):
        from app.services.public_access_copy import generate_access_copy

        audio = _media(db_session, org, "audio", "audio/wav")
        with patch("app.services.public_access_copy.ffmpeg_available", return_value=False), \
                patch("app.services.video_transcoding.is_video_transcoding_available", return_value=True), \
                patch("app.services.storage.get_storage_backend", return_value=_MemoryStorage({})), \
                patch("app.tasks.media.transcode_video_task.delay") as delay:
            assert generate_access_copy(audio, db_session) == {"delegated": "transcode"}
        delay.assert_called_once_with(
            media_id=str(audio.media_id), organization_id=str(org.organization_id),
            derivatives=["web_audio_aac"], extract_poster=False,
        )


def test_mediaconvert_audio_job_is_audio_only():
    from app.services.video_transcoding import VideoTranscodingService

    svc = VideoTranscodingService()
    captured = {}

    class _Client:
        def create_job(self, **kw):
            captured.update(kw)
            return {"Job": {"Id": "job-1", "Status": "SUBMITTED"}}

    svc._client = _Client()
    with patch.dict("os.environ", {"MEDIACONVERT_ROLE_ARN": "arn:aws:iam::0:role/x"}):
        svc.create_transcode_job("s3://b/in.wav", "s3://b/out/", uuid.uuid4(), derivatives=["web_audio_aac"])
    settings = captured["Settings"]
    assert "VideoSelector" not in settings["Inputs"][0]
    groups = settings["OutputGroups"]
    assert [g["Name"] for g in groups] == ["web_audio_aac"]  # no poster frame
    output = groups[0]["Outputs"][0]
    assert "VideoDescription" not in output
    assert output["AudioDescriptions"][0]["CodecSettings"]["Codec"] == "AAC"
    assert output["Extension"] == "m4a"

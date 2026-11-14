"""Staff side of the per-file public download level (media PUT allowlist)."""

from uuid import uuid4

from app.models import Media


def _media(db_session, org_id):
    m = Media(
        organization_id=org_id,
        s3_key=f"orgs/{org_id}/media/{uuid4()}/master.tif",
        filename="master.tif",
        file_size=1024,
        mime_type="image/tiff",
        media_type="image",
        processing_status="completed",
    )
    db_session.add(m)
    db_session.commit()
    return m


def _url(org, media):
    return f"/api/organizations/{org.organization_id}/media/{media.media_id}"


def test_level_is_unset_by_default_and_serialized(auth_setup, db_session):
    auth_client, org, _ = auth_setup
    m = _media(db_session, org.organization_id)
    resp = auth_client.get(_url(org, m))
    assert resp.status_code == 200
    assert resp.json["public_download_level"] is None


def test_each_level_saves_through_the_put_allowlist(auth_setup, db_session):
    auth_client, org, _ = auth_setup
    m = _media(db_session, org.organization_id)
    for level in ("none", "derivatives", "originals"):
        resp = auth_client.put(_url(org, m), json={"public_download_level": level})
        assert resp.status_code == 200, resp.text
        assert resp.json["public_download_level"] == level
        db_session.refresh(m)
        assert m.public_download_level == level


def test_null_or_empty_clears_back_to_unset(auth_setup, db_session):
    auth_client, org, _ = auth_setup
    m = _media(db_session, org.organization_id)
    auth_client.put(_url(org, m), json={"public_download_level": "originals"})
    resp = auth_client.put(_url(org, m), json={"public_download_level": ""})
    assert resp.status_code == 200
    assert resp.json["public_download_level"] is None


def test_invalid_level_is_a_422_and_not_saved(auth_setup, db_session):
    auth_client, org, _ = auth_setup
    m = _media(db_session, org.organization_id)
    resp = auth_client.put(_url(org, m), json={"public_download_level": "everything"})
    assert resp.status_code == 422
    db_session.refresh(m)
    assert m.public_download_level is None


def test_other_field_updates_leave_the_level_alone(auth_setup, db_session):
    auth_client, org, _ = auth_setup
    m = _media(db_session, org.organization_id)
    auth_client.put(_url(org, m), json={"public_download_level": "derivatives"})
    resp = auth_client.put(_url(org, m), json={"title": "Renamed"})
    assert resp.status_code == 200
    assert resp.json["public_download_level"] == "derivatives"

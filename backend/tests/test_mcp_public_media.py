"""The public MCP server serves media under the Discover rules.

get_object used to mint each published file's master (media.s3_key), so an
API client got the full-resolution original whatever the file's public
download level said. It now reuses the Discover media payload: images as a
rendition, downloads only as each file allows.
"""
from contextlib import contextmanager
from unittest.mock import patch

from tests.test_discover_public_media import (  # noqa: F401 - fixtures
    _image_with_rendition,
    _link,
    fake_signing,
    obj,
    org,
)


def _call_get_object(db_session, org, obj):
    from app.fastapi_app.routers import mcp_server

    @contextmanager
    def _session():
        yield db_session

    token = mcp_server._mcp_org_ctx.set(
        mcp_server.MCPOrgContext(organization_id=org.organization_id, slug=org.slug)
    )
    try:
        with patch("app.database.get_session", _session):
            fn = getattr(mcp_server.get_object, "fn", mcp_server.get_object)
            return fn(str(obj.object_id))
    finally:
        mcp_server._mcp_org_ctx.reset(token)


def test_image_is_a_rendition_not_the_master(db_session, org, obj):
    image = _image_with_rendition(db_session, org)
    _link(db_session, obj, image, primary=True)
    result = _call_get_object(db_session, org, obj)
    assert "error" not in result, result
    [item] = result["media"]
    assert "MASTER" not in item["url"]
    assert item["media_type"] == "image"
    assert item["downloads"] == []


def test_original_download_offered_only_when_the_file_allows_it(db_session, org, obj):
    image = _image_with_rendition(db_session, org)
    image.public_download_level = "originals"
    db_session.flush()
    _link(db_session, obj, image, primary=True)
    [item] = _call_get_object(db_session, org, obj)["media"]
    assert "MASTER" not in item["url"]
    variants = {d.get("variant") for d in item["downloads"]}
    assert "original" in variants

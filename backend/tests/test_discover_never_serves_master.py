"""Discover must serve renditions, never the uploaded master.

`_display_key_for_image` exists because minting `Media.s3_key` for display
hands every viewer a full-resolution download of the original, regardless of
the asset's rights or the organization's download settings — the master is
meant to be reachable only through the permission-gated download route.

Both Discover paths bypassed it and minted `Media.s3_key` directly:

  - collections_discover (staff preview) built `url` from the master and
    emitted no srcset at all, so an 80-pixel preview thumbnail downloaded a
    multi-megabyte original;
  - discover_public (anonymous) built srcset from derivatives correctly but
    left the `<img src>` fallback pointing at the master.

Nothing failed while that was true. These are the guards.
"""

import ast
from pathlib import Path

import pytest

ROUTERS = Path(__file__).resolve().parent.parent / "app" / "fastapi_app" / "routers"
DISCOVER_MODULES = ("collections_discover.py", "discover_public.py")


def _master_key_reads_passed_to_url_builder(path: Path) -> list[int]:
    """Line numbers where get_org_media_url() is handed a bare *.s3_key.

    A rendition's key is read off a MediaDerivative (named `d`/`deriv`), so the
    telling pattern is `media.s3_key` — the master — reaching the URL builder.
    """
    tree = ast.parse(path.read_text())
    bad = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        fn = node.func
        name = fn.attr if isinstance(fn, ast.Attribute) else getattr(fn, "id", None)
        if name != "get_org_media_url":
            continue
        for arg in node.args:
            if (
                isinstance(arg, ast.Attribute)
                and arg.attr == "s3_key"
                and isinstance(arg.value, ast.Name)
                and arg.value.id in {"media", "Media"}
            ):
                bad.append(node.lineno)
    return bad


@pytest.mark.parametrize("module", DISCOVER_MODULES)
def test_discover_never_mints_the_master_key(module):
    path = ROUTERS / module
    assert path.exists(), f"{module} moved; update this guard"
    offenders = _master_key_reads_passed_to_url_builder(path)
    assert not offenders, (
        f"{module} passes the uploaded master (media.s3_key) to "
        f"get_org_media_url at line(s) {offenders}. Display URLs must come "
        "from a rendition — see build_display_key_for_media."
    )


def test_display_key_helper_prefers_a_rendition_over_the_master(db_session, demo_tenant):
    """The helper returns a derivative's key, not the media's own s3_key."""
    from app.models.media import Media, MediaDerivative
    from app.services.discovery_service import build_display_key_for_media

    media = Media(
        organization_id=demo_tenant.organization_id,
        filename="original.tif",
        s3_key="orgs/x/media/MASTER-DO-NOT-SERVE.tif",
        media_type="image",
        file_size=9_000_000,
        mime_type="image/tiff",
        is_published=True,
    )
    db_session.add(media)
    db_session.flush()

    db_session.add(MediaDerivative(
        media_id=media.media_id,
        organization_id=demo_tenant.organization_id,
        derivative_type="large",
        format="jpeg",
        s3_key="orgs/x/media/derivatives/large.jpeg",
        width=1600, height=1200, file_size=200_000,
    ))
    db_session.flush()

    key = build_display_key_for_media(media, db_session)
    assert key == "orgs/x/media/derivatives/large.jpeg"
    assert key != media.s3_key


def test_display_key_helper_returns_none_rather_than_the_master(db_session, demo_tenant):
    """With no renditions it declines — callers omit the image, not substitute."""
    from app.models.media import Media
    from app.services.discovery_service import build_display_key_for_media

    media = Media(
        organization_id=demo_tenant.organization_id,
        filename="lonely.tif",
        s3_key="orgs/x/media/MASTER-DO-NOT-SERVE.tif",
        media_type="image",
        file_size=9_000_000,
        mime_type="image/tiff",
        is_published=True,
    )
    db_session.add(media)
    db_session.flush()

    assert build_display_key_for_media(media, db_session) is None


def test_thumbnail_order_is_smallest_first():
    """A thumbnail slot must not fall *up* to the display tier."""
    from app.serializers.media import (
        _DISPLAY_DERIVATIVE_ORDER,
        _THUMBNAIL_DERIVATIVE_ORDER,
    )

    assert _THUMBNAIL_DERIVATIVE_ORDER[0] == "thumbnail"
    assert _DISPLAY_DERIVATIVE_ORDER[0] == "large"
    # Both must still bottom out somewhere, or a missing tier yields no image.
    assert set(_DISPLAY_DERIVATIVE_ORDER) <= set(_THUMBNAIL_DERIVATIVE_ORDER)

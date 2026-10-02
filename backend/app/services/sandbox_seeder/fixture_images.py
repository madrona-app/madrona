"""
Ensure demo fixture images exist in the configured object store.

The manifest seeder creates Media rows that reference a shared
``sandbox-fixtures/...`` key and assumes the bytes are already in the media
bucket. That holds for the hosted sandbox, where the fixtures were uploaded
once by hand. It does not hold for a self-hosted deployment, whose object store
starts empty — seeding there would produce a catalog of objects with
broken images.

The fixture images ship in the repository under ``fixtures/images/``
(CC0/public-domain originals from the Met, Rijksmuseum and Smithsonian
open-access programs, ~250 MB). They are checked in rather than fetched
at run time because this software is published unmaintained: source CDN
URLs rot, and a demo that depends on three museum CDNs staying stable has
a built-in expiry date. Checked-in bytes also mean the demo works offline,
which matters for institutional networks.

This module uploads any missing fixture to the configured bucket. It is
idempotent and cheap on re-run: existing keys are skipped after a HEAD.
"""

from __future__ import annotations

import logging
import pathlib
from typing import Any

logger = logging.getLogger(__name__)

FIXTURE_ROOT = pathlib.Path(__file__).parent / "fixtures" / "images"
KEY_PREFIX = "sandbox-fixtures"


def _content_type(path: pathlib.Path) -> str:
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".tif": "image/tiff",
        ".tiff": "image/tiff",
    }.get(path.suffix.lower(), "application/octet-stream")


def ensure_fixture_images(region: str | None = None) -> dict[str, Any]:
    """
    Upload any fixture images missing from the media bucket.

    Returns a dict with uploaded / skipped / missing counts. Safe to call
    repeatedly; safe to call when the fixtures directory is absent (returns
    missing=True so the caller can warn rather than fail).
    """
    from botocore.exceptions import ClientError

    from app.services.uploads import DEFAULT_REGION, get_media_bucket, get_s3_client

    region = region or DEFAULT_REGION
    bucket = get_media_bucket(region)

    if not FIXTURE_ROOT.exists():
        logger.warning(
            "Fixture images not found at %s — demo objects will have no image "
            "bytes. Expected them to ship with the repository.",
            FIXTURE_ROOT,
        )
        return {"uploaded": 0, "skipped": 0, "missing": True, "bucket": bucket}

    client = get_s3_client(region)
    uploaded = skipped = failed = 0

    for path in sorted(FIXTURE_ROOT.rglob("*")):
        if not path.is_file():
            continue
        key = f"{KEY_PREFIX}/{path.relative_to(FIXTURE_ROOT).as_posix()}"

        try:
            client.head_object(Bucket=bucket, Key=key)
            skipped += 1
            continue
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") not in ("404", "NoSuchKey", "403"):
                logger.warning("head_object failed for %s: %s", key, exc)
                failed += 1
                continue

        try:
            client.upload_file(
                str(path), bucket, key,
                ExtraArgs={"ContentType": _content_type(path)},
            )
            uploaded += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to upload fixture %s: %s", key, exc)
            failed += 1

    logger.info(
        "Fixture images in %s: %d uploaded, %d already present, %d failed",
        bucket, uploaded, skipped, failed,
    )
    return {
        "uploaded": uploaded,
        "skipped": skipped,
        "failed": failed,
        "missing": False,
        "bucket": bucket,
    }

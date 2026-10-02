#!/usr/bin/env python
"""
Generate shared thumbnail fixtures for the sandbox-fixtures media.

The saga seeders reference shared image bytes in the madrona-media-{region}
bucket under `sandbox-fixtures/<source>/<id>.jpg`. Those are full-size
originals (~1.6 MB avg). Lists/grids that want a thumbnail were falling back
to the full original because no thumbnail derivative existed — see
sandbox_seeder/manifest.py.

This script produces a 200px thumbnail next to each original
(`sandbox-fixtures/<source>/<id>_thumb.jpg`, the same key with a `_thumb`
suffix so the seeder + backfill migration can derive it deterministically),
uploads it to the same bucket, and records the thumbnail key + dimensions +
byte size back into the checked-in manifests. The seeder then writes a
`thumbnail` MediaDerivative row + media.thumbnail_s3_key from those manifest
fields (cheap — DB rows only, shared bytes), and a data migration backfills
rows for media already seeded.

Thumbnails are generated with the app's own generate_derivative() so they
match what the live pipeline produces (aspect-fit, max dimension 200, JPEG).

Usage:
    ./venv/bin/python scripts/build_sandbox_thumbnails.py [--source met|rijks|smithsonian|all]
                                                          [--region us-west-2]
                                                          [--bucket NAME] [--force] [--dry-run]

S3 reads the existing original fixtures; S3 writes the thumbnails. Idempotent:
entries that already carry a thumbnail_s3_key are skipped unless --force.
"""
from __future__ import annotations

import argparse
import io
import json
import logging
import os
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("build_sandbox_thumbnails")

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

FIXTURES_DIR = _BACKEND_ROOT / "app" / "services" / "sandbox_seeder" / "fixtures"
DEFAULT_BUCKET_PREFIX = os.environ.get("S3_MEDIA_BUCKET_PREFIX", "madrona-media")
SOURCES = ("met", "rijks", "smithsonian")


def _bucket_for_region(region: str) -> str:
    return f"{DEFAULT_BUCKET_PREFIX}-{region}"


def _thumb_key(s3_key: str) -> str:
    """sandbox-fixtures/met/9480.jpg -> sandbox-fixtures/met/9480_thumb.jpg.

    Must stay in lockstep with the backfill migration's key derivation.
    """
    if "." in s3_key.rsplit("/", 1)[-1]:
        stem, ext = s3_key.rsplit(".", 1)
        return f"{stem}_thumb.{ext}"
    return f"{s3_key}_thumb"


def _process_manifest(path: Path, s3, bucket: str, *, force: bool, dry_run: bool) -> dict:
    from PIL import Image
    from app.services.media_processing import (
        DerivativeFormat,
        DerivativeType,
        generate_derivative,
    )

    entries = json.loads(path.read_text())
    stats = {"thumbed": 0, "skipped_existing": 0, "no_media": 0, "failed": 0}

    for entry in entries:
        media = entry.get("media") or {}
        s3_key = media.get("s3_key")
        if not s3_key:
            stats["no_media"] += 1
            continue
        if media.get("thumbnail_s3_key") and not force:
            stats["skipped_existing"] += 1
            continue

        thumb_key = _thumb_key(s3_key)
        try:
            # Source bytes from the existing original fixture (already in S3).
            obj = s3.get_object(Bucket=bucket, Key=s3_key)
            original_bytes = obj["Body"].read()
            image = Image.open(io.BytesIO(original_bytes))
            orig_w, orig_h = image.size

            thumb_bytes, t_w, t_h = generate_derivative(
                image, DerivativeType.THUMBNAIL, DerivativeFormat.JPEG
            )

            if dry_run:
                logger.info(
                    "  [dry-run] %s -> %s (%dx%d, %d bytes)",
                    s3_key, thumb_key, t_w, t_h, len(thumb_bytes),
                )
            else:
                s3.put_object(
                    Bucket=bucket,
                    Key=thumb_key,
                    Body=thumb_bytes,
                    ContentType="image/jpeg",
                    CacheControl="public, max-age=2592000",
                )
                logger.info("  uploaded %s (%dx%d, %d bytes)", thumb_key, t_w, t_h, len(thumb_bytes))

            media["thumbnail_s3_key"] = thumb_key
            media["thumbnail_width"] = t_w
            media["thumbnail_height"] = t_h
            media["thumbnail_file_size"] = len(thumb_bytes)
            # Backfill the original dimensions while we have the image open;
            # the seeder leaves media.width/height NULL otherwise.
            media.setdefault("width", orig_w)
            media.setdefault("height", orig_h)
            entry["media"] = media
            stats["thumbed"] += 1
        except Exception as e:  # noqa: BLE001 — log + continue, one bad asset shouldn't abort
            logger.warning("  FAILED %s: %s", s3_key, e)
            stats["failed"] += 1

    if not dry_run and stats["thumbed"]:
        # Match the bootstrap's manifest formatting exactly for a clean diff.
        path.write_text(json.dumps(entries, indent=2, sort_keys=True) + "\n")
        logger.info("manifest rewritten: %s", path)

    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default="all", choices=(*SOURCES, "all"))
    parser.add_argument("--region", default=os.environ.get("AWS_REGION", "us-west-2"))
    parser.add_argument("--bucket", default=None)
    parser.add_argument("--force", action="store_true", help="Re-thumbnail entries that already have a thumbnail_s3_key")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    bucket = args.bucket or _bucket_for_region(args.region)
    sources = SOURCES if args.source == "all" else (args.source,)

    import boto3

    s3 = boto3.client("s3", region_name=args.region)
    logger.info("bucket=%s region=%s sources=%s dry_run=%s", bucket, args.region, sources, args.dry_run)

    overall = {}
    for src in sources:
        path = FIXTURES_DIR / f"{src}-manifest.json"
        if not path.exists():
            logger.warning("[%s] manifest missing: %s — skipping", src, path)
            continue
        logger.info("=== %s ===", src)
        overall[src] = _process_manifest(path, s3, bucket, force=args.force, dry_run=args.dry_run)
        logger.info("[%s] %s", src, overall[src])

    logger.info("DONE: %s", overall)
    return 0


if __name__ == "__main__":
    sys.exit(main())

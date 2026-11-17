"""Public (anonymous) IIIF Image API: renditions only, at a capped size.

When a Cantaloupe image server is configured, staff manifests point straight
at it with the ``{org_id}/{media_id}`` identifier, which Cantaloupe resolves to
the uploaded master. Handing that identifier to anonymous callers meant
``.../full/max/0/default.jpg`` returned the master at full resolution — the
one thing every other public surface refuses to do.

Anonymous IIIF image requests therefore go through Madrona instead:

    /iiif/3/media/{media_id}/info.json
    /iiif/3/media/{media_id}/{region}/{size}/{rotation}/{quality}.{format}

and this module decides what they may see:

* The media must pass the Discover gates (published, linked to a public
  object of its organization; ``discover_media.get_public_media``).
* The image source is a rendition (``access_master``, then ``large``,
  ``medium``, ``small``), never the master. Cantaloupe is asked for the
  rendition by its storage key, so the master identifier is never used.
  An image with no rendition has no public IIIF service (404).
* Output is capped. ``maxWidth``/``maxHeight`` are the rendition's own size,
  or the rendition fitted inside ``IIIF_PUBLIC_MAX_DIMENSION`` pixels on the
  long edge when it is larger (default 3000). ``info.json`` advertises the
  cap and only sizes within it.

Size behaviour (IIIF Image API 3.0, sections 4.2 and 5.3):

* ``max`` / ``^max`` (and the 2.x ``full``) return the largest image the cap
  allows for the requested region — the capped image, not an error.
* Any other size whose result exceeds ``maxWidth``/``maxHeight`` is a
  ``400 Bad Request``, as is a size larger than the region without the
  ``^`` upscaling prefix, or a region outside the image.

Region coordinates are in the rendition's pixel space, which is also the
canvas size the public manifests declare.

Cantaloupe must be configured so an identifier is the S3 object key (the
S3Source BasicLookupStrategy), and should not itself be reachable from the
public internet: the gates above only hold for requests that come through
Madrona.
"""
from __future__ import annotations

import logging
import math
import os
import re
from dataclasses import dataclass
from urllib.parse import quote, urljoin

from app.models import Media, MediaDerivative

logger = logging.getLogger(__name__)

# Long-edge cap for anonymous IIIF output, in pixels.
DEFAULT_PUBLIC_MAX_DIMENSION = 3000


def public_max_dimension() -> int:
    raw = os.environ.get("IIIF_PUBLIC_MAX_DIMENSION", "")
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_PUBLIC_MAX_DIMENSION
    return value if value > 0 else DEFAULT_PUBLIC_MAX_DIMENSION


# Best rendition first. All are access copies produced by media processing;
# the master (Media.s3_key) is deliberately not in this list.
PUBLIC_IIIF_RENDITION_ORDER = ("access_master", "large", "medium", "small")

TILE_SIZE = 512


@dataclass(frozen=True)
class PublicImageSource:
    s3_key: str
    width: int
    height: int
    max_width: int
    max_height: int


def _fit(width: int, height: int, cap: int) -> tuple[int, int]:
    longest = max(width, height)
    if longest <= cap:
        return width, height
    scale = cap / longest
    return max(1, round(width * scale)), max(1, round(height * scale))


def public_iiif_source(media: Media, derivatives: list[MediaDerivative] | None = None) -> PublicImageSource | None:
    """The rendition anonymous IIIF serves for ``media``, or None.

    Never the master: an image without a rendition has no public source.
    """
    if media is None or media.media_type != "image":
        return None
    if derivatives is None:
        derivatives = list(getattr(media, "derivatives", None) or [])
    for kind in PUBLIC_IIIF_RENDITION_ORDER:
        for d in derivatives:
            if (
                d.derivative_type == kind
                and d.s3_key
                and d.s3_key != media.s3_key
                and d.width
                and d.height
            ):
                max_w, max_h = _fit(d.width, d.height, public_max_dimension())
                return PublicImageSource(d.s3_key, d.width, d.height, max_w, max_h)
    return None


def public_service_base() -> str:
    from app.services.iiif_presentation import IIIF_PRESENTATION_BASE_URL

    return IIIF_PRESENTATION_BASE_URL if IIIF_PRESENTATION_BASE_URL.endswith("/") else IIIF_PRESENTATION_BASE_URL + "/"


def public_service_id(media: Media, base: str | None = None) -> str:
    """The Image API service id public manifests reference for ``media``."""
    base = base or public_service_base()
    if not base.endswith("/"):
        base += "/"
    return f"{base}media/{media.media_id}"


def image_body(service_id: str, source: PublicImageSource) -> dict:
    """Painting-annotation body for a public manifest (capped ``max``)."""
    return {
        "id": f"{service_id}/full/max/0/default.jpg",
        "type": "Image",
        "format": "image/jpeg",
        "width": source.max_width,
        "height": source.max_height,
        "service": [{"id": service_id, "type": "ImageService3", "profile": "level2"}],
    }


def thumbnail(service_id: str, source: PublicImageSource, width: int = 200) -> dict:
    """A thumbnail through the public service, never wider than the cap."""
    if source.max_width >= width:
        size = f"{width},"
        out_w, out_h = width, max(1, round(source.height * width / source.width))
    else:
        size = "max"
        out_w, out_h = source.max_width, source.max_height
    return {
        "id": f"{service_id}/full/{size}/0/default.jpg",
        "type": "Image",
        "format": "image/jpeg",
        "width": out_w,
        "height": out_h,
    }


def info_json(service_id: str, source: PublicImageSource) -> dict:
    """Image Information for the public service, advertising the cap."""
    sizes = []
    w, h = source.max_width, source.max_height
    while w >= 64 and h >= 64 and len(sizes) < 8:
        sizes.append({"width": w, "height": h})
        w, h = max(1, w // 2), max(1, h // 2)
    sizes.reverse()

    scale_factors = [1]
    while max(source.width, source.height) / (scale_factors[-1] * 2) >= TILE_SIZE / 2 and len(scale_factors) < 8:
        scale_factors.append(scale_factors[-1] * 2)

    return {
        "@context": "http://iiif.io/api/image/3/context.json",
        "id": service_id,
        "type": "ImageService3",
        "protocol": "http://iiif.io/api/image",
        "profile": "level2",
        "width": source.width,
        "height": source.height,
        "maxWidth": source.max_width,
        "maxHeight": source.max_height,
        "sizes": sizes,
        "tiles": [{"width": TILE_SIZE, "scaleFactors": scale_factors}],
    }


# ---------------------------------------------------------------------------
# Request parsing
# ---------------------------------------------------------------------------


class IIIFRequestError(ValueError):
    """A request the public service refuses (400 Bad Request)."""


_NUM = r"\d+(?:\.\d+)?"
_REGION_XYWH = re.compile(r"^(\d+),(\d+),(\d+),(\d+)$")
_REGION_PCT = re.compile(rf"^pct:({_NUM}),({_NUM}),({_NUM}),({_NUM})$")
_SIZE_W = re.compile(r"^(\d+),$")
_SIZE_H = re.compile(r"^,(\d+)$")
_SIZE_WH = re.compile(r"^(!?)(\d+),(\d+)$")
_SIZE_PCT = re.compile(rf"^pct:({_NUM})$")
_ROTATION = re.compile(rf"^!?({_NUM})$")
QUALITIES = ("default", "color", "gray", "bitonal")
FORMATS = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif"}


def _region(region: str, width: int, height: int) -> tuple[int, int, int, int]:
    if region == "full":
        return 0, 0, width, height
    if region == "square":
        side = min(width, height)
        return (width - side) // 2, (height - side) // 2, side, side
    m = _REGION_XYWH.match(region)
    if m:
        x, y, w, h = (int(v) for v in m.groups())
    else:
        m = _REGION_PCT.match(region)
        if not m:
            raise IIIFRequestError(f"Invalid region {region!r}")
        px, py, pw, ph = (float(v) for v in m.groups())
        x, y = int(px * width / 100), int(py * height / 100)
        w, h = round(pw * width / 100), round(ph * height / 100)
    if w <= 0 or h <= 0 or x >= width or y >= height:
        raise IIIFRequestError("Region is outside the image")
    # Clipped to the image edge, as the spec requires.
    return x, y, min(w, width - x), min(h, height - y)


def _size(size: str, rw: int, rh: int, max_w: int, max_h: int) -> tuple[int, int]:
    """Output (width, height) for ``size`` over a ``rw`` x ``rh`` region."""
    upscale = size.startswith("^")
    spec = size[1:] if upscale else size

    if spec in ("max", "full"):
        limit_w, limit_h = (max_w, max_h) if upscale else (min(rw, max_w), min(rh, max_h))
        scale = min(limit_w / rw, limit_h / rh)
        if not upscale:
            scale = min(scale, 1.0)
        return max(1, math.floor(rw * scale)), max(1, math.floor(rh * scale))

    m = _SIZE_W.match(spec)
    if m:
        w = int(m.group(1))
        out = (w, max(1, round(rh * w / rw)))
    elif (m := _SIZE_H.match(spec)):
        h = int(m.group(1))
        out = (max(1, round(rw * h / rh)), h)
    elif (m := _SIZE_PCT.match(spec)):
        pct = float(m.group(1))
        out = (max(1, round(rw * pct / 100)), max(1, round(rh * pct / 100)))
    elif (m := _SIZE_WH.match(spec)):
        confined, w, h = m.group(1) == "!", int(m.group(2)), int(m.group(3))
        if confined:
            scale = min(w / rw, h / rh)
            out = (max(1, math.floor(rw * scale)), max(1, math.floor(rh * scale)))
        else:
            out = (w, h)
    else:
        raise IIIFRequestError(f"Invalid size {size!r}")

    if out[0] <= 0 or out[1] <= 0:
        raise IIIFRequestError("Size must be at least one pixel")
    if not upscale and (out[0] > rw or out[1] > rh):
        raise IIIFRequestError("Size is larger than the region; use ^ to upscale")
    if out[0] > max_w or out[1] > max_h:
        raise IIIFRequestError(
            f"Size {out[0]}x{out[1]} exceeds the maximum {max_w}x{max_h} for this image"
        )
    return out


@dataclass(frozen=True)
class UpstreamRequest:
    path: str          # region/size/rotation/quality.format, Cantaloupe-ready
    width: int
    height: int
    content_type: str


def plan_request(
    source: PublicImageSource, region: str, size: str, rotation: str, quality: str, fmt: str,
) -> UpstreamRequest:
    """Validate an Image API request against ``source`` and its cap.

    Returns the upstream path with an explicit pixel region and size, so the
    image server never decides the output size on its own.
    """
    x, y, rw, rh = _region(region, source.width, source.height)
    out_w, out_h = _size(size, rw, rh, source.max_width, source.max_height)

    m = _ROTATION.match(rotation)
    if not m or float(m.group(1)) > 360:
        raise IIIFRequestError(f"Invalid rotation {rotation!r}")
    if quality not in QUALITIES:
        raise IIIFRequestError(f"Invalid quality {quality!r}")
    if fmt not in FORMATS:
        raise IIIFRequestError(f"Unsupported format {fmt!r}")

    up_size = f"{out_w},{out_h}"
    if out_w > rw or out_h > rh:
        up_size = "^" + up_size
    return UpstreamRequest(
        path=f"{x},{y},{rw},{rh}/{up_size}/{rotation}/{quality}.{fmt}",
        width=out_w,
        height=out_h,
        content_type=FORMATS[fmt],
    )


def upstream_url(server_url: str, source: PublicImageSource, plan: UpstreamRequest) -> str:
    """Cantaloupe URL for the rendition (identifier = its storage key)."""
    if not server_url.endswith("/"):
        server_url += "/"
    return urljoin(server_url, f"{quote(source.s3_key, safe='')}/{plan.path}")


def fetch_upstream(url: str) -> tuple[int, bytes, str | None]:
    """GET an image from the image server. Patched in tests."""
    import httpx

    resp = httpx.get(url, timeout=30.0)
    return resp.status_code, resp.content, resp.headers.get("content-type")

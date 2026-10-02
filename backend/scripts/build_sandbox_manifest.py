"""
Build sandbox-fixtures manifests for the saga seeders.

One-shot bootstrap. Runs against the Met Open Access API, Smithsonian
Open Access, and Rijksmuseum, plus the madrona-media-{region} S3
bucket. Produces:

    backend/app/services/sandbox_seeder/fixtures/met-manifest.json
    backend/app/services/sandbox_seeder/fixtures/smithsonian-manifest.json
    backend/app/services/sandbox_seeder/fixtures/rijks-manifest.json

Those files are checked into the repo. The saga step
`seed_collections_from_manifest(source=...)` reads them instead of
hammering the upstream APIs on every sandbox provision.

Image bytes are uploaded to shared prefixes in the same bucket that
holds per-org media:

    s3://madrona-media-{region}/sandbox-fixtures/met/<id>.jpg
    s3://madrona-media-{region}/sandbox-fixtures/smithsonian/<id>.jpg
    s3://madrona-media-{region}/sandbox-fixtures/rijks/<id>.jpg

Every sandbox org references the same shared keys. The CDN URL builder
is a pure prefix concat (no per-org gating in the URL itself); the
application-layer permission gate keys off `Media.organization_id`
(= the sandbox's), not the s3_key prefix, so sharing is safe.

Idempotent. If a manifest exists, new entries are merged in; if an
image S3 key already exists, the upload is skipped.

Usage:
    cd backend
    # All three sources:
    ./venv/bin/python scripts/build_sandbox_manifest.py --source all
    # Just one:
    ./venv/bin/python scripts/build_sandbox_manifest.py --source met
    ./venv/bin/python scripts/build_sandbox_manifest.py --source smithsonian
    ./venv/bin/python scripts/build_sandbox_manifest.py --source rijks

API keys are pulled from env vars (SMITHSONIAN_API_KEY,
RIJKSMUSEUM_API_KEY). The script will fall back to scanning
flow.connector_instances if SMITHSONIAN_API_KEY isn't set — useful for
local dev where the key is stored as a connector config.

Rijks does not require an API key for the public collection endpoint;
when no key is set, the request is sent without one and the public
quota applies.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import sys
import time
from datetime import date
from pathlib import Path
from typing import Any, Callable

import requests

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from scripts.seed_met_museum import MET_OBJECTS, MET_API_BASE  # noqa: E402

logger = logging.getLogger(__name__)

FIXTURES_DIR = _BACKEND_ROOT / "app" / "services" / "sandbox_seeder" / "fixtures"
DEFAULT_BUCKET_PREFIX = os.environ.get("S3_MEDIA_BUCKET_PREFIX", "madrona-media")


def _bucket_for_region(region: str) -> str:
    return f"{DEFAULT_BUCKET_PREFIX}-{region}"


# ---------------------------------------------------------------------------
# Met Museum
# ---------------------------------------------------------------------------


def _met_fetch(met_id: int, api_key: str | None) -> dict | None:
    try:
        resp = requests.get(f"{MET_API_BASE}/{met_id}", timeout=30)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        logger.warning("MET-%s fetch failed: %s", met_id, e)
        return None


def _met_should_skip(data: dict) -> str | None:
    if not data.get("isPublicDomain"):
        return "not public domain"
    if not data.get("primaryImage"):
        return "no primaryImage"
    return None


def _met_image_url(data: dict) -> str:
    return data["primaryImage"]


def _met_map(data: dict) -> dict:
    creators = []
    if data.get("artistDisplayName"):
        c: dict[str, Any] = {
            "name": data["artistDisplayName"],
            "role": data.get("artistRole") or None,
            "attribution": None,
            "authority_id": None,
            "ulan_id": None,
        }
        ulan_url = data.get("artistULAN_URL")
        if ulan_url:
            c["ulan_id"] = ulan_url.rstrip("/").rsplit("/", 1)[-1] or None
        creators.append(c)
    materials = []
    if data.get("medium"):
        materials.append({"name": data["medium"], "part": None, "vocabulary_term_id": None})
    subjects = []
    for tag in (data.get("tags") or []):
        subjects.append({"term": tag.get("term"), "type": "topic", "vocabulary_term_id": None})

    creation_date_earliest = None
    creation_date_latest = None
    try:
        if data.get("objectBeginDate"):
            y = int(data["objectBeginDate"])
            if -5000 <= y <= 2100 and y != 0:
                creation_date_earliest = date(max(y, 1), 1, 1).isoformat()
        if data.get("objectEndDate"):
            y = int(data["objectEndDate"])
            if -5000 <= y <= 2100 and y != 0:
                creation_date_latest = date(max(y, 1), 12, 31).isoformat()
    except (ValueError, TypeError):
        pass

    return {
        "object_name": data.get("objectName") or None,
        "brief_description": data.get("objectName") or None,
        "responsible_department": data.get("department") or None,
        "object_type": data.get("objectName") or None,
        "materials": materials or None,
        "subjects": subjects or None,
        "physical_description": data.get("dimensions") or None,
        "style_period": data.get("period") or None,
        "creators": creators or None,
        "creation_date_display": data.get("objectDate") or None,
        "creation_date_earliest": creation_date_earliest,
        "creation_date_latest": creation_date_latest,
        "creation_place": data.get("culture") or data.get("artistNationality") or None,
        "credit_line": data.get("creditLine") or None,
        "object_status": "accessioned",
    }


def _met_titles(data: dict) -> list[dict]:
    title = data.get("title") or "Untitled"
    return [{"title": title, "title_type": "primary", "is_preferred": True}]


def _met_media(data: dict, s3_key: str, file_size: int) -> dict:
    title = data.get("title") or "Untitled"
    artist = data.get("artistDisplayName") or "Unknown"
    return {
        "s3_key": s3_key,
        "file_size": file_size,
        "mime_type": "image/jpeg",
        "title": title,
        "alt_text": f"{title} by {artist}" if artist != "Unknown" else title,
        "credit": data.get("creditLine") or None,
        "creator": artist if artist != "Unknown" else None,
        "source": "The Metropolitan Museum of Art, Open Access",
        "copyright_status": "public_domain",
        "rights_statement": "CC0 1.0 Universal Public Domain Dedication",
        "license": "CC0-1.0",
        "image_url": data.get("primaryImage"),
    }


# ---------------------------------------------------------------------------
# Smithsonian Open Access
# ---------------------------------------------------------------------------

SI_API_BASE = "https://api.si.edu/openaccess/api/v1.0"
# Discovery via /search replaces the previous curated list — EDANMDM IDs
# get re-keyed when records move between SI units, and the first attempt
# at curating 15 IDs saw 13 of them 404 by the time we ran the bootstrap.
SMITHSONIAN_OBJECT_IDS: list[str] = []
# Filter: CC0 images only, restricted to cultural-collection units so
# the sandbox isn't all botany specimens (the global CC0-image set leans
# heavily toward NMNH botany scans). The `q` is Solr-flavored.
_SI_CULTURAL_UNITS = (
    "SAAM",       # Smithsonian American Art Museum
    "NPG",        # National Portrait Gallery
    "NMAAHC",     # African American History and Culture
    "NMAfA",      # African Art
    "CHNDM",      # Cooper Hewitt
    "NMAH",       # American History
    "NASM",       # Air and Space
    "FSG",        # Freer Sackler
)
SI_DISCOVERY_QUERY = (
    "online_media_type:Images AND media_usage:CC0 AND ("
    + " OR ".join(f"unit_code:{u}" for u in _SI_CULTURAL_UNITS)
    + ")"
)


def _si_fetch(edanmdm_id: str, api_key: str | None) -> dict | None:
    if not api_key:
        return None
    try:
        resp = requests.get(
            f"{SI_API_BASE}/content/{edanmdm_id}",
            params={"api_key": api_key},
            timeout=30,
        )
        resp.raise_for_status()
        body = resp.json()
        return body.get("response", {}).get("content")
    except (requests.RequestException, ValueError) as e:
        logger.warning("SI %s fetch failed: %s", edanmdm_id, e)
        return None


def _si_image_url(record: dict) -> str | None:
    descriptive = record.get("descriptiveNonRepeating", {})
    online_media = descriptive.get("online_media", {})
    media_list = online_media.get("media", [])
    if not media_list:
        return None
    first = media_list[0]
    return first.get("content") or first.get("thumbnail")


def _si_should_skip(record: dict) -> str | None:
    if not _si_image_url(record):
        return "no image URL"
    return None


def _si_map(record: dict) -> dict:
    descriptive = record.get("descriptiveNonRepeating", {})
    indexed = record.get("indexedStructured", {})
    freetext = record.get("freetext", {})

    creators = []
    for entry in (freetext.get("name") or [])[:3]:
        if isinstance(entry, dict) and entry.get("content"):
            creators.append({
                "name": entry["content"],
                "role": entry.get("label") or None,
                "attribution": None,
                "authority_id": None,
                "ulan_id": None,
            })

    subjects = []
    for topic in (indexed.get("topic") or [])[:8]:
        subjects.append({"term": topic, "type": "topic", "vocabulary_term_id": None})

    materials = []

    creation_date_display = None
    for d in (freetext.get("date") or []):
        if isinstance(d, dict) and d.get("content"):
            creation_date_display = d["content"]
            break

    credit_line = None
    for c in (freetext.get("creditLine") or []):
        if isinstance(c, dict) and c.get("content"):
            credit_line = c["content"]
            break

    brief = None
    for n in (freetext.get("notes") or [])[:2]:
        if isinstance(n, dict) and n.get("content"):
            brief = n["content"][:500]
            break

    title = descriptive.get("title", {}).get("content") or "Untitled"
    object_type_list = indexed.get("object_type") or []

    return {
        "object_name": title[:255],
        "brief_description": brief,
        "responsible_department": descriptive.get("unit_code"),
        "object_type": object_type_list[0] if object_type_list else None,
        "materials": materials or None,
        "subjects": subjects or None,
        "creators": creators or None,
        "creation_date_display": creation_date_display,
        "creation_place": (indexed.get("place") or [None])[0],
        "credit_line": credit_line,
        "object_status": "accessioned",
    }


def _si_titles(record: dict) -> list[dict]:
    descriptive = record.get("descriptiveNonRepeating", {})
    title = descriptive.get("title", {}).get("content") or "Untitled"
    return [{"title": title, "title_type": "primary", "is_preferred": True}]


def _si_media(record: dict, s3_key: str, file_size: int) -> dict:
    descriptive = record.get("descriptiveNonRepeating", {})
    title = descriptive.get("title", {}).get("content") or "Untitled"
    creators = []
    freetext = record.get("freetext", {})
    for entry in (freetext.get("name") or [])[:1]:
        if isinstance(entry, dict) and entry.get("content"):
            creators.append(entry["content"])
    creator = creators[0] if creators else None
    credit_line = None
    for c in (freetext.get("creditLine") or []):
        if isinstance(c, dict) and c.get("content"):
            credit_line = c["content"]
            break
    return {
        "s3_key": s3_key,
        "file_size": file_size,
        "mime_type": "image/jpeg",
        "title": title,
        "alt_text": f"{title} ({creator})" if creator else title,
        "credit": credit_line,
        "creator": creator,
        "source": "Smithsonian Open Access",
        "copyright_status": "public_domain",
        "rights_statement": "CC0 1.0 Universal Public Domain Dedication",
        "license": "CC0-1.0",
        "image_url": _si_image_url(record),
    }


def _si_id_normalize(edanmdm_id: str) -> str:
    return edanmdm_id.replace(":", "-")


def _si_discover_ids(target: int, api_key: str | None) -> list[str]:
    """Paginate SI Open Access /search filtered to CC0 images. Return up
    to `target` EDANMDM IDs whose detail record will resolve.

    SI's /search returns rows that already include `id` (the EDANMDM ID)
    and the full content payload, but per-row image validation can fail
    once the detail call happens. Over-fetch by ~50% to absorb attrition.
    """
    if not api_key:
        return []

    page_size = 100
    over_fetch = max(target + target // 2, target)
    ids: list[str] = []
    start = 0

    while len(ids) < over_fetch:
        try:
            resp = requests.get(
                f"{SI_API_BASE}/search",
                params={
                    "api_key": api_key,
                    "q": SI_DISCOVERY_QUERY,
                    "rows": page_size,
                    "start": start,
                    # `sort=random` distributes across SI units; without
                    # it the relevancy-default returns long runs of a
                    # single unit (97% NPG in the first 100 rows).
                    "sort": "random",
                },
                timeout=30,
            )
            resp.raise_for_status()
            body = resp.json()
        except (requests.RequestException, ValueError) as e:
            logger.warning("SI search page (start=%d) failed: %s", start, e)
            break

        rows = (body.get("response") or {}).get("rows") or []
        if not rows:
            break

        for row in rows:
            if len(ids) >= over_fetch:
                break
            # Search rows use the opaque internal `id` (e.g.
            # "ld1-1643399134763-…"); the EDANMDM identifier _si_fetch
            # needs is in `row.url` and already has the "edanmdm:" prefix.
            edanmdm = row.get("url")
            if not edanmdm or not isinstance(edanmdm, str):
                continue
            if not edanmdm.startswith("edanmdm:"):
                edanmdm = f"edanmdm:{edanmdm}"
            ids.append(edanmdm)

        if len(rows) < page_size:
            break
        start += page_size

    return ids[:target] if len(ids) > target else ids


# ---------------------------------------------------------------------------
# Rijksmuseum (Linked Art / data.rijksmuseum.nl)
#
# The legacy `www.rijksmuseum.nl/api/en/collection/<id>` endpoint was
# retired. The Rijksmuseum's new Linked Art service lives at
# `data.rijksmuseum.nl/search/collection` (search) and
# `data.rijksmuseum.nl/objects/<slug>` (detail), serving JSON-LD with
# `Accept: application/ld+json`. No API key.
# ---------------------------------------------------------------------------

RIJKS_LD_SEARCH = "https://data.rijksmuseum.nl/search/collection"
RIJKS_LD_HEADERS = {
    "Accept": "application/ld+json",
    "User-Agent": "Madrona-Sandbox-Seeder/1.0",
}


def _rijks_ld_extract_by_type(items, target_type: str, content_key: str = "content") -> str:
    """Pull `content` (or `value`) from a Linked Art identified_by /
    referred_to_by list where `type` matches `target_type`."""
    if not isinstance(items, list):
        return ""
    for item in items:
        if isinstance(item, dict) and item.get("type") == target_type:
            return item.get(content_key, "") or item.get("value", "")
    return ""


def _rijks_ld_name(items) -> str:
    return _rijks_ld_extract_by_type(items, "Name", "content")


def _rijks_discover_ids(target: int, _api_key: str | None) -> list[str]:
    """Paginate the Linked Art search endpoint, return up to `target`
    detail-URL ids whose records expose an image (representation)."""
    ids: list[str] = []
    page_token: str | None = None
    consecutive_empty = 0
    session = requests.Session()
    session.headers.update(RIJKS_LD_HEADERS)

    while len(ids) < target and consecutive_empty < 3:
        params = {"pageToken": page_token} if page_token else {}
        try:
            resp = session.get(RIJKS_LD_SEARCH, params=params, timeout=30)
            resp.raise_for_status()
            data = resp.json()
        except (requests.RequestException, ValueError) as e:
            logger.warning("Rijks search page failed: %s", e)
            consecutive_empty += 1
            continue

        items = data.get("orderedItems") or []
        if not items:
            consecutive_empty += 1
            continue
        consecutive_empty = 0

        for item in items:
            if len(ids) >= target:
                break
            item_id = item.get("id") or item.get("@id")
            if not item_id:
                continue
            ids.append(item_id)

        next_obj = data.get("next") or {}
        next_id = next_obj.get("id", "") if isinstance(next_obj, dict) else ""
        if "pageToken=" in next_id:
            page_token = next_id.split("pageToken=")[-1].split("&")[0]
        else:
            break

    return ids


_RIJKS_SESSION: requests.Session | None = None


def _rijks_session() -> requests.Session:
    global _RIJKS_SESSION
    if _RIJKS_SESSION is None:
        _RIJKS_SESSION = requests.Session()
        _RIJKS_SESSION.headers.update(RIJKS_LD_HEADERS)
    return _RIJKS_SESSION


def _rijks_get_ld(url: str) -> dict | None:
    try:
        resp = _rijks_session().get(url, timeout=30)
        resp.raise_for_status()
        return resp.json()
    except (requests.RequestException, ValueError) as e:
        logger.warning("Rijks LD fetch %s failed: %s", url, e)
        return None


def _rijks_is_cc0(record: dict) -> bool:
    """Check `subject_of[*].subject_to[*].classified_as[*].id` for the
    CC0 URI. Rijks puts rights on a LinguisticObject hanging off
    subject_of."""
    for s in (record.get("subject_of") or []):
        if not isinstance(s, dict):
            continue
        for st in (s.get("subject_to") or []):
            if not isinstance(st, dict):
                continue
            for cls in (st.get("classified_as") or []):
                if not isinstance(cls, dict):
                    continue
                cid = cls.get("id") or ""
                if "creativecommons.org/publicdomain/zero" in cid:
                    return True
    return False


def _rijks_resolve_image_url(record: dict) -> str | None:
    """Walk shows[0] → VisualItem → digitally_shown_by[0] → DigitalObject
    → access_point[0].id. Returns the IIIF image URL, or None."""
    # Sometimes representation is populated directly; respect that.
    rep = record.get("representation") or []
    if isinstance(rep, list) and rep and isinstance(rep[0], dict):
        direct = rep[0].get("id") or rep[0].get("@id")
        if direct:
            return direct

    shows = record.get("shows") or []
    if not isinstance(shows, list) or not shows:
        return None
    visual_ref = shows[0]
    if not isinstance(visual_ref, dict):
        return None
    visual_url = visual_ref.get("id") or visual_ref.get("@id")
    if not visual_url:
        return None

    visual = _rijks_get_ld(visual_url)
    if not visual:
        return None

    digitally_shown = visual.get("digitally_shown_by") or []
    if not isinstance(digitally_shown, list) or not digitally_shown:
        return None
    digital_ref = digitally_shown[0]
    if not isinstance(digital_ref, dict):
        return None
    digital_url = digital_ref.get("id") or digital_ref.get("@id")
    if not digital_url:
        return None

    digital = _rijks_get_ld(digital_url)
    if not digital:
        return None

    access = digital.get("access_point") or []
    if not isinstance(access, list) or not access:
        return None
    first = access[0]
    if not isinstance(first, dict):
        return None
    return first.get("id") or first.get("@id")


def _rijks_fetch(item_id: str, _api_key: str | None) -> dict | None:
    """Fetch the HumanMadeObject and resolve its image URL via the
    VisualItem → DigitalObject chain. The resolved URL is attached at
    the synthetic key `_madrona_image_url` so `_rijks_image_url` and
    `_rijks_media` can read it without re-fetching."""
    record = _rijks_get_ld(item_id)
    if not record:
        return None
    record["_madrona_image_url"] = _rijks_resolve_image_url(record)
    return record


def _rijks_image_url(record: dict) -> str | None:
    return record.get("_madrona_image_url") or None


def _rijks_should_skip(record: dict) -> str | None:
    if not _rijks_is_cc0(record):
        return "not CC0"
    if not _rijks_image_url(record):
        return "no resolvable image URL"
    return None


def _rijks_title(record: dict) -> str:
    return _rijks_ld_name(record.get("identified_by") or []) or "Untitled"


def _rijks_accession(record: dict) -> str:
    return _rijks_ld_extract_by_type(
        record.get("identified_by") or [], "Identifier", "content"
    )


def _rijks_creator(record: dict) -> str:
    """Linked Art: producer is at `produced_by`; the human-readable
    creator can be either a LinguisticObject in produced_by.referred_to_by
    or carried_out_by[0].identified_by.Name."""
    produced_by = record.get("produced_by") or {}
    if not isinstance(produced_by, dict):
        return ""

    for ref in (produced_by.get("referred_to_by") or []):
        if isinstance(ref, dict) and ref.get("type") == "LinguisticObject":
            content = ref.get("content")
            if content:
                return content

    for carried in (produced_by.get("carried_out_by") or []):
        if isinstance(carried, dict):
            name = _rijks_ld_name(carried.get("identified_by") or [])
            if name:
                return name
    return ""


def _rijks_creation_date(record: dict) -> str:
    produced_by = record.get("produced_by") or {}
    if not isinstance(produced_by, dict):
        return ""
    timespan = produced_by.get("timespan") or {}
    if not isinstance(timespan, dict):
        return ""
    return _rijks_ld_name(timespan.get("identified_by") or [])


def _rijks_materials(record: dict) -> list[dict]:
    made_of = record.get("made_of") or []
    if not isinstance(made_of, list):
        return []
    out: list[dict] = []
    for m in made_of[:5]:
        if isinstance(m, dict):
            name = _rijks_ld_name(m.get("identified_by") or [])
            if name:
                out.append({"name": name, "part": None, "vocabulary_term_id": None})
    return out


def _rijks_classification(record: dict) -> str:
    classified_as = record.get("classified_as") or []
    if not isinstance(classified_as, list):
        return ""
    for c in classified_as:
        if isinstance(c, dict):
            name = _rijks_ld_name(c.get("identified_by") or [])
            if name:
                return name
    return ""


def _rijks_referred_to(record: dict, label_substr: str) -> str:
    """Pull a `referred_to_by` entry whose first `classified_as` label
    contains `label_substr` (case-insensitive). Used for dimensions,
    credit line, description."""
    for ref in (record.get("referred_to_by") or []):
        if not isinstance(ref, dict):
            continue
        classified = ref.get("classified_as") or []
        if not isinstance(classified, list) or not classified:
            continue
        first_cls = classified[0]
        if not isinstance(first_cls, dict):
            continue
        label = _rijks_ld_name(first_cls.get("identified_by") or []).lower()
        if label_substr in label:
            content = ref.get("content")
            if content:
                return content
    return ""


def _rijks_map(record: dict) -> dict:
    title = _rijks_title(record)
    creator_name = _rijks_creator(record)
    creators: list[dict] = []
    if creator_name:
        creators.append({
            "name": creator_name,
            "role": None,
            "attribution": None,
            "authority_id": None,
            "ulan_id": None,
        })

    obj_type = _rijks_classification(record)
    materials = _rijks_materials(record)
    description = _rijks_referred_to(record, "description")
    physical = _rijks_referred_to(record, "dimension") or _rijks_referred_to(record, "measurement")
    creation_date_display = _rijks_creation_date(record) or None

    return {
        "object_name": title[:255],
        "brief_description": description or None,
        "responsible_department": "Rijksmuseum",
        "object_type": obj_type or None,
        "materials": materials or None,
        "subjects": None,
        "physical_description": physical or None,
        "creators": creators or None,
        "creation_date_display": creation_date_display,
        "creation_date_earliest": None,
        "creation_date_latest": None,
        "creation_place": None,
        "credit_line": "Rijksmuseum Amsterdam",
        "object_status": "accessioned",
    }


def _rijks_titles(record: dict) -> list[dict]:
    return [{"title": _rijks_title(record), "title_type": "primary", "is_preferred": True}]


def _rijks_media(record: dict, s3_key: str, file_size: int) -> dict:
    title = _rijks_title(record)
    maker = _rijks_creator(record)
    return {
        "s3_key": s3_key,
        "file_size": file_size,
        "mime_type": "image/jpeg",
        "title": title,
        "alt_text": f"{title} by {maker}" if maker else title,
        "credit": "Rijksmuseum Amsterdam",
        "creator": maker or None,
        "source": "Rijksmuseum",
        "copyright_status": "public_domain",
        "rights_statement": "CC0 1.0 Universal Public Domain Dedication",
        "license": "CC0-1.0",
        "image_url": _rijks_image_url(record),
    }


def _rijks_id_normalize(item_id: str) -> str:
    """Detail URLs look like `https://data.rijksmuseum.nl/objects/SK-C-5`.
    Reduce to the trailing slug for use in object_number / s3_key."""
    return item_id.rstrip("/").rsplit("/", 1)[-1]


# ---------------------------------------------------------------------------
# Source registry — each source pulls a stable API, maps to manifest entries,
# and uploads images under sandbox-fixtures/<source>/<id>.<ext>.
# ---------------------------------------------------------------------------


class SourceSpec:
    def __init__(
        self,
        key: str,
        ids: list,
        prefix: str,                     # object_number prefix, e.g. "MET-"
        s3_key_subdir: str,              # "met", "smithsonian", "rijks"
        api_key_env: str | None,
        fetch_fn: Callable[..., dict | None],
        should_skip_fn: Callable[[dict], str | None],
        image_url_fn: Callable[[dict], str | None],
        map_fn: Callable[[dict], dict],
        titles_fn: Callable[[dict], list[dict]],
        media_fn: Callable[[dict, str, int], dict],
        id_normalize_fn: Callable[[Any], str] = str,
        # Optional: when set, run_source calls this to obtain the ID list
        # at runtime instead of using the static `ids` field. Useful for
        # sources where curated lists go stale (SI re-keys, Rijks moved
        # endpoints). Signature: (target_count, api_key) -> list[id].
        discover_fn: Callable[[int, str | None], list] | None = None,
        default_target: int = 40,
    ):
        self.key = key
        self.ids = ids
        self.prefix = prefix
        self.s3_key_subdir = s3_key_subdir
        self.api_key_env = api_key_env
        self.fetch_fn = fetch_fn
        self.should_skip_fn = should_skip_fn
        self.image_url_fn = image_url_fn
        self.map_fn = map_fn
        self.titles_fn = titles_fn
        self.media_fn = media_fn
        self.id_normalize_fn = id_normalize_fn
        self.discover_fn = discover_fn
        self.default_target = default_target


SOURCES = {
    "met": SourceSpec(
        key="met",
        ids=MET_OBJECTS,
        prefix="MET-",
        s3_key_subdir="met",
        api_key_env=None,
        fetch_fn=_met_fetch,
        should_skip_fn=_met_should_skip,
        image_url_fn=_met_image_url,
        map_fn=_met_map,
        titles_fn=_met_titles,
        media_fn=_met_media,
    ),
    "smithsonian": SourceSpec(
        key="smithsonian",
        ids=SMITHSONIAN_OBJECT_IDS,  # empty — discovery replaces curated list
        prefix="SI-",
        s3_key_subdir="smithsonian",
        api_key_env="SMITHSONIAN_API_KEY",
        fetch_fn=_si_fetch,
        should_skip_fn=_si_should_skip,
        image_url_fn=_si_image_url,
        map_fn=_si_map,
        titles_fn=_si_titles,
        media_fn=_si_media,
        id_normalize_fn=_si_id_normalize,
        discover_fn=_si_discover_ids,
        default_target=40,
    ),
    "rijks": SourceSpec(
        key="rijks",
        ids=[],  # discovery-only: Linked Art search endpoint
        prefix="RIJKS-",
        s3_key_subdir="rijks",
        api_key_env=None,  # data.rijksmuseum.nl is open, no key
        fetch_fn=_rijks_fetch,
        should_skip_fn=_rijks_should_skip,
        image_url_fn=_rijks_image_url,
        map_fn=_rijks_map,
        titles_fn=_rijks_titles,
        media_fn=_rijks_media,
        id_normalize_fn=_rijks_id_normalize,
        discover_fn=_rijks_discover_ids,
        default_target=40,
    ),
}


# ---------------------------------------------------------------------------
# Generic per-source runner
# ---------------------------------------------------------------------------


def _existing_manifest(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    try:
        rows = json.loads(path.read_text())
        # Key by the source-specific ID. Met uses met_id, others use a
        # generic 'source_id' field we add below.
        return {str(row.get("source_id") or row.get("met_id")): row for row in rows}
    except Exception as e:
        logger.warning("Existing manifest %s unreadable (%s); starting fresh", path, e)
        return {}


def _download_image(url: str) -> bytes | None:
    try:
        resp = requests.get(url, timeout=60, stream=True)
        resp.raise_for_status()
        content = resp.content
        if len(content) < 1000:
            logger.warning("Image suspiciously small (%d bytes), skipping", len(content))
            return None
        return content
    except requests.RequestException as e:
        logger.warning("Image download failed: %s", e)
        return None


def _key_exists(s3_client, bucket: str, key: str) -> tuple[bool, int | None]:
    try:
        head = s3_client.head_object(Bucket=bucket, Key=key)
        return True, head.get("ContentLength")
    except Exception:
        return False, None


def _smithsonian_key_from_db() -> str | None:
    """Pull the SI API key from the local madrona DB's connectors table
    if SMITHSONIAN_API_KEY isn't in env. Falls back silently."""
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        return None
    # Strip the SQLAlchemy driver suffix so psycopg accepts it.
    db_url = (
        db_url.replace("postgresql+psycopg://", "postgresql://")
              .replace("postgres+psycopg://", "postgres://")
    )
    try:
        import psycopg
        with psycopg.connect(db_url) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT config->>'api_key' "
                    "FROM flow.connector_instances ci "
                    "JOIN flow.connector_definitions cd "
                    "  ON cd.connector_definition_id = ci.connector_definition_id "
                    "WHERE cd.key = 'smithsonian-openaccess' "
                    "  AND ci.config ? 'api_key' "
                    "  AND length(ci.config->>'api_key') > 12 "
                    "LIMIT 1"
                )
                row = cur.fetchone()
                if row:
                    return row[0]
    except Exception as e:
        logger.debug("Couldn't pull SI key from connectors table: %s", e)
    return None


def _resolve_api_key(source: SourceSpec) -> str | None:
    if not source.api_key_env:
        return None
    key = os.environ.get(source.api_key_env, "").strip() or None
    if not key and source.key == "smithsonian":
        key = _smithsonian_key_from_db()
        if key:
            logger.info("Smithsonian API key pulled from local connectors table")
    return key


def run_source(source: SourceSpec, *, region: str, bucket: str, limit: int | None,
               rate_ms: int, dry_run: bool, s3_client) -> dict:
    """Drive a single source's manifest build."""
    api_key = _resolve_api_key(source)
    if source.api_key_env and not api_key:
        if source.key == "smithsonian":
            logger.error(
                "Smithsonian needs an API key (SMITHSONIAN_API_KEY env or a "
                "connector_instances row with config.api_key). Skipping source."
            )
            return {"source": source.key, "skipped_reason": "no API key"}
        # Rijks: no key is fine.

    manifest_path = FIXTURES_DIR / f"{source.key}-manifest.json"
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
    existing = _existing_manifest(manifest_path)
    logger.info("[%s] existing manifest entries: %d", source.key, len(existing))

    if source.discover_fn is not None:
        target_count = limit if limit else source.default_target
        logger.info("[%s] discovering up to %d IDs from upstream API", source.key, target_count)
        targets = source.discover_fn(target_count, api_key)
        logger.info("[%s] discovery returned %d IDs", source.key, len(targets))
    else:
        targets = source.ids[:limit] if limit else source.ids
    new_manifest: list[dict] = []
    stats = {"uploaded": 0, "reused": 0, "skipped": 0, "fetch_failed": 0}

    for i, obj_id in enumerate(targets, 1):
        norm_id = source.id_normalize_fn(obj_id)
        logger.info("[%s %d/%d] %s%s", source.key, i, len(targets), source.prefix, norm_id)

        if i > 1:
            time.sleep(rate_ms / 1000)

        record = source.fetch_fn(obj_id, api_key)
        if not record:
            stats["fetch_failed"] += 1
            continue

        skip_reason = source.should_skip_fn(record)
        if skip_reason:
            logger.info("  skipping (%s)", skip_reason)
            stats["skipped"] += 1
            continue

        image_url = source.image_url_fn(record)
        if not image_url:
            logger.info("  no image url; skipping")
            stats["skipped"] += 1
            continue

        # File extension from the URL tail; default to .jpg for Met/SI/Rijks images.
        ext = "jpg"
        if "." in image_url.rsplit("/", 1)[-1]:
            candidate = image_url.rsplit(".", 1)[-1].lower().split("?")[0]
            if candidate in ("jpg", "jpeg", "png", "tif", "tiff"):
                ext = "jpg" if candidate == "jpeg" else candidate
        s3_key = f"sandbox-fixtures/{source.s3_key_subdir}/{norm_id}.{ext}"

        existing_entry = existing.get(norm_id)
        present, size = _key_exists(s3_client, bucket, s3_key)

        if dry_run:
            logger.info("  [dry-run] would upload to s3://%s/%s", bucket, s3_key)
            file_size = -1
        elif present and existing_entry and existing_entry.get("media", {}).get("s3_key") == s3_key:
            logger.info("  S3 key present (%d bytes), reusing", size or -1)
            file_size = size or 0
            stats["reused"] += 1
        else:
            content = _download_image(image_url)
            if not content:
                stats["skipped"] += 1
                continue
            s3_client.put_object(
                Bucket=bucket,
                Key=s3_key,
                Body=content,
                ContentType="image/jpeg",
                CacheControl="public, max-age=2592000",
            )
            file_size = len(content)
            logger.info("  uploaded %d bytes to s3://%s/%s", file_size, bucket, s3_key)
            stats["uploaded"] += 1

        entry = {
            "source_id": norm_id,
            "object_number": f"{source.prefix}{norm_id}",
            "object_fields": source.map_fn(record),
            "titles": source.titles_fn(record),
            "media": source.media_fn(record, s3_key, file_size),
        }
        # For backwards-compatibility with the Met loader's met_id key.
        if source.key == "met":
            entry["met_id"] = norm_id
        new_manifest.append(entry)

    if dry_run:
        logger.info(
            "[%s] DRY RUN — would write %d entries; stats=%s",
            source.key, len(new_manifest), stats,
        )
        return {"source": source.key, "entries": len(new_manifest), **stats}

    # Merge with existing entries we didn't refresh this run.
    by_id = {row.get("source_id") or row.get("met_id"): row for row in new_manifest}
    for sid, entry in existing.items():
        by_id.setdefault(sid, entry)
    merged = sorted(by_id.values(), key=lambda r: r.get("source_id") or r.get("met_id"))

    manifest_path.write_text(json.dumps(merged, indent=2, sort_keys=True) + "\n")
    digest = hashlib.sha256(manifest_path.read_bytes()).hexdigest()[:12]
    logger.info(
        "[%s] manifest written: %s (%d entries, sha256:%s)",
        source.key, manifest_path, len(merged), digest,
    )
    logger.info("[%s] stats: %s", source.key, stats)
    return {"source": source.key, "entries": len(merged), **stats}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        choices=list(SOURCES.keys()) + ["all"],
        default="all",
        help="Which manifest to build (default: all)",
    )
    parser.add_argument("--region", default=os.environ.get("AWS_REGION", "us-west-2"))
    parser.add_argument("--bucket", default=None)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--rate-ms", type=int, default=200)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    bucket = args.bucket or _bucket_for_region(args.region)
    logger.info("Using bucket %s in region %s", bucket, args.region)

    import boto3
    s3 = boto3.client("s3", region_name=args.region)

    targets = list(SOURCES.keys()) if args.source == "all" else [args.source]
    summary: list[dict] = []
    for src_key in targets:
        result = run_source(
            SOURCES[src_key],
            region=args.region,
            bucket=bucket,
            limit=args.limit,
            rate_ms=args.rate_ms,
            dry_run=args.dry_run,
            s3_client=s3,
        )
        summary.append(result)

    logger.info("Bootstrap summary: %s", summary)
    return 0


if __name__ == "__main__":
    sys.exit(main())

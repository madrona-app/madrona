"""
Seed Madrona with ~73 curated objects from the Metropolitan Museum of Art.

Uses the Met's free Open Access API (no API key required).
All objects are CC0 public domain with high-resolution images.
Objects span 10+ departments and 6 continents for broad search coverage.

Usage:
    cd backend
    ./venv/bin/python scripts/seed_met_museum.py --org-id <UUID> --user-id <UUID>
    ./venv/bin/python scripts/seed_met_museum.py --org-id <UUID> --user-id <UUID> --dry-run
    ./venv/bin/python scripts/seed_met_museum.py --org-id <UUID> --user-id <UUID> --skip-images
"""

import argparse
import os
import sys
import time
import uuid
from datetime import date, datetime, timezone
from io import BytesIO
from pathlib import Path

# Ensure backend directory is on sys.path when running as a standalone script
_backend_dir = str(Path(__file__).resolve().parent.parent)
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

import requests

# ─── Curated Met Object IDs ─────────────────────────────────────────────────
# ~73 objects across 10+ departments and 6 continents.
# All verified isPublicDomain=true with primaryImage via Met API.

MET_OBJECTS = [
    # ── European Paintings ──────────────────────────────────────────────────
    436535,   # Wheat Field with Cypresses – Van Gogh
    436532,   # Self-Portrait with a Straw Hat – Van Gogh
    436105,   # The Death of Socrates – David
    436528,   # Irises – Van Gogh
    435809,   # The Harvesters – Bruegel the Elder
    438817,   # The Dance Class – Degas
    436575,   # View of Toledo – El Greco
    437881,   # Young Woman with a Water Pitcher – Vermeer
    437980,   # Cypresses – Van Gogh
    435621,   # Joan of Arc – Bastien-Lepage
    437397,   # Self-Portrait – Rembrandt
    436449,   # The Siesta – Gauguin

    # ── American Wing ───────────────────────────────────────────────────────
    11417,    # Washington Crossing the Delaware – Leutze
    11122,    # The Gulf Stream – Winslow Homer
    10481,    # Heart of the Andes – Church
    10159,    # Fur Traders Descending the Missouri – Bingham

    # ── Egyptian Art ────────────────────────────────────────────────────────
    547802,   # The Temple of Dendur
    544227,   # Hippopotamus ("William") – faience

    # ── Greek & Roman Art ───────────────────────────────────────────────────
    248904,   # Terracotta Krater – Hirschfeld Workshop

    # ── Ancient Near Eastern Art ────────────────────────────────────────────
    322623,   # Assyrian Relief – cavalrymen along a stream

    # ── European Sculpture & Decorative Arts ────────────────────────────────
    204758,   # Perseus with the Head of Medusa – Canova

    # ── Arms & Armor ────────────────────────────────────────────────────────
    24975,    # Armor (Gusoku) – Bamen Tomotsugu
    22506,    # Armor (Yoroi) of Ashikaga Takauji – Japanese

    # ── Asian Art ───────────────────────────────────────────────────────────
    39799,    # The Great Wave – Hokusai
    39668,    # "Old Trees, Level Distance" – Guo Xi, Song dynasty scroll
    42229,    # Peach-bloom vase – Jingdezhen porcelain
    39325,    # Standing Parvati – Chola dynasty (India), copper
    38965,    # Buddha Offering Protection – Gupta period (India)
    38265,    # Brahma – Khmer (Cambodia), sandstone
    38950,    # Bodhisattva Avalokiteshvara – Thailand, copper
    39357,    # Shiva Seated with Parvati – Nepal, copper

    # ── African Art ─────────────────────────────────────────────────────────
    310325,   # Seated Couple – Dogon (Mali), wood/copper
    318622,   # Pendant Mask of Iyoba – Edo (Nigeria), ivory
    316393,   # Plaque with Warrior – Benin, brass
    310752,   # Plaque with Equestrian Oba – Benin, brass
    316442,   # Lidded Saltcellar – Temne/Bullom (Sierra Leone), ivory

    # ── Islamic Art ─────────────────────────────────────────────────────────
    449537,   # Mihrab (Prayer Niche) – mosaic tiles, 1354
    452100,   # "Simonetti" Carpet – wool, ca. 1500
    453351,   # Folio from Siyer-i Nebi – manuscript, ca. 1595
    447004,   # Mosque Lamp of Sultan Barquq – glass, 1382-99
    450513,   # Ewer – brass inlaid with silver, ca. 1180
    453563,   # Tile – cuerda seca technique, 1421

    # ── Pre-Columbian / Americas ────────────────────────────────────────────
    309959,   # Funerary Mask – Lambayeque (Peru), gold
    313411,   # Nose Ornament – Moche (Peru), gold/silver
    310268,   # Eagle Pendant – Chiriqui (Panama), gold
    765334,   # Spider Monkey – Aztec (Mexico), stone
    316299,   # Earflare Frontals – Maya, jadeite
    310619,   # Stirrup-spout Bottle – Chimu (Peru), silver

    # ── Oceanic / Pacific ───────────────────────────────────────────────────
    313658,   # Female Figure – Tonga, whale ivory
    313669,   # Ritual Image of Deity Oro – Tahiti, wood
    313844,   # Akua Ka'ai (Deity Figure) – Hawai'i, wood
    313842,   # Lei Niho Palaoa – Hawai'i, walrus ivory

    # ── Textiles & Fashion ──────────────────────────────────────────────────
    467642,   # Unicorn Rests in Garden (Unicorn Tapestry), 1495
    467637,   # Hunters Enter the Woods (Unicorn Tapestry), 1495
    79893,    # Robe à la française – British silk, 1740s
    83605,    # Robe à la française – French silk, 1750-75
    80389,    # Dress – British silk, ca. 1850

    # ── Photography ─────────────────────────────────────────────────────────
    267087,   # Landscape with Cottage – daguerreotype, 1844
    286022,   # Self-Portrait – daguerreotype, 1846
    267891,   # Ruins of Gallego Flour Mills – albumen silver, 1865
    285444,   # Self-Portrait with Christine – Degas, gelatin silver, ca. 1895
    302000,   # Young Woman with Stereoscope – albumen silver, 1864

    # ── Modern / Contemporary ───────────────────────────────────────────────
    485540,   # Unique Forms of Continuity in Space – Boccioni, bronze, 1913
    490027,   # Gustav Mahler (bust) – Rodin, bronze, 1909

    # ── Decorative Arts ─────────────────────────────────────────────────────
    9480,     # Vase – Louis C. Tiffany
    20633,    # Water-Lily Lamp – Tiffany Studios, glass/bronze
    206499,   # Drop-front Desk with Sèvres plaques, ca. 1776
    236178,   # Pair of Vases – Sèvres Manufactory, 1789
    208898,   # Wall Sconces – Duplessis, porcelain/enamel

    # ── Musical Instruments ─────────────────────────────────────────────────
    503523,   # Guqin (ancient Chinese instrument) – Prince Lu
    501788,   # Grand Piano – Cristofori, 1720 (inventor of the piano)
    503008,   # "Antonius" Violin – Stradivari, 1711
    504622,   # Folding Harpsichord – Italian, mid-18th c.
]

MET_API_BASE = "https://collectionapi.metmuseum.org/public/collection/v1/objects"


def fetch_met_object(met_id: int) -> dict | None:
    """Fetch a single object from the Met API."""
    try:
        resp = requests.get(f"{MET_API_BASE}/{met_id}", timeout=30)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        print(f"  WARNING: Failed to fetch MET-{met_id}: {e}")
        return None


def map_met_to_madrona(data: dict, org_id: uuid.UUID, user_id: uuid.UUID) -> dict:
    """Map Met API fields to CollectionObject constructor kwargs."""
    met_id = data["objectID"]

    # Titles
    titles = []
    if data.get("title"):
        titles.append({
            "title": data["title"],
            "title_type": "primary",
            "is_preferred": True,
        })

    # Creators (Madrona schema: name, role?, attribution?, authority_id?, ulan_id?)
    creators = []
    if data.get("artistDisplayName"):
        creator = {
            "name": data["artistDisplayName"],
            "role": data.get("artistRole") or None,
            "attribution": None,
            "authority_id": None,
            "ulan_id": None,
        }
        creators.append(creator)

    # Classifications
    classifications = []
    if data.get("classification"):
        classifications.append({"term": data["classification"]})

    # Materials (Madrona schema: name, part?, vocabulary_term_id?)
    materials = []
    if data.get("medium"):
        materials.append({
            "name": data["medium"],
            "part": None,
            "vocabulary_term_id": None,
        })

    # Measurements - store dimension text in physical_description instead,
    # since Madrona expects structured {dimension, value (number), unit, part}
    physical_description = data.get("dimensions") or None

    # Date handling
    creation_date_earliest = None
    creation_date_latest = None
    if data.get("objectBeginDate"):
        try:
            year = int(data["objectBeginDate"])
            if -5000 <= year <= 2100 and year != 0:
                creation_date_earliest = date(max(year, 1), 1, 1)
        except (ValueError, TypeError):
            pass
    if data.get("objectEndDate"):
        try:
            year = int(data["objectEndDate"])
            if -5000 <= year <= 2100 and year != 0:
                creation_date_latest = date(max(year, 1), 12, 31)
        except (ValueError, TypeError):
            pass

    # Style/period
    style_period = data.get("period") or None

    # Subject tags (with AAT/Wikidata authority URIs)
    subjects = []
    for tag in (data.get("tags") or []):
        subject = {
            "term": tag["term"],
            "type": "topic",
            "vocabulary_term_id": None,
        }
        subjects.append(subject)

    # Artist ULAN ID
    ulan_url = data.get("artistULAN_URL")
    if ulan_url and creators:
        ulan_id = ulan_url.split("/")[-1] if "/" in ulan_url else None
        if ulan_id:
            creators[0]["ulan_id"] = ulan_id

    fields = {
        "organization_id": org_id,
        "object_number": f"MET-{met_id}",
        "object_name": data.get("objectName") or None,
        # `titles` and `classifications` were extracted to dedicated link
        # tables (ObjectTitle, ObjectClassification) — passing them as
        # CollectionObject kwargs raises TypeError. The caller creates
        # ObjectTitle rows from `_pending_titles` after the object exists;
        # classifications are dropped entirely from the seed because they
        # require resolving lookup_values FKs which the demo doesn't need.
        "_pending_titles": titles,
        "brief_description": data.get("objectName") or None,
        "responsible_department": data.get("department") or None,
        "object_type": data.get("objectName") or None,
        "materials": materials or None,
        "subjects": subjects or None,
        "physical_description": physical_description,
        "style_period": style_period,
        "creators": creators or None,
        "creation_date_display": data.get("objectDate") or None,
        "creation_date_earliest": creation_date_earliest,
        "creation_date_latest": creation_date_latest,
        "creation_place": data.get("culture") or data.get("artistNationality") or None,
        "credit_line": data.get("creditLine") or None,
        "object_status": "accessioned",
        "created_by": user_id,
        "updated_by": user_id,
    }
    return fields


def download_image(url: str) -> bytes | None:
    """Download an image from the Met CDN."""
    try:
        resp = requests.get(url, timeout=60, stream=True)
        resp.raise_for_status()
        content = resp.content
        if len(content) < 1000:
            print(f"  WARNING: Image suspiciously small ({len(content)} bytes), skipping")
            return None
        return content
    except requests.RequestException as e:
        print(f"  WARNING: Failed to download image: {e}")
        return None


def seed_met_objects(org_id: uuid.UUID, user_id: uuid.UUID, dry_run: bool = False, skip_images: bool = False, session=None):
    """Main seed function."""
    from app.fastapi_app.serializers.collections_helpers import _index_collection_object
    from app.models import CollectionObject, CollectionObjectMedia, Media, ObjectPart
    from app.models.objects import ObjectTitle
    from app.services.uploads import MediaType, upload_org_media
    from app.tasks.media import process_upload_task

    created = 0
    skipped = 0
    errors = 0
    images_uploaded = 0
    media_ids_to_process = []

    for i, met_id in enumerate(MET_OBJECTS, 1):
        print(f"\n[{i}/{len(MET_OBJECTS)}] Processing MET-{met_id}...")

        # Rate-limit Met API requests (good citizenship at 73 objects)
        if i > 1:
            time.sleep(0.2)

        # Check if already exists
        existing = session.query(CollectionObject).filter(
            CollectionObject.organization_id == org_id,
            CollectionObject.object_number == f"MET-{met_id}",
        ).first()
        if existing:
            print(f"  Skipping MET-{met_id} (already exists)")
            skipped += 1
            continue

        # Fetch from Met API
        data = fetch_met_object(met_id)
        if not data:
            errors += 1
            continue

        title = data.get("title", "Unknown")
        artist = data.get("artistDisplayName", "Unknown")
        print(f"  {title} — {artist}")

        if not data.get("isPublicDomain"):
            print(f"  WARNING: MET-{met_id} is not public domain, skipping")
            errors += 1
            continue

        # Map fields
        fields = map_met_to_madrona(data, org_id, user_id)

        if dry_run:
            print(f"  [DRY RUN] Would create: {fields['object_number']}")
            print(f"    Title: {title}")
            print(f"    Artist: {artist}")
            print(f"    Date: {fields.get('creation_date_display', 'N/A')}")
            print(f"    Department: {fields.get('responsible_department', 'N/A')}")
            print(f"    Image URL: {data.get('primaryImage', 'None')}")
            created += 1
            continue

        try:
            # Pop the link-table data before constructing CollectionObject;
            # those keys aren't actual columns on the model.
            pending_titles = fields.pop("_pending_titles", None) or []

            # Create CollectionObject
            obj = CollectionObject(**fields)
            session.add(obj)
            session.flush()  # Get the object_id

            # Create ObjectTitle rows from the Met "title" field. Models
            # the same shape map_met_to_madrona built earlier (one row per
            # entry, primary/preferred flags carried through).
            for idx, title_dict in enumerate(pending_titles):
                title_text = title_dict.get("title")
                if not title_text:
                    continue
                session.add(ObjectTitle(
                    organization_id=org_id,
                    object_id=obj.object_id,
                    title=title_text,
                    title_type=title_dict.get("title_type"),
                    is_preferred=bool(title_dict.get("is_preferred", False)),
                    display_order=idx,
                    created_by=user_id,
                ))

            # Create default ObjectPart (required by procedures)
            part = ObjectPart(
                organization_id=org_id,
                object_id=obj.object_id,
                display_order=0,
                created_by=user_id,
                updated_by=user_id,
            )
            session.add(part)

            # Handle image
            image_url = data.get("primaryImage")
            if image_url and not skip_images:
                print(f"  Downloading image...")
                image_data = download_image(image_url)
                if image_data:
                    print(f"  Uploading to S3 ({len(image_data) / 1024 / 1024:.1f} MB)...")
                    try:
                        s3_key, file_size = upload_org_media(
                            organization_id=str(org_id),
                            file_data=BytesIO(image_data),
                            content_type="image/jpeg",
                            media_type=MediaType.IMAGE,
                            filename=f"met_{met_id}.jpg",
                            db_session=session,
                            check_limits=False,
                        )

                        # Create Media record
                        media = Media(
                            organization_id=org_id,
                            s3_key=s3_key,
                            filename=f"met_{met_id}.jpg",
                            file_size=file_size,
                            mime_type="image/jpeg",
                            media_type="image",
                            title=title,
                            alt_text=f"{title} by {artist}" if artist != "Unknown" else title,
                            credit=data.get("creditLine"),
                            creator=artist if artist != "Unknown" else None,
                            source="The Metropolitan Museum of Art, Open Access",
                            copyright_status="public_domain",
                            rights_statement="CC0 1.0 Universal Public Domain Dedication",
                            license="CC0-1.0",
                            processing_status="pending",
                            is_published=True,
                            created_by=user_id,
                            updated_by=user_id,
                        )
                        session.add(media)
                        session.flush()

                        # Link media to object
                        link = CollectionObjectMedia(
                            object_id=obj.object_id,
                            media_id=media.media_id,
                            is_primary=True,
                            sort_order=0,
                            usage_type="main",
                            created_by=user_id,
                        )
                        session.add(link)
                        images_uploaded += 1
                        media_ids_to_process.append(str(media.media_id))
                        print(f"  Image uploaded successfully")
                    except Exception as e:
                        print(f"  WARNING: Image upload failed: {e}")
                        # Object still gets created without image

            session.commit()
            session.refresh(obj)
            _index_collection_object(obj)
            created += 1
            print(f"  Created {fields['object_number']}")

        except Exception as e:
            session.rollback()
            print(f"  ERROR: Failed to create MET-{met_id}: {e}")
            errors += 1

    # Queue derivative processing for uploaded images
    if media_ids_to_process and not dry_run:
        print(f"\nQueuing derivative processing for {len(media_ids_to_process)} images...")
        for mid in media_ids_to_process:
            process_upload_task.delay(mid, str(org_id))
        print(f"  Queued {len(media_ids_to_process)} tasks to Celery")

    print(f"\n{'=' * 60}")
    print(f"Met Museum seed complete:")
    print(f"  Created:  {created}")
    print(f"  Skipped:  {skipped} (already existed)")
    print(f"  Errors:   {errors}")
    print(f"  Images:   {images_uploaded}")
    print(f"{'=' * 60}")


def main():
    parser = argparse.ArgumentParser(
        description="Seed Madrona with Met Museum Open Access objects"
    )
    parser.add_argument(
        "--org-id",
        required=True,
        help="Target organization UUID",
    )
    parser.add_argument(
        "--user-id",
        required=True,
        help="User UUID for created_by/updated_by fields",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and map data, print results, don't persist",
    )
    parser.add_argument(
        "--skip-images",
        action="store_true",
        help="Create objects without downloading/uploading images",
    )
    args = parser.parse_args()

    # Validate UUIDs
    try:
        org_id = uuid.UUID(args.org_id)
    except ValueError:
        print(f"ERROR: Invalid org-id: {args.org_id}")
        sys.exit(1)
    try:
        user_id = uuid.UUID(args.user_id)
    except ValueError:
        print(f"ERROR: Invalid user-id: {args.user_id}")
        sys.exit(1)

    from app.database import get_session

    with get_session() as session:
        print(f"Seeding Met Museum objects into org {org_id}")
        if args.dry_run:
            print("(DRY RUN - no data will be persisted)\n")
        seed_met_objects(org_id, user_id, dry_run=args.dry_run, skip_images=args.skip_images, session=session)


if __name__ == "__main__":
    main()

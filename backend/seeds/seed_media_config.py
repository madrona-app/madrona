"""
Seed media configuration for an organization.

Creates:
- 12 tag definitions (standard museum/DAM taxonomy)
- 2 watermark templates (text + image placeholder)
- 3 metadata templates (museum credit, public domain, restricted)
- derivative size presets, if any are defined — DERIVATIVE_SIZE_PRESETS ships
  empty on purpose, with a commented example to copy
Run with:
    python -m seeds.seed_media_config --org-id <uuid>

    # Preview without writing:
    python -m seeds.seed_media_config --org-id <uuid> --dry-run

    # Seed only a specific section:
    python -m seeds.seed_media_config --org-id <uuid> --only derivatives
    python -m seeds.seed_media_config --org-id <uuid> --only tags
    python -m seeds.seed_media_config --org-id <uuid> --only templates

Idempotent: checks for existing records before inserting.
"""

import argparse
import sys
from pathlib import Path
from uuid import uuid4, UUID

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.config import Settings
from app.models.media import (
    DerivativeSizeConfig,
    MediaTagDefinition,
    MediaTagValue,
    WatermarkTemplate,
    MetadataTemplate,
)


# ---------------------------------------------------------------------------
# Derivative Size Presets
# These are download options shown to users (not the processing pipeline sizes).
# ---------------------------------------------------------------------------
# Additional derivative sizes beyond system defaults.
# System defaults (thumbnail, small, medium, large, access_master, square_thumb)
# are created by migration. These are org-level extras.
DERIVATIVE_SIZE_PRESETS: list[dict] = [
    # Add org-specific sizes here if needed, e.g.:
    # {"name": "social_square", "label": "Social Media Square", "media_type": "image",
    #  "max_width": 1080, "max_height": 1080, "format": "jpeg", "quality": 85,
    #  "is_default": False, "sort_order": 10},
]


# ---------------------------------------------------------------------------
# Tag Definitions
# Standard museum/DAM taxonomy covering common classification axes.
# ---------------------------------------------------------------------------
# Each definition carries `field_type` + `allow_multiple` and an optional
# `values` list of preset allowed values for controlled types.
# field_type ∈ {text, dropdown, multi_select, category_tree, dynamic_keywords, date}
TAG_DEFINITIONS: list[dict] = [
    {
        "tag_key": "subject",
        "display_name": "Subject",
        "description": "Primary subject matter (landscape, portrait, architecture, event, etc.)",
        "field_type": "dynamic_keywords",
        "allow_multiple": True,
        "sort_order": 0,
    },
    {
        "tag_key": "view_type",
        "display_name": "View Type",
        "description": "Photographic perspective (front, back, detail, installation, in-situ, aerial)",
        "field_type": "dropdown",
        "allow_multiple": False,
        "sort_order": 1,
        "values": ["Front", "Back", "Detail", "Installation", "In-Situ", "Aerial", "Overall", "Oblique"],
    },
    {
        "tag_key": "location",
        "display_name": "Capture Location",
        "description": "Where the asset was captured (gallery name, storage area, studio, offsite)",
        "field_type": "dynamic_keywords",
        "allow_multiple": False,
        "sort_order": 2,
    },
    {
        "tag_key": "media_purpose",
        "display_name": "Purpose",
        "description": "Intended use (catalog, web, social media, press, print, internal documentation)",
        "field_type": "multi_select",
        "allow_multiple": True,
        "sort_order": 3,
        "values": ["Catalog", "Web", "Social Media", "Press", "Print", "Internal Documentation"],
    },
    {
        "tag_key": "format_type",
        "display_name": "Format Type",
        "description": "How the asset was produced (photography, scan, born-digital, video still, 3D render)",
        "field_type": "dropdown",
        "allow_multiple": False,
        "sort_order": 4,
        "values": ["Photography", "Scan", "Born-Digital", "Video Still", "3D Render"],
    },
    {
        "tag_key": "condition_context",
        "display_name": "Condition Context",
        "description": "Condition documentation stage (pre-treatment, post-treatment, damage, monitoring)",
        "field_type": "dropdown",
        "allow_multiple": False,
        "sort_order": 5,
        "values": ["Pre-Treatment", "Post-Treatment", "In-Progress", "Damage", "Monitoring"],
    },
    {
        "tag_key": "exhibition",
        "display_name": "Exhibition",
        "description": "Associated exhibition, display, or gallery installation",
        "field_type": "dynamic_keywords",
        "allow_multiple": True,
        "sort_order": 6,
    },
    {
        "tag_key": "event",
        "display_name": "Event",
        "description": "Associated event (opening, program, lecture, workshop, fundraiser)",
        "field_type": "dynamic_keywords",
        "allow_multiple": True,
        "sort_order": 7,
    },
    {
        "tag_key": "department",
        "display_name": "Department",
        "description": "Owning or producing department (curatorial, conservation, education, marketing)",
        "field_type": "dynamic_keywords",
        "allow_multiple": False,
        "sort_order": 8,
    },
    {
        "tag_key": "project",
        "display_name": "Project",
        "description": "Associated campaign, grant, or project (digitization initiative, annual report)",
        "field_type": "dynamic_keywords",
        "allow_multiple": True,
        "sort_order": 9,
    },
    {
        "tag_key": "rights_category",
        "display_name": "Rights Category",
        "description": "Access restriction level (public domain, open access, restricted, permission required)",
        "field_type": "dropdown",
        "allow_multiple": False,
        "sort_order": 10,
        "values": ["Public Domain", "Open Access", "Restricted", "Permission Required"],
    },
    {
        "tag_key": "sensitivity",
        "display_name": "Sensitivity",
        "description": "Cultural sensitivity flags (NAGPRA, sacred, restricted viewing, culturally sensitive)",
        "field_type": "multi_select",
        "allow_multiple": True,
        "sort_order": 11,
        "values": ["NAGPRA", "Sacred", "Restricted Viewing", "Culturally Sensitive"],
    },
]


# ---------------------------------------------------------------------------
# Watermark Templates
# ---------------------------------------------------------------------------
WATERMARK_TEMPLATES = [
    {
        "name": "Standard Text Watermark",
        "is_default": True,
        "is_active": True,
        "watermark_type": "text",
        "config": {
            "text": "© {organization_name}",
            "font": "Arial",
            "font_size": 24,
            "color": "#FFFFFF",
            "opacity": 0.4,
            "position": "bottom-right",
            "padding": 20,
        },
    },
    {
        "name": "Diagonal Draft Watermark",
        "is_default": False,
        "is_active": True,
        "watermark_type": "text",
        "config": {
            "text": "DRAFT — NOT FOR PUBLICATION",
            "font": "Arial",
            "font_size": 48,
            "color": "#FF0000",
            "opacity": 0.25,
            "position": "center",
            "padding": 0,
        },
    },
]


# ---------------------------------------------------------------------------
# Metadata Templates
# ---------------------------------------------------------------------------
METADATA_TEMPLATES = [
    {
        "name": "Standard Museum Credit",
        "description": "Default metadata template with standard museum credit line and copyright notice",
        "is_default": True,
        "is_active": True,
        "template_fields": {
            "title_prefix": None,
            "title_suffix": None,
            "description": None,
            "alt_text": None,
            "creator": None,
            "credit": "Image courtesy of {organization_name}",
            "source": None,
            "copyright_status": "institutional",
            "rights_statement": "This image is provided for non-commercial, educational use only. For reproduction permissions, contact the institution.",
            "license": None,
            "tags": [],
            "extra_metadata": None,
        },
    },
    {
        "name": "Public Domain",
        "description": "Template for works in the public domain with open access rights statement",
        "is_default": False,
        "is_active": True,
        "template_fields": {
            "title_prefix": None,
            "title_suffix": None,
            "description": None,
            "alt_text": None,
            "creator": None,
            "credit": None,
            "source": None,
            "copyright_status": "public_domain",
            "rights_statement": "This work is in the public domain. No rights reserved.",
            "license": "CC0 1.0",
            "tags": [],
            "extra_metadata": None,
        },
    },
    {
        "name": "Restricted — Conservation Only",
        "description": "Template for condition documentation with restricted access",
        "is_default": False,
        "is_active": True,
        "template_fields": {
            "title_prefix": "[RESTRICTED] ",
            "title_suffix": None,
            "description": None,
            "alt_text": None,
            "creator": None,
            "credit": None,
            "source": None,
            "copyright_status": "restricted",
            "rights_statement": "Internal use only. This image is restricted to conservation and curatorial staff.",
            "license": None,
            "tags": ["condition_context"],
            "extra_metadata": {"access_level": "staff_only"},
        },
    },
]


# ---------------------------------------------------------------------------
# Seeding functions
# ---------------------------------------------------------------------------

def seed_derivative_sizes(session: Session, org_id: str, dry_run: bool = False) -> int:
    """Seed derivative size presets."""
    existing = {
        c.name
        for c in session.query(DerivativeSizeConfig.name)
        .filter_by(organization_id=org_id)
        .all()
    }

    created = 0
    for preset in DERIVATIVE_SIZE_PRESETS:
        if preset["name"] in existing:
            continue
        if dry_run:
            print(f"  [DRY RUN] Would create derivative size: {preset['label']}")
            created += 1
            continue

        config = DerivativeSizeConfig(
            config_id=uuid4(),
            organization_id=org_id,
            **preset,
        )
        session.add(config)
        created += 1
        print(f"  Created derivative size: {preset['label']}")

    return created


def seed_tag_definitions(session: Session, org_id: str, dry_run: bool = False) -> int:
    """
    Seed tag definitions and their preset allowed values.

    For existing definitions, field_type / allow_multiple / description are
    reconciled in-place (idempotent upgrade path for orgs seeded before the
    controlled-vocab schema). Preset values are added only when missing.
    """
    existing_defs: dict[str, MediaTagDefinition] = {
        d.tag_key: d
        for d in session.query(MediaTagDefinition)
        .filter_by(organization_id=org_id)
        .all()
    }

    created = 0
    for tag in TAG_DEFINITIONS:
        values = tag.get("values") or []
        base = {k: v for k, v in tag.items() if k != "values"}

        defn = existing_defs.get(tag["tag_key"])
        if defn is None:
            if dry_run:
                print(f"  [DRY RUN] Would create tag: {tag['display_name']}")
                created += 1
                continue
            defn = MediaTagDefinition(
                definition_id=uuid4(),
                organization_id=org_id,
                is_active=True,
                **base,
            )
            session.add(defn)
            session.flush()  # so value rows can reference defn.definition_id
            created += 1
            print(f"  Created tag definition: {tag['display_name']}")
        else:
            # Upgrade in place: keep admin overrides to display_name but sync
            # typing metadata so controlled vocab takes effect on re-seed.
            changed = False
            for attr in ("field_type", "allow_multiple", "description"):
                if getattr(defn, attr, None) != base.get(attr):
                    setattr(defn, attr, base[attr])
                    changed = True
            if changed and not dry_run:
                print(f"  Updated tag definition: {tag['display_name']}")

        # Seed preset values if any — only insert values that don't already
        # exist for this definition. Sort order follows the list position.
        if values:
            existing_values = {
                v.value.lower()
                for v in session.query(MediaTagValue)
                .filter_by(definition_id=defn.definition_id)
                .all()
            }
            for idx, val in enumerate(values):
                if val.lower() in existing_values:
                    continue
                if dry_run:
                    print(f"    [DRY RUN] Would add value: {tag['display_name']} → {val}")
                    continue
                session.add(MediaTagValue(
                    value_id=uuid4(),
                    definition_id=defn.definition_id,
                    value=val,
                    sort_order=idx,
                    is_active=True,
                ))
                print(f"    Added value: {tag['display_name']} → {val}")

    return created


def seed_templates(session: Session, org_id: str, dry_run: bool = False) -> tuple[int, int]:
    """Seed watermark and metadata templates."""
    existing_wm = {
        w.name
        for w in session.query(WatermarkTemplate.name)
        .filter_by(organization_id=org_id)
        .all()
    }
    existing_mt = {
        m.name
        for m in session.query(MetadataTemplate.name)
        .filter_by(organization_id=org_id)
        .all()
    }

    wm_created = 0
    for wm in WATERMARK_TEMPLATES:
        if wm["name"] in existing_wm:
            continue
        if dry_run:
            print(f"  [DRY RUN] Would create watermark: {wm['name']}")
            wm_created += 1
            continue

        template = WatermarkTemplate(
            template_id=uuid4(),
            organization_id=org_id,
            **wm,
        )
        session.add(template)
        wm_created += 1
        print(f"  Created watermark template: {wm['name']}")

    mt_created = 0
    for mt in METADATA_TEMPLATES:
        if mt["name"] in existing_mt:
            continue
        if dry_run:
            print(f"  [DRY RUN] Would create metadata template: {mt['name']}")
            mt_created += 1
            continue

        template = MetadataTemplate(
            template_id=uuid4(),
            organization_id=org_id,
            **mt,
        )
        session.add(template)
        mt_created += 1
        print(f"  Created metadata template: {mt['name']}")

    return wm_created, mt_created


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Seed media configuration for an organization."
    )
    parser.add_argument("--org-id", required=True, help="Organization UUID")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    parser.add_argument(
        "--only",
        choices=["derivatives", "tags", "templates"],
        help="Seed only a specific section",
    )
    args = parser.parse_args()

    # Validate UUID
    try:
        org_uuid = str(UUID(args.org_id))
    except ValueError:
        print(f"Error: '{args.org_id}' is not a valid UUID")
        sys.exit(1)

    settings = Settings()
    engine = create_engine(settings.database_url.unicode_string())

    sections = [args.only] if args.only else ["derivatives", "tags", "templates"]

    print(f"\n{'[DRY RUN] ' if args.dry_run else ''}Seeding media config for org {org_uuid}")
    print("=" * 60)

    with Session(engine) as session:
        # Verify org exists
        from app.models import Organization
        org = session.query(Organization).filter_by(organization_id=org_uuid).first()
        if not org:
            print(f"Error: Organization {org_uuid} not found")
            sys.exit(1)
        print(f"Organization: {org.name}\n")

        totals = {}

        if "derivatives" in sections:
            print("Derivative Size Presets:")
            totals["derivatives"] = seed_derivative_sizes(session, org_uuid, args.dry_run)

        if "tags" in sections:
            print("\nTag Definitions:")
            totals["tags"] = seed_tag_definitions(session, org_uuid, args.dry_run)

        if "templates" in sections:
            print("\nTemplates:")
            wm, mt = seed_templates(session, org_uuid, args.dry_run)
            totals["watermarks"] = wm
            totals["metadata_templates"] = mt

        if not args.dry_run:
            session.commit()

        print("\n" + "=" * 60)
        prefix = "[DRY RUN] " if args.dry_run else ""
        for key, count in totals.items():
            status = f"created {count}" if count > 0 else "already up to date"
            print(f"  {prefix}{key}: {status}")
        print()


if __name__ == "__main__":
    main()

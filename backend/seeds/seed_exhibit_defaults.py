"""
Seed default frame styles and mount configurations for exhibitions.

Creates system-level (is_system=True) frame styles and mount configs that
are available to all organizations.

Run with:
    python -m seeds.seed_exhibit_defaults

Frame Styles:
- Flat: Simple flat profile frame
- Stepped: Frame with stepped edge detail
- Ornate: Traditional decorative frame
- Float: Float mount with gap between art and frame
- Shadowbox: Deep frame creating shadow box effect

Mount Configs:
- Wall: Standard wall mounting
- Plinth: Freestanding pedestal display
- Hanging: Suspended from ceiling
- Vitrine: Glass display case
"""

import sys
from pathlib import Path
from decimal import Decimal
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import Organization, FrameStyle, MountConfig


# System default frame styles
DEFAULT_FRAME_STYLES = [
    {
        "name": "Flat Black",
        "description": "Simple flat profile frame in matte black",
        "profile_type": "flat",
        "default_width_cm": Decimal("3.0"),
        "default_depth_cm": Decimal("2.0"),
        "material": "wood",
        "color_hex": "#1A1A1A",
    },
    {
        "name": "Flat White",
        "description": "Simple flat profile frame in white",
        "profile_type": "flat",
        "default_width_cm": Decimal("3.0"),
        "default_depth_cm": Decimal("2.0"),
        "material": "wood",
        "color_hex": "#FFFFFF",
    },
    {
        "name": "Flat Natural Oak",
        "description": "Simple flat profile frame in natural oak",
        "profile_type": "flat",
        "default_width_cm": Decimal("3.5"),
        "default_depth_cm": Decimal("2.0"),
        "material": "wood",
        "color_hex": "#C4A574",
    },
    {
        "name": "Stepped Black",
        "description": "Frame with stepped edge detail in black",
        "profile_type": "stepped",
        "default_width_cm": Decimal("4.0"),
        "default_depth_cm": Decimal("2.5"),
        "material": "wood",
        "color_hex": "#2C2C2C",
    },
    {
        "name": "Ornate Gold",
        "description": "Traditional decorative frame with gilt finish",
        "profile_type": "ornate",
        "default_width_cm": Decimal("8.0"),
        "default_depth_cm": Decimal("4.0"),
        "material": "gilt",
        "color_hex": "#D4AF37",
    },
    {
        "name": "Ornate Silver",
        "description": "Traditional decorative frame with silver finish",
        "profile_type": "ornate",
        "default_width_cm": Decimal("8.0"),
        "default_depth_cm": Decimal("4.0"),
        "material": "gilt",
        "color_hex": "#C0C0C0",
    },
    {
        "name": "Float White",
        "description": "Float mount with visible gap, white frame",
        "profile_type": "float",
        "default_width_cm": Decimal("5.0"),
        "default_depth_cm": Decimal("3.0"),
        "material": "wood",
        "color_hex": "#FFFFFF",
    },
    {
        "name": "Float Black",
        "description": "Float mount with visible gap, black frame",
        "profile_type": "float",
        "default_width_cm": Decimal("5.0"),
        "default_depth_cm": Decimal("3.0"),
        "material": "wood",
        "color_hex": "#1A1A1A",
    },
    {
        "name": "Shadowbox White",
        "description": "Deep frame for 3D objects, white finish",
        "profile_type": "shadowbox",
        "default_width_cm": Decimal("5.0"),
        "default_depth_cm": Decimal("8.0"),
        "material": "wood",
        "color_hex": "#FFFFFF",
    },
    {
        "name": "Metal Silver",
        "description": "Modern thin metal frame in silver",
        "profile_type": "flat",
        "default_width_cm": Decimal("1.5"),
        "default_depth_cm": Decimal("1.0"),
        "material": "metal",
        "color_hex": "#808080",
    },
]


# System default mount configurations
DEFAULT_MOUNT_CONFIGS = [
    {
        "name": "Standard Wall Mount",
        "mount_type": "wall",
        "config": {
            "wire_type": "steel_cable",
            "hardware": "french_cleat",
        },
    },
    {
        "name": "D-Ring Wall Mount",
        "mount_type": "wall",
        "config": {
            "wire_type": "d-ring",
            "hardware": "keyhole",
        },
    },
    {
        "name": "Low Plinth (60cm)",
        "mount_type": "plinth",
        "config": {
            "height_cm": 60,
            "width_cm": 40,
            "depth_cm": 40,
            "material": "wood",
            "color_hex": "#FFFFFF",
        },
    },
    {
        "name": "Medium Plinth (90cm)",
        "mount_type": "plinth",
        "config": {
            "height_cm": 90,
            "width_cm": 50,
            "depth_cm": 50,
            "material": "wood",
            "color_hex": "#FFFFFF",
        },
    },
    {
        "name": "Tall Plinth (120cm)",
        "mount_type": "plinth",
        "config": {
            "height_cm": 120,
            "width_cm": 60,
            "depth_cm": 60,
            "material": "wood",
            "color_hex": "#FFFFFF",
        },
    },
    {
        "name": "Black Plinth (90cm)",
        "mount_type": "plinth",
        "config": {
            "height_cm": 90,
            "width_cm": 50,
            "depth_cm": 50,
            "material": "wood",
            "color_hex": "#1A1A1A",
        },
    },
    {
        "name": "Acrylic Plinth (90cm)",
        "mount_type": "plinth",
        "config": {
            "height_cm": 90,
            "width_cm": 40,
            "depth_cm": 40,
            "material": "acrylic",
            "color_hex": "#FFFFFF",
        },
    },
    {
        "name": "Steel Cable Hanging",
        "mount_type": "hanging",
        "config": {
            "wire_length_cm": 150,
            "offset_from_ceiling_cm": 10,
            "wire_type": "steel_cable",
        },
    },
    {
        "name": "Nylon Cord Hanging",
        "mount_type": "hanging",
        "config": {
            "wire_length_cm": 200,
            "offset_from_ceiling_cm": 15,
            "wire_type": "nylon",
        },
    },
    {
        "name": "Small Vitrine (40x40x40)",
        "mount_type": "vitrine",
        "config": {
            "height_cm": 40,
            "width_cm": 40,
            "depth_cm": 40,
            "has_pedestal": True,
            "pedestal_height_cm": 80,
        },
    },
    {
        "name": "Medium Vitrine (60x50x50)",
        "mount_type": "vitrine",
        "config": {
            "height_cm": 60,
            "width_cm": 50,
            "depth_cm": 50,
            "has_pedestal": True,
            "pedestal_height_cm": 90,
        },
    },
    {
        "name": "Large Vitrine (80x70x70)",
        "mount_type": "vitrine",
        "config": {
            "height_cm": 80,
            "width_cm": 70,
            "depth_cm": 70,
            "has_pedestal": True,
            "pedestal_height_cm": 60,
        },
    },
    {
        "name": "Table Vitrine (no pedestal)",
        "mount_type": "vitrine",
        "config": {
            "height_cm": 30,
            "width_cm": 60,
            "depth_cm": 40,
            "has_pedestal": False,
            "pedestal_height_cm": 0,
        },
    },
]


def get_or_create_system_org(session: Session) -> Organization:
    """
    Get or create a system organization for shared resources.

    System defaults need an organization_id due to FK constraint.
    We use a dedicated 'system' organization for shared resources.
    """
    system_org = session.query(Organization).filter_by(slug="system").first()

    if not system_org:
        system_org = Organization(
            name="System Defaults",
            slug="system",
            status="active",
            is_demo=False,
        )
        session.add(system_org)
        session.flush()
        print(f"Created system organization: {system_org.organization_id}")

    return system_org


def seed_frame_styles(session: Session, org_id) -> int:
    """Seed default frame styles."""
    created = 0

    for frame_data in DEFAULT_FRAME_STYLES:
        # Check if already exists
        existing = session.query(FrameStyle).filter_by(
            organization_id=org_id,
            name=frame_data["name"],
            is_system=True,
        ).first()

        if existing:
            print(f"  ✓ Frame: {frame_data['name']} (exists)")
            continue

        frame = FrameStyle(
            organization_id=org_id,
            name=frame_data["name"],
            description=frame_data.get("description"),
            profile_type=frame_data["profile_type"],
            default_width_cm=frame_data["default_width_cm"],
            default_depth_cm=frame_data["default_depth_cm"],
            material=frame_data.get("material"),
            color_hex=frame_data["color_hex"],
            is_system=True,
        )
        session.add(frame)
        created += 1
        print(f"  + Frame: {frame_data['name']} (created)")

    return created


def seed_mount_configs(session: Session, org_id) -> int:
    """Seed default mount configurations."""
    created = 0

    for mount_data in DEFAULT_MOUNT_CONFIGS:
        # Check if already exists
        existing = session.query(MountConfig).filter_by(
            organization_id=org_id,
            name=mount_data["name"],
            is_system=True,
        ).first()

        if existing:
            print(f"  ✓ Mount: {mount_data['name']} (exists)")
            continue

        mount = MountConfig(
            organization_id=org_id,
            name=mount_data["name"],
            mount_type=mount_data["mount_type"],
            config=mount_data["config"],
            is_system=True,
        )
        session.add(mount)
        created += 1
        print(f"  + Mount: {mount_data['name']} (created)")

    return created


def seed_exhibit_defaults():
    """Create default frame styles and mount configurations."""
    settings = Settings()
    engine = create_engine(settings.database_url.unicode_string())

    print("\n" + "=" * 80)
    print("Seeding Exhibition Defaults")
    print("=" * 80)

    with Session(engine) as session:
        # Get or create system organization
        system_org = get_or_create_system_org(session)
        org_id = system_org.organization_id

        print(f"\nUsing system organization: {org_id}")

        # Seed frame styles
        print("\nFrame Styles:")
        print("-" * 40)
        frames_created = seed_frame_styles(session, org_id)

        # Seed mount configs
        print("\nMount Configurations:")
        print("-" * 40)
        mounts_created = seed_mount_configs(session, org_id)

        session.commit()

        # Summary
        print("\n" + "=" * 80)
        print(f"✅ Created {frames_created} frame styles")
        print(f"✅ Created {mounts_created} mount configurations")
        print(f"📊 Total frame styles: {session.query(FrameStyle).filter_by(is_system=True).count()}")
        print(f"📊 Total mount configs: {session.query(MountConfig).filter_by(is_system=True).count()}")
        print("=" * 80 + "\n")


if __name__ == "__main__":
    seed_exhibit_defaults()

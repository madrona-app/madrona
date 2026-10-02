"""
Seed role profiles with display labels.

Creates role_profile records from the canonical ROLE_LABELS in app/permissions.py.

Run with:
    python -m seeds.seed_role_profiles

Idempotent: updates existing labels if changed, creates new ones if missing.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import RoleProfile
from app.permissions import ROLE_LABELS


def seed_role_profiles():
    """Create role profile labels from the canonical ROLE_LABELS dict."""
    settings = Settings()
    engine = create_engine(settings.database_url.unicode_string())

    profile_key = "glam_default"

    with Session(engine) as session:
        profiles_created = 0
        profiles_updated = 0

        print(f"\nRole Labels ({profile_key}):")
        print("-" * 60)

        for role_key, label in ROLE_LABELS.items():
            if role_key == "platform_admin":
                continue  # Platform admin is internal-only

            existing = session.query(RoleProfile).filter_by(
                profile_key=profile_key,
                role_key=role_key
            ).first()

            if existing:
                if existing.label != label:
                    existing.label = label
                    profiles_updated += 1
                    print(f"  updated {role_key:20} -> {label}")
                else:
                    print(f"  exists  {role_key:20} -> {label}")
                continue

            profile = RoleProfile(
                profile_key=profile_key,
                role_key=role_key,
                label=label,
            )
            session.add(profile)
            profiles_created += 1
            print(f"  created {role_key:20} -> {label}")

        session.commit()

        print(f"\nCreated {profiles_created}, updated {profiles_updated}")


if __name__ == "__main__":
    seed_role_profiles()

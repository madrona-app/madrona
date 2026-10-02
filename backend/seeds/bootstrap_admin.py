"""
Create the first administrator account for a self-hosted install.

`docker compose up` gives you a running system with no way in. This creates
(or reuses) an organization, creates an admin user, enables every application,
and optionally grants platform-admin.

The setup wizard at /setup does the same thing in a browser and is the
friendlier route; both call bootstrap_first_admin in
app.services.install_service.py, so there is one implementation rather than two.
This CLI stays for scripted installs and for recovering an install whose admin
password has been lost.

Run with:
    python -m seeds.bootstrap_admin --email you@museum.org --password '...'
    python -m seeds.bootstrap_admin --email you@museum.org --password '...' \
        --org-name "Museum of Somewhere" --platform-admin

Idempotent: re-running updates the password, tops up any missing
application grants, and leaves everything else alone.
"""

import argparse
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.services.install_service import bootstrap_first_admin

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("bootstrap")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--email", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--name", default=None, help="Display name (default: email local part)")
    ap.add_argument("--org-name", default="My Museum")
    ap.add_argument("--platform-admin", action="store_true",
                    help="Grant platform-admin rather than org admin")
    args = ap.parse_args()

    # Owner role: bootstrap writes org-scoped rows before any RLS context
    # exists, so it must bypass RLS like the other seeds.
    settings = Settings()
    db_url = os.environ.get("ALEMBIC_DATABASE_URL") or settings.database_url.unicode_string()
    engine = create_engine(db_url)

    with Session(engine) as session:
        try:
            result = bootstrap_first_admin(
                session,
                email=args.email,
                password=args.password,
                display_name=args.name,
                org_name=args.org_name,
                platform_admin=args.platform_admin,
            )
        except LookupError as exc:
            raise SystemExit(str(exc))
        session.commit()

    logger.info("")
    logger.info("Sign in at the frontend with %s", result["email"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

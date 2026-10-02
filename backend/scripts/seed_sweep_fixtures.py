#!/usr/bin/env python3
"""Create one minimal row per org-scoped table, so the API sweep can reach more.

scripts/api_sweep.py can only call an endpoint if it can find a real id for
every path parameter. On a database with realistic but narrow content, 255 write
operations and 114 reads were unreachable for want of a row — 75 distinct
parameters, spread across loans, checklists, pipelines, floor plans and the rest.
Hand-writing 75 fixtures would be a lot of code to maintain and would rot.

So this derives them. For every mapped table that is scoped to an organization
and has no row for ours, it inserts one, filling each NOT NULL column from the
schema itself:

  * the primary key gets a fresh UUID
  * organization_id gets ours
  * a foreign key borrows an existing row's id, preferring our own tenant
  * a column with a CHECK constraint that enumerates literals takes the first
    one, because a generic string would violate it
  * anything else is typed from its column: 1, False, today, {}, [], a short
    string clipped to the column's length

Rows are inserted one per savepoint, so a table that cannot be satisfied is
skipped rather than poisoning the transaction, and several passes run so a table
whose foreign key was unsatisfiable on the first pass can succeed on a later one.

Known limit: a NOT NULL jsonb column gets `{}`, which satisfies the database and
can still be a shape no consumer accepts — collections.label_templates requires a
`fields` array inside template_fields, so a fixture row makes the label-templates
page log a schema error. That is the fixture being unrealistic, not a defect, and
it is why a jsonb-heavy table is sometimes better left unseeded.

Rows are also deleted by scripts/api_sweep.py --mode write, whose DELETE pass runs
last. Re-run this after a write sweep, or the ids it created will have gone.

This writes to whatever database you point it at, and the rows it makes are
obvious filler. Use a disposable database.

    cd backend
    ./venv/bin/python scripts/seed_sweep_fixtures.py --org <uuid>
    ./venv/bin/python scripts/seed_sweep_fixtures.py --org <uuid> --dry-run
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import re
import sys
import uuid
from decimal import Decimal

from sqlalchemy import JSON, create_engine, inspect, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.models import Base  # noqa: E402

MARKER = "sweep-fixture"


def check_literals(session: Session, table, column: str) -> list[str]:
    """Literals a CHECK constraint allows for this column, if it enumerates any.

    Status and type columns are usually constrained to a short list. A generic
    string violates the constraint and the insert fails for a reason that has
    nothing to do with the row we want.
    """
    schema = table.schema or "public"
    rows = session.execute(text("""
        SELECT pg_get_constraintdef(c.oid)
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE c.contype = 'c' AND n.nspname = :schema AND t.relname = :table
    """), {"schema": schema, "table": table.name}).scalars().all()

    for definition in rows:
        # Only trust a constraint that mentions this column and nothing else,
        # or a multi-column one would hand us a value for the wrong field.
        mentioned = set(re.findall(r'\(?"?([a-z_][a-z0-9_]*)"?\)?::text\b', definition))
        if column not in mentioned or len(mentioned) > 1:
            continue
        # Literals may be cast to text or to character varying depending on how
        # the column was declared: ANY (ARRAY['jpeg'::character varying, ...]).
        # Take every quoted string rather than matching one cast spelling.
        literals = re.findall(r"'([^']*)'", definition)
        literals = [lit for lit in literals if lit]
        if literals:
            return literals
    return []


def borrow_fk(session: Session, column, org_id: str):
    """An existing id from the table this column points at."""
    for fk in column.foreign_keys:
        target = fk.column.table
        qualified = f"{target.schema or 'public'}.{target.name}"
        has_org = any(c.name == "organization_id" for c in target.columns)
        try:
            if has_org:
                value = session.execute(
                    text(f"SELECT {fk.column.name} FROM {qualified} "
                         f"WHERE organization_id = :org LIMIT 1"),
                    {"org": org_id},
                ).scalar()
                if value is not None:
                    return value
            return session.execute(
                text(f"SELECT {fk.column.name} FROM {qualified} LIMIT 1")
            ).scalar()
        except SQLAlchemyError:
            session.rollback()
    return None


def value_for(session: Session, table, column, org_id: str):
    if column.name == "organization_id":
        return uuid.UUID(org_id)
    if column.primary_key:
        return uuid.uuid4()
    if column.foreign_keys:
        return borrow_fk(session, column, org_id)

    literals = check_literals(session, table, column.name)
    if literals:
        return literals[0]

    # By type, not python_type: SQLAlchemy reports a JSON column's python_type
    # as `object`, so the dict branch below never matched and every NOT NULL
    # json column got the marker string. That is valid JSON, so the insert
    # succeeded, and the API then failed to serialize the row — the sweep's
    # 500 on GET /api/layout-overrides. Every such column is mapped as a dict.
    # JSONB subclasses JSON, so this covers both.
    if isinstance(column.type, JSON):
        return {}

    python_type = None
    try:
        python_type = column.type.python_type
    except (NotImplementedError, AttributeError):
        pass

    if python_type is bool:
        return False
    if python_type is int:
        return 1
    if python_type in (float, Decimal):
        return 1
    if python_type is dt.date:
        return dt.date.today()
    if python_type is dt.datetime:
        return dt.datetime.now(dt.timezone.utc)
    if python_type is dt.time:
        return dt.time(12, 0)
    if python_type is uuid.UUID:
        return uuid.uuid4()
    if python_type in (dict,):
        return {}
    if python_type in (list, tuple):
        return []
    if python_type is bytes:
        return b""

    length = getattr(column.type, "length", None)
    if column.name in URL_ADDRESSABLE or column.name.endswith("_slug"):
        # Unique-ish: slugs usually carry a unique index, and a constant would
        # collide the second time this runs.
        value = f"{MARKER}-{uuid.uuid4().hex[:8]}"
        return value[:length] if length else value
    return MARKER[:length] if length else MARKER


# Nullable columns that still have to be filled, because a URL addresses rows by
# them. A route like /c/:orgSlug/venues/:venueSlug cannot be visited when the only
# venue's slug is null, and the sweep then skips the route rather than testing it.
URL_ADDRESSABLE = {"slug"}


def needs_a_value(column) -> bool:
    if column.nullable:
        return column.name in URL_ADDRESSABLE or column.name.endswith("_slug")
    if column.default is not None or column.server_default is not None:
        return column.primary_key  # a PK default we still want to control
    return True


def seed(session: Session, org_id: str, passes: int, dry_run: bool) -> dict:
    inspector = inspect(session.get_bind())
    stats = {"created": 0, "already": 0, "failed": 0, "not_org_scoped": 0}
    failures: dict[str, str] = {}

    tables = [t for t in Base.metadata.sorted_tables
              if any(c.name == "organization_id" for c in t.columns)]

    for attempt in range(passes):
        made_progress = False
        for table in tables:
            qualified = f"{table.schema or 'public'}.{table.name}"
            if not inspector.has_table(table.name, schema=table.schema):
                continue
            try:
                existing = session.execute(
                    text(f"SELECT 1 FROM {qualified} WHERE organization_id = :org LIMIT 1"),
                    {"org": org_id},
                ).scalar()
            except SQLAlchemyError:
                session.rollback()
                continue
            if existing:
                if attempt == 0:
                    stats["already"] += 1
                continue

            columns = [c for c in table.columns if needs_a_value(c)]
            values, missing = {}, False
            for column in columns:
                value = value_for(session, table, column, org_id)
                if value is None:
                    missing = True
                    failures[qualified] = f"no value for NOT NULL {column.name}"
                    break
                values[column.name] = value
            if missing:
                continue

            if dry_run:
                stats["created"] += 1
                made_progress = True
                continue

            savepoint = session.begin_nested()
            try:
                session.execute(table.insert().values(**values))
                savepoint.commit()
                session.commit()
                stats["created"] += 1
                made_progress = True
                failures.pop(qualified, None)
            except SQLAlchemyError as exc:
                savepoint.rollback()
                failures[qualified] = str(exc.orig if hasattr(exc, "orig") else exc).split("\n")[0][:130]

        if not made_progress:
            break

    stats["failed"] = len(failures)
    return {"stats": stats, "failures": failures}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--org", required=True, help="organization_id to seed for")
    parser.add_argument("--db", default=os.environ.get(
        "SWEEP_DB_URL", "postgresql+psycopg://madrona:madrona@localhost:15432/madrona"))
    parser.add_argument("--passes", type=int, default=3,
                        help="retry rounds, so later tables can borrow earlier rows")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--show-failures", action="store_true")
    args = parser.parse_args()

    engine = create_engine(args.db)
    with Session(engine) as session:
        outcome = seed(session, args.org, args.passes, args.dry_run)

    stats = outcome["stats"]
    verb = "would create" if args.dry_run else "created"
    print(f"{verb} {stats['created']} fixture row(s); "
          f"{stats['already']} table(s) already had one; "
          f"{stats['failed']} could not be satisfied")

    if args.show_failures and outcome["failures"]:
        print("\ncould not seed:")
        for table, reason in sorted(outcome["failures"].items()):
            print(f"  {table}: {reason}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

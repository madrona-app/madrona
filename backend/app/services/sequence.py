"""
Atomic sequential number generation.

Uses INSERT ... ON CONFLICT DO UPDATE for race-condition-free number
generation.  On first use for a given (org, prefix, year) it scans
the target table for the highest existing number — including manually
entered ones — so the counter never starts behind reality.
"""

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

# Maps prefix → (schema.table, column) so the counter can discover
# manually entered numbers that are ahead of the stored counter.
_PREFIX_TABLE_MAP: dict[str, tuple[str, str]] = {
    "CR": ("collections.condition_reports", "report_number"),
    "EX": ("collections.object_exits", "exit_number"),
    "M": ("collections.movements", "movement_reference_number"),
    # NB: keys MUST match the prefix passed to next_sequential_number (the same
    # prefix used to format the stored number), or the max-existing scan silently
    # returns 0 and the counter collides with seeded/existing rows. See
    # test_sequence_prefix_coverage.
    "E": ("collections.object_entries", "entry_number"),
    "ACQ": ("collections.acquisitions", "acquisition_number"),
    "LI": ("collections.loans_in", "loan_number"),
    "LO": ("collections.loans_out", "loan_number"),
    "DA": ("collections.deaccessions", "deaccession_number"),
    "VAL": ("collections.valuations", "valuation_number"),
    "REV": ("collections.collections_reviews", "review_number"),
    "DP": ("collections.documentation_plans", "plan_number"),
    "DL": ("collections.damage_loss_reports", "report_number"),
    "CON": ("collections.conservation_treatments", "treatment_number"),
    "USE": ("collections.use_requests", "request_number"),
    "REP": ("collections.reproduction_requests", "request_number"),
}


def _scan_max_existing(
    session: Session,
    organization_id: str,
    prefix: str,
    year: int,
    separator: str,
) -> int:
    """Scan the target table for the highest existing number with this prefix+year."""
    table_info = _PREFIX_TABLE_MAP.get(prefix)
    if not table_info:
        return 0

    table, column = table_info
    # Build the LIKE pattern: "CR2026." or "M.2026." depending on format
    # Try both patterns since some prefixes include separator before year
    patterns = [
        f"{prefix}{year}{separator}%",      # CR2026.0001
        f"{prefix}{separator}{year}{separator}%",  # M.2026.0001
    ]

    max_num = 0
    for pattern in patterns:
        try:
            result = session.execute(
                text(f"""
                    SELECT MAX({column}) FROM {table}
                    WHERE organization_id = :org_id AND {column} LIKE :pattern
                """),
                {"org_id": organization_id, "pattern": pattern},
            ).scalar()
            if result:
                try:
                    max_num = max(max_num, int(result.split(separator)[-1]))
                except (ValueError, IndexError):
                    pass
        except Exception:
            pass

    return max_num


def next_sequential_number(
    session: Session,
    organization_id: UUID | str,
    prefix: str,
    year: int | None = None,
    pad: int = 4,
    separator: str = '.',
    include_year: bool = True,
) -> str:
    """
    Atomically generate the next sequential number for a given prefix.

    Uses INSERT ... ON CONFLICT DO UPDATE to safely handle concurrent requests.
    On first use, scans the target table for existing numbers (including
    manually entered ones) so the counter starts ahead of all existing records.

    Returns a formatted string like "LI2026.0001" (with year) or "SHP-IN-0001" (without year).

    Args:
        session: SQLAlchemy session (must be in a transaction)
        organization_id: Organization UUID
        prefix: Number prefix (e.g., 'LI', 'LO', 'CR', 'EX', 'SHP-IN')
        year: Year component (defaults to current UTC year). Used as sequence
              partition even when include_year=False.
        pad: Zero-padding width for the counter (default 4)
        separator: Character between prefix+year and counter (default '.')
        include_year: Whether to include the year in the formatted output (default True)
    """
    if year is None:
        year = datetime.now(timezone.utc).year

    org_id = str(organization_id)

    # Try the fast path: increment existing counter
    result = session.execute(
        text("""
            UPDATE collections.sequence_counters
            SET current_value = current_value + 1
            WHERE organization_id = :org_id AND prefix = :prefix AND year = :year
            RETURNING current_value
        """),
        {"org_id": org_id, "prefix": prefix, "year": year},
    )
    row = result.fetchone()

    if row:
        next_val = row[0]
    else:
        # First use: scan existing records to find the real max
        existing_max = _scan_max_existing(session, org_id, prefix, year, separator)
        start_value = existing_max + 1

        result = session.execute(
            text("""
                INSERT INTO collections.sequence_counters
                    (counter_id, organization_id, prefix, year, current_value)
                VALUES
                    (gen_random_uuid(), :org_id, :prefix, :year, :start_value)
                ON CONFLICT (organization_id, prefix, year)
                DO UPDATE SET current_value = collections.sequence_counters.current_value + 1
                RETURNING current_value
            """),
            {"org_id": org_id, "prefix": prefix, "year": year, "start_value": start_value},
        )
        next_val = result.scalar_one()

    if include_year:
        return f"{prefix}{year}{separator}{next_val:0{pad}d}"
    else:
        return f"{prefix}{separator}{next_val:0{pad}d}"

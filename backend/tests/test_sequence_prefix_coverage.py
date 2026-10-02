"""Guard: every draft-factory sequence prefix is mapped in the sequence service.

A prefix passed to next_sequential_number that's absent from _PREFIX_TABLE_MAP
makes the max-existing scan silently return 0, so the counter starts behind
reality and collides with seeded/existing rows (the ACQ2026.0001 duplicate-key
failure). This pins prefix ↔ map alignment so it can't drift again.
"""

from app.services.sequence import _PREFIX_TABLE_MAP
from app.services.drafts.factory.registry import ENTITY_DRAFT_SPECS


def test_every_draft_sequence_prefix_is_mapped():
    missing = [
        (spec.entity_type, spec.sequence_prefix)
        for spec in ENTITY_DRAFT_SPECS
        if spec.sequence_prefix and spec.sequence_prefix not in _PREFIX_TABLE_MAP
    ]
    assert not missing, (
        "draft sequence prefixes absent from _PREFIX_TABLE_MAP (scan returns 0 → "
        f"number collisions): {missing}"
    )

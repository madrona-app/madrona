"""Which draft-payload fields are entity references, and of what kind.

Single source of truth shared by:
- the draft form projection (so the inbox renders a picker + resolves a label
  instead of showing a UUID), and
- the draft tool schema (so a specialist passes the referenced entity's id, not
  a free-text name).

Conservative by design: only KNOWN reference fields get a kind. An unrecognised
``*_id`` (entry_id, part_id, reference_id, …) returns None and stays plain text.
"""

from __future__ import annotations

# form-registry lookup_category → reference kind the picker can search/resolve.
# (department has no picker yet → not mapped.)
KIND_BY_LOOKUP: dict[str, str] = {
    "collection_object": "object",
    "constituent": "constituent",
    "location": "location",
    "user": "user",
}

# *_id fields the form registry doesn't tag, inferred by name.
CONSTITUENT_REFS = frozenset({
    "source_id", "lender_id", "lender_contact_id", "lender_authorizer_id",
    "borrower_id", "borrower_contact_id", "venue_id", "valuator_id",
    "conservator_id", "recipient_id", "authorizer_id", "rights_holder_contact_id",
    "current_owner_id", "depositor_id", "examiner_id",
})
USER_REFS = frozenset({"requester_user_id"})


def reference_kind(name: str, lookup_category: str | None = None) -> str | None:
    """Return the reference kind for a field, or None if it isn't a (known)
    reference. Prefers an explicit form-registry lookup_category, else infers
    from the field name."""
    if lookup_category:
        return KIND_BY_LOOKUP.get(lookup_category)
    if name == "object_id":
        return "object"
    if name == "location_id" or name.endswith("_location_id"):
        return "location"
    if name in USER_REFS or name.endswith("_user_id"):
        return "user"
    if name in CONSTITUENT_REFS:
        return "constituent"
    return None

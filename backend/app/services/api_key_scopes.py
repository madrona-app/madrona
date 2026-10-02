"""
API key scope normalization.

All scope reading goes through normalize_scopes() which accepts any
legacy storage format and returns a canonical set of Permission-style names
(domain.action with dot separator).

This is the single source of truth for scope naming and aliasing.
"""

# Legacy scope names → canonical Permission-style names.
# Keys are old names found in existing DB rows and test fixtures.
_SCOPE_ALIASES: dict[str, str] = {
    # colon-separated legacy (resource:action)
    "media:read": "media.view",
    "media:write": "media.edit",
    # colon-separated legacy (action:resource — bridge era)
    "read:datasets": "data.view",
    "read:entities": "data.view",
    "read:changes": "data.view",
    "read:runs": "runs.view",
    "write:datasets": "data.manage",
    "write:entities": "data.manage",
    "run:execute": "runs.execute",
    # dot-separated legacy that don't match canonical Permission names
    "media.read": "media.view",
    "objects.read": "collections.view",
    "iiif.read": "media.view",
}

# Curated subset of Permission enum values that are safe to expose via API keys.
# Not everything in Permission is here — only scopes relevant to external integrations.
# Keys are canonical scope names; values are human-readable descriptions.
EXTERNAL_API_SCOPES: dict[str, str] = {
    "collections.view": "Search and view collection objects",
    "collections.edit": "Create and update collection objects",
    "media.view": "Access published media and IIIF manifests",
    "media.edit": "Upload and update media files",
    "exhibit.view": "View exhibitions, venues, and floor plans",
    "constituents.view": "View person and organization records",
    "loans.view": "View loan records",
    "data.view": "Read pipeline datasets and entities",
    "data.manage": "Write pipeline datasets and entities",
    "runs.view": "View pipeline run history",
    "runs.execute": "Trigger pipeline runs",
}


def normalize_scopes(raw: object) -> set[str]:
    """
    Accept any legacy scope storage format, return canonical set.

    Accepted inputs:
      {"media.view": True, "collections.view": True}   — canonical flat dict
      {"media:read": True, "media:write": True}         — legacy flat dict (colon names)
      {"scopes": ["media:read", "read:datasets"]}       — nested list (old create endpoint)
      ["media.read", "objects.read"]                     — plain list
      None / empty                                       — empty set

    Output: set of canonical scope names (domain.action format)
    """
    raw_names: list[str] = []

    if isinstance(raw, dict):
        if "scopes" in raw and isinstance(raw["scopes"], list):
            # Legacy nested format from old create endpoint
            raw_names = raw["scopes"]
        else:
            # Flat dict: keys are scope names, values are truthy/falsy
            raw_names = [k for k, v in raw.items() if v]
    elif isinstance(raw, list):
        raw_names = raw

    result: set[str] = set()
    for name in raw_names:
        if not isinstance(name, str):
            continue
        canonical = _SCOPE_ALIASES.get(name, name)
        result.add(canonical)

    return result


def has_scope(scopes: set[str], required: str) -> bool:
    """Check if a scope set contains the required scope (or wildcard).

    Wildcard ``*`` bypasses all scope checks at authorization time.
    Wildcard keys cannot be created via the API or UI — only via direct
    DB insert by a platform admin.
    """
    return "*" in scopes or required in scopes


def canonical_scopes_dict(scope_names: list[str]) -> dict[str, bool]:
    """Build the canonical storage format from a validated list of scope names.

    Resolves aliases and filters against the external allowlist.
    Rejects ``*`` — wildcard keys are not creatable via this path.

    Callers should validate scope_names against EXTERNAL_API_SCOPES first
    to give the user clear error messages. This function is a defensive
    second layer that silently drops anything not in the allowlist.
    """
    result: dict[str, bool] = {}
    for name in scope_names:
        if name == "*":
            continue
        canonical = _SCOPE_ALIASES.get(name, name)
        if canonical not in EXTERNAL_API_SCOPES:
            continue
        result[canonical] = True
    return result

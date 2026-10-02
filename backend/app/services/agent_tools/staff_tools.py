"""
Staff-only tools for the agent: vocabulary lookup, object history, cataloging suggestions,
and schema-aware field lookup.
"""

import logging
from difflib import SequenceMatcher
from uuid import UUID

from sqlalchemy import inspect as sa_inspect

from app.services.agent_tools import AgentContext, ToolRegistry

logger = logging.getLogger(__name__)

# 21 core fields across 7 categories for cataloging completeness
CATALOGING_FIELDS = {
    "identification": [
        "object_number",
        "object_name",
        "object_type",
    ],
    "description": [
        "brief_description",
        "full_description",
        "materials",
    ],
    "production": [
        "creators",
        "creation_date_display",
        "creation_place",
    ],
    "location": [
        "current_location_id",
        "home_location_id",
        "object_status",
    ],
    "condition": [
        "condition_rating",
        "condition_date",
        "completeness",
    ],
    "acquisition": [
        "acquisition_method",
        "acquisition_date",
        "credit_line",
    ],
    "public": [
        "titles",
        "is_discoverable",
        "subjects",
    ],
}


def lookup_vocabulary_term(args: dict, ctx: AgentContext) -> dict:
    """Search Getty and local vocabulary terms."""
    from app.services.vocabulary_service import VocabularyService

    query = args.get("query", "").strip()
    if not query:
        return {"error": "query is required"}

    vocabulary = args.get("vocabulary")  # aat, ulan, tgn, nomenclature, local, or None for all

    service = VocabularyService(ctx.db_session, ctx.organization_id)
    results = service.search(query, vocabulary=vocabulary, limit=5)

    terms = []
    for r in results:
        terms.append({
            "preferred_term": r.preferred_term,
            "scope_note": (r.scope_note or "")[:500] or None,
            "broader_term": r.broader_term,
            "hierarchy_path": r.hierarchy_path,
            "external_uri": r.external_uri,
            "vocabulary": r.vocabulary,
        })

    return {
        "query": query,
        "vocabulary_filter": vocabulary,
        "results": terms,
        "total": len(terms),
    }


def _resolve_object_id(args: dict, ctx: AgentContext) -> UUID | dict:
    """Resolve object_id or object_number to a UUID. Returns UUID or error dict.
    Falls back to the conversation's context entity if no identifier is provided."""
    from app.models import CollectionObject

    object_id = args.get("object_id")
    object_number = args.get("object_number")

    # Fall back to conversation context entity
    if not object_id and not object_number:
        if ctx.context_entity_type == 'collection_object' and ctx.context_entity_id:
            return ctx.context_entity_id
        return {"error": "Provide either object_id or object_number"}

    if object_id:
        try:
            return UUID(object_id)
        except (ValueError, TypeError):
            return {"error": f"Invalid object_id format: {object_id}"}

    obj = ctx.db_session.query(CollectionObject.object_id).filter(
        CollectionObject.organization_id == ctx.organization_id,
        CollectionObject.object_number == object_number,
    ).first()
    if not obj:
        return {"error": f"No object found with number '{object_number}'"}
    return obj.object_id


def get_object_history(args: dict, ctx: AgentContext) -> dict:
    """Get recent audit history for a collection object."""
    from app.models.core import EntityAuditEvent, EntityAuditFieldDiff

    resolved = _resolve_object_id(args, ctx)
    if isinstance(resolved, dict):
        return resolved
    oid = resolved

    limit = min(args.get("limit", 20), 50)

    events = (
        ctx.db_session.query(EntityAuditEvent)
        .filter(
            EntityAuditEvent.organization_id == ctx.organization_id,
            EntityAuditEvent.entity_type == "collection_object",
            EntityAuditEvent.entity_id == oid,
        )
        .order_by(EntityAuditEvent.changed_at.desc())
        .limit(limit)
        .all()
    )

    if not events:
        return {"object_id": str(oid), "events": [], "total": 0}

    results = []
    for ev in events:
        entry = {
            "date": str(ev.changed_at),
            "action": ev.change_type,
            "by": ev.changed_by_name or "System",
            "summary": ev.summary,
            "fields_changed": ev.changed_fields or [],
        }

        # Include up to 5 field diffs with truncated values
        diffs = []
        for fd in (ev.field_diffs or [])[:5]:
            old_val = str(fd.old_value) if fd.old_value is not None else None
            new_val = str(fd.new_value) if fd.new_value is not None else None
            diffs.append({
                "field": fd.field_name,
                "old": old_val[:200] if old_val else None,
                "new": new_val[:200] if new_val else None,
            })
        if diffs:
            entry["diffs"] = diffs

        results.append(entry)

    return {
        "object_id": str(oid),
        "events": results,
        "total": len(results),
    }


def suggest_cataloging(args: dict, ctx: AgentContext) -> dict:
    """Analyze cataloging completeness for a collection object."""
    from app.models import CollectionObject

    resolved = _resolve_object_id(args, ctx)
    if isinstance(resolved, dict):
        return resolved
    oid = resolved

    obj = ctx.db_session.query(CollectionObject).filter(
        CollectionObject.object_id == oid,
        CollectionObject.organization_id == ctx.organization_id,
    ).first()

    if not obj:
        return {"error": "Object not found"}

    filled_total = 0
    total_fields = 0
    categories = {}
    empty_fields = []

    for category, fields in CATALOGING_FIELDS.items():
        filled = 0
        for field_name in fields:
            total_fields += 1
            value = getattr(obj, field_name, None)
            # Consider a field "filled" if it has a truthy value
            # (handles None, empty string, empty list, False, etc.)
            if value:
                filled += 1
                filled_total += 1
            else:
                empty_fields.append(field_name)
        categories[category] = {
            "filled": filled,
            "total": len(fields),
        }

    score = round((filled_total / total_fields) * 100) if total_fields else 0

    return {
        "object_id": str(oid),
        "object_number": obj.object_number,
        "object_name": obj.object_name,
        "completeness_score": score,
        "filled": filled_total,
        "total": total_fields,
        "categories": categories,
        "empty_recommended_fields": empty_fields,
    }


def _resolve_entity(args: dict, ctx: AgentContext) -> tuple[str, UUID] | dict:
    """Resolve entity_type and entity_id from args or context.

    Returns (entity_type, entity_id) or an error dict.
    """
    entity_type = args.get("entity_type") or ctx.context_entity_type
    entity_id_str = args.get("entity_id")

    if entity_id_str:
        try:
            entity_id = UUID(entity_id_str)
        except (ValueError, TypeError):
            return {"error": f"Invalid entity_id format: {entity_id_str}"}
    elif ctx.context_entity_id:
        entity_id = ctx.context_entity_id
    else:
        return {"error": "No record specified and no page context available. Tell me which record you need help with."}

    if not entity_type:
        return {"error": "No entity type specified and no page context available."}

    return entity_type, entity_id


def _format_field_value(value, field_meta) -> str | None:
    """Format a field value for display. Returns None for empty values."""
    if value is None:
        return None
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (list, dict)):
        if not value:
            return None
        return str(value)
    val_str = str(value).strip()
    return val_str if val_str else None


def _resolve_contact_name(db_session, contact_id, organization_id) -> str | None:
    """Look up a constituent display name from a contact FK."""
    if not contact_id:
        return None
    from app.models.contacts import Constituent
    row = db_session.query(Constituent.display_name).filter(
        Constituent.constituent_id == contact_id,
        Constituent.organization_id == organization_id,
    ).first()
    return row.display_name if row else None


def get_record_summary(args: dict, ctx: AgentContext) -> dict:
    """Get the current state of a record — fields, completion, and next-status requirements."""
    from app.services.agent_tools.form_registry import FORM_REGISTRY, get_entity_model_map

    resolved = _resolve_entity(args, ctx)
    if isinstance(resolved, dict):
        return resolved
    entity_type, entity_id = resolved

    form_def = FORM_REGISTRY.get(entity_type)
    if not form_def:
        return {"error": f"Unknown entity type: {entity_type}"}

    entity_model_map = get_entity_model_map()
    if entity_type not in entity_model_map:
        return {"error": f"No model mapping for entity type: {entity_type}"}

    model_cls, pk_field, number_field = entity_model_map[entity_type]

    entity = ctx.db_session.query(model_cls).filter(
        getattr(model_cls, pk_field) == entity_id,
        model_cls.organization_id == ctx.organization_id,
    ).first()

    if not entity:
        return {"error": f"{form_def.entity_label} record not found"}

    # Build sections with field values
    sections = []
    current_section = None
    current_section_fields = []
    filled_count = 0
    total_count = 0
    empty_optional = []

    for field in form_def.fields:
        # Start new section if needed
        if field.section != (current_section or ""):
            if current_section is not None:
                sections.append({"title": current_section, "fields": current_section_fields})
            current_section = field.section
            current_section_fields = []

        raw_value = getattr(entity, field.name, None)
        total_count += 1

        # Resolve contact FKs to display names
        display_value = None
        if field.field_type == 'contact' and raw_value:
            contact_name = _resolve_contact_name(
                ctx.db_session, raw_value, ctx.organization_id,
            )
            display_value = contact_name or str(raw_value)
        else:
            display_value = _format_field_value(raw_value, field)

        is_filled = display_value is not None
        if is_filled:
            filled_count += 1
        elif not field.required:
            empty_optional.append(field.name)

        current_section_fields.append({
            "name": field.name,
            "label": field.label,
            "value": display_value,
            "filled": is_filled,
            "required": field.required,
        })

    # Flush last section
    if current_section is not None:
        sections.append({"title": current_section, "fields": current_section_fields})

    # Record identifier
    identifier = (
        getattr(entity, number_field, None) if number_field else None
    ) or str(entity_id)

    # Current status
    current_status = getattr(entity, 'status', None)
    current_status_label = None
    if current_status:
        current_status_label = form_def.status_labels.get(current_status, current_status)

    # Determine next status and missing fields
    next_status_info = None
    if current_status and form_def.statuses:
        try:
            current_idx = form_def.statuses.index(current_status)
            if current_idx + 1 < len(form_def.statuses):
                next_status = form_def.statuses[current_idx + 1]
                # Find matching status requirement
                req = None
                for sr in form_def.status_requirements:
                    if sr.target_status == next_status:
                        req = sr
                        break

                if req:
                    missing = []
                    missing_labels = []
                    for req_field in req.required_fields:
                        val = getattr(entity, req_field, None)
                        if val is None or (isinstance(val, str) and not val.strip()):
                            missing.append(req_field)
                            # Find label from fields
                            label = req_field
                            for f in form_def.fields:
                                if f.name == req_field:
                                    label = f.label
                                    break
                            missing_labels.append(label)

                    next_status_info = {
                        "target": next_status,
                        "target_label": form_def.status_labels.get(next_status, next_status),
                        "missing_fields": missing,
                        "missing_labels": missing_labels,
                    }
                else:
                    next_status_info = {
                        "target": next_status,
                        "target_label": form_def.status_labels.get(next_status, next_status),
                        "missing_fields": [],
                        "missing_labels": [],
                    }
        except ValueError:
            pass  # Current status not in ordered list

    percentage = round((filled_count / total_count) * 100) if total_count else 0

    result = {
        "entity_type": entity_type,
        "entity_label": form_def.entity_label,
        "procedure": form_def.procedure,
        "record_identifier": identifier,
        "current_status": current_status,
        "current_status_label": current_status_label,
        "sections": sections,
        "completion": {
            "filled": filled_count,
            "total": total_count,
            "percentage": percentage,
        },
    }

    if next_status_info:
        result["next_status"] = next_status_info

    if empty_optional:
        result["empty_recommended_fields"] = empty_optional[:20]  # Cap to avoid bloat

    return result


# Columns to exclude from field lookup — infrastructure, not user-facing
_EXCLUDED_COLUMNS = {
    "organization_id", "created_at", "created_by", "updated_at", "updated_by",
    "is_deleted", "deleted_at", "deleted_by", "version", "last_synced_at",
}

# Map SQLAlchemy type class names to UI field types
_SA_TYPE_MAP = {
    "VARCHAR": "text", "TEXT": "text", "String": "text",
    "DATE": "date", "Date": "date", "DATETIME": "date", "DateTime": "date",
    "BOOLEAN": "boolean", "Boolean": "boolean",
    "INTEGER": "integer", "Integer": "integer",
    "NUMERIC": "currency", "Numeric": "currency",
    "JSON": "json", "JSONB": "json",
}


def _auto_label(column_name: str) -> str:
    """Convert snake_case column name to a human label: 'insurance_policy' → 'Insurance policy'."""
    return column_name.replace("_", " ").capitalize()


def _infer_field_type(col) -> str:
    """Infer a UI field type from a SQLAlchemy column."""
    type_name = type(col.type).__name__
    if type_name in _SA_TYPE_MAP:
        return _SA_TYPE_MAP[type_name]
    # UUID columns with a FK are likely contacts/references
    if type_name == "UUID" and col.foreign_keys:
        return "contact"
    return "text"


def _get_introspected_fields(entity_type: str) -> list[dict] | None:
    """Get all user-facing fields for an entity type via hybrid introspection.

    Cross-references SQLAlchemy model columns with FORM_REGISTRY metadata.
    Returns None if the entity type is unknown.
    """
    from app.services.agent_tools.form_registry import FORM_REGISTRY, get_entity_model_map

    entity_model_map = get_entity_model_map()
    if entity_type not in entity_model_map:
        return None

    model_cls, pk_field, _ = entity_model_map[entity_type]
    form_def = FORM_REGISTRY.get(entity_type)

    # Build a lookup from field name → FieldMeta for quick cross-reference
    registry_fields = {}
    if form_def:
        for fm in form_def.fields:
            registry_fields[fm.name] = fm

    mapper = sa_inspect(model_cls)
    fields = []

    for col in mapper.columns:
        name = col.name
        # Skip infrastructure columns and primary keys
        if name in _EXCLUDED_COLUMNS or name == pk_field:
            continue

        if name in registry_fields:
            # Use curated metadata from form registry
            fm = registry_fields[name]
            fields.append({
                "name": fm.name,
                "label": fm.label,
                "section": fm.section,
                "field_type": fm.field_type,
                "required": fm.required,
                "enum_values": fm.enum_values,
                "registered": True,
            })
        else:
            # Auto-generate from SQLAlchemy column
            fields.append({
                "name": name,
                "label": _auto_label(name),
                "section": "other",
                "field_type": _infer_field_type(col),
                "required": not col.nullable and col.default is None,
                "enum_values": None,
                "registered": False,
            })
            logger.warning(
                "Field '%s' on %s not in form registry — auto-generated metadata",
                name, entity_type,
            )

    return fields


def _score_field(query_tokens: list[str], field: dict, entity_label: str, procedure: str) -> float:
    """Score a field's relevance to a search query."""
    score = 0.0
    searchable = [
        field["label"].lower(),
        field["section"].lower(),
        entity_label.lower(),
        procedure.lower(),
    ]
    for token in query_tokens:
        for text in searchable:
            if token in text:
                score += 1.0
                break
            ratio = SequenceMatcher(None, token, text).ratio()
            if ratio > 0.6:
                score += ratio
                break
    return score


def lookup_madrona_field(args: dict, ctx: AgentContext) -> dict:
    """Search Madrona's form definitions to find where information is recorded."""
    import logging
    logger = logging.getLogger(__name__)
    logger.info("lookup_madrona_field called with args: %s", args)

    from app.services.agent_tools.form_registry import FORM_REGISTRY

    query = args.get("query", "").strip().lower()
    entity_type_filter = args.get("entity_type", "").strip().lower() or None
    target_status = args.get("target_status", "").strip().lower() or None
    required_only = args.get("required_only", False)

    if not query and not entity_type_filter:
        return {"error": "Provide at least 'query' or 'entity_type'."}

    # Validate entity_type if provided
    if entity_type_filter and entity_type_filter not in FORM_REGISTRY:
        return {"error": f"Unknown entity type: '{entity_type_filter}'. Valid types: {', '.join(sorted(FORM_REGISTRY.keys()))}"}

    entity_types = [entity_type_filter] if entity_type_filter else list(FORM_REGISTRY.keys())

    # --- Overview mode: entity_type given, no query ---
    if not query:
        form_def = FORM_REGISTRY[entity_type_filter]
        fields = _get_introspected_fields(entity_type_filter) or []

        if required_only:
            fields = [f for f in fields if f.get("required")]

        # Group by section
        sections: dict[str, list] = {}
        for f in fields:
            sec = f["section"]
            if sec not in sections:
                sections[sec] = []
            entry = {"name": f["name"], "label": f["label"], "type": f["field_type"]}
            if f.get("required"):
                entry["required"] = True
            if f.get("enum_values"):
                entry["enum_values"] = f["enum_values"]
            sections[sec].append(entry)

        result = {
            "entity_type": entity_type_filter,
            "entity_label": form_def.entity_label,
            "procedure": form_def.procedure,
            "statuses": [
                {"status": s, "label": form_def.status_labels.get(s, s)}
                for s in form_def.statuses
            ],
            "sections": [
                {"title": sec_name, "fields": sec_fields}
                for sec_name, sec_fields in sections.items()
            ],
        }

        if form_def.status_requirements:
            # Don't pre-filter when target_status is set — the merge
            # logic below needs ALL statuses to collect requirements
            # from the target onwards (matching frontend behavior).
            reqs = form_def.status_requirements
            if not target_status:
                result["status_requirements"] = [
                    {
                        "target_status": sr.target_status,
                        "label": sr.target_status_label,
                        "required_fields": sr.required_fields,
                    }
                    for sr in reqs
                ]

        # When target_status is set, return a focused response with
        # field labels and section names so Guide can narrate "in the
        # People section" rather than raw field paths.
        #
        # Matches the frontend's computeProcedureCompliance behavior:
        # collect requirements for ALL statuses from the target onwards
        # (not just the exact target). This way "what's blocking for
        # in_transit?" includes fields needed for later statuses like
        # "acknowledged" — same as what the requirements card shows.
        if target_status:
            from app.services.procedure_requirements import PROCEDURE_REQUIREMENTS
            from app.services.agent_tools.form_registry import _ENTITY_PROCEDURE_MAP
            field_lookup = {f.name: f for f in form_def.fields}

            # Determine which statuses are at-or-after the target.
            proc_keys = _ENTITY_PROCEDURE_MAP.get(entity_type_filter, [entity_type_filter])
            relevant_statuses = {target_status}
            for key in proc_keys:
                proc = PROCEDURE_REQUIREMENTS.get(key)
                if proc:
                    order = proc.status_order
                    idx = order.index(target_status) if target_status in order else -1
                    if idx >= 0:
                        relevant_statuses.update(order[idx:])

            # Merge blocking fields across all relevant statuses, deduped.
            # Works directly with StatusRequirement dataclass objects
            # (not serialized dicts) since we skipped serialization above.
            merged_fields: dict[str, dict] = {}
            target_label = target_status.replace("_", " ").title()
            for sr in reqs:
                if sr.target_status in relevant_statuses:
                    if sr.target_status == target_status:
                        target_label = sr.target_status_label
                    for fp in sr.required_fields:
                        if fp not in merged_fields:
                            fm = field_lookup.get(fp)
                            merged_fields[fp] = {
                                "field_path": fp,
                                "label": fm.label if fm else fp.replace("_", " ").title(),
                                "section": fm.section if fm else "unknown",
                            }

            if merged_fields:
                # Deduplicated section hints for the frontend to render
                # "Jump to {section}" buttons under the Guide answer.
                seen_sections: set[str] = set()
                section_hints = []
                for field_info in merged_fields.values():
                    sec = field_info.get("section", "unknown")
                    if sec != "unknown" and sec not in seen_sections:
                        seen_sections.add(sec)
                        section_hints.append({
                            "sectionId": sec,
                            "label": sec.replace("_", " ").title(),
                            "fieldPath": field_info["field_path"],
                        })

                return {
                    "entity_type": entity_type_filter,
                    "entity_label": form_def.entity_label,
                    "target_status": target_status,
                    "target_status_label": target_label,
                    "required_fields": list(merged_fields.values()),
                    "_section_hints": section_hints,
                    "note": (
                        f"Includes requirements for {target_status} and all "
                        f"subsequent statuses ({', '.join(sorted(relevant_statuses))})."
                    ),
                }
            else:
                return {
                    "entity_type": entity_type_filter,
                    "entity_label": form_def.entity_label,
                    "target_status": target_status,
                    "required_fields": [],
                    "note": "No blocking requirements defined for this status or any subsequent status.",
                }

        return result

    # --- Search mode: query given ---
    query_tokens = query.split()
    scored_results = []

    for et in entity_types:
        form_def = FORM_REGISTRY[et]
        fields = _get_introspected_fields(et) or []

        for f in fields:
            if required_only and not f.get("required"):
                continue

            score = _score_field(query_tokens, f, form_def.entity_label, form_def.procedure)
            if score > 0:
                scored_results.append((score, {
                    "entity_type": et,
                    "entity_label": form_def.entity_label,
                    "procedure": form_def.procedure,
                    "field_name": f["name"],
                    "field_label": f["label"],
                    "section": f["section"],
                    "field_type": f["field_type"],
                    "required": f.get("required", False),
                }))

    # Sort by score descending, return top 15
    scored_results.sort(key=lambda x: x[0], reverse=True)
    results = [r for _, r in scored_results[:15]]

    return {
        "query": query,
        "results": results,
        "total": len(results),
    }


def lookup_staff(args: dict, ctx: AgentContext) -> dict:
    """Find org staff to direct work to (e.g. route an approval). Optionally
    filter to holders of a permission so only valid approvers are offered.
    Returns candidates — the agent should confirm with the user before routing."""
    from sqlalchemy import or_

    from app.models import OrganizationMembership, User

    query = (args.get("query") or "").strip()
    permission = args.get("permission")
    session = ctx.db_session

    q = (
        session.query(User)
        .join(OrganizationMembership, OrganizationMembership.user_id == User.user_id)
        .filter(
            OrganizationMembership.organization_id == ctx.organization_id,
            OrganizationMembership.status == "active",
        )
    )
    if query:
        like = f"%{query}%"
        q = q.filter(or_(User.display_name.ilike(like), User.email.ilike(like)))
    users = q.limit(25).all()

    if permission:
        from app.services.rbac_service import check_permission

        users = [
            u
            for u in users
            if check_permission(u.user_id, ctx.organization_id, permission, session=session)
        ]
    return {
        "staff": [
            {
                "user_id": str(u.user_id),
                "display_name": u.display_name,
                "email": u.email,
            }
            for u in users[:10]
        ]
    }


def register_staff_tools(registry: ToolRegistry) -> None:
    """Register staff-only tools with the registry."""
    registry.register(
        name="lookup_staff",
        description=(
            "Find staff members in this organization to direct work to — e.g. to "
            "route an approval to a specific person. Optionally filter to people "
            "who hold a permission so you only offer valid approvers. Returns "
            "candidates; ALWAYS confirm the person with the user before routing."
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Name or email fragment to search for",
                },
                "permission": {
                    "type": "string",
                    "description": "Optional: only staff who hold this permission (e.g. 'conservation.approve')",
                },
            },
        },
        handler=lookup_staff,
        personas=["staff"],
    )
    registry.register(
        name="lookup_vocabulary_term",
        description=(
            "Search for controlled vocabulary terms from the Art & Architecture "
            "Thesaurus (AAT), Union List of Artist Names (ULAN), or Thesaurus of "
            "Geographic Names (TGN). Use this when someone asks about correct "
            "terminology, classification terms, or wants to find the standard name "
            "for a material, technique, style, place, or person."
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The term to search for (e.g. 'terracotta', 'oil painting', 'Impressionism')",
                },
                "vocabulary": {
                    "type": "string",
                    "description": "Limit to a specific vocabulary: 'aat' (objects, materials, techniques, styles), 'ulan' (artists/people), 'tgn' (places), or 'nomenclature' (AASLH object classification for history museums). Omit to search all.",
                    "enum": ["aat", "ulan", "tgn", "nomenclature"],
                },
            },
            "required": ["query"],
        },
        handler=lookup_vocabulary_term,
        personas=["staff", "guide"],
    )

    registry.register(
        name="get_object_history",
        description=(
            "Get the audit history for a collection object — what changed, when, "
            "and by whom. Shows recent edits with field-level diffs. Use this when "
            "someone asks what's been changed on an object recently."
        ),
        parameters={
            "type": "object",
            "properties": {
                "object_id": {
                    "type": "string",
                    "description": "The UUID of the collection object",
                },
                "object_number": {
                    "type": "string",
                    "description": "The accession/object number (e.g. 'MET-436532')",
                },
                "limit": {
                    "type": "integer",
                    "description": "Max events to return (1-50, default 20)",
                },
            },
        },
        handler=get_object_history,
        personas=["staff"],
    )

    registry.register(
        name="suggest_cataloging",
        description=(
            "Analyze a collection object's cataloging completeness. Checks 21 core "
            "fields across 7 categories (identification, description, production, "
            "location, condition, acquisition, public) and reports which fields are "
            "empty. Use when someone asks what needs work on an object's record."
        ),
        parameters={
            "type": "object",
            "properties": {
                "object_id": {
                    "type": "string",
                    "description": "The UUID of the collection object",
                },
                "object_number": {
                    "type": "string",
                    "description": "The accession/object number (e.g. 'MET-436532')",
                },
            },
        },
        handler=suggest_cataloging,
        personas=["staff"],
    )

    registry.register(
        name="get_record_summary",
        description=(
            "Get the current state of a record the user is working on — shows all "
            "fields, what's filled, what's empty, current status, and what's needed "
            "to advance to the next status. Use this when helping someone fill out a "
            "form or understand what to do next. Works with any record type: loans, "
            "entries, condition reports, acquisitions, conservation treatments, and more."
        ),
        parameters={
            "type": "object",
            "properties": {
                "entity_type": {
                    "type": "string",
                    "description": (
                        "The type of record (e.g. 'loan_in', 'object_entry', 'condition_report'). "
                        "Defaults to the record the user is currently viewing."
                    ),
                },
                "entity_id": {
                    "type": "string",
                    "description": "The UUID of the record. Defaults to the record the user is currently viewing.",
                },
            },
        },
        handler=get_record_summary,
        personas=["staff"],
    )

    registry.register(
        name="lookup_madrona_field",
        description=(
            "Search Madrona's form definitions to find where a specific piece of "
            "information is recorded, what fields exist on a record type, or what's "
            "required for a workflow status. Use this when someone asks 'where do I "
            "put X?', 'what fields does Y have?', or 'what's required for Z?'. "
            "Does NOT need a specific record — it searches the form structure itself.\n\n"
            "THREE MODES:\n"
            "1. Status requirements: pass entity_type + target_status to get ONLY "
            "the blocking fields for that specific status. Best for 'what's required "
            "for approved?' questions.\n"
            "2. Overview mode: pass entity_type WITHOUT query to get all fields, "
            "statuses, and status_requirements. "
            "Add required_only=true to filter to required fields only.\n"
            "3. Search mode: pass query to search across all entity types (optionally "
            "filtered by entity_type).\n\n"
            "For 'what's required for status X?' questions, ALWAYS use mode 1 "
            "(entity_type + target_status). It returns a focused answer."
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": (
                        "Free-text search across field labels, section names, entity "
                        "labels, and procedure names. E.g. 'insurance policy', "
                        "'donor tax ID', 'conservation treatment'."
                    ),
                },
                "entity_type": {
                    "type": "string",
                    "description": (
                        "Filter to a specific entity type. One of: object_entry, "
                        "acquisition, loan_in, loan_out, condition_report, conservation, "
                        "object_exit, movement, collection_object, deaccession, "
                        "use_request, valuation, incident_report, right, "
                        "reproduction_request."
                    ),
                },
                "target_status": {
                    "type": "string",
                    "description": (
                        "When asking what's required for a specific status, pass the "
                        "status key (e.g. 'approved', 'received', 'closed'). "
                        "Returns ONLY the blocking fields for that status — much more "
                        "focused than the full overview. Requires entity_type."
                    ),
                },
                "required_only": {
                    "type": "boolean",
                    "description": "If true, only return required fields. In overview mode (no query), the response always includes status_requirements regardless of this flag.",
                },
            },
        },
        handler=lookup_madrona_field,
        personas=["staff", "guide"],
    )

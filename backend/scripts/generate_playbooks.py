"""
Auto-generate skeleton playbooks from the procedure requirements + form registry.

Produces markdown files for entity types that don't already have a
hand-authored playbook. The output is a starting point — accurate on
fields and statuses, but missing the conversational tone, procedures
rationale, and "common pitfalls" that hand-authored playbooks have.

Usage:
    cd backend
    ./venv/bin/python scripts/generate_playbooks.py

    # Preview without writing files:
    ./venv/bin/python scripts/generate_playbooks.py --dry-run

    # Generate for a specific entity type:
    ./venv/bin/python scripts/generate_playbooks.py --entity use_request
"""

import argparse
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.agent_tools.form_registry import FORM_REGISTRY
from app.services.procedure_requirements import PROCEDURE_REQUIREMENTS


PLAYBOOKS_DIR = Path(__file__).parent.parent / "playbooks"

# Entity types that already have hand-authored playbooks.
# Keyed on the procedure_type, not the entity_type.
HAND_AUTHORED = {
    "object_entry", "acquisition", "loan_in", "loan_out",
    "condition_report", "conservation", "movement",
    "incident_report", "deaccession", "object_exit",
    "valuation", "right", "collection_object",
}

# Map entity_type to a human-friendly filename slug
SLUG_MAP = {
    "use_request": "process_use_request",
    "reproduction_request": "process_reproduction_request",
    "insurance": "manage_insurance_policy",
    "indemnity": "manage_indemnity_arrangement",
    "collections_review": "run_collections_review",
    "doc_plan": "create_documentation_plan",
}


def _friendly_name(key: str) -> str:
    return key.replace("_", " ").replace("-", " ").title()


def _generate_playbook(entity_type: str) -> str | None:
    """Generate a markdown playbook skeleton for an entity type."""
    form_def = FORM_REGISTRY.get(entity_type)
    if not form_def:
        return None

    title = form_def.entity_label
    procedure = form_def.procedure

    # Get procedure requirements if available
    # Try both entity_type and common aliases
    proc = PROCEDURE_REQUIREMENTS.get(entity_type)
    if not proc:
        # Try removing common prefixes
        for alias in [entity_type, entity_type.replace("_policy", ""),
                      entity_type.replace("_arrangement", "")]:
            proc = PROCEDURE_REQUIREMENTS.get(alias)
            if proc:
                break

    lines = [f"# {title}\n"]
    lines.append(f"*Auto-generated from the Madrona form registry and procedure requirements. "
                 f"Edit this file to add institutional context, procedure rationale, and common pitfalls.*\n")

    # procedure name
    if procedure:
        lines.append(f"procedure: **{procedure}**\n")

    # Status order
    if proc and proc.status_order:
        lines.append("## Workflow statuses\n")
        for i, status in enumerate(proc.status_order):
            marker = "→" if i > 0 else " "
            lines.append(f"{marker} **{_friendly_name(status)}** (`{status}`)")
        lines.append("")

    # Fields by section
    if form_def.fields:
        lines.append("## Fields\n")
        sections: dict[str, list] = {}
        for f in form_def.fields:
            sections.setdefault(f.section, []).append(f)

        for section_name, fields in sections.items():
            lines.append(f"### {_friendly_name(section_name)}\n")
            for f in fields:
                req_marker = " *(required)*" if f.required else ""
                lines.append(f"- **{f.label}**{req_marker} — `{f.name}` ({f.field_type})")
            lines.append("")

    # Status requirements
    if form_def.status_requirements:
        lines.append("## Requirements by status\n")
        for sr in form_def.status_requirements:
            lines.append(f"### To reach {sr.target_status_label} (`{sr.target_status}`)\n")
            for fp in sr.required_fields:
                # Try to find the field label
                field_meta = next((f for f in form_def.fields if f.name == fp), None)
                label = field_meta.label if field_meta else _friendly_name(fp)
                lines.append(f"- {label} (`{fp}`)")
            lines.append("")

    # procedure requirement groups with help text
    if proc:
        lines.append("## Procedure requirement details\n")
        for group in proc.requirement_groups:
            lines.append(f"### {group.label}\n")
            for req in group.requirements:
                severity_badge = f"[{req.severity}]"
                lines.append(f"- **{req.label}** {severity_badge}")
                if req.help_text:
                    lines.append(f"  {req.help_text}")
                if req.required_for_statuses:
                    statuses = ", ".join(req.required_for_statuses)
                    lines.append(f"  *Required for: {statuses}*")
            lines.append("")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Generate skeleton playbooks from form registry + procedure requirements."
    )
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing files")
    parser.add_argument("--entity", help="Generate for a specific entity type only")
    parser.add_argument("--force", action="store_true", help="Overwrite existing playbooks")
    args = parser.parse_args()

    PLAYBOOKS_DIR.mkdir(parents=True, exist_ok=True)

    entity_types = [args.entity] if args.entity else sorted(FORM_REGISTRY.keys())
    generated = 0
    skipped = 0

    for entity_type in entity_types:
        slug = SLUG_MAP.get(entity_type, entity_type)
        output_path = PLAYBOOKS_DIR / f"{slug}.md"

        # Skip hand-authored playbooks unless --force
        if output_path.exists() and not args.force:
            skipped += 1
            continue

        # Skip entity types that already have hand-authored playbooks
        # (check the procedure type mapping too)
        if entity_type in HAND_AUTHORED and not args.force:
            skipped += 1
            continue

        content = _generate_playbook(entity_type)
        if not content:
            continue

        if args.dry_run:
            print(f"\n{'='*60}")
            print(f"Would write: {output_path}")
            print(f"{'='*60}")
            print(content[:500])
            if len(content) > 500:
                print(f"... ({len(content)} chars total)")
        else:
            output_path.write_text(content)
            print(f"  Generated: {output_path.name}")

        generated += 1

    print(f"\n{'[DRY RUN] ' if args.dry_run else ''}Generated: {generated}, Skipped: {skipped}")
    if not args.dry_run and generated > 0:
        print(f"\nNext: run the ingest to embed the new playbooks:")
        print(f"  ./venv/bin/python scripts/ingest_references.py --source playbook")


if __name__ == "__main__":
    main()

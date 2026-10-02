"""
Procedure Requirements — Single Source of Truth

Dataclass-based definitions of every procedure's requirements,
groups, severity levels, and status gates. Used by:
- Backend status-transition validation
- API endpoint that serves requirements to the frontend
- Form registry for deriving per-status field lists

Each procedure module registers itself in PROCEDURE_REQUIREMENTS on import.
"""
from __future__ import annotations

from dataclasses import dataclass, field


# ---------------------------------------------------------------------------
# Core dataclasses
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ProcedureRequirement:
    id: str
    label: str
    group_id: str
    field_paths: list[str]
    required_for_statuses: list[str]
    severity: str  # "blocking" | "recommended" | "info"
    help_text: str = ""
    has_predicate: bool = False  # True if frontend needs custom predicate logic


@dataclass(frozen=True)
class ProcedureRequirementGroup:
    id: str
    label: str
    section_id: str
    requirements: list[ProcedureRequirement] = field(default_factory=list)


@dataclass(frozen=True)
class ProcedureRequirements:
    procedure_type: str
    procedure_label: str
    procedure: str  # the procedure name
    status_order: list[str]
    requirement_groups: list[ProcedureRequirementGroup] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Serialization
# ---------------------------------------------------------------------------

def requirement_to_dict(req: ProcedureRequirement) -> dict:
    d = {
        "id": req.id,
        "label": req.label,
        "groupId": req.group_id,
        "fieldPaths": req.field_paths,
        "requiredForStatuses": req.required_for_statuses,
        "severity": req.severity,
    }
    if req.help_text:
        d["helpText"] = req.help_text
    if req.has_predicate:
        d["hasPredicate"] = True
    return d


def group_to_dict(group: ProcedureRequirementGroup) -> dict:
    return {
        "id": group.id,
        "label": group.label,
        "sectionId": group.section_id,
        "requirements": [requirement_to_dict(r) for r in group.requirements],
    }


def procedure_to_dict(proc: ProcedureRequirements) -> dict:
    return {
        "procedureType": proc.procedure_type,
        "procedureLabel": proc.procedure_label,
        "procedureProcedure": proc.procedure,
        "statusOrder": proc.status_order,
        "requirementGroups": [group_to_dict(g) for g in proc.requirement_groups],
    }


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

PROCEDURE_REQUIREMENTS: dict[str, ProcedureRequirements] = {}


def _register(proc: ProcedureRequirements) -> ProcedureRequirements:
    """Register a ProcedureRequirements and return it."""
    PROCEDURE_REQUIREMENTS[proc.procedure_type] = proc
    return proc


# ---------------------------------------------------------------------------
# Status-requirement derivation helper
# ---------------------------------------------------------------------------

@dataclass
class StatusFieldRequirement:
    """A single field required for a specific status."""
    field_path: str
    requirement_id: str
    severity: str
    has_predicate: bool = False


def derive_status_requirements(
    procedure_type: str,
) -> dict[str, list[StatusFieldRequirement]]:
    """Invert field->statuses into status->fields for the form registry.

    Returns a dict keyed by status, where each value is a list of
    StatusFieldRequirement objects describing what fields that status needs.
    """
    proc = PROCEDURE_REQUIREMENTS.get(procedure_type)
    if proc is None:
        return {}

    result: dict[str, list[StatusFieldRequirement]] = {}
    for group in proc.requirement_groups:
        for req in group.requirements:
            for status in req.required_for_statuses:
                if status not in result:
                    result[status] = []
                for fp in req.field_paths:
                    result[status].append(
                        StatusFieldRequirement(
                            field_path=fp,
                            requirement_id=req.id,
                            severity=req.severity,
                            has_predicate=req.has_predicate,
                        )
                    )
    return result


# ---------------------------------------------------------------------------
# Import all procedure modules to populate PROCEDURE_REQUIREMENTS
# ---------------------------------------------------------------------------

from app.services.procedure_requirements.object_entry import OBJECT_ENTRY_REQUIREMENTS  # noqa: E402, F401
from app.services.procedure_requirements.acquisition import ACQUISITION_REQUIREMENTS  # noqa: E402, F401
from app.services.procedure_requirements.loan_in import LOAN_IN_REQUIREMENTS  # noqa: E402, F401
from app.services.procedure_requirements.loan_out import LOAN_OUT_REQUIREMENTS  # noqa: E402, F401
from app.services.procedure_requirements.object_exit import OBJECT_EXIT_REQUIREMENTS  # noqa: E402, F401
from app.services.procedure_requirements.deaccession import DEACCESSION_REQUIREMENTS  # noqa: E402, F401
from app.services.procedure_requirements.movement import MOVEMENT_REQUIREMENTS  # noqa: E402, F401
from app.services.procedure_requirements.doc_plan import DOC_PLAN_REQUIREMENTS  # noqa: E402, F401
from app.services.procedure_requirements.inventory import INVENTORY_REQUIREMENTS, CATALOGING_REQUIREMENTS  # noqa: E402, F401
from app.services.procedure_requirements.condition_checking import CONDITION_CHECKING_REQUIREMENTS  # noqa: E402, F401
from app.services.procedure_requirements.conservation import CONSERVATION_REQUIREMENTS  # noqa: E402, F401
from app.services.procedure_requirements.collections_review import COLLECTIONS_REVIEW_REQUIREMENTS  # noqa: E402, F401
from app.services.procedure_requirements.damage_loss import DAMAGE_LOSS_REQUIREMENTS  # noqa: E402, F401
from app.services.procedure_requirements.insurance_indemnity import INSURANCE_REQUIREMENTS  # noqa: E402, F401
from app.services.procedure_requirements.indemnity import INDEMNITY_REQUIREMENTS  # noqa: E402, F401
from app.services.procedure_requirements.reproduction import REPRODUCTION_REQUIREMENTS  # noqa: E402, F401
from app.services.procedure_requirements.valuation import VALUATION_REQUIREMENTS  # noqa: E402, F401

__all__ = [
    "ProcedureRequirement",
    "ProcedureRequirementGroup",
    "ProcedureRequirements",
    "StatusFieldRequirement",
    "PROCEDURE_REQUIREMENTS",
    "derive_status_requirements",
    "procedure_to_dict",
    "group_to_dict",
    "requirement_to_dict",
]

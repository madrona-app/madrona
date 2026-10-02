"""Typed payload for a `condition_report` draft (Guide Studio v1 Phase 1).

The proposable subset of the live ConditionReport create shape
(`app/models/objects.py::ConditionReport`). `extra='forbid'` rejects any field
the model invents — a hallucinated key fails validation at draft creation
rather than silently surviving into the audit trail.
"""

from datetime import date
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# Mirror the live condition_reports CHECK constraints so an out-of-range value
# fails at draft creation (a clear tool error), not at apply time (a buried
# CheckViolation). Source: app/models/objects.py::ConditionReport.__table_args__.
ReportType = Literal[
    "intake",
    "loan_out",
    "loan_in",
    "loan_return",
    "periodic",
    "conservation",
    "incident",
    "pre_treatment",
    "post_treatment",
]
OverallCondition = Literal["excellent", "good", "fair", "poor", "unacceptable"]


class ConditionReportDraftPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Target + required core
    object_id: UUID = Field(..., description="The collection object this report is for")
    report_type: ReportType
    report_date: date

    # Condition (CDWA 14.1)
    overall_condition: OverallCondition | None = None
    condition_summary: str | None = None
    detailed_findings: list[dict[str, Any]] | None = None

    # Examination
    check_reason: str | None = Field(default=None, max_length=500)
    # Reference to the examining user (FK → users). Prefer this over the free-text
    # examiner_name, which is the fallback for an external / unlisted examiner.
    examiner_id: UUID | None = None
    examiner_name: str | None = Field(default=None, max_length=255)
    examiner_institution: str | None = Field(default=None, max_length=255)
    examination_method: str | None = Field(default=None, max_length=50)

    # Recommendations + requirements
    recommendations: str | None = None
    conservation_needed: bool = False
    conservation_priority: str | None = Field(default=None, max_length=20)
    next_check_date: date | None = None
    handling_requirements: str | None = None
    display_restrictions: str | None = None
    hazard_summary: str | None = None

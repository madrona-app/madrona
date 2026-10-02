"""Typed payload for a `movement` draft (Movement, Procedure 6).

The proposable subset of the live Movement create shape
(`app/models/locations.py::Movement`). System-derived fields
(movement_reference_number, from_location_id, movement_date, authorized_by,
moved_by, created_by) are NOT proposable — the create function derives them.
`extra='forbid'` rejects anything else.
"""

from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# Mirror the live movements CHECK constraints
# (app/models/locations.py::Movement.__table_args__) so an out-of-range value
# fails at draft creation (a clear tool error) rather than at apply time (a
# buried CheckViolation).
MovementReason = Literal[
    "exhibition",
    "storage",
    "conservation",
    "loan",
    "photography",
    "research",
    "inventory",
    "rearrangement",
    "environmental",
    "security",
    "access_request",
    "other",
]
MovementStatus = Literal["pending", "in_transit", "completed", "cancelled"]
MovementMethod = Literal[
    "hand_carried", "cart", "forklift", "vehicle", "shipped", "courier"
]
LocationFitness = Literal["suitable", "temporary", "unsuitable"]
ShippingMethod = Literal["ground", "air", "sea"]


class MovementDraftPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Target + required core (mirrors the router's required-field checks).
    object_id: UUID
    to_location_id: UUID
    reason: MovementReason

    # Which part moves; omitted → the object's primary/first part.
    part_id: UUID | None = None

    movement_note: str | None = None
    location_fitness: LocationFitness | None = None
    movement_method: MovementMethod | None = None

    # Authorization (procedures).
    authorizer_id: UUID | None = None
    authorization_date: date | None = None
    authorization_note: str | None = None

    # Handling / courier.
    handler_id: UUID | None = None
    handler_name: str | None = Field(default=None, max_length=255)
    organization_courier: bool = False
    courier_name: str | None = Field(default=None, max_length=255)

    # Shipping.
    shipper_id: UUID | None = None
    shipper_name: str | None = Field(default=None, max_length=255)
    shipping_method: ShippingMethod | None = None
    shipping_tracking_number: str | None = Field(default=None, max_length=100)
    shipping_insurance_value: Decimal | None = Field(default=None, ge=0)
    shipping_insurance_currency: str | None = Field(default=None, max_length=3)
    shipping_note: str | None = None

    # Condition + planning.
    condition_note: str | None = None
    condition_report_id: UUID | None = None
    planned_removal_date: date | None = None
    planned_return_date: date | None = None

    status: MovementStatus = "completed"

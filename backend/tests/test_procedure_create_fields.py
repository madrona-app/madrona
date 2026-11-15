"""Every field on a procedure's staff form persists on create, as on update.

Driven from app/services/procedure_form_fields.json (the fields each form has
a control for, kept equal to the forms by a frontend test), so a new control
is covered automatically. Per procedure the test POSTs a value for every form
field that is a record column (plus the form's non-column fields: the loan
out venue address and conservation materials), then GETs the record and
checks each value came back. The same payload is then PUT onto a second
record to show update and create agree.

Fields the server sets itself (approval dates, the approver) are not in the
list: the forms show them read-only, without a `name`.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
import sqlalchemy as sa

from app.models import CollectionObject, Constituent
from app.services import procedure_required_fields as prf
from app.services.collections.field_enums import _enum_columns

URLS = {
    "object_entry": "entries",
    "acquisition": "acquisitions",
    "loan_in": "loans-in",
    "loan_out": "loans-out",
    "conservation": "conservation",
    "object_exit": "exits",
    "deaccession": "deaccessions",
}
ID_KEYS = {
    "object_entry": "entry_id",
    "acquisition": "acquisition_id",
    "loan_in": "loan_in_id",
    "loan_out": "loan_out_id",
    "conservation": "treatment_id",
    "object_exit": "exit_id",
    "deaccession": "deaccession_id",
}
# API name the form sends for a column, where it differs.
API_NAMES = {"object_entry": {"entry_reason": "reason"}}


def _seeded_lookup_value(model, name):
    """A seeded value for a lookup-backed column (validated by lookup_fields)."""
    from app.services.lookup_fields import _open_fields
    from seeds.seed_lookup_data import LOOKUP_VALUES

    category = _open_fields(model.__table__.fullname).get(name)
    if category is None:
        return None
    keys = sorted(row[2] for row in LOOKUP_VALUES if row[0] == category)
    assert keys, f"no seeded {category} value for {name}"
    return keys[0]


def _value(proc, model, name, column, refs, n):
    lookup = _seeded_lookup_value(model, name)
    if lookup is not None:
        return lookup
    enums = _enum_columns(model)
    if name in enums:
        return sorted(enums[name])[0]
    if column.foreign_keys:
        target = next(iter(column.foreign_keys)).target_fullname
        return refs[target]
    t = column.type
    if isinstance(t, sa.Date):
        return date(2026, 3, 1 + n % 27).isoformat()
    if isinstance(t, sa.Integer):
        return 3
    if isinstance(t, sa.Numeric):
        return 1234.5
    if isinstance(t, (sa.UUID, sa.Uuid)) or type(t).__name__ == "UUID":
        return "8f14e45f-ceea-467a-9575-6b6b8d5a5a00"
    length = getattr(t, "length", None) or 200
    text = f"{name.replace('_', ' ')} value"
    if length < len(text):
        text = ("ABC" if "currency" in name else name)[:length]
    return text


def _payload(proc, refs):
    model = prf._entity_models()[proc]
    columns = {a.key: a.columns[0] for a in sa.inspect(model).column_attrs}
    names = API_NAMES.get(proc, {})
    payload, expected = {}, {}
    for n, field in enumerate(sorted(prf.form_fields()[proc])):
        if field not in columns:
            continue
        value = _value(proc, model, field, columns[field], refs, n)
        payload[names.get(field, field)] = value
        expected[field] = value
    if proc == "loan_out":
        payload["venue_address"] = {"street": "1 Main St", "city": "Leeds", "state": None,
                                    "postal_code": "LS1", "country": "UK"}
        expected["venue_address"] = payload["venue_address"]
    if proc == "conservation":
        payload["materials_used"] = ["Paraloid B-72", "Klucel G"]
    return payload, expected


def _norm(value):
    if isinstance(value, (Decimal, float, int)) and not isinstance(value, bool):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value) if value.replace(".", "", 1).isdigit() else value
        except ValueError:
            return value
    return value


def _check(proc, body, expected):
    wrong = {}
    for field, value in expected.items():
        got = body.get(API_NAMES.get(proc, {}).get(field, field), body.get(field))
        if isinstance(got, str) and isinstance(value, str) and len(value) == 10 and got.startswith(value):
            continue
        if _norm(got) != _norm(value):
            wrong[field] = (value, got)
    if proc == "conservation":
        names = [m["material_name"] for m in body.get("materials_used") or []]
        if names != ["Paraloid B-72", "Klucel G"]:
            wrong["materials_used"] = names
    return wrong


@pytest.fixture
def refs(auth_setup, db_session):
    _, org, user = auth_setup
    contact = Constituent(organization_id=org.organization_id, constituent_type="person", name="Ref Person")
    obj = CollectionObject(organization_id=org.organization_id, object_number="CF-1", object_name="Bowl")
    db_session.add_all([contact, obj])
    db_session.commit()
    return {
        "collections.constituents.constituent_id": str(contact.constituent_id),
        "collections.collection_objects.object_id": str(obj.object_id),
        "users.user_id": str(user.user_id),
    }


@pytest.mark.parametrize("proc", sorted(URLS))
def test_create_persists_every_form_field(proc, auth_setup, refs):
    client, org, _ = auth_setup
    base = f"/api/organizations/{org.organization_id}/collections/{URLS[proc]}"
    payload, expected = _payload(proc, refs)

    resp = client.post(base, json=payload)
    assert resp.status_code == 201, resp.text
    record_id = resp.json[ID_KEYS[proc]]
    got = client.get(f"{base}/{record_id}")
    assert got.status_code == 200, got.text
    assert _check(proc, got.json, expected) == {}, "dropped on create"


@pytest.mark.parametrize("proc", sorted(URLS))
def test_update_persists_the_same_fields(proc, auth_setup, refs):
    client, org, _ = auth_setup
    base = f"/api/organizations/{org.organization_id}/collections/{URLS[proc]}"
    payload, expected = _payload(proc, refs)

    resp = client.post(base, json=payload)
    assert resp.status_code == 201, resp.text
    record_id = resp.json[ID_KEYS[proc]]
    resp = client.put(f"{base}/{record_id}", json=payload)
    assert resp.status_code == 200, resp.text
    got = client.get(f"{base}/{record_id}")
    assert _check(proc, got.json, expected) == {}, "dropped on update"

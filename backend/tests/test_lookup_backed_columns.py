"""Lookup-backed form fields save every value their control offers.

A form control offers the values of a lookup category; the column it saves to
must accept all of them. The registry in app/services/lookup_fields.py maps
every category a form uses to its column(s):

- OPEN columns have no CHECK and the API accepts any value active for the
  organization (seeded or org-added) and refuses anything else with a 400.
- FIXED columns keep their CHECK; every seeded value must satisfy it and
  organizations cannot add values to the category.
- FREE columns have no CHECK and are stored as given.

The static half fails when a CHECK and a category drift apart, or when the
frontend starts using a category the registry does not cover; the route half
saves an org-added value through every OPEN column's create and update route.
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import date
from pathlib import Path

import pytest
from sqlalchemy import text

from app.services.lookup_fields import (
    FIXED,
    FREE,
    LOOKUP_COLUMNS,
    NOT_PERSISTED_AS_KEY,
    OPEN,
)
from seeds.seed_lookup_data import LOOKUP_CATEGORIES, LOOKUP_VALUES

FRONTEND_SRC = Path(__file__).resolve().parents[2] / "frontend" / "src"


def _seeded(category: str) -> list[str]:
    return [v[2] for v in LOOKUP_VALUES if v[0] == category and v[7]]


def _check_defs(db_session, table: str, column: str) -> list[str]:
    """Definitions of CHECK constraints that reference ``table.column``."""
    schema, name = table.split(".")
    rows = db_session.execute(
        text(
            """
            SELECT pg_get_constraintdef(con.oid)
            FROM pg_constraint con
            JOIN pg_class c ON c.oid = con.conrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (con.conkey)
            WHERE con.contype = 'c' AND n.nspname = :schema AND c.relname = :name
              AND a.attname = :column
            """
        ),
        {"schema": schema, "name": name, "column": column},
    ).scalars()
    return list(rows)


# ---------------------------------------------------------------------------
# Registry against the schema, the seeds and the frontend
# ---------------------------------------------------------------------------


class TestRegistry:
    def test_registry_columns_exist(self, db_session):
        for entry in LOOKUP_COLUMNS:
            schema, name = entry.table.split(".")
            found = db_session.execute(
                text(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_schema = :s AND table_name = :t AND column_name = :c"
                ),
                {"s": schema, "t": name, "c": entry.column},
            ).first()
            assert found, f"{entry.table}.{entry.column} is registered but does not exist"

    def test_registered_categories_are_seeded(self):
        seeded = {c[1] for c in LOOKUP_CATEGORIES}
        for entry in LOOKUP_COLUMNS:
            assert entry.category in seeded, entry
            assert _seeded(entry.category), f"{entry.category} has no seeded values"

    def test_open_and_free_columns_have_no_check(self, db_session):
        for entry in LOOKUP_COLUMNS:
            if entry.mode in (OPEN, FREE):
                defs = _check_defs(db_session, entry.table, entry.column)
                assert not defs, (
                    f"{entry.table}.{entry.column} is filled from lookup '{entry.category}' "
                    f"(org-extendable) but has a CHECK: {defs}"
                )

    def test_fixed_columns_accept_every_seeded_value(self, db_session):
        fixed = [e for e in LOOKUP_COLUMNS if e.mode == FIXED]
        assert fixed
        for entry in fixed:
            defs = _check_defs(db_session, entry.table, entry.column)
            assert defs, f"{entry.table}.{entry.column} is FIXED but has no CHECK"
            allowed = set()
            for d in defs:
                allowed |= set(re.findall(r"'([^']*)'", d))
            rejected = [v for v in _seeded(entry.category) if v not in allowed]
            assert not rejected, (
                f"seeded {entry.category} values {rejected} are refused by the CHECK on "
                f"{entry.table}.{entry.column}"
            )

    def test_seeded_values_fit_their_columns(self):
        from app.services.lookup_fields import _column_length

        for entry in LOOKUP_COLUMNS:
            limit = _column_length(entry.table, entry.column)
            if limit is None:
                continue
            too_long = [v for v in _seeded(entry.category) if len(v) > limit]
            assert not too_long, (entry, limit, too_long)

    def test_a_category_has_one_kind_of_vocabulary(self):
        # An org may add values to a category unless it is FIXED somewhere, so
        # a category cannot be OPEN on one column and FIXED on another.
        modes: dict[str, set[str]] = {}
        for entry in LOOKUP_COLUMNS:
            modes.setdefault(entry.category, set()).add(entry.mode)
        for category, seen in modes.items():
            assert not (OPEN in seen and FIXED in seen), category


def _frontend_files():
    for path in FRONTEND_SRC.rglob("*"):
        if path.suffix not in {".ts", ".tsx"} or "/test/" in str(path) or ".test." in path.name:
            continue
        yield path


@pytest.mark.skipif(not FRONTEND_SRC.is_dir(), reason="frontend tree not present")
class TestFrontendCategories:
    LITERAL = re.compile(r"\b(?:getLookup|useLookupCategory)\(\s*['\"]([a-z0-9_]+)['\"]")
    DYNAMIC = re.compile(r"\b(?:getLookup|useLookupCategory)\(\s*[^'\")\s]")

    def test_every_form_category_is_registered(self):
        registered = {e.category for e in LOOKUP_COLUMNS} | set(NOT_PERSISTED_AS_KEY)
        used: dict[str, str] = {}
        for path in _frontend_files():
            for match in self.LITERAL.finditer(path.read_text()):
                used.setdefault(match.group(1), str(path.relative_to(FRONTEND_SRC)))
        assert used, "no lookup categories found; has the hook been renamed?"
        missing = {c: f for c, f in used.items() if c not in registered}
        assert not missing, (
            "these lookup categories feed a form control but are not in "
            f"app/services/lookup_fields.py LOOKUP_COLUMNS: {missing}"
        )

    def test_dynamic_categories_are_constituent_roles(self):
        # ConstituentLinker builds `constituent_role_<entity>`; any other
        # computed category key would escape the check above.
        dynamic = set()
        for path in _frontend_files():
            src = path.read_text()
            for match in self.DYNAMIC.finditer(src):
                line = src[: match.start()].count("\n") + 1
                dynamic.add(f"{path.relative_to(FRONTEND_SRC)}:{line}")
        allowed_files = {"components/collections/ConstituentLinker.tsx", "hooks/useLookupValues.ts"}
        assert {d.rsplit(":", 1)[0] for d in dynamic} <= allowed_files, dynamic
        seeded_roles = {c[1] for c in LOOKUP_CATEGORIES if c[1].startswith("constituent_role_")}
        registered = {e.category for e in LOOKUP_COLUMNS}
        assert seeded_roles <= registered, seeded_roles - registered


# ---------------------------------------------------------------------------
# Routes: org-added values save; unknown values are a 400 naming the field
# ---------------------------------------------------------------------------


def _object(db_session, org):
    from app.models import CollectionObject

    obj = CollectionObject(
        organization_id=org.organization_id,
        object_number=f"LK-{uuid.uuid4().hex[:6].upper()}",
        object_name="Lookup test object",
        object_status="accessioned",
    )
    db_session.add(obj)
    db_session.commit()
    return obj


def _add_org_value(db_session, org, category: str, key: str) -> None:
    from app.models import LookupCategory, LookupValue

    cat = db_session.query(LookupCategory).filter(LookupCategory.category_key == category).one()
    db_session.add(
        LookupValue(
            category_id=cat.category_id,
            organization_id=org.organization_id,
            value_key=key,
            label=key.replace("_", " ").title(),
        )
    )
    db_session.commit()


def _first(category):
    return _seeded(category)[0]


# table -> (create path, update path, id keys, base payload builder, {column: body key})
def _specs(obj_id):
    o = str(obj_id)
    return {
        "collections.acquisitions": (
            "acquisitions", "acquisitions/{id}", ("acquisition_id",),
            {"acquisition_method": _first("acquisition_method")}, {},
        ),
        "collections.audit_campaigns": (
            "audits", "audits/{id}", ("audit_id",),
            {"title": "Audit", "audit_type": _first("audit_type")}, {},
        ),
        "collections.citations": (
            "citations", "citations/{id}", ("citation_id",),
            {"brief_citation": "Cite", "citation_type": _first("citation_type")}, {},
        ),
        "collections.collections_reviews": (
            "reviews", "reviews/{id}", ("review_id",),
            {"title": "Review", "review_type": _first("review_type")}, {},
        ),
        "collections.condition_reports": (
            "condition-reports", "condition-reports/{id}", ("report_id",),
            {"report_type": _first("report_type"), "object_id": o}, {},
        ),
        "collections.conservation_treatments": (
            "conservation", "conservation/{id}", ("treatment_id",),
            {"treatment_type": _first("treatment_type"), "object_id": o}, {},
        ),
        "collections.deaccessions": (
            "deaccessions", "deaccessions/{id}", ("deaccession_id",),
            {"object_id": o, "reason": _first("deaccession_reason")}, {},
        ),
        "collections.documentation_plans": (
            "documentation-plans", "documentation-plans/{id}", ("plan_id",),
            {"title": "Plan"}, {},
        ),
        "collections.events": (
            "events", "events/{id}", ("event_id",),
            {"title": "Event", "event_type": _first("event_type")}, {},
        ),
        "collections.incident_reports": (
            "incidents", "incidents/{id}", ("report_id", "incident_id"),
            {"incident_type": _first("incident_type"), "incident_description": "Spill"}, {},
        ),
        "collections.loans_in": (
            "loans-in", "loans-in/{id}", ("loan_id", "loan_in_id"),
            {"loan_purpose": _first("loan_purpose")}, {},
        ),
        "collections.loans_out": (
            "loans-out", "loans-out/{id}", ("loan_id", "loan_out_id"),
            {"loan_purpose": _first("loan_purpose")}, {},
        ),
        "collections.object_entries": (
            "entries", "entries/{id}", ("entry_id",),
            {"reason": _first("entry_reason")}, {"entry_reason": "reason"},
        ),
        "collections.object_exits": (
            "exits", "exits/{id}", ("exit_id",),
            {"exit_reason": _first("exit_reason")}, {},
        ),
        "collections.reproduction_requests": (
            "reproduction-requests", "reproduction-requests/{id}", ("reproduction_id",),
            {
                "request_number": f"RR-{uuid.uuid4().hex[:6]}",
                "requester_name": "Requester",
                "reproduction_type": _first("reproduction_type"),
            },
            {},
        ),
        "collections.object_rights": (
            f"objects/{o}/rights", "rights/{id}", ("right_id",),
            {"right_type": _first("right_type")}, {},
        ),
        "collections.use_requests": (
            "use-requests", "use-requests/{id}", ("request_id",),
            {"use_type": _first("use_type"), "requester_name": "Requester", "use_purpose": "Study"},
            {},
        ),
        "collections.valuations": (
            "valuations", "valuations/{id}", ("valuation_id",),
            {
                "object_id": o,
                "valuation_type": _first("valuation_type"),
                "valuation_amount": 100,
                "valuation_date": date.today().isoformat(),
            },
            {},
        ),
    }


OPEN_COLUMNS = [e for e in LOOKUP_COLUMNS if e.mode == OPEN]


def _base_url(org):
    return f"/api/organizations/{org.organization_id}/collections/"


def _post(client, url, payload):
    return client.post(url, data=json.dumps(payload), content_type="application/json")


def _put(client, url, payload):
    return client.put(url, data=json.dumps(payload), content_type="application/json")


def _record_id(body: dict, keys) -> str:
    for key in (*keys, "id"):
        if body.get(key):
            return body[key]
    raise AssertionError(f"no id among {keys} in {sorted(body)}")


def test_every_open_column_has_a_route_spec():
    tables = set(_specs(uuid.uuid4()))
    assert {e.table for e in OPEN_COLUMNS} <= tables


@pytest.mark.parametrize("entry", OPEN_COLUMNS, ids=lambda e: f"{e.table.split('.')[1]}.{e.column}")
class TestOpenColumnRoutes:
    def _spec(self, db_session, org, entry):
        obj = _object(db_session, org)
        create, update, ids, base, aliases = _specs(obj.object_id)[entry.table]
        key = aliases.get(entry.column, entry.column)
        return create, update, ids, dict(base), key

    def test_create_saves_org_added_value(self, auth_setup, db_session, entry):
        client, org, _ = auth_setup
        create, _update, ids, payload, key = self._spec(db_session, org, entry)
        custom = "org_value_a"
        _add_org_value(db_session, org, entry.category, custom)
        payload[key] = custom

        resp = _post(client, _base_url(org) + create, payload)
        assert resp.status_code in (200, 201), resp.get_json()

        from app.database import Base

        table = Base.metadata.tables[entry.table]
        pk = list(table.primary_key.columns)[0]
        rid = _record_id(resp.get_json(), ids)
        stored = db_session.execute(
            text(f"SELECT {entry.column} FROM {entry.table} WHERE {pk.name} = :id"), {"id": rid}
        ).scalar()
        assert stored == custom

    def test_create_refuses_unknown_value(self, auth_setup, db_session, entry):
        client, org, _ = auth_setup
        create, _update, _ids, payload, key = self._spec(db_session, org, entry)
        payload[key] = "not_a_lookup_value"

        resp = _post(client, _base_url(org) + create, payload)
        assert resp.status_code == 400, resp.get_json()
        error = resp.get_json()["error"]
        assert error["code"] == "invalid_lookup_value"
        assert error["field"] == key

    def test_update_saves_org_added_value_and_refuses_unknown(self, auth_setup, db_session, entry):
        client, org, _ = auth_setup
        create, update, ids, payload, key = self._spec(db_session, org, entry)
        resp = _post(client, _base_url(org) + create, payload)
        assert resp.status_code in (200, 201), resp.get_json()
        url = _base_url(org) + update.format(id=_record_id(resp.get_json(), ids))

        custom = "org_value_b"
        _add_org_value(db_session, org, entry.category, custom)
        resp = _put(client, url, {key: custom})
        assert resp.status_code == 200, resp.get_json()

        resp = _put(client, url, {key: "not_a_lookup_value"})
        assert resp.status_code == 400, resp.get_json()
        assert resp.get_json()["error"]["field"] == key


def test_another_orgs_value_is_refused(auth_setup, db_session):
    from app.models import Organization

    client, org, _ = auth_setup
    other = Organization(name="Other", slug=f"other-{uuid.uuid4().hex[:6]}", status="active")
    db_session.add(other)
    db_session.commit()
    _add_org_value(db_session, other, "citation_type", "zine")

    resp = _post(client, _base_url(org) + "citations", {"brief_citation": "C", "citation_type": "zine"})
    assert resp.status_code == 400


def test_unchanged_legacy_value_does_not_block_an_update(auth_setup, db_session):
    """A value stored under the old CHECK vocabulary but never seeded as a
    lookup ('commission') can be re-sent unchanged by a full-form save."""
    client, org, _ = auth_setup
    resp = _post(client, _base_url(org) + "acquisitions", {"acquisition_method": "gift"})
    assert resp.status_code in (200, 201), resp.get_json()
    acq_id = resp.get_json()["acquisition_id"]
    db_session.execute(
        text("UPDATE collections.acquisitions SET acquisition_method = 'commission' WHERE acquisition_id = :id"),
        {"id": acq_id},
    )
    db_session.commit()

    resp = _put(
        client,
        _base_url(org) + f"acquisitions/{acq_id}",
        {"acquisition_method": "commission", "credit_line": "Purchased 1990"},
    )
    assert resp.status_code == 200, resp.get_json()


def test_seeded_values_the_old_checks_refused_now_save(auth_setup, db_session):
    """The values the audit found refused at commit, saved through the API."""
    client, org, _ = auth_setup
    obj = _object(db_session, org)
    base = _base_url(org)
    cases = [
        ("acquisitions", {"acquisition_method": "other", "source_type": "auction"}),
        ("citations", {"brief_citation": "C", "citation_type": "catalog"}),
        ("loans-out", {"loan_purpose": "long_term"}),
        ("reproduction-requests", {"request_number": "RR-1", "requester_name": "N", "reproduction_type": "print"}),
        (f"objects/{obj.object_id}/rights", {"right_type": "digital"}),
        ("events", {"title": "E", "event_type": "program", "audience": "students"}),
        ("incidents", {"incident_type": "damage", "incident_description": "d", "insurance_claim_status": "under_review"}),
    ]
    for path, payload in cases:
        resp = _post(client, base + path, payload)
        assert resp.status_code in (200, 201), (path, resp.get_json())


# ---------------------------------------------------------------------------
# FIXED categories
# ---------------------------------------------------------------------------


class TestFixedCategories:
    def _post_value(self, client, org, category, key):
        return _post(
            client,
            f"/api/organizations/{org.organization_id}/lookups/{category}",
            {"value_key": key, "label": key.title()},
        )

    @pytest.mark.parametrize("category", sorted({e.category for e in LOOKUP_COLUMNS if e.mode == FIXED}))
    def test_org_cannot_add_to_a_fixed_category(self, auth_setup, category):
        client, org, _ = auth_setup
        resp = self._post_value(client, org, category, "in_storage")
        assert resp.status_code == 400, resp.get_json()
        assert resp.get_json()["error"]["code"] == "fixed_lookup_category"

    def test_key_longer_than_the_column_is_refused(self, auth_setup):
        # review_frequency is varchar(20); a 21-character key could be picked
        # in the form but never saved.
        client, org, _ = auth_setup
        resp = self._post_value(client, org, "review_frequency", "x" * 21)
        assert resp.status_code == 400, resp.get_json()
        assert resp.get_json()["error"]["code"] == "value_key_too_long"
        assert self._post_value(client, org, "review_frequency", "x" * 20).status_code == 201

    def test_org_can_add_to_an_open_category(self, auth_setup):
        client, org, _ = auth_setup
        resp = self._post_value(client, org, "citation_type", "zine")
        assert resp.status_code == 201, resp.get_json()

    def test_object_status_seed_matches_the_workflow(self):
        assert set(_seeded("object_status")) == {
            "pending", "accessioned", "on_loan", "deaccessioned", "missing", "destroyed",
        }
        assert "critical" not in _seeded("condition")

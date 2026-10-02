"""
Sandbox seeder unit tests.

Phase 1b coverage focuses on:
* `seed_reference_data` real DB writes — uses the conftest `db_session`
  fixture (Postgres in CI; local machines need TEST_DATABASE_URL pointing
  at a usable Postgres). Skipped if the fixture can't connect.
* The API-key-gating short-circuits on `seed_smithsonian_collections`
  and `seed_rijks_collections`. These tests don't touch the DB so they
  run anywhere.

The Met seeder is a thin wrapper around the long-existing CLI script;
its happy-path is exercised end-to-end during real sandbox provisioning
in staging.
"""
from __future__ import annotations

import os
import uuid
from unittest.mock import patch

import pytest

from app.services.sandbox_seeder import (
    seed_acquisitions,
    seed_condition_reports,
    seed_conservation,
    seed_exhibitions,
    seed_loans,
    seed_reference_data,
    seed_smithsonian_collections,
    seed_rijks_collections,
)


# ---------------------------------------------------------------------------
# seed_reference_data — real DB writes (Postgres-only)
#
# Uses conftest's `db_session` fixture which requires TEST_DATABASE_URL
# to point at a working Postgres. Models use schema="collections" which
# SQLite can't approximate.
# ---------------------------------------------------------------------------

class TestSeedReferenceData:
    @pytest.fixture
    def org_id(self, db_session):
        from app.models import Organization

        org = Organization(
            name="Sandbox Seeder Test Org",
            slug=f"sandbox-{uuid.uuid4().hex[:8]}",
            is_demo=True,
            status="active",
        )
        db_session.add(org)
        db_session.commit()
        return org.organization_id

    def test_creates_full_set_on_first_run(self, db_session, org_id):
        from app.models.departments import Department

        result = seed_reference_data(db_session, org_id)

        assert result["departments_created"] == 5
        assert result["locations_created"] == 20
        assert result["contacts_created"] == 15

        cur = (
            db_session.query(Department)
            .filter_by(organization_id=org_id, code="CUR")
            .first()
        )
        assert cur is not None
        assert cur.name == "Curatorial"
        assert cur.color == "#5A7A52"

    def test_re_run_is_no_op(self, db_session, org_id):
        seed_reference_data(db_session, org_id)
        result = seed_reference_data(db_session, org_id)

        assert result == {
            "departments_created": 0,
            "locations_created": 0,
            "contacts_created": 0,
        }

    def test_locations_have_parent_relationships(self, db_session, org_id):
        from app.models.locations import Location

        seed_reference_data(db_session, org_id)

        wing = (
            db_session.query(Location)
            .filter_by(organization_id=org_id, code="STG")
            .first()
        )
        room = (
            db_session.query(Location)
            .filter_by(organization_id=org_id, code="STG-101")
            .first()
        )
        assert wing is not None and room is not None
        assert room.parent_id == wing.location_id
        assert room.depth == wing.depth + 1
        assert room.path.startswith(wing.path)

        # location_type must stay within the frontend Zod enum (a subset of the
        # DB CHECK constraint). wing/area satisfy the DB but the UI rejects
        # them, so the seeder uses floor/room instead.
        all_locs = (
            db_session.query(Location).filter_by(organization_id=org_id).all()
        )
        for loc in all_locs:
            assert loc.location_type in {
                "building", "floor", "room", "case", "shelf", "drawer", "other",
            }, f"non-canonical location_type {loc.location_type!r}"

    def test_requires_org_id(self, db_session):
        with pytest.raises(ValueError, match="org_id"):
            seed_reference_data(db_session, None)


# ---------------------------------------------------------------------------
# Smithsonian / Rijksmuseum — verify the no-key short-circuit. These don't
# need the DB because the seeder bails before any query runs.
# ---------------------------------------------------------------------------

class TestSeedSmithsonianCollections:
    def test_skips_gracefully_without_api_key(self):
        with patch.dict(os.environ, {"SMITHSONIAN_API_KEY": ""}, clear=False):
            # session arg is never reached when the key is missing.
            result = seed_smithsonian_collections(
                None, org_id=None, admin_user_id=None  # type: ignore[arg-type]
            )
        assert result["skipped"] is True
        assert "SMITHSONIAN_API_KEY" in result["reason"]


class TestSeedRijksCollections:
    def test_skips_gracefully_without_api_key(self):
        with patch.dict(os.environ, {"RIJKSMUSEUM_API_KEY": ""}, clear=False):
            result = seed_rijks_collections(
                None, org_id=None, admin_user_id=None  # type: ignore[arg-type]
            )
        assert result["skipped"] is True
        assert "RIJKSMUSEUM_API_KEY" in result["reason"]


# ---------------------------------------------------------------------------
# seed_acquisitions — real DB writes
# ---------------------------------------------------------------------------

class TestSeedAcquisitions:
    @pytest.fixture
    def org_id(self, db_session):
        from app.models import Organization

        org = Organization(
            name="Sandbox Acquisitions Test Org",
            slug=f"sbx-acq-{uuid.uuid4().hex[:8]}",
            is_demo=True,
            status="active",
        )
        db_session.add(org)
        db_session.commit()
        return org.organization_id

    @pytest.fixture
    def admin_user_id(self, db_session, org_id):
        from app.models import User

        user = User(
            email=f"admin-{uuid.uuid4().hex[:6]}@example.org",
            display_name="Sandbox Admin",
            status="active",
        )
        db_session.add(user)
        db_session.commit()
        return user.user_id

    @pytest.fixture
    def seeded_objects(self, db_session, org_id):
        """Insert 12 fake MET-/SI-/RIJKS- objects so the seeder has source material."""
        from app.models.objects import CollectionObject

        rows = []
        for i in range(12):
            prefix = ("MET", "SI", "RIJKS")[i % 3]
            obj = CollectionObject(
                organization_id=org_id,
                object_number=f"{prefix}-TEST-{i:03d}",
                object_name=f"Test Object {i}",
            )
            db_session.add(obj)
            rows.append(obj)
        db_session.commit()
        return rows

    def test_creates_acquisitions_when_objects_present(
        self, db_session, org_id, admin_user_id, seeded_objects
    ):
        # Reference data is needed so the seeder finds donor/institution
        # constituents to use as Acquisition.source.
        seed_reference_data(db_session, org_id)

        result = seed_acquisitions(
            db_session, org_id=org_id, admin_user_id=admin_user_id
        )

        assert result["skipped_at_target"] is False
        assert result["acquisitions_created"] >= 1
        # Top-up target = "every object gets an acquisition", so on a
        # fresh org every seeded object should end up linked.
        assert result["acquisition_objects_created"] == len(seeded_objects)
        assert result["acquisitions_existing"] == 0
        assert result["objects_existing"] == 0

        from app.models.procedures import Acquisition, AcquisitionObject

        all_acqs = (
            db_session.query(Acquisition)
            .filter_by(organization_id=org_id)
            .all()
        )
        assert len(all_acqs) == result["acquisitions_created"]
        # Every acquisition must have a method from the CHECK constraint
        # and a numeric YYYY.NNN-style number.
        for acq in all_acqs:
            assert acq.acquisition_method in {
                "gift", "purchase", "bequest", "transfer", "exchange",
            }
            assert acq.status in {
                "accessioned", "completed", "approved", "pending_approval",
            }
            # source_type is its own enum (NOT constituent_type). Canonical:
            # individual|institution|estate|dealer|other. person/organization
            # are the drifted values the UI rejected.
            assert acq.source_type in {
                None, "individual", "institution", "estate", "dealer", "other",
            }, f"non-canonical source_type {acq.source_type!r}"
            assert "." in acq.acquisition_number  # YYYY.NNN

        # Every linked object should belong to one of the seeded objects.
        seeded_ids = {o.object_id for o in seeded_objects}
        links = (
            db_session.query(AcquisitionObject)
            .filter_by(organization_id=org_id)
            .all()
        )
        for link in links:
            assert link.object_id in seeded_ids

    def test_re_run_is_no_op_when_at_target(
        self, db_session, org_id, admin_user_id, seeded_objects
    ):
        """First seed fills every object with an acquisition. A second
        call should detect 'all objects covered' and return
        skipped_at_target=True with zero creates, surfacing the existing
        counts so the UI can show "N already present" instead of bare 0."""
        seed_reference_data(db_session, org_id)
        first = seed_acquisitions(db_session, org_id=org_id, admin_user_id=admin_user_id)

        result = seed_acquisitions(
            db_session, org_id=org_id, admin_user_id=admin_user_id
        )
        assert result["skipped_at_target"] is True
        assert result["acquisitions_created"] == 0
        assert result["acquisition_objects_created"] == 0
        assert result["acquisitions_existing"] == first["acquisitions_created"]
        assert result["objects_existing"] == first["acquisition_objects_created"]

    def test_top_up_after_new_objects_added(
        self, db_session, org_id, admin_user_id, seeded_objects
    ):
        """The orphan-prevention guarantee: re-running the seeder after
        new collection objects appear (as happens when a richer manifest
        is deployed mid-life of a sandbox) should backfill the gap.

        Existing acquisitions are left untouched; new acquisitions cover
        only the previously-uncovered objects; their numbers do not
        collide with existing year sequences."""
        from app.models.objects import CollectionObject
        from app.models.procedures import Acquisition, AcquisitionObject

        seed_reference_data(db_session, org_id)
        first = seed_acquisitions(db_session, org_id=org_id, admin_user_id=admin_user_id)
        assert first["acquisition_objects_created"] == len(seeded_objects)

        # Capture existing acquisition numbers so we can verify the
        # top-up doesn't accidentally reuse any.
        before_numbers = {
            a.acquisition_number
            for a in db_session.query(Acquisition).filter_by(organization_id=org_id).all()
        }

        # Simulate a manifest expansion: 8 new objects land in the org.
        new_objs = []
        for i in range(8):
            prefix = ("MET", "SI", "RIJKS")[i % 3]
            obj = CollectionObject(
                organization_id=org_id,
                object_number=f"{prefix}-TOPUP-{i:03d}",
                object_name=f"Top-up Object {i}",
            )
            db_session.add(obj)
            new_objs.append(obj)
        db_session.commit()

        result = seed_acquisitions(
            db_session, org_id=org_id, admin_user_id=admin_user_id
        )
        assert result["skipped_at_target"] is False
        # Top-up creates acquisitions for exactly the 8 new objects.
        assert result["acquisition_objects_created"] == 8
        assert result["acquisitions_existing"] == first["acquisitions_created"]
        assert result["objects_existing"] == len(seeded_objects)

        # Existing acquisitions untouched; new ones added on top.
        all_acqs = db_session.query(Acquisition).filter_by(organization_id=org_id).all()
        assert len(all_acqs) == first["acquisitions_created"] + result["acquisitions_created"]

        # Acquisition numbers don't collide.
        after_numbers = {a.acquisition_number for a in all_acqs}
        assert before_numbers <= after_numbers
        new_numbers = after_numbers - before_numbers
        assert before_numbers.isdisjoint(new_numbers)

        # The 8 new objects are now covered; no orphans.
        new_obj_ids = {o.object_id for o in new_objs}
        topped_up = (
            db_session.query(AcquisitionObject)
            .filter(AcquisitionObject.organization_id == org_id,
                    AcquisitionObject.object_id.in_(new_obj_ids))
            .count()
        )
        assert topped_up == 8

    def test_skips_when_no_objects(self, db_session, org_id, admin_user_id):
        # Reference data only — no MET-/SI-/RIJKS- objects in the org.
        seed_reference_data(db_session, org_id)

        result = seed_acquisitions(
            db_session, org_id=org_id, admin_user_id=admin_user_id
        )
        assert result.get("skipped_no_objects") is True
        assert result["acquisitions_created"] == 0

    def test_requires_org_and_admin_user_id(self, db_session):
        with pytest.raises(ValueError, match="org_id"):
            seed_acquisitions(
                db_session, org_id=None, admin_user_id=uuid.uuid4()  # type: ignore[arg-type]
            )


# ---------------------------------------------------------------------------
# seed_loans — real DB writes
# ---------------------------------------------------------------------------

class TestSeedLoans:
    @pytest.fixture
    def org_id(self, db_session):
        from app.models import Organization

        org = Organization(
            name="Sandbox Loans Test Org",
            slug=f"sbx-loans-{uuid.uuid4().hex[:8]}",
            is_demo=True,
            status="active",
        )
        db_session.add(org)
        db_session.commit()
        return org.organization_id

    @pytest.fixture
    def admin_user_id(self, db_session, org_id):
        from app.models import User

        user = User(
            email=f"admin-{uuid.uuid4().hex[:6]}@example.org",
            display_name="Sandbox Admin",
            status="active",
        )
        db_session.add(user)
        db_session.commit()
        return user.user_id

    @pytest.fixture
    def seeded_objects(self, db_session, org_id):
        from app.models.objects import CollectionObject

        rows = []
        for i in range(8):
            prefix = ("MET", "SI", "RIJKS")[i % 3]
            obj = CollectionObject(
                organization_id=org_id,
                object_number=f"{prefix}-LN-{i:03d}",
                object_name=f"Test Object {i}",
            )
            db_session.add(obj)
            rows.append(obj)
        db_session.commit()
        return rows

    def test_creates_loans_in_and_out(
        self, db_session, org_id, admin_user_id, seeded_objects
    ):
        seed_reference_data(db_session, org_id)
        result = seed_loans(
            db_session, org_id=org_id, admin_user_id=admin_user_id
        )

        assert result["skipped_at_target"] is False
        assert result["loans_in_created"] >= 1
        assert result["loan_in_objects_created"] >= 1
        assert result["loans_out_created"] >= 1
        assert result["loan_out_objects_created"] >= 1

        from app.models.procedures import LoanIn, LoanOut

        loans_in = (
            db_session.query(LoanIn).filter_by(organization_id=org_id).all()
        )
        loans_out = (
            db_session.query(LoanOut).filter_by(organization_id=org_id).all()
        )
        # Numbers come back unique-per-org; verify the format and constraints.
        for li in loans_in:
            # Canonical LI number from next_sequential_number via create_loan_in:
            # "LIYYYY.NNNN" (NOT the old "LI-YYYY-NNN").
            assert li.loan_number.startswith("LI")
            assert "." in li.loan_number
            # Canonical loan-in purpose enum (procedures.ts). "study" drifted
            # in previously; do not re-add it.
            assert li.loan_purpose in {
                "exhibition", "research", "conservation", "long_term", "other",
            }, f"non-canonical loan_in purpose {li.loan_purpose!r}"
            assert li.status in {
                "requested", "pending_approval", "approved", "agreement_sent",
                "agreement_signed", "in_transit", "received", "on_loan",
                "return_initiated", "returned", "closed", "cancelled", "overdue",
            }
        for lo in loans_out:
            # Canonical LO number from next_sequential_number via create_loan_out.
            assert lo.loan_number.startswith("LO")
            assert "." in lo.loan_number
            assert lo.loan_purpose in {
                "exhibition", "research", "conservation", "education",
                "photography", "touring", "inter_museum", "other",
            }
            assert lo.status in {
                "requested", "pending_approval", "approved", "agreement_sent",
                "agreement_signed", "in_transit", "on_loan", "return_scheduled",
                "returned", "closed", "declined", "cancelled",
            }

        # Dispatched loans (in_transit/on_loan/returned) must now carry the
        # ObjectExit + Movement side-effects the workspace renders —
        # the seeder used to skip these, leaving those sections empty.
        from app.models.procedures import LoanOutObject, ObjectExit
        from app.models.locations import Location, Movement

        dispatched = [
            lo for lo in loans_out
            if lo.status in {"in_transit", "on_loan", "returned"}
        ]
        if dispatched:
            assert result["object_exits_created"] >= 1
            assert result["loan_movements_created"] >= 1

            exits = (
                db_session.query(ObjectExit)
                .filter_by(organization_id=org_id, reference_type="loan_out")
                .all()
            )
            assert len(exits) >= 1
            assert all(e.exit_reason == "loan_out" for e in exits)

            movements = (
                db_session.query(Movement)
                .filter_by(organization_id=org_id, reference_type="loan_out")
                .all()
            )
            assert len(movements) >= 1

            # The On Loan system location was created.
            on_loan = (
                db_session.query(Location)
                .filter_by(organization_id=org_id, name="On Loan")
                .first()
            )
            assert on_loan is not None

            # Every object on a dispatched loan got its exit_id back-link.
            for lo in dispatched:
                links = (
                    db_session.query(LoanOutObject)
                    .filter_by(loan_out_id=lo.loan_out_id)
                    .all()
                )
                assert all(link.exit_id is not None for link in links)

    def test_re_run_is_no_op(
        self, db_session, org_id, admin_user_id, seeded_objects
    ):
        seed_reference_data(db_session, org_id)
        seed_loans(db_session, org_id=org_id, admin_user_id=admin_user_id)

        result = seed_loans(
            db_session, org_id=org_id, admin_user_id=admin_user_id
        )
        assert result["skipped_at_target"] is True
        assert result["loans_in_created"] == 0
        assert result["loans_out_created"] == 0

    def test_loans_in_can_seed_without_own_objects(
        self, db_session, org_id, admin_user_id
    ):
        # No CollectionObjects -- LoanIn does not need them (object_id NULLABLE).
        # LoanOut will be skipped because there are no own objects to lend.
        seed_reference_data(db_session, org_id)
        result = seed_loans(
            db_session, org_id=org_id, admin_user_id=admin_user_id
        )
        assert result["loans_in_created"] >= 1
        assert result["loans_out_created"] == 0

    def test_requires_org_and_admin_user_id(self, db_session):
        with pytest.raises(ValueError, match="org_id"):
            seed_loans(
                db_session, org_id=None, admin_user_id=uuid.uuid4()  # type: ignore[arg-type]
            )


# ---------------------------------------------------------------------------
# seed_exhibitions — real DB writes
# ---------------------------------------------------------------------------

class TestSeedExhibitions:
    @pytest.fixture
    def org_id(self, db_session):
        from app.models import Organization

        org = Organization(
            name="Sandbox Exhibitions Test Org",
            slug=f"sbx-exh-{uuid.uuid4().hex[:8]}",
            is_demo=True,
            status="active",
        )
        db_session.add(org)
        db_session.commit()
        return org.organization_id

    @pytest.fixture
    def admin_user_id(self, db_session, org_id):
        from app.models import User

        user = User(
            email=f"admin-{uuid.uuid4().hex[:6]}@example.org",
            display_name="Sandbox Admin",
            status="active",
        )
        db_session.add(user)
        db_session.commit()
        return user.user_id

    @pytest.fixture
    def seeded_objects(self, db_session, org_id):
        from app.models.objects import CollectionObject

        rows = []
        for i in range(20):
            prefix = ("MET", "SI", "RIJKS")[i % 3]
            obj = CollectionObject(
                organization_id=org_id,
                object_number=f"{prefix}-EX-{i:03d}",
                object_name=f"Test Object {i}",
            )
            db_session.add(obj)
            rows.append(obj)
        db_session.commit()
        return rows

    def test_creates_three_exhibitions_with_objects(
        self, db_session, org_id, admin_user_id, seeded_objects
    ):
        result = seed_exhibitions(
            db_session, org_id=org_id, admin_user_id=admin_user_id
        )

        assert result["skipped_at_target"] is False
        assert result["exhibitions_created"] == 3
        assert result["exhibition_objects_created"] >= 3
        assert result["venues_created"] == 1
        assert result["status_history_created"] == 3

        from app.models.exhibit import (
            Exhibition,
            ExhibitionObject,
            ExhibitionStatusHistory,
        )

        exhibitions = (
            db_session.query(Exhibition).filter_by(organization_id=org_id).all()
        )
        assert len(exhibitions) == 3
        statuses = {e.status for e in exhibitions}
        # Spec covers open, archived, and in_preparation.
        assert statuses == {"open", "archived", "in_preparation"}

        for ex in exhibitions:
            assert ex.exhibition_number is not None
            assert ex.exhibition_number.startswith("EXH-")
            assert ex.exhibition_type in {
                "permanent", "temporary", "touring", "traveling",
                "online", "pop_up",
            }
            assert ex.venue_id is not None  # Demo venue is created.

        # Every exhibition gets a "created" status-history row so the lifecycle
        # timeline renders (mirrors the create router's side-effect).
        history = (
            db_session.query(ExhibitionStatusHistory)
            .join(
                Exhibition,
                Exhibition.exhibition_id == ExhibitionStatusHistory.exhibition_id,
            )
            .filter(Exhibition.organization_id == org_id)
            .all()
        )
        assert len(history) == 3
        assert all(h.notes == "Exhibition created" for h in history)
        assert {h.status for h in history} == {"open", "archived", "in_preparation"}

        ex_objects = (
            db_session.query(ExhibitionObject).filter_by(organization_id=org_id).all()
        )
        # Each ExhibitionObject must have object_id set (entity_key is null).
        for eo in ex_objects:
            assert eo.object_id is not None
            assert eo.entity_key is None
            assert eo.object_status in {
                "planned", "confirmed", "on_display", "returned",
            }

    def test_re_run_is_no_op(
        self, db_session, org_id, admin_user_id, seeded_objects
    ):
        seed_exhibitions(db_session, org_id=org_id, admin_user_id=admin_user_id)

        result = seed_exhibitions(
            db_session, org_id=org_id, admin_user_id=admin_user_id
        )
        assert result["skipped_at_target"] is True
        assert result["exhibitions_created"] == 0

    def test_skips_when_no_objects(self, db_session, org_id, admin_user_id):
        result = seed_exhibitions(
            db_session, org_id=org_id, admin_user_id=admin_user_id
        )
        assert result.get("skipped_no_objects") is True
        assert result["exhibitions_created"] == 0

    def test_requires_org_and_admin_user_id(self, db_session):
        with pytest.raises(ValueError, match="org_id"):
            seed_exhibitions(
                db_session, org_id=None, admin_user_id=uuid.uuid4()  # type: ignore[arg-type]
            )


# ---------------------------------------------------------------------------
# seed_conservation — real DB writes
# ---------------------------------------------------------------------------

class TestSeedConservation:
    @pytest.fixture
    def org_id(self, db_session):
        from app.models import Organization

        org = Organization(
            name="Sandbox Conservation Test Org",
            slug=f"sbx-cn-{uuid.uuid4().hex[:8]}",
            is_demo=True,
            status="active",
        )
        db_session.add(org)
        db_session.commit()
        return org.organization_id

    @pytest.fixture
    def admin_user_id(self, db_session, org_id):
        from app.models import User

        user = User(
            email=f"admin-{uuid.uuid4().hex[:6]}@example.org",
            display_name="Sandbox Admin",
            status="active",
        )
        db_session.add(user)
        db_session.commit()
        return user.user_id

    @pytest.fixture
    def seeded_objects(self, db_session, org_id):
        from app.models.objects import CollectionObject

        rows = []
        for i in range(10):
            prefix = ("MET", "SI", "RIJKS")[i % 3]
            obj = CollectionObject(
                organization_id=org_id,
                object_number=f"{prefix}-CN-{i:03d}",
                object_name=f"Test Object {i}",
            )
            db_session.add(obj)
            rows.append(obj)
        db_session.commit()
        return rows

    def test_creates_treatments_across_lifecycle(
        self, db_session, org_id, admin_user_id, seeded_objects
    ):
        # Seed reference data so the seeder finds a staff conservator.
        seed_reference_data(db_session, org_id)

        result = seed_conservation(
            db_session, org_id=org_id, admin_user_id=admin_user_id
        )
        assert result["skipped_at_target"] is False
        assert result["treatments_created"] >= 5

        from app.models.procedures import ConservationTreatment

        treatments = (
            db_session.query(ConservationTreatment)
            .filter_by(organization_id=org_id)
            .all()
        )
        assert len(treatments) == result["treatments_created"]

        statuses = {t.status for t in treatments}
        # Spec covers completed, in_progress, approved, proposed.
        assert "completed" in statuses
        assert "in_progress" in statuses

        for t in treatments:
            # Canonical treatment_number issued by next_sequential_number via
            # create_conservation_treatment: "CONYYYY.NNNN" (NOT the old hand-
            # rolled "CT-YYYY-NNN"). Matches what the API/draft-applier produce.
            assert t.treatment_number.startswith("CON")
            assert "." in t.treatment_number
            # treatment_type MUST stay within the canonical enum the API/UI
            # validate against (frontend procedures.ts treatment_type +
            # treatment_type lookup vocabulary). Granular intervention kinds
            # (cleaning, repair, ...) map to these via _CANONICAL_TYPE; the
            # stored value is never the granular kind. Do not widen this set
            # without also widening the Zod enum + lookup vocab.
            assert t.treatment_type in {
                "preventive", "remedial", "restoration", "analysis", "other",
            }, f"non-canonical treatment_type {t.treatment_type!r}"
            assert t.status in {
                "proposed", "pending_approval", "approved", "in_progress",
                "on_hold", "completed", "cancelled",
            }
            assert t.object_id is not None  # Schema requires it.

    def test_re_run_is_no_op(
        self, db_session, org_id, admin_user_id, seeded_objects
    ):
        seed_conservation(
            db_session, org_id=org_id, admin_user_id=admin_user_id
        )
        result = seed_conservation(
            db_session, org_id=org_id, admin_user_id=admin_user_id
        )
        assert result["skipped_at_target"] is True
        assert result["treatments_created"] == 0

    def test_skips_when_no_objects(self, db_session, org_id, admin_user_id):
        result = seed_conservation(
            db_session, org_id=org_id, admin_user_id=admin_user_id
        )
        assert result.get("skipped_no_objects") is True
        assert result["treatments_created"] == 0

    def test_requires_org_and_admin_user_id(self, db_session):
        with pytest.raises(ValueError, match="org_id"):
            seed_conservation(
                db_session, org_id=None, admin_user_id=uuid.uuid4()  # type: ignore[arg-type]
            )


# ---------------------------------------------------------------------------
# seed_condition_reports — real DB writes
# ---------------------------------------------------------------------------

class TestSeedConditionReports:
    @pytest.fixture
    def org_id(self, db_session):
        from app.models import Organization

        org = Organization(
            name="Sandbox CR Test Org",
            slug=f"sbx-cr-{uuid.uuid4().hex[:8]}",
            is_demo=True,
            status="active",
        )
        db_session.add(org)
        db_session.commit()
        return org.organization_id

    @pytest.fixture
    def admin_user_id(self, db_session, org_id):
        from app.models import User

        user = User(
            email=f"admin-{uuid.uuid4().hex[:6]}@example.org",
            display_name="Sandbox Admin",
            status="active",
        )
        db_session.add(user)
        db_session.commit()
        return user.user_id

    @pytest.fixture
    def seeded_objects(self, db_session, org_id):
        from app.models.objects import CollectionObject

        rows = []
        for i in range(10):
            prefix = ("MET", "SI", "RIJKS")[i % 3]
            obj = CollectionObject(
                organization_id=org_id,
                object_number=f"{prefix}-CR-{i:03d}",
                object_name=f"Test Object {i}",
            )
            db_session.add(obj)
            rows.append(obj)
        db_session.commit()
        return rows

    def test_creates_periodic_reports_when_no_procedures(
        self, db_session, org_id, admin_user_id, seeded_objects
    ):
        # No conservation treatments and no loans seeded — reports come
        # from the periodic-survey path only.
        result = seed_condition_reports(
            db_session, org_id=org_id, admin_user_id=admin_user_id
        )
        assert result["skipped_at_target"] is False
        assert result["reports_created"] >= 1

        from app.models.objects import ConditionReport

        reports = (
            db_session.query(ConditionReport).filter_by(organization_id=org_id).all()
        )
        for r in reports:
            # Canonical report_number from next_sequential_number via
            # create_condition_report: "CRYYYY.NNNN" (NOT the old "CR-YYYY-NNN").
            assert r.report_number.startswith("CR")
            assert "." in r.report_number
            # Canonical report_type enum only (frontend procedures.ts). Do not
            # re-add pre_treatment/post_treatment/loan_return — those drifted
            # values are what the UI rejected with "Invalid input".
            assert r.report_type in {
                "intake", "loan_out", "loan_in",
                "periodic", "conservation", "incident",
            }
            assert r.status in {"draft", "completed", "reviewed", "superseded"}
            if r.overall_condition is not None:
                assert r.overall_condition in {
                    "excellent", "good", "fair", "poor", "unacceptable",
                }
        # Periodic-only path should produce only periodic reports.
        assert all(r.report_type == "periodic" for r in reports)

    def test_links_reports_to_treatments_and_loans(
        self, db_session, org_id, admin_user_id, seeded_objects
    ):
        # Seed reference data + treatments + loans so condition reports
        # can hang off those procedures.
        seed_reference_data(db_session, org_id)
        seed_conservation(
            db_session, org_id=org_id, admin_user_id=admin_user_id
        )
        seed_loans(
            db_session, org_id=org_id, admin_user_id=admin_user_id
        )

        result = seed_condition_reports(
            db_session, org_id=org_id, admin_user_id=admin_user_id
        )
        assert result["reports_created"] >= 5

        from app.models.objects import ConditionReport

        reports = (
            db_session.query(ConditionReport).filter_by(organization_id=org_id).all()
        )
        types = {r.report_type for r in reports}
        # report_type MUST stay within the canonical enum the API/UI validate
        # against (frontend procedures.ts report_type). Pre-/post-treatment and
        # loan-return nuance lives in the summary text, not the type.
        assert types <= {
            "intake", "loan_out", "loan_in", "periodic", "conservation", "incident",
        }, f"non-canonical report_type(s): {types}"
        # At minimum we should see a conservation (pre-treatment) report + a periodic.
        assert "conservation" in types
        assert "periodic" in types
        # Linked-entity-type values cover both procedure flavours.
        linked = {r.linked_entity_type for r in reports if r.linked_entity_type}
        assert "conservation_treatment" in linked or not any(
            r.linked_entity_type == "conservation_treatment" for r in reports
        )

        # Loan condition reports must back-link to the LoanOutObject FK slots
        # the workspace renders (condition_report_out_id / _return_id) — not just
        # the polymorphic linked_entity. Empty FKs left the slots blank before.
        from app.models.procedures import LoanOut, LoanOutObject

        dispatched_loans = (
            db_session.query(LoanOut)
            .filter(
                LoanOut.organization_id == org_id,
                LoanOut.status.in_(["on_loan", "returned"]),
            )
            .all()
        )
        if dispatched_loans:
            loan_objs = (
                db_session.query(LoanOutObject)
                .filter(
                    LoanOutObject.loan_out_id.in_(
                        [lo.loan_out_id for lo in dispatched_loans]
                    )
                )
                .all()
            )
            assert loan_objs, "dispatched loans should have loan objects"
            # Every dispatched loan object has its outgoing condition report linked.
            assert all(lo.condition_report_out_id is not None for lo in loan_objs)
            # Returned loans additionally have the return condition report linked.
            returned_ids = {
                lo.loan_out_id for lo in dispatched_loans if lo.status == "returned"
            }
            returned_objs = [
                lo for lo in loan_objs if lo.loan_out_id in returned_ids
            ]
            if returned_objs:
                assert all(
                    lo.condition_report_return_id is not None for lo in returned_objs
                )

    def test_re_run_is_no_op(
        self, db_session, org_id, admin_user_id, seeded_objects
    ):
        seed_condition_reports(
            db_session, org_id=org_id, admin_user_id=admin_user_id
        )
        result = seed_condition_reports(
            db_session, org_id=org_id, admin_user_id=admin_user_id
        )
        assert result["skipped_at_target"] is True
        assert result["reports_created"] == 0

    def test_requires_org_and_admin_user_id(self, db_session):
        with pytest.raises(ValueError, match="org_id"):
            seed_condition_reports(
                db_session, org_id=None, admin_user_id=uuid.uuid4()  # type: ignore[arg-type]
            )

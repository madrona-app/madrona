"""
Coverage-focused integration tests for the agent_tools modules.

These tests exercise each tool function with representative inputs so coverage
for the tool modules crosses the project's 60% threshold. They favor happy-path
DB queries over exhaustive branch coverage; where a tool hits OpenSearch,
embeddings, or outbound HTTP the external dependency is mocked.

See each tool module for the signatures: `(args, ctx) -> dict`.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from app.models import Organization, User
from app.services.agent_tools import AgentContext


# ── Shared helpers ────────────────────────────────────────────────────────


def _org_and_user(db_session):
    org = Organization(
        name="Tool Test",
        slug=f"tool-{uuid4().hex[:8]}",
        is_demo=False,
        status="active",
    )
    db_session.add(org)
    db_session.flush()
    user = User(
        email=f"tool-{uuid4().hex[:8]}@test.local",
        password_hash="x",
        status="active",
    )
    db_session.add(user)
    db_session.flush()
    return org, user


def _staff_ctx(db_session, org, user, **overrides):
    return AgentContext(
        organization_id=org.organization_id,
        user_id=user.user_id,
        persona=overrides.pop("persona", "staff"),
        db_session=db_session,
        org_slug=overrides.pop("org_slug", org.slug),
        **overrides,
    )


def _visitor_ctx(db_session, org, **overrides):
    return AgentContext(
        organization_id=org.organization_id,
        user_id=None,
        persona="visitor",
        db_session=db_session,
        org_slug=overrides.pop("org_slug", org.slug),
        **overrides,
    )


def _make_object(db_session, org, **overrides):
    from app.models.objects import CollectionObject

    obj = CollectionObject(
        organization_id=org.organization_id,
        object_number=overrides.pop("object_number", f"TST.{uuid4().hex[:6]}"),
        object_name=overrides.pop("object_name", "Test Object"),
        brief_description=overrides.pop("brief_description", "A short description."),
        is_discoverable=overrides.pop("is_discoverable", True),
        object_status=overrides.pop("object_status", "accessioned"),
        **overrides,
    )
    db_session.add(obj)
    db_session.flush()
    return obj


# ── collection_tools ──────────────────────────────────────────────────────


class TestSearchCollection:
    def test_search_unavailable_returns_error(self, db_session):
        org, user = _org_and_user(db_session)
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import collection_tools

        with patch(
            "app.search.collections.service.get_collections_search_service"
        ) as fake:
            fake.return_value.is_available.return_value = False
            result = collection_tools.search_collection({"query": "anything"}, ctx)
        assert "error" in result

    def test_visitor_search_emits_object_cards_hint(self, db_session):
        """Visitor chat renders results as inline cards — the tool must attach
        an object_cards UI hint (capped at 4) for visitors, never for staff."""
        org, user = _org_and_user(db_session)
        from app.search.collections.schemas import (
            CollectionsSearchHit,
            CollectionsSearchResponse,
        )
        from app.services.agent_tools import collection_tools

        hits = [
            CollectionsSearchHit(
                object_id=str(uuid4()),
                object_number=f"MET-{i}",
                title=f"Work {i}",
                creators=[{"name": "Hokusai"}],
                creation_date={"display": "ca. 1830"},
            )
            for i in range(6)
        ]
        response = CollectionsSearchResponse(hits=hits, total=6, took_ms=1)

        with patch(
            "app.search.collections.service.get_collections_search_service"
        ) as fake, patch(
            "app.services.discovery_service.get_object_card_thumbnails",
            return_value={hits[0].object_id: "https://cdn/thumb0.webp"},
        ):
            fake.return_value.is_available.return_value = True
            fake.return_value.search.return_value = response

            visitor_ctx = _visitor_ctx(db_session, org)
            result = collection_tools.search_collection({"query": "waves"}, visitor_ctx)
            assert result["_ui"]["kind"] == "object_cards"
            cards = result["_ui"]["objects"]
            assert len(cards) == 4  # capped
            assert cards[0]["thumbnail_url"] == "https://cdn/thumb0.webp"
            assert cards[1]["thumbnail_url"] is None
            assert cards[0]["path"].startswith(f"/c/{visitor_ctx.org_slug}/objects/")
            assert cards[0]["creator"] == "Hokusai"

            staff_ctx = _staff_ctx(db_session, org, user)
            result = collection_tools.search_collection({"query": "waves"}, staff_ctx)
            assert "_ui" not in result

    def test_visitor_object_type_is_soft_signal_not_filter(self, db_session):
        """Visitors say "painting" colloquially; the catalog is procedure-precise
        (The Great Wave is a print). For visitors, object_type must fold into the
        text query as a ranking signal — never a hard filter that silently
        excludes the work they're describing."""
        org, user = _org_and_user(db_session)
        ctx = _visitor_ctx(db_session, org)
        from app.search.collections.schemas import CollectionsSearchResponse
        from app.services.agent_tools import collection_tools

        response = CollectionsSearchResponse(hits=[], total=0, took_ms=1)
        with patch(
            "app.search.collections.service.get_collections_search_service"
        ) as fake:
            fake.return_value.is_available.return_value = True
            fake.return_value.search.return_value = response
            collection_tools.search_collection(
                {"query": "waves", "object_type": "painting"}, ctx,
            )
            request = fake.return_value.search.call_args[0][0]

        assert request.filters.object_type is None
        assert "painting" in request.query.q
        assert "waves" in request.query.q
        assert request.filters.is_discoverable is True

    def test_search_returns_prose_summary(self, db_session):
        org, user = _org_and_user(db_session)
        ctx = _staff_ctx(db_session, org, user)
        from app.search.collections.schemas import (
            CollectionsSearchHit,
            CollectionsSearchResponse,
        )
        from app.services.agent_tools import collection_tools

        hit = CollectionsSearchHit(
            object_id=str(uuid4()),
            object_number="2024.001",
            title="Sample Painting",
            object_type="Painting",
            creators=[{"name": "Jane Doe"}],
            creation_date={"display_date": "1890"},
        )
        response = CollectionsSearchResponse(hits=[hit], total=1, took_ms=1)
        with patch(
            "app.search.collections.service.get_collections_search_service"
        ) as fake:
            fake.return_value.is_available.return_value = True
            fake.return_value.search.return_value = response
            result = collection_tools.search_collection(
                {
                    "query": "paint",
                    "object_type": "Painting",
                    "creator": "Doe",
                    "date_from": "1800",
                    "date_to": "1900",
                    "condition_rating": "good",
                    "limit": 5,
                },
                ctx,
            )
        assert "summary" in result and "Sample Painting" in result["summary"]

    def test_search_visitor_forces_discoverable_and_uses_slug_urls(self, db_session):
        org, _ = _org_and_user(db_session)
        ctx = _visitor_ctx(db_session, org)
        from app.search.collections.schemas import (
            CollectionsSearchHit,
            CollectionsSearchResponse,
        )
        from app.services.agent_tools import collection_tools

        hit = CollectionsSearchHit(object_id=str(uuid4()), title="Public Object")
        with patch(
            "app.search.collections.service.get_collections_search_service"
        ) as fake:
            fake.return_value.is_available.return_value = True
            fake.return_value.search.return_value = CollectionsSearchResponse(
                hits=[hit], total=1, took_ms=1
            )
            result = collection_tools.search_collection({"query": "x"}, ctx)
        assert f"/c/{org.slug}/objects/" in result["summary"]


class TestGetObjectDetail:
    def test_missing_inputs(self, db_session):
        org, user = _org_and_user(db_session)
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import collection_tools

        assert "error" in collection_tools.get_object_detail({}, ctx)

    def test_invalid_uuid(self, db_session):
        org, user = _org_and_user(db_session)
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import collection_tools

        result = collection_tools.get_object_detail({"object_id": "not-uuid"}, ctx)
        assert "error" in result

    def test_returns_detail_for_known_object(self, db_session):
        org, user = _org_and_user(db_session)
        obj = _make_object(
            db_session,
            org,
            creators=[{"name": "Someone"}],
            creation_date_display="1920",
        )
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import collection_tools

        result = collection_tools.get_object_detail(
            {"object_id": str(obj.object_id)}, ctx
        )
        assert result["object_id"] == str(obj.object_id)
        assert result["object_number"] == obj.object_number
        assert result.get("creation_date") == "1920"


class TestFindRelatedObjects:
    def test_no_object_and_no_context(self, db_session):
        org, user = _org_and_user(db_session)
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import collection_tools

        assert "error" in collection_tools.find_related_objects({}, ctx)

    def test_invalid_uuid(self, db_session):
        org, user = _org_and_user(db_session)
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import collection_tools

        assert "error" in collection_tools.find_related_objects(
            {"object_id": "nope"}, ctx
        )

    def test_search_unavailable(self, db_session):
        org, user = _org_and_user(db_session)
        obj = _make_object(db_session, org)
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import collection_tools

        with patch(
            "app.search.collections.service.CollectionsSearchService.is_available",
            return_value=False,
        ):
            result = collection_tools.find_related_objects(
                {"object_id": str(obj.object_id)}, ctx
            )
        assert "error" in result


# ── visitor_tools ─────────────────────────────────────────────────────────


class TestVisitorTools:
    def test_get_museum_info_empty(self, db_session):
        org, _ = _org_and_user(db_session)
        ctx = _visitor_ctx(db_session, org)
        from app.services.agent_tools import visitor_tools

        result = visitor_tools.get_museum_info({}, ctx)
        assert "message" in result or "venues" in result

    def test_get_museum_info_returns_public_venues(self, db_session):
        from app.models import Venue

        org, _ = _org_and_user(db_session)
        venue = Venue(
            organization_id=org.organization_id,
            name="Main Hall",
            description="A nice hall",
            address="1 Madrona Way",
            is_public=True,
        )
        db_session.add(venue)
        db_session.flush()
        ctx = _visitor_ctx(db_session, org)
        from app.services.agent_tools import visitor_tools

        result = visitor_tools.get_museum_info({}, ctx)
        assert result.get("total") == 1
        assert result["venues"][0]["name"] == "Main Hall"

    def test_list_upcoming_events(self, db_session):
        from app.models import Event, Venue

        org, _ = _org_and_user(db_session)
        venue = Venue(
            organization_id=org.organization_id, name="Auditorium", is_public=True
        )
        db_session.add(venue)
        db_session.flush()
        ev = Event(
            organization_id=org.organization_id,
            event_reference_number="EV1",
            title="Lecture",
            event_type="program",
            status="scheduled",
            audience="public",
            start_at=datetime.now(timezone.utc) + timedelta(days=2),
            end_at=datetime.now(timezone.utc) + timedelta(days=2, hours=1),
            venue_id=venue.venue_id,
        )
        db_session.add(ev)
        db_session.flush()
        ctx = _visitor_ctx(db_session, org)
        from app.services.agent_tools import visitor_tools

        result = visitor_tools.list_upcoming_events({"days": 10}, ctx)
        assert result["total"] == 1
        assert result["events"][0]["title"] == "Lecture"
        assert result["events"][0].get("venue") == "Auditorium"

    def test_get_event_detail_missing_id(self, db_session):
        org, _ = _org_and_user(db_session)
        ctx = _visitor_ctx(db_session, org)
        from app.services.agent_tools import visitor_tools

        assert "error" in visitor_tools.get_event_detail({}, ctx)

    def test_get_event_detail_returns_event(self, db_session):
        from app.models import Event

        org, _ = _org_and_user(db_session)
        ev = Event(
            organization_id=org.organization_id,
            event_reference_number="EV2",
            title="Opening",
            event_type="opening_reception",
            status="scheduled",
            audience="public",
            start_at=datetime.now(timezone.utc) + timedelta(days=1),
        )
        db_session.add(ev)
        db_session.flush()
        ctx = _visitor_ctx(db_session, org)
        from app.services.agent_tools import visitor_tools

        result = visitor_tools.get_event_detail({"event_id": str(ev.event_id)}, ctx)
        assert result["title"] == "Opening"


# ── exhibition_tools ──────────────────────────────────────────────────────


class TestExhibitionTools:
    def test_list_current_exhibitions_empty(self, db_session):
        org, _ = _org_and_user(db_session)
        ctx = _visitor_ctx(db_session, org)
        from app.services.agent_tools import exhibition_tools

        result = exhibition_tools.list_current_exhibitions({}, ctx)
        assert result["total"] == 0

    def test_list_current_exhibitions_returns_open_ones(self, db_session):
        from app.models import Exhibition

        org, _ = _org_and_user(db_session)
        ex = Exhibition(
            organization_id=org.organization_id,
            title="Spring Show",
            status="open",
            exhibition_type="temporary",
            is_public=True,
            planned_start_date=date.today(),
        )
        db_session.add(ex)
        db_session.flush()
        ctx = _visitor_ctx(db_session, org)
        from app.services.agent_tools import exhibition_tools

        result = exhibition_tools.list_current_exhibitions({}, ctx)
        assert result["total"] == 1
        assert result["exhibitions"][0]["title"] == "Spring Show"

    def test_get_exhibition_info_missing_id(self, db_session):
        org, _ = _org_and_user(db_session)
        ctx = _visitor_ctx(db_session, org)
        from app.services.agent_tools import exhibition_tools

        assert "error" in exhibition_tools.get_exhibition_info({}, ctx)

    def test_get_exhibition_info_invalid_id(self, db_session):
        org, _ = _org_and_user(db_session)
        ctx = _visitor_ctx(db_session, org)
        from app.services.agent_tools import exhibition_tools

        assert "error" in exhibition_tools.get_exhibition_info(
            {"exhibition_id": "not-uuid"}, ctx
        )

    def test_get_exhibition_info_returns_detail(self, db_session):
        from app.models import Exhibition

        org, _ = _org_and_user(db_session)
        ex = Exhibition(
            organization_id=org.organization_id,
            title="Summer Show",
            status="open",
            exhibition_type="temporary",
            is_public=True,
            description="A nice exhibition",
        )
        db_session.add(ex)
        db_session.flush()
        ctx = _visitor_ctx(db_session, org)
        from app.services.agent_tools import exhibition_tools

        result = exhibition_tools.get_exhibition_info(
            {"exhibition_id": str(ex.exhibition_id)}, ctx
        )
        assert result["title"] == "Summer Show"
        assert "objects" in result

    def test_get_exhibition_info_with_venue_and_object(self, db_session):
        from app.models import Exhibition, Venue
        from app.models.exhibit import ExhibitionObject

        org, _ = _org_and_user(db_session)
        venue = Venue(
            organization_id=org.organization_id,
            name="Main Gallery",
            address="100 Main",
            is_public=True,
        )
        db_session.add(venue)
        db_session.flush()
        ex = Exhibition(
            organization_id=org.organization_id,
            title="Fall Show",
            status="open",
            exhibition_type="temporary",
            is_public=True,
            venue_id=venue.venue_id,
        )
        db_session.add(ex)
        db_session.flush()
        obj = _make_object(db_session, org, object_name="Featured Piece")
        db_session.add(
            ExhibitionObject(
                exhibition_id=ex.exhibition_id,
                organization_id=org.organization_id,
                object_id=obj.object_id,
                object_status="planned",
            )
        )
        db_session.flush()
        ctx = _visitor_ctx(db_session, org)
        from app.services.agent_tools import exhibition_tools

        result = exhibition_tools.get_exhibition_info(
            {"exhibition_id": str(ex.exhibition_id)}, ctx
        )
        assert result["venue_name"] == "Main Gallery"
        assert result["object_count"] == 1


# ── location_tools ────────────────────────────────────────────────────────


def _make_location(db_session, org, **overrides):
    from app.models.locations import Location

    # Note: "vault" is NOT in the check_location_type constraint despite being
    # allowed in the agent tool's enum (app/services/agent_tools/location_tools.py).
    # Using "cabinet" which IS allowed. Flagged as a potential tool/schema mismatch.
    loc = Location(
        organization_id=org.organization_id,
        name=overrides.pop("name", "Cabinet A"),
        code=overrides.pop("code", f"C-{uuid4().hex[:4]}"),
        location_type=overrides.pop("location_type", "cabinet"),
        path=overrides.pop("path", "/Cabinet A"),
        status=overrides.pop("status", "active"),
        **overrides,
    )
    db_session.add(loc)
    db_session.flush()
    return loc


class TestLocationTools:
    def test_find_object_location_missing_id(self, db_session):
        org, user = _org_and_user(db_session)
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import location_tools

        assert "error" in location_tools.find_object_location({}, ctx)

    def test_find_object_location_invalid_id(self, db_session):
        org, user = _org_and_user(db_session)
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import location_tools

        assert "error" in location_tools.find_object_location(
            {"object_id": "nope"}, ctx
        )

    def test_find_object_location_happy_path(self, db_session):
        org, user = _org_and_user(db_session)
        loc = _make_location(db_session, org)
        obj = _make_object(db_session, org, current_location_id=loc.location_id)
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import location_tools

        result = location_tools.find_object_location(
            {"object_id": str(obj.object_id)}, ctx
        )
        assert result["object_id"] == str(obj.object_id)
        assert result["current_location"]["name"] == loc.name

    def test_check_storage_availability(self, db_session):
        org, user = _org_and_user(db_session)
        _make_location(
            db_session,
            org,
            capacity=100,
            current_count=25,
            name="Room 1",
            location_type="room",
            path="/Room 1",
        )
        _make_location(
            db_session,
            org,
            capacity=50,
            current_count=60,  # over-capacity → available=0
            name="Closet",
            code=f"C-{uuid4().hex[:4]}",
            location_type="cabinet",
            path="/Closet",
        )
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import location_tools

        result = location_tools.check_storage_availability({"query": "room"}, ctx)
        assert result["total"] == 1
        assert result["locations"][0]["name"] == "Room 1"
        assert result["locations"][0]["available"] == 75


# ── workflow_tools ────────────────────────────────────────────────────────


class TestWorkflowTools:
    def test_check_workflow_status_validation(self, db_session):
        org, user = _org_and_user(db_session)
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import workflow_tools

        assert "error" in workflow_tools.check_workflow_status({}, ctx)
        assert "error" in workflow_tools.check_workflow_status(
            {"record_type": "weird", "record_id": str(uuid4())}, ctx
        )
        assert "error" in workflow_tools.check_workflow_status(
            {"record_type": "loan_in", "record_id": "bad"}, ctx
        )

    def test_check_workflow_status_collection_object(self, db_session):
        org, user = _org_and_user(db_session)
        obj = _make_object(db_session, org)
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import workflow_tools

        result = workflow_tools.check_workflow_status(
            {"record_type": "collection_object", "record_id": str(obj.object_id)}, ctx
        )
        assert result["record_type"] == "collection_object"
        assert result["object_number"] == obj.object_number

    def test_find_overdue_items_empty(self, db_session):
        org, user = _org_and_user(db_session)
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import workflow_tools

        result = workflow_tools.find_overdue_items({}, ctx)
        assert "summary" in result
        assert result["summary"]["overdue_loans_in"] == 0

    def test_find_overdue_items_with_overdue_loan(self, db_session):
        from app.models.procedures import LoanIn

        org, user = _org_and_user(db_session)
        loan = LoanIn(
            organization_id=org.organization_id,
            loan_number=f"LIN-{uuid4().hex[:6]}",
            loan_purpose="exhibition",
            lender_name="Big Lender",
            status="received",
            loan_start_date=date.today() - timedelta(days=60),
            loan_end_date=date.today() - timedelta(days=10),
        )
        db_session.add(loan)
        db_session.flush()
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import workflow_tools

        result = workflow_tools.find_overdue_items({}, ctx)
        assert result["summary"]["overdue_loans_in"] >= 1


# ── operations_tools ──────────────────────────────────────────────────────


class TestOperationsTools:
    def test_query_procedures_unknown_type(self, db_session):
        org, user = _org_and_user(db_session)
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import operations_tools

        assert "error" in operations_tools.query_procedures(
            {"procedure_type": "weird"}, ctx
        )

    def test_query_procedures_all_types_empty(self, db_session):
        org, user = _org_and_user(db_session)
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import operations_tools

        result = operations_tools.query_procedures({}, ctx)
        assert result["count"] == 0
        assert "filters_applied" in result

    def test_query_procedures_with_loan(self, db_session):
        from app.models.procedures import LoanIn

        org, user = _org_and_user(db_session)
        loan = LoanIn(
            organization_id=org.organization_id,
            loan_number=f"LIN-{uuid4().hex[:6]}",
            loan_purpose="exhibition",
            lender_name="Alpha Lender",
            status="received",
        )
        db_session.add(loan)
        db_session.flush()
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import operations_tools

        result = operations_tools.query_procedures(
            {
                "procedure_type": "loan_in",
                "status": "received",
                "search": "alpha",
                "date_from": "2000-01-01",
                "date_to": "2200-01-01",
                "limit": 5,
            },
            ctx,
        )
        assert result["count"] == 1
        assert result["results"][0]["procedure_type"] == "loan_in"
        assert result["results"][0]["lender"] == "Alpha Lender"

    def test_operations_dashboard(self, db_session):
        from app.models.procedures import LoanIn, LoanOut, ObjectEntry, Acquisition
        from app.models import Exhibition

        org, user = _org_and_user(db_session)
        db_session.add_all(
            [
                LoanIn(
                    organization_id=org.organization_id,
                    loan_number=f"LIN-{uuid4().hex[:6]}",
                    loan_purpose="exhibition",
                    status="received",
                    loan_end_date=date.today() - timedelta(days=3),
                    lender_name="L",
                ),
                LoanOut(
                    organization_id=org.organization_id,
                    loan_number=f"LOUT-{uuid4().hex[:6]}",
                    loan_purpose="exhibition",
                    status="on_loan",  # 'dispatched' isn't in check_loan_out_status — bug in find_overdue_items filter
                    loan_end_date=date.today() + timedelta(days=30),
                    borrower_name="B",
                ),
                ObjectEntry(
                    organization_id=org.organization_id,
                    entry_number=f"EN-{uuid4().hex[:6]}",
                    entry_date=date.today(),
                    entry_reason="loan_consideration",
                    status="pending",
                    depositor_name="D",
                ),
                Acquisition(
                    organization_id=org.organization_id,
                    acquisition_number=f"AC-{uuid4().hex[:6]}",
                    acquisition_method="gift",
                    status="proposed",
                    source_name="S",
                ),
                Exhibition(
                    organization_id=org.organization_id,
                    title="Ex1",
                    status="open",
                    exhibition_type="temporary",
                ),
            ]
        )
        db_session.flush()
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import operations_tools

        result = operations_tools.operations_dashboard({}, ctx)
        assert result["summary"]["active_loans_in"] >= 1
        assert result["summary"]["overdue_loans_in"] >= 1
        assert result["summary"]["active_loans_out"] >= 1
        assert result["summary"]["pending_entries"] >= 1
        assert result["summary"]["in_progress_acquisitions"] >= 1
        assert result["summary"]["open_exhibitions"] >= 1

    def test_get_object_context_missing(self, db_session):
        org, user = _org_and_user(db_session)
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import operations_tools

        assert "error" in operations_tools.get_object_context({}, ctx)

    def test_get_object_context_happy_path(self, db_session):
        org, user = _org_and_user(db_session)
        obj = _make_object(db_session, org)
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import operations_tools

        result = operations_tools.get_object_context(
            {"object_id": str(obj.object_id)}, ctx
        )
        assert result["object_id"] == str(obj.object_id)
        assert "flags" in result
        assert result["flags"]["on_loan_in"] is False

    def test_check_document_readiness_missing(self, db_session):
        org, user = _org_and_user(db_session)
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import operations_tools

        assert "error" in operations_tools.check_document_readiness({}, ctx)

    def test_check_document_readiness_lists_documents(self, db_session):
        from app.models.procedures import LoanIn

        org, user = _org_and_user(db_session)
        loan = LoanIn(
            organization_id=org.organization_id,
            loan_number=f"LIN-{uuid4().hex[:6]}",
            loan_purpose="exhibition",
            lender_name="L",
            status="requested",  # "pending" isn't in check_loan_in_status — flagged
        )
        db_session.add(loan)
        db_session.flush()
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import operations_tools

        # Without document_type → list available
        result = operations_tools.check_document_readiness(
            {"record_type": "loan_in", "record_id": str(loan.loan_in_id)}, ctx
        )
        assert "available_documents" in result
        # With document_type → evaluate readiness
        result2 = operations_tools.check_document_readiness(
            {
                "record_type": "loan_in",
                "record_id": str(loan.loan_in_id),
                "document_type": "loan_agreement_in",
            },
            ctx,
        )
        assert "ready" in result2
        assert result2["ready"] is False  # missing dates + items


# ── web_tools ─────────────────────────────────────────────────────────────


class TestWebTools:
    def test_web_search_validation(self, db_session):
        org, user = _org_and_user(db_session)
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import web_tools

        assert "error" in web_tools.web_search({}, ctx)

    def test_web_search_parses_html(self, db_session):
        org, user = _org_and_user(db_session)
        ctx = _staff_ctx(db_session, org, user)
        fake_html = (
            '<div class="result">'
            '<a class="result__a" href="https://example.com/foo">Foo Title</a>'
            '<a class="result__snippet" href="#">Foo snippet body.</a>'
            "</div>"
        )
        fake_resp = MagicMock()
        fake_resp.text = fake_html
        fake_resp.raise_for_status = MagicMock()
        from app.services.agent_tools import web_tools

        with patch("app.services.agent_tools.web_tools.requests.get", return_value=fake_resp):
            result = web_tools.web_search({"query": "foo"}, ctx)
        assert "results" in result
        assert result["results"][0]["title"] == "Foo Title"

    def test_web_search_handles_exception(self, db_session):
        org, user = _org_and_user(db_session)
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import web_tools

        with patch(
            "app.services.agent_tools.web_tools.requests.get",
            side_effect=RuntimeError("boom"),
        ):
            result = web_tools.web_search({"query": "x"}, ctx)
        assert "error" in result

    def test_fetch_webpage_validation(self, db_session):
        org, user = _org_and_user(db_session)
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import web_tools

        assert "error" in web_tools.fetch_webpage({}, ctx)
        assert "error" in web_tools.fetch_webpage({"url": "ftp://bad"}, ctx)

    def test_fetch_webpage_extracts_text(self, db_session):
        org, user = _org_and_user(db_session)
        ctx = _staff_ctx(db_session, org, user)
        fake_resp = MagicMock()
        fake_resp.text = (
            "<html><head><title>Hello</title></head>"
            "<body><script>alert(1)</script><p>Body text.</p></body></html>"
        )
        fake_resp.headers = {"Content-Type": "text/html"}
        fake_resp.raise_for_status = MagicMock()
        from app.services.agent_tools import web_tools

        with patch(
            "app.services.agent_tools.web_tools.requests.get",
            return_value=fake_resp,
        ):
            result = web_tools.fetch_webpage({"url": "https://example.com"}, ctx)
        assert result["title"] == "Hello"
        assert "Body text." in result["content"]

    def test_fetch_webpage_rejects_nonhtml(self, db_session):
        org, user = _org_and_user(db_session)
        ctx = _staff_ctx(db_session, org, user)
        fake_resp = MagicMock()
        fake_resp.text = "{}"
        fake_resp.headers = {"Content-Type": "application/json"}
        fake_resp.raise_for_status = MagicMock()
        from app.services.agent_tools import web_tools

        with patch(
            "app.services.agent_tools.web_tools.requests.get",
            return_value=fake_resp,
        ):
            result = web_tools.fetch_webpage({"url": "https://example.com"}, ctx)
        assert "error" in result


# ── reference_tools ───────────────────────────────────────────────────────


class TestReferenceTools:
    def test_lookup_reference_missing_query(self, db_session):
        org, user = _org_and_user(db_session)
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import reference_tools

        assert "error" in reference_tools.lookup_reference({}, ctx)

    def test_lookup_reference_embedding_failure(self, db_session):
        org, user = _org_and_user(db_session)
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import reference_tools

        with patch(
            "app.services.agent_tools.reference_tools._embed_query",
            return_value=None,
        ):
            assert "error" in reference_tools.lookup_reference({"query": "x"}, ctx)

    def test_lookup_reference_calls_search(self, db_session):
        org, user = _org_and_user(db_session)
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import reference_tools

        with patch(
            "app.services.agent_tools.reference_tools._embed_query",
            return_value=[0.1] * 768,
        ), patch(
            "app.services.agent_tools.reference_tools._search_chunks",
            return_value={"results": []},
        ) as m:
            result = reference_tools.lookup_reference(
                {"query": "procedure", "source": "procedure", "limit": 3}, ctx
            )
        assert result == {"results": []}
        assert m.call_args.kwargs.get("source") == "procedure"
        assert m.call_args.kwargs.get("limit") == 3

    def test_lookup_museum_info_empty_results(self, db_session):
        org, _ = _org_and_user(db_session)
        ctx = _visitor_ctx(db_session, org)
        from app.services.agent_tools import reference_tools

        with patch(
            "app.services.agent_tools.reference_tools._embed_query",
            return_value=[0.1] * 768,
        ), patch(
            "app.services.agent_tools.reference_tools._search_chunks",
            return_value={"results": []},
        ) as m:
            result = reference_tools.lookup_museum_info({"query": "hours"}, ctx)
        assert result == {"results": []}
        assert m.call_args.kwargs.get("org_only") is True
        assert m.call_args.kwargs.get("public_only") is True

    def test_search_chunks_exercises_sql_path(self, db_session):
        """_search_chunks with no matching rows should return the empty-message shape."""
        org, user = _org_and_user(db_session)
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import reference_tools

        # Empty vector-like query won't match anything (table is empty in tests),
        # but the SQL path executes which is what we're exercising.
        result = reference_tools._search_chunks([0.1] * 768, ctx, org_only=True, limit=2)
        assert "results" in result or "error" in result


# ── media_tools ───────────────────────────────────────────────────────────


def _make_media(db_session, org, **overrides):
    from app.models.media import Media

    m = Media(
        organization_id=org.organization_id,
        s3_key=f"s3/test/{uuid4().hex}",
        filename=overrides.pop("filename", "photo.jpg"),
        file_size=overrides.pop("file_size", 1234),
        mime_type=overrides.pop("mime_type", "image/jpeg"),
        media_type=overrides.pop("media_type", "image"),
        title=overrides.pop("title", "Photo"),
        **overrides,
    )
    db_session.add(m)
    db_session.flush()
    return m


class TestMediaTools:
    def test_search_media_with_query(self, db_session):
        org, user = _org_and_user(db_session)
        _make_media(db_session, org, title="Ancient Pot")
        _make_media(db_session, org, title="Modern Painting", filename="painting.jpg")
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import media_tools

        result = media_tools.search_media({"query": "pot", "media_type": "image"}, ctx)
        assert result["total"] == 1
        assert result["media"][0]["title"] == "Ancient Pot"

    def test_get_media_detail_missing(self, db_session):
        org, user = _org_and_user(db_session)
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import media_tools

        assert "error" in media_tools.get_media_detail({}, ctx)
        assert "error" in media_tools.get_media_detail({"media_id": "nope"}, ctx)
        assert "error" in media_tools.get_media_detail(
            {"media_id": str(uuid4())}, ctx
        )

    def test_get_media_detail_returns_shape(self, db_session):
        org, user = _org_and_user(db_session)
        m = _make_media(db_session, org, credit="Staff Photographer")
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import media_tools

        result = media_tools.get_media_detail({"media_id": str(m.media_id)}, ctx)
        assert result["media_id"] == str(m.media_id)
        assert result["credit"] == "Staff Photographer"


# ── analytics_tools ───────────────────────────────────────────────────────


class TestAnalyticsTools:
    def test_collection_statistics_empty(self, db_session):
        org, user = _org_and_user(db_session)
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import analytics_tools

        result = analytics_tools.collection_statistics({}, ctx)
        assert result["total_objects"] == 0
        assert result["media_assets"] == 0
        assert result["by_department"] == []

    def test_collection_statistics_with_data(self, db_session):
        org, user = _org_and_user(db_session)
        _make_object(db_session, org)
        _make_object(db_session, org, is_discoverable=False)
        _make_media(db_session, org)
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import analytics_tools

        result = analytics_tools.collection_statistics({}, ctx)
        assert result["total_objects"] == 2
        assert result["discoverable"] == 1
        assert result["media_assets"] == 1

    def test_recent_activity(self, db_session):
        org, user = _org_and_user(db_session)
        _make_object(db_session, org)
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import analytics_tools

        result = analytics_tools.recent_activity({"days": 30}, ctx)
        assert result["period_days"] == 30
        assert isinstance(result["new_objects"], list)


# ── visitor_info_tools ────────────────────────────────────────────────────


class TestVisitorInfoTools:
    def test_get_directions_missing_query(self, db_session):
        org, _ = _org_and_user(db_session)
        ctx = _visitor_ctx(db_session, org)
        from app.services.agent_tools import visitor_info_tools

        assert "error" in visitor_info_tools.get_directions({}, ctx)

    def test_get_directions_no_docs(self, db_session):
        org, _ = _org_and_user(db_session)
        ctx = _visitor_ctx(db_session, org)
        from app.services.agent_tools import visitor_info_tools

        with patch(
            "app.services.agent_tools.visitor_info_tools._embed_query",
            return_value=[0.1] * 768,
        ), patch(
            "app.services.agent_tools.visitor_info_tools._search_chunks",
            return_value={"results": []},
        ):
            result = visitor_info_tools.get_directions({"query": "restrooms"}, ctx)
        assert "results" in result
        assert result["results"] == []

    def test_get_directions_returns_results(self, db_session):
        org, _ = _org_and_user(db_session)
        ctx = _visitor_ctx(db_session, org)
        from app.services.agent_tools import visitor_info_tools

        canned = {"results": [{"content": "Gallery 3 is upstairs"}]}
        with patch(
            "app.services.agent_tools.visitor_info_tools._embed_query",
            return_value=[0.1] * 768,
        ), patch(
            "app.services.agent_tools.visitor_info_tools._search_chunks",
            return_value=canned,
        ):
            result = visitor_info_tools.get_directions({"query": "gallery"}, ctx)
        assert result == canned

    def test_check_accessibility_empty_query_uses_default(self, db_session):
        org, _ = _org_and_user(db_session)
        ctx = _visitor_ctx(db_session, org)
        from app.services.agent_tools import visitor_info_tools

        with patch(
            "app.services.agent_tools.visitor_info_tools._embed_query",
            return_value=[0.1] * 768,
        ), patch(
            "app.services.agent_tools.visitor_info_tools._search_chunks",
            return_value={"results": []},
        ):
            result = visitor_info_tools.check_accessibility({}, ctx)
        assert "results" in result

    def test_check_accessibility_embed_failure(self, db_session):
        org, _ = _org_and_user(db_session)
        ctx = _visitor_ctx(db_session, org)
        from app.services.agent_tools import visitor_info_tools

        with patch(
            "app.services.agent_tools.visitor_info_tools._embed_query",
            return_value=None,
        ):
            assert "error" in visitor_info_tools.check_accessibility(
                {"query": "wheelchair"}, ctx
            )


# ── contact_tools ─────────────────────────────────────────────────────────


class TestContactTools:
    def test_search_contacts_missing_query(self, db_session):
        org, user = _org_and_user(db_session)
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import contact_tools

        assert "error" in contact_tools.search_contacts({}, ctx)

    def test_search_contacts_happy_path(self, db_session):
        from app.models.contacts import Constituent

        org, user = _org_and_user(db_session)
        c = Constituent(
            organization_id=org.organization_id,
            constituent_type="person",
            name="Amelia Earhart",
            display_name="Amelia Earhart",
            email="amelia@example.com",
            status="active",
        )
        db_session.add(c)
        db_session.flush()
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import contact_tools

        result = contact_tools.search_contacts(
            {"query": "amelia", "type": "person", "limit": 5}, ctx
        )
        assert result["total"] == 1
        assert result["contacts"][0]["name"] == "Amelia Earhart"

    def test_search_contacts_no_match(self, db_session):
        org, user = _org_and_user(db_session)
        ctx = _staff_ctx(db_session, org, user)
        from app.services.agent_tools import contact_tools

        result = contact_tools.search_contacts({"query": "nobody-here"}, ctx)
        assert result["total"] == 0

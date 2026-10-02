"""
Tests for Exhibition Execution Pack Export functionality.

Tests the data fetching helpers and PDF/CSV generators:
- Checklist PDF
- Shipment Summary PDF
- Object List CSV
- Object List PDF
- Budget CSV
"""
import pytest
from datetime import date, datetime, timedelta
from uuid import uuid4

from app.models import (
    Organization,
    User,
    OrganizationMembership,
    Exhibition,
    Placement,
    FloorPlan,
    Venue,
    ExhibitionChecklist,
    ChecklistItem,
    ChecklistPhase,
    ChecklistItemStatus,
    ChecklistRole,
    Shipment,
    ShipmentItem,
    ShipmentReference,
    ExhibitionLoan,
    ExhibitionLoanObject,
    LoanStatus,
    ExhibitionBudgetLine,
    BudgetCategory,
)

# Import the helpers we're testing
from app.fastapi_app.routers.exhibit_exports import (
    _get_checklist_export_data,
    _get_shipment_export_data,
    _get_object_list_export_data,
    _get_budget_export_data,
    _safe_filename,
)
from app.services.exhibit_pdf_service import (
    ChecklistPDFGenerator,
    ShipmentSummaryPDFGenerator,
    ObjectListPDFGenerator,
)


# ============================================================================
# FIXTURES
# ============================================================================

@pytest.fixture
def test_org(postgres_session):
    """Create a test organization."""
    org = Organization(
        name="Test Museum",
        slug="test-museum",
        is_demo=False,
        status="active",
    )
    postgres_session.add(org)
    postgres_session.flush()
    return org


@pytest.fixture
def test_user(postgres_session, test_org):
    """Create a test user with admin permissions."""
    user = User(
        email="admin@testmuseum.org",
        display_name="Test Admin",
        status="active",
    )
    postgres_session.add(user)
    postgres_session.flush()

    from app.models import Role
    role = Role(
        role_key=f"exec-pack-admin-{user.user_id.hex[:8]}",
        display_name="Exec Pack Admin",
        is_system=False,
    )
    postgres_session.add(role)
    postgres_session.flush()

    membership = OrganizationMembership(
        user_id=user.user_id,
        organization_id=test_org.organization_id,
        role="admin",
        role_id=role.role_id,
        status="active",
    )
    postgres_session.add(membership)
    postgres_session.flush()
    return user


@pytest.fixture
def setup_exhibition_with_full_data(postgres_session, test_org, test_user):
    """Create an exhibition with checklist items, shipments, placements, loans, and budget."""
    # Create venue and floor plan
    venue = Venue(
        organization_id=test_org.organization_id,
        name="Test Venue",
        created_by=test_user.user_id,
    )
    postgres_session.add(venue)
    postgres_session.flush()

    floor_plan = FloorPlan(
        venue_id=venue.venue_id,
        name="Gallery 1",
        geometry={"type": "rectangular", "width_cm": 800, "depth_cm": 600},
    )
    postgres_session.add(floor_plan)
    postgres_session.flush()

    # Create exhibition
    exhibition = Exhibition(
        organization_id=test_org.organization_id,
        venue_id=venue.venue_id,
        title="Test Exhibition for Exports",
        status="in_preparation",
        planned_start_date=date.today() + timedelta(days=30),
        planned_end_date=date.today() + timedelta(days=90),
        created_by=test_user.user_id,
    )
    postgres_session.add(exhibition)
    postgres_session.flush()

    # Create checklist with items across phases
    checklist = ExhibitionChecklist(
        exhibition_id=exhibition.exhibition_id,
        name="Main Checklist",
        created_by=test_user.user_id,
    )
    postgres_session.add(checklist)
    postgres_session.flush()

    # Add checklist items
    checklist_items = [
        ChecklistItem(
            checklist_id=checklist.checklist_id,
            phase=ChecklistPhase.PLANNING,
            title="Confirm loan agreements",
            status=ChecklistItemStatus.DONE,
            responsible_role=ChecklistRole.REGISTRAR,
            due_date=date.today() - timedelta(days=10),
        ),
        ChecklistItem(
            checklist_id=checklist.checklist_id,
            phase=ChecklistPhase.PLANNING,
            title="Finalize object list",
            status=ChecklistItemStatus.IN_PROGRESS,
            responsible_role=ChecklistRole.CURATOR,
            due_date=date.today() + timedelta(days=5),
            assigned_user_id=test_user.user_id,
        ),
        ChecklistItem(
            checklist_id=checklist.checklist_id,
            phase=ChecklistPhase.PRE_INSTALL,
            title="Order crates",
            status=ChecklistItemStatus.TODO,
            responsible_role=ChecklistRole.REGISTRAR,
            due_date=date.today() + timedelta(days=15),
        ),
        ChecklistItem(
            checklist_id=checklist.checklist_id,
            phase=ChecklistPhase.INSTALL,
            title="Install artworks",
            status=ChecklistItemStatus.TODO,
            responsible_role=ChecklistRole.PREPARATOR,
            due_date=date.today() + timedelta(days=28),
        ),
        ChecklistItem(
            checklist_id=checklist.checklist_id,
            phase=ChecklistPhase.OPEN,
            title="Opening reception",
            status=ChecklistItemStatus.BLOCKED,
            responsible_role=ChecklistRole.MARKETING,
            due_date=date.today() + timedelta(days=30),
        ),
    ]
    for item in checklist_items:
        postgres_session.add(item)
    postgres_session.flush()

    # Create shipments (generic Shipment linked to exhibition via ShipmentReference)
    inbound_shipment = Shipment(
        organization_id=test_org.organization_id,
        shipment_number="SHIP-001",
        shipment_type="outbound",
        direction="inbound",
        purpose="exhibition",
        status="in_transit",
        estimated_dispatch_date=date.today() - timedelta(days=5),
        estimated_arrival_date=date.today() + timedelta(days=2),
    )
    postgres_session.add(inbound_shipment)
    postgres_session.flush()

    inbound_ref = ShipmentReference(
        organization_id=test_org.organization_id,
        shipment_id=inbound_shipment.shipment_id,
        procedure_type="exhibition_venue",
        procedure_id=exhibition.exhibition_id,
    )
    postgres_session.add(inbound_ref)

    outbound_shipment = Shipment(
        organization_id=test_org.organization_id,
        shipment_number="SHIP-002",
        shipment_type="outbound",
        direction="outbound",
        purpose="exhibition",
        status="confirmed",
        estimated_dispatch_date=date.today() + timedelta(days=95),
        estimated_arrival_date=date.today() + timedelta(days=100),
    )
    postgres_session.add(outbound_shipment)
    postgres_session.flush()

    outbound_ref = ShipmentReference(
        organization_id=test_org.organization_id,
        shipment_id=outbound_shipment.shipment_id,
        procedure_type="exhibition_venue",
        procedure_id=exhibition.exhibition_id,
    )
    postgres_session.add(outbound_ref)
    postgres_session.flush()

    # Create placements with source objects — seed real CollectionObject rows
    # so downstream ShipmentItems can FK-link to them.
    from app.models import CollectionObject
    _objs = []
    for i in range(3):
        _obj = CollectionObject(
            organization_id=test_org.organization_id,
            object_number=f"EXEC.{i+1}.{uuid4().hex[:6]}",
            object_type="painting",
            object_status="accessioned",
        )
        postgres_session.add(_obj)
        _objs.append(_obj)
    postgres_session.flush()
    object_id_1 = _objs[0].object_id
    object_id_2 = _objs[1].object_id
    object_id_3 = _objs[2].object_id

    placements = [
        Placement(
            exhibition_id=exhibition.exhibition_id,
            floor_plan_id=floor_plan.floor_plan_id,
            source_type="collections",
            source_id=object_id_1,
            display_title="Starry Night",
            display_artist="Vincent van Gogh",
            width_cm=73.7,
            height_cm=92.1,
            wall_id="north",
            position_x=200,
            position_y=150,
            mount_type="wall",
            placement_status="approved",
        ),
        Placement(
            exhibition_id=exhibition.exhibition_id,
            floor_plan_id=floor_plan.floor_plan_id,
            source_type="collections",
            source_id=object_id_2,
            display_title="The Persistence of Memory",
            display_artist="Salvador Dalí",
            width_cm=24,
            height_cm=33,
            wall_id="east",
            position_x=100,
            position_y=140,
            mount_type="wall",
            placement_status="proposed",
        ),
        Placement(
            exhibition_id=exhibition.exhibition_id,
            floor_plan_id=floor_plan.floor_plan_id,
            source_type="collections",
            source_id=object_id_3,
            display_title="The Thinker",
            display_artist="Auguste Rodin",
            width_cm=98,
            height_cm=189,
            depth_cm=140,
            wall_id="floor",
            position_x=400,
            position_y=0,
            floor_position_x=200,
            floor_position_y=150,
            mount_type="plinth",
            placement_status="draft",
        ),
    ]
    for p in placements:
        postgres_session.add(p)
    postgres_session.flush()

    # Create shipment items with packing notes
    shipment_item_1 = ShipmentItem(
        organization_id=test_org.organization_id,
        shipment_id=inbound_shipment.shipment_id,
        object_id=object_id_1,
        packing_notes="Handle with extreme care. Climate controlled.",
        status="pending",
    )
    shipment_item_2 = ShipmentItem(
        organization_id=test_org.organization_id,
        shipment_id=inbound_shipment.shipment_id,
        object_id=object_id_2,
        packing_notes="Fragile frame. Do not stack.",
        status="pending",
    )
    postgres_session.add(shipment_item_1)
    postgres_session.add(shipment_item_2)
    postgres_session.flush()

    # Create loans for some objects
    loan = ExhibitionLoan(
        organization_id=test_org.organization_id,
        exhibition_id=exhibition.exhibition_id,
        party_name="Museum of Modern Art",
        status=LoanStatus.ON_LOAN,
        loan_start_date=date.today() - timedelta(days=10),
        loan_end_date=date.today() + timedelta(days=100),
    )
    postgres_session.add(loan)
    postgres_session.flush()

    # Link loan to object
    loan_object = ExhibitionLoanObject(
        link_id=loan.link_id,
        object_id=object_id_1,
        object_number="OBJ-001",
        object_title="Starry Night",
    )
    postgres_session.add(loan_object)
    postgres_session.flush()

    # Create budget lines
    budget_lines = [
        ExhibitionBudgetLine(
            exhibition_id=exhibition.exhibition_id,
            category=BudgetCategory.SHIPPING,
            description="Inbound shipping from MoMA",
            estimated_amount=15000.00,
            actual_amount=14500.00,
            vendor="FedEx Art",
            currency_code="USD",
        ),
        ExhibitionBudgetLine(
            exhibition_id=exhibition.exhibition_id,
            category=BudgetCategory.SHIPPING,
            description="Return shipping to MoMA",
            estimated_amount=15000.00,
            vendor="Cadogan Tate",
            currency_code="USD",
        ),
        ExhibitionBudgetLine(
            exhibition_id=exhibition.exhibition_id,
            category=BudgetCategory.INSURANCE,
            description="Fine Arts Insurance",
            estimated_amount=25000.00,
            actual_amount=24000.00,
            vendor="AXA Art",
            currency_code="USD",
        ),
        ExhibitionBudgetLine(
            exhibition_id=exhibition.exhibition_id,
            category=BudgetCategory.INSTALLATION,
            description="Installation labor",
            estimated_amount=8000.00,
            currency_code="USD",
        ),
        ExhibitionBudgetLine(
            exhibition_id=exhibition.exhibition_id,
            category=BudgetCategory.PRINTING,
            description="Exhibition catalog",
            estimated_amount=12000.00,
            actual_amount=11500.00,
            vendor="Museum Press",
            currency_code="USD",
        ),
    ]
    for bl in budget_lines:
        postgres_session.add(bl)
    postgres_session.flush()

    return {
        "exhibition": exhibition,
        "checklist": checklist,
        "checklist_items": checklist_items,
        "inbound_shipment": inbound_shipment,
        "outbound_shipment": outbound_shipment,
        "placements": placements,
        "loan": loan,
        "budget_lines": budget_lines,
        "object_ids": [object_id_1, object_id_2, object_id_3],
    }


# ============================================================================
# UTILITY TESTS
# ============================================================================

@pytest.mark.postgres
class TestSafeFilename:
    """Tests for the _safe_filename helper."""

    def test_safe_filename_normal(self):
        """Test normal filename sanitization."""
        assert _safe_filename("Test Exhibition") == "Test Exhibition"

    def test_safe_filename_special_chars(self):
        """Test removal of special characters."""
        assert _safe_filename("Test: Exhibition (2026)!") == "Test Exhibition 2026"

    def test_safe_filename_max_length(self):
        """Test max length truncation."""
        long_name = "A" * 50
        assert len(_safe_filename(long_name, 30)) == 30


# ============================================================================
# CHECKLIST EXPORT TESTS
# ============================================================================

@pytest.mark.postgres
class TestChecklistExportData:
    """Tests for checklist data fetching."""

    def test_get_all_checklist_items(self, postgres_session, setup_exhibition_with_full_data, test_org):
        """Test fetching all checklist items."""
        exhibition = setup_exhibition_with_full_data["exhibition"]

        exhibition_dict, items = _get_checklist_export_data(
            postgres_session,
            test_org.organization_id,
            exhibition.exhibition_id,
        )

        assert exhibition_dict["title"] == "Test Exhibition for Exports"
        assert len(items) == 5

    def test_filter_by_phase(self, postgres_session, setup_exhibition_with_full_data, test_org):
        """Test filtering checklist items by phase."""
        exhibition = setup_exhibition_with_full_data["exhibition"]

        exhibition_dict, items = _get_checklist_export_data(
            postgres_session,
            test_org.organization_id,
            exhibition.exhibition_id,
            phase=ChecklistPhase.PLANNING,
        )

        assert len(items) == 2
        assert all(item["phase"] == "planning" for item in items)

    def test_exclude_completed(self, postgres_session, setup_exhibition_with_full_data, test_org):
        """Test excluding completed items."""
        exhibition = setup_exhibition_with_full_data["exhibition"]

        exhibition_dict, items = _get_checklist_export_data(
            postgres_session,
            test_org.organization_id,
            exhibition.exhibition_id,
            include_completed=False,
        )

        assert len(items) == 4
        assert not any(item["status"] == "done" for item in items)

    def test_includes_assigned_user_name(self, postgres_session, setup_exhibition_with_full_data, test_org, test_user):
        """Test that assigned user names are included."""
        exhibition = setup_exhibition_with_full_data["exhibition"]

        exhibition_dict, items = _get_checklist_export_data(
            postgres_session,
            test_org.organization_id,
            exhibition.exhibition_id,
        )

        # Find the item with assigned user
        assigned_item = next((i for i in items if i["assigned_user_name"]), None)
        assert assigned_item is not None
        # User model column is display_name (prod bug: exhibit_exports.py:200 reads u.full_name).
        assert assigned_item["assigned_user_name"] == test_user.display_name

    def test_not_found_raises_error(self, postgres_session, test_org):
        """Test that non-existent exhibition raises ValueError."""
        with pytest.raises(ValueError, match="Exhibition not found"):
            _get_checklist_export_data(
                postgres_session,
                test_org.organization_id,
                uuid4(),
            )


@pytest.mark.postgres
class TestChecklistPDFGeneration:
    """Tests for checklist PDF generation."""

    def test_generate_pdf_bytes(self, postgres_session, setup_exhibition_with_full_data, test_org):
        """Test generating PDF returns valid bytes."""
        exhibition = setup_exhibition_with_full_data["exhibition"]

        exhibition_dict, items = _get_checklist_export_data(
            postgres_session,
            test_org.organization_id,
            exhibition.exhibition_id,
        )

        generator = ChecklistPDFGenerator(
            exhibition=exhibition_dict,
            items=items,
        )
        pdf_bytes = generator.generate()

        assert pdf_bytes[:4] == b"%PDF"
        assert len(pdf_bytes) > 1000  # Reasonable PDF size

    def test_empty_items_generates_valid_pdf(self, postgres_session, test_org, test_user):
        """Test that empty checklist generates valid PDF."""
        exhibition = Exhibition(
            organization_id=test_org.organization_id,
            title="Empty Exhibition",
            status="proposed",
            created_by=test_user.user_id,
        )
        postgres_session.add(exhibition)
        postgres_session.flush()

        exhibition_dict, items = _get_checklist_export_data(
            postgres_session,
            test_org.organization_id,
            exhibition.exhibition_id,
        )

        generator = ChecklistPDFGenerator(
            exhibition=exhibition_dict,
            items=items,
        )
        pdf_bytes = generator.generate()

        assert pdf_bytes[:4] == b"%PDF"


# ============================================================================
# SHIPMENT EXPORT TESTS
# ============================================================================

@pytest.mark.postgres
class TestShipmentExportData:
    """Tests for shipment data fetching."""

    def test_get_shipments(self, postgres_session, setup_exhibition_with_full_data, test_org):
        """Test fetching shipment data."""
        exhibition = setup_exhibition_with_full_data["exhibition"]

        exhibition_dict, shipments = _get_shipment_export_data(
            postgres_session,
            test_org.organization_id,
            exhibition.exhibition_id,
        )

        assert exhibition_dict["title"] == "Test Exhibition for Exports"
        assert len(shipments) == 2

    def test_shipment_direction_grouping(self, postgres_session, setup_exhibition_with_full_data, test_org):
        """Test that shipments include direction labels."""
        exhibition = setup_exhibition_with_full_data["exhibition"]

        exhibition_dict, shipments = _get_shipment_export_data(
            postgres_session,
            test_org.organization_id,
            exhibition.exhibition_id,
        )

        inbound = [s for s in shipments if s["direction"] == "inbound"]
        outbound = [s for s in shipments if s["direction"] == "outbound"]

        assert len(inbound) == 1
        assert len(outbound) == 1
        assert inbound[0]["direction_label"] == "Inbound"
        assert outbound[0]["direction_label"] == "Outbound"


@pytest.mark.postgres
class TestShipmentPDFGeneration:
    """Tests for shipment PDF generation."""

    def test_generate_pdf_bytes(self, postgres_session, setup_exhibition_with_full_data, test_org):
        """Test generating shipment PDF returns valid bytes."""
        exhibition = setup_exhibition_with_full_data["exhibition"]

        exhibition_dict, shipments = _get_shipment_export_data(
            postgres_session,
            test_org.organization_id,
            exhibition.exhibition_id,
        )

        generator = ShipmentSummaryPDFGenerator(
            exhibition=exhibition_dict,
            shipments=shipments,
        )
        pdf_bytes = generator.generate()

        assert pdf_bytes[:4] == b"%PDF"
        assert len(pdf_bytes) > 1000


# ============================================================================
# OBJECT LIST EXPORT TESTS
# ============================================================================

@pytest.mark.postgres
class TestObjectListExportData:
    """Tests for object list data fetching."""

    def test_get_objects(self, postgres_session, setup_exhibition_with_full_data, test_org):
        """Test fetching object list data."""
        exhibition = setup_exhibition_with_full_data["exhibition"]

        exhibition_dict, objects = _get_object_list_export_data(
            postgres_session,
            test_org.organization_id,
            exhibition.exhibition_id,
        )

        assert exhibition_dict["title"] == "Test Exhibition for Exports"
        assert len(objects) == 3

    def test_includes_lender_names(self, postgres_session, setup_exhibition_with_full_data, test_org):
        """Test that lender names from loans are included."""
        exhibition = setup_exhibition_with_full_data["exhibition"]

        exhibition_dict, objects = _get_object_list_export_data(
            postgres_session,
            test_org.organization_id,
            exhibition.exhibition_id,
        )

        # Object with loan should have lender name
        objects_with_lender = [o for o in objects if o["lender_name"]]
        assert len(objects_with_lender) == 1
        assert objects_with_lender[0]["lender_name"] == "Museum of Modern Art"

    def test_includes_packing_notes(self, postgres_session, setup_exhibition_with_full_data, test_org):
        """Test that packing notes from shipments are included."""
        exhibition = setup_exhibition_with_full_data["exhibition"]

        exhibition_dict, objects = _get_object_list_export_data(
            postgres_session,
            test_org.organization_id,
            exhibition.exhibition_id,
        )

        objects_with_notes = [o for o in objects if o["packing_notes"]]
        assert len(objects_with_notes) == 2
        # Prod orders placements by (wall_id, position_x); don't assume index order.
        all_notes = " | ".join(o["packing_notes"] for o in objects_with_notes)
        assert "Handle with extreme care" in all_notes
        assert "Fragile frame" in all_notes

    def test_includes_placement_status(self, postgres_session, setup_exhibition_with_full_data, test_org):
        """Test that placement status labels are included."""
        exhibition = setup_exhibition_with_full_data["exhibition"]

        exhibition_dict, objects = _get_object_list_export_data(
            postgres_session,
            test_org.organization_id,
            exhibition.exhibition_id,
        )

        statuses = {o["placement_status_label"] for o in objects}
        assert "Approved" in statuses
        assert "Proposed" in statuses
        assert "Draft" in statuses


@pytest.mark.postgres
class TestObjectListPDFGeneration:
    """Tests for object list PDF generation."""

    def test_generate_pdf_bytes(self, postgres_session, setup_exhibition_with_full_data, test_org):
        """Test generating object list PDF returns valid bytes."""
        exhibition = setup_exhibition_with_full_data["exhibition"]

        exhibition_dict, objects = _get_object_list_export_data(
            postgres_session,
            test_org.organization_id,
            exhibition.exhibition_id,
        )

        generator = ObjectListPDFGenerator(
            exhibition=exhibition_dict,
            objects=objects,
        )
        pdf_bytes = generator.generate()

        assert pdf_bytes[:4] == b"%PDF"
        assert len(pdf_bytes) > 1000


# ============================================================================
# BUDGET EXPORT TESTS
# ============================================================================

@pytest.mark.postgres
class TestBudgetExportData:
    """Tests for budget data fetching."""

    def test_get_budget_lines(self, postgres_session, setup_exhibition_with_full_data, test_org):
        """Test fetching budget data."""
        exhibition = setup_exhibition_with_full_data["exhibition"]

        exhibition_dict, budget_lines = _get_budget_export_data(
            postgres_session,
            test_org.organization_id,
            exhibition.exhibition_id,
        )

        assert exhibition_dict["title"] == "Test Exhibition for Exports"
        assert len(budget_lines) == 5

    def test_includes_category_labels(self, postgres_session, setup_exhibition_with_full_data, test_org):
        """Test that category labels are included."""
        exhibition = setup_exhibition_with_full_data["exhibition"]

        exhibition_dict, budget_lines = _get_budget_export_data(
            postgres_session,
            test_org.organization_id,
            exhibition.exhibition_id,
        )

        labels = {bl["category_label"] for bl in budget_lines}
        assert "Shipping" in labels
        assert "Insurance" in labels
        assert "Installation" in labels

    def test_amounts_are_floats(self, postgres_session, setup_exhibition_with_full_data, test_org):
        """Test that amounts are converted to floats."""
        exhibition = setup_exhibition_with_full_data["exhibition"]

        exhibition_dict, budget_lines = _get_budget_export_data(
            postgres_session,
            test_org.organization_id,
            exhibition.exhibition_id,
        )

        for bl in budget_lines:
            assert isinstance(bl["estimated_amount"], float)
            if bl["actual_amount"] is not None:
                assert isinstance(bl["actual_amount"], float)

    def test_category_totals(self, postgres_session, setup_exhibition_with_full_data, test_org):
        """Test calculation of totals by category."""
        exhibition = setup_exhibition_with_full_data["exhibition"]

        exhibition_dict, budget_lines = _get_budget_export_data(
            postgres_session,
            test_org.organization_id,
            exhibition.exhibition_id,
        )

        # Calculate shipping total
        shipping_total = sum(
            bl["estimated_amount"]
            for bl in budget_lines
            if bl["category"] == "shipping"
        )
        assert shipping_total == 30000.0  # 15000 + 15000

        # Grand total
        grand_total = sum(bl["estimated_amount"] for bl in budget_lines)
        assert grand_total == 75000.0  # 30000 + 25000 + 8000 + 12000

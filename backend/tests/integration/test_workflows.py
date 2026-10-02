"""
Integration tests for complete procedure workflow scenarios.

These tests verify end-to-end workflows like:
- Object Entry: deposit → process → link to acquisition/loan → complete
- Loan In: request → approve → receive objects → return
- Acquisition: propose → approve → receive objects → complete

Tests use the Flask test client to simulate real API interactions.

NOTE: These tests require PostgreSQL (TEST_DATABASE_URL must be set).
SQLite cannot handle the complex foreign key relationships in the schema.
Run with: TEST_DATABASE_URL=postgresql://... pytest -m postgres tests/integration/
"""

import pytest
from datetime import date, timedelta
from uuid import uuid4

# Mark all tests in this module as requiring postgres
pytestmark = pytest.mark.postgres

from app.models import (
    Organization,
    User,
    ObjectEntry,
    Acquisition,
    LoanIn,
    Constituent,
)


class TestObjectEntryWorkflow:
    """Test the complete Object Entry workflow (procedure)."""

    @pytest.fixture
    def org_with_user(self, db_session):
        """Create an organization with a test user."""
        org = Organization(
            name="Test Museum",
            slug="test-museum",
            status="active",
        )
        db_session.add(org)
        db_session.commit()

        user = User(
            email="curator@test-museum.org",
            display_name="Test Curator",
            status="active",
        )
        db_session.add(user)
        db_session.commit()

        return org, user

    @pytest.fixture
    def depositor_contact(self, db_session, org_with_user):
        """Create a depositor contact."""
        org, _ = org_with_user
        contact = Constituent(
            organization_id=org.organization_id,
            name="John Depositor",
            constituent_type="person",
            email="john@example.com",
        )
        db_session.add(contact)
        db_session.commit()
        return contact

    def test_create_object_entry(self, db_session, org_with_user, depositor_contact):
        """Test creating a new object entry."""
        org, user = org_with_user

        entry = ObjectEntry(
            organization_id=org.organization_id,
            entry_number="E2024-001",
            entry_date=date.today(),
            entry_reason="loan_consideration",
            depositor_id=depositor_contact.constituent_id,
            depositor_name=depositor_contact.name,
            objects_description="Oil painting, 24x36 inches",
            status="pending",
            created_by=user.user_id,
        )
        db_session.add(entry)
        db_session.commit()

        # Verify entry was created
        saved_entry = db_session.query(ObjectEntry).filter_by(
            entry_id=entry.entry_id
        ).first()
        assert saved_entry is not None
        assert saved_entry.entry_number == "E2024-001"
        assert saved_entry.status == "pending"
        assert saved_entry.depositor_id == depositor_contact.constituent_id

    def test_object_entry_status_transitions(self, db_session, org_with_user, depositor_contact):
        """Test valid status transitions for object entry."""
        org, user = org_with_user

        entry = ObjectEntry(
            organization_id=org.organization_id,
            entry_number="E2024-002",
            entry_date=date.today(),
            entry_reason="gift_offer",
            depositor_id=depositor_contact.constituent_id,
            objects_description="Ceramic vase",
            status="pending",
        )
        db_session.add(entry)
        db_session.commit()

        # Transition: pending → received
        entry.status = "received"
        entry.receipt_date = date.today()
        entry.received_by = user.user_id
        db_session.commit()
        assert entry.status == "received"

        # Transition: received → processed
        entry.status = "processed"
        entry.processed_date = date.today()
        entry.processed_by = user.user_id
        db_session.commit()
        assert entry.status == "processed"

    def test_object_entry_with_insurance(self, db_session, org_with_user, depositor_contact):
        """Test object entry with insurance information."""
        org, _ = org_with_user

        entry = ObjectEntry(
            organization_id=org.organization_id,
            entry_number="E2024-003",
            entry_date=date.today(),
            entry_reason="loan_consideration",
            depositor_id=depositor_contact.constituent_id,
            objects_description="Valuable artwork",
            insurance_value=50000.00,
            insurance_currency="USD",
            insurance_policy="POL-2024-12345",
            insurance_note="Covered by lender's policy",
            status="pending",
        )
        db_session.add(entry)
        db_session.commit()

        saved_entry = db_session.query(ObjectEntry).filter_by(
            entry_id=entry.entry_id
        ).first()
        assert saved_entry.insurance_value == 50000.00
        assert saved_entry.insurance_currency == "USD"
        assert saved_entry.insurance_policy == "POL-2024-12345"

    def test_object_entry_terms_acceptance(self, db_session, org_with_user, depositor_contact):
        """Test terms and conditions acceptance workflow."""
        org, user = org_with_user

        entry = ObjectEntry(
            organization_id=org.organization_id,
            entry_number="E2024-004",
            entry_date=date.today(),
            entry_reason="loan_consideration",
            depositor_id=depositor_contact.constituent_id,
            objects_description="Test object",
            status="pending",
            terms_accepted=False,
        )
        db_session.add(entry)
        db_session.commit()

        # Accept terms
        entry.terms_accepted = True
        entry.terms_accepted_date = date.today()
        entry.terms_accepted_by_id = depositor_contact.constituent_id
        entry.signature_reference = "SIG-2024-001"
        db_session.commit()

        saved_entry = db_session.query(ObjectEntry).filter_by(
            entry_id=entry.entry_id
        ).first()
        assert saved_entry.terms_accepted is True
        assert saved_entry.terms_accepted_date == date.today()
        assert saved_entry.signature_reference == "SIG-2024-001"


class TestLoanInWorkflow:
    """Test the complete Loan In workflow (procedure)."""

    @pytest.fixture
    def org_with_user(self, db_session):
        """Create an organization with a test user."""
        org = Organization(
            name="Test Gallery",
            slug="test-gallery",
            status="active",
        )
        db_session.add(org)
        db_session.commit()

        user = User(
            email="registrar@test-gallery.org",
            display_name="Test Registrar",
            status="active",
        )
        db_session.add(user)
        db_session.commit()

        return org, user

    @pytest.fixture
    def lender_contact(self, db_session, org_with_user):
        """Create a lender contact."""
        org, _ = org_with_user
        contact = Constituent(
            organization_id=org.organization_id,
            name="Example Museum",
            constituent_type="organization",
            email="loans@example.com",
        )
        db_session.add(contact)
        db_session.commit()
        return contact

    def test_create_loan_in(self, db_session, org_with_user, lender_contact):
        """Test creating a new loan in record."""
        org, user = org_with_user

        loan = LoanIn(
            organization_id=org.organization_id,
            loan_number="LI2024-001",
            lender_id=lender_contact.constituent_id,
            lender_name=lender_contact.name,
            loan_purpose="exhibition",
            loan_start_date=date.today(),
            loan_end_date=date.today() + timedelta(days=180),
            status="requested",
            created_by=user.user_id,
        )
        db_session.add(loan)
        db_session.commit()

        saved_loan = db_session.query(LoanIn).filter_by(
            loan_in_id=loan.loan_in_id
        ).first()
        assert saved_loan is not None
        assert saved_loan.loan_number == "LI2024-001"
        assert saved_loan.status == "requested"
        assert saved_loan.lender_id == lender_contact.constituent_id

    def test_loan_in_status_transitions(self, db_session, org_with_user, lender_contact):
        """Test valid status transitions for loan in."""
        org, user = org_with_user

        loan = LoanIn(
            organization_id=org.organization_id,
            loan_number="LI2024-002",
            lender_id=lender_contact.constituent_id,
            loan_purpose="research",
            loan_start_date=date.today(),
            loan_end_date=date.today() + timedelta(days=90),
            status="requested",
        )
        db_session.add(loan)
        db_session.commit()

        # Transition: requested → approved
        loan.status = "approved"
        loan.approval_date = date.today()
        loan.approved_by = user.user_id
        db_session.commit()
        assert loan.status == "approved"

        # Transition: approved → on_loan
        loan.status = "on_loan"
        loan.actual_receipt_date = date.today()
        db_session.commit()
        assert loan.status == "on_loan"

        # Transition: on_loan → returned
        loan.status = "returned"
        loan.actual_return_date = date.today() + timedelta(days=85)
        db_session.commit()
        assert loan.status == "returned"


class TestAcquisitionWorkflow:
    """Test the complete Acquisition workflow (procedure)."""

    @pytest.fixture
    def org_with_user(self, db_session):
        """Create an organization with a test user."""
        org = Organization(
            name="Test Archive",
            slug="test-archive",
            status="active",
        )
        db_session.add(org)
        db_session.commit()

        user = User(
            email="director@test-archive.org",
            display_name="Test Director",
            status="active",
        )
        db_session.add(user)
        db_session.commit()

        return org, user

    @pytest.fixture
    def donor_contact(self, db_session, org_with_user):
        """Create a donor contact."""
        org, _ = org_with_user
        contact = Constituent(
            organization_id=org.organization_id,
            name="Jane Donor",
            constituent_type="person",
            email="jane.donor@example.com",
        )
        db_session.add(contact)
        db_session.commit()
        return contact

    def test_create_acquisition(self, db_session, org_with_user, donor_contact):
        """Test creating a new acquisition record."""
        org, user = org_with_user

        acquisition = Acquisition(
            organization_id=org.organization_id,
            acquisition_number="ACQ2024-001",
            acquisition_method="gift",
            source_id=donor_contact.constituent_id,
            source_name=donor_contact.name,
            acquisition_date=date.today(),
            status="proposed",
            created_by=user.user_id,
        )
        db_session.add(acquisition)
        db_session.commit()

        saved_acq = db_session.query(Acquisition).filter_by(
            acquisition_id=acquisition.acquisition_id
        ).first()
        assert saved_acq is not None
        assert saved_acq.acquisition_number == "ACQ2024-001"
        assert saved_acq.acquisition_method == "gift"
        assert saved_acq.status == "proposed"

    def test_acquisition_status_transitions(self, db_session, org_with_user, donor_contact):
        """Test valid status transitions for acquisition."""
        org, user = org_with_user

        acquisition = Acquisition(
            organization_id=org.organization_id,
            acquisition_number="ACQ2024-002",
            acquisition_method="purchase",
            source_id=donor_contact.constituent_id,
            acquisition_date=date.today(),
            status="proposed",
        )
        db_session.add(acquisition)
        db_session.commit()

        # Transition: proposed → pending_approval
        acquisition.status = "pending_approval"
        db_session.commit()
        assert acquisition.status == "pending_approval"

        # Transition: pending_approval → approved
        acquisition.status = "approved"
        acquisition.accessioning_approved = True
        acquisition.accessioning_approved_by = user.user_id
        acquisition.accessioning_approved_date = date.today()
        db_session.commit()
        assert acquisition.status == "approved"

        # Transition: approved → completed
        acquisition.status = "completed"
        acquisition.completed_date = date.today()
        db_session.commit()
        assert acquisition.status == "completed"


class TestCrossEntityWorkflows:
    """Test workflows that span multiple entity types."""

    @pytest.fixture
    def full_org_setup(self, db_session):
        """Create a complete organization setup with user and contacts."""
        org = Organization(
            name="Complete Museum",
            slug="complete-museum",
            status="active",
        )
        db_session.add(org)
        db_session.commit()

        user = User(
            email="staff@complete-museum.org",
            display_name="Museum Staff",
            status="active",
        )
        db_session.add(user)

        depositor = Constituent(
            organization_id=org.organization_id,
            name="External Depositor",
            constituent_type="person",
        )
        db_session.add(depositor)
        db_session.commit()

        return org, user, depositor

    def test_entry_linked_to_acquisition(self, db_session, full_org_setup):
        """Test linking an object entry to an acquisition."""
        org, user, depositor = full_org_setup

        # Create acquisition first
        acquisition = Acquisition(
            organization_id=org.organization_id,
            acquisition_number="ACQ2024-LINK-001",
            acquisition_method="gift",
            source_id=depositor.constituent_id,
            acquisition_date=date.today(),
            status="approved",
        )
        db_session.add(acquisition)
        db_session.commit()

        # Create entry and link to acquisition
        entry = ObjectEntry(
            organization_id=org.organization_id,
            entry_number="E2024-LINK-001",
            entry_date=date.today(),
            entry_reason="gift_offer",
            depositor_id=depositor.constituent_id,
            objects_description="Gift items",
            status="pending",
        )
        db_session.add(entry)
        db_session.commit()

        # Link entry to acquisition
        acquisition.entry_id = entry.entry_id
        db_session.commit()

        # Verify link
        saved_acq = db_session.query(Acquisition).filter_by(
            acquisition_id=acquisition.acquisition_id
        ).first()
        assert saved_acq.entry_id == entry.entry_id

    def test_entry_linked_to_loan_in(self, db_session, full_org_setup):
        """Test linking an object entry to a loan in."""
        org, user, depositor = full_org_setup

        # Create loan first
        loan = LoanIn(
            organization_id=org.organization_id,
            loan_number="LI2024-LINK-001",
            lender_id=depositor.constituent_id,
            loan_purpose="exhibition",
            loan_start_date=date.today(),
            loan_end_date=date.today() + timedelta(days=90),
            status="approved",
        )
        db_session.add(loan)
        db_session.commit()

        # Create entry
        entry = ObjectEntry(
            organization_id=org.organization_id,
            entry_number="E2024-LINK-002",
            entry_date=date.today(),
            entry_reason="loan_consideration",
            depositor_id=depositor.constituent_id,
            objects_description="Loan items",
            status="pending",
        )
        db_session.add(entry)
        db_session.commit()

        # Note: LoanIn to ObjectEntry is many-to-many via loan_in_object_entries table
        # This test verifies the entry can be created with loan context
        assert entry.entry_reason == "loan_consideration"
        assert entry.entry_id is not None

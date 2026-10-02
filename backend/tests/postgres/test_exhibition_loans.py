"""
Tests for exhibition loan linking functionality.

Tests CRUD operations, status tracking, and permission visibility.
"""

import pytest
from datetime import date, timedelta
from app.models import (
    ExhibitionLoan,
    ExhibitionLoanObject,
    LoanType,
    LoanStatus,
    Exhibition,
)
from app.fastapi_app.routers.exhibition_loans import _loan_needs_attention
import uuid


@pytest.mark.postgres
class TestLoanLinking:
    """Tests for loan linking to exhibitions."""

    def test_link_loan_to_exhibition(self, postgres_session, test_tenant):
        """Link a loan to an exhibition."""
        exhibition = Exhibition(
            organization_id=test_tenant.organization_id,
            title='Test Exhibition',
            exhibition_type='traveling',
            status='in_preparation',
        )
        postgres_session.add(exhibition)
        postgres_session.flush()

        loan_id = uuid.uuid4()
        loan_link = ExhibitionLoan(
            organization_id=test_tenant.organization_id,
            exhibition_id=exhibition.exhibition_id,
            loan_id=loan_id,
            loan_type=LoanType.LOAN_IN,
            loan_number='LI-2026-001',
            party_name='National Gallery',
            status=LoanStatus.REQUESTED,
        )
        postgres_session.add(loan_link)
        postgres_session.flush()

        assert loan_link.link_id is not None
        assert loan_link.loan_type == 'loan_in'
        assert loan_link.party_name == 'National Gallery'

    def test_loan_with_objects(self, postgres_session, test_tenant):
        """Loan link can include objects."""
        exhibition = Exhibition(
            organization_id=test_tenant.organization_id,
            title='Test Exhibition',
            exhibition_type='traveling',
            status='in_preparation',
        )
        postgres_session.add(exhibition)
        postgres_session.flush()

        loan_link = ExhibitionLoan(
            organization_id=test_tenant.organization_id,
            exhibition_id=exhibition.exhibition_id,
            loan_id=uuid.uuid4(),
            loan_type=LoanType.LOAN_IN,
            party_name='Partner Museum',
            status=LoanStatus.APPROVED,
        )
        postgres_session.add(loan_link)
        postgres_session.flush()

        obj1 = ExhibitionLoanObject(
            link_id=loan_link.link_id,
            object_id=uuid.uuid4(),
            object_number='PM.2020.001',
            object_title='Famous Painting',
        )
        obj2 = ExhibitionLoanObject(
            link_id=loan_link.link_id,
            object_id=uuid.uuid4(),
            object_number='PM.2020.002',
            object_title='Important Sculpture',
        )
        postgres_session.add_all([obj1, obj2])
        postgres_session.flush()

        postgres_session.refresh(loan_link)
        assert len(loan_link.objects) == 2

    def test_multiple_loans_per_exhibition(self, postgres_session, test_tenant):
        """Exhibition can have multiple loans."""
        exhibition = Exhibition(
            organization_id=test_tenant.organization_id,
            title='Test Exhibition',
            exhibition_type='traveling',
            status='in_preparation',
        )
        postgres_session.add(exhibition)
        postgres_session.flush()

        loan_in = ExhibitionLoan(
            organization_id=test_tenant.organization_id,
            exhibition_id=exhibition.exhibition_id,
            loan_id=uuid.uuid4(),
            loan_type=LoanType.LOAN_IN,
            party_name='Lender A',
            status=LoanStatus.ON_LOAN,
        )
        loan_out = ExhibitionLoan(
            organization_id=test_tenant.organization_id,
            exhibition_id=exhibition.exhibition_id,
            loan_id=uuid.uuid4(),
            loan_type=LoanType.LOAN_OUT,
            party_name='Borrower B',
            status=LoanStatus.REQUESTED,
        )
        postgres_session.add_all([loan_in, loan_out])
        postgres_session.flush()

        loans = postgres_session.query(ExhibitionLoan).filter(
            ExhibitionLoan.exhibition_id == exhibition.exhibition_id
        ).all()
        assert len(loans) == 2
        assert len([l for l in loans if l.loan_type == LoanType.LOAN_IN]) == 1
        assert len([l for l in loans if l.loan_type == LoanType.LOAN_OUT]) == 1


@pytest.mark.postgres
class TestLoanStatus:
    """Tests for loan status tracking."""

    def test_all_statuses_valid(self):
        """All defined statuses are valid."""
        expected = [
            'requested', 'pending_approval', 'approved', 'agreement_sent',
            'agreement_signed', 'in_transit', 'on_loan', 'return_scheduled',
            'returned', 'closed', 'declined', 'cancelled'
        ]
        assert set(LoanStatus.ALL) == set(expected)

    def test_all_statuses_have_labels(self):
        """Every status has a display label."""
        for status in LoanStatus.ALL:
            assert status in LoanStatus.LABELS

    def test_active_statuses(self):
        """Active statuses are correctly categorized."""
        expected_active = [
            'requested', 'pending_approval', 'approved', 'agreement_sent',
            'agreement_signed', 'in_transit', 'on_loan', 'return_scheduled'
        ]
        assert set(LoanStatus.ACTIVE) == set(expected_active)

    def test_completed_statuses(self):
        """Completed statuses are correctly categorized."""
        assert set(LoanStatus.COMPLETED) == {'returned', 'closed'}


@pytest.mark.postgres
class TestLoanNeedsAttention:
    """Tests for the needs_attention logic."""

    def test_agreement_pending_needs_attention(self, postgres_session, test_tenant):
        """Loan with agreement sent but not signed needs attention."""
        exhibition = Exhibition(
            organization_id=test_tenant.organization_id,
            title='Test Exhibition',
            exhibition_type='temporary',
            status='in_preparation',
        )
        postgres_session.add(exhibition)
        postgres_session.flush()

        loan = ExhibitionLoan(
            organization_id=test_tenant.organization_id,
            exhibition_id=exhibition.exhibition_id,
            loan_id=uuid.uuid4(),
            loan_type=LoanType.LOAN_IN,
            party_name='Lender',
            status=LoanStatus.AGREEMENT_SENT,
            agreement_signed=False,
        )
        postgres_session.add(loan)
        postgres_session.flush()

        assert _loan_needs_attention(loan) is True

    def test_insurance_pending_needs_attention(self, postgres_session, test_tenant):
        """Loan without insurance confirmation needs attention."""
        exhibition = Exhibition(
            organization_id=test_tenant.organization_id,
            title='Test Exhibition',
            exhibition_type='temporary',
            status='in_preparation',
        )
        postgres_session.add(exhibition)
        postgres_session.flush()

        loan = ExhibitionLoan(
            organization_id=test_tenant.organization_id,
            exhibition_id=exhibition.exhibition_id,
            loan_id=uuid.uuid4(),
            loan_type=LoanType.LOAN_IN,
            party_name='Lender',
            status=LoanStatus.AGREEMENT_SIGNED,
            agreement_signed=True,
            insurance_confirmed=False,
        )
        postgres_session.add(loan)
        postgres_session.flush()

        assert _loan_needs_attention(loan) is True

    def test_loan_ending_soon_needs_attention(self, postgres_session, test_tenant):
        """Loan ending within 30 days needs attention."""
        exhibition = Exhibition(
            organization_id=test_tenant.organization_id,
            title='Test Exhibition',
            exhibition_type='temporary',
            status='in_preparation',
        )
        postgres_session.add(exhibition)
        postgres_session.flush()

        loan = ExhibitionLoan(
            organization_id=test_tenant.organization_id,
            exhibition_id=exhibition.exhibition_id,
            loan_id=uuid.uuid4(),
            loan_type=LoanType.LOAN_IN,
            party_name='Lender',
            status=LoanStatus.ON_LOAN,
            agreement_signed=True,
            insurance_confirmed=True,
            loan_end_date=date.today() + timedelta(days=15),  # Ending in 15 days
        )
        postgres_session.add(loan)
        postgres_session.flush()

        assert _loan_needs_attention(loan) is True

    def test_healthy_loan_no_attention(self, postgres_session, test_tenant):
        """Healthy loan doesn't need attention."""
        exhibition = Exhibition(
            organization_id=test_tenant.organization_id,
            title='Test Exhibition',
            exhibition_type='temporary',
            status='in_preparation',
        )
        postgres_session.add(exhibition)
        postgres_session.flush()

        loan = ExhibitionLoan(
            organization_id=test_tenant.organization_id,
            exhibition_id=exhibition.exhibition_id,
            loan_id=uuid.uuid4(),
            loan_type=LoanType.LOAN_IN,
            party_name='Lender',
            status=LoanStatus.ON_LOAN,
            agreement_signed=True,
            insurance_confirmed=True,
            loan_end_date=date.today() + timedelta(days=90),  # Plenty of time
        )
        postgres_session.add(loan)
        postgres_session.flush()

        assert _loan_needs_attention(loan) is False


@pytest.mark.postgres
class TestLoanAgreementTracking:
    """Tests for agreement document tracking."""

    def test_agreement_fields(self, postgres_session, test_tenant):
        """Agreement tracking fields work correctly."""
        exhibition = Exhibition(
            organization_id=test_tenant.organization_id,
            title='Test Exhibition',
            exhibition_type='temporary',
            status='in_preparation',
        )
        postgres_session.add(exhibition)
        postgres_session.flush()

        doc_id = uuid.uuid4()
        loan = ExhibitionLoan(
            organization_id=test_tenant.organization_id,
            exhibition_id=exhibition.exhibition_id,
            loan_id=uuid.uuid4(),
            loan_type=LoanType.LOAN_IN,
            party_name='Lender',
            status=LoanStatus.AGREEMENT_SIGNED,
            agreement_document_id=doc_id,
            agreement_signed=True,
            agreement_signed_date=date.today(),
        )
        postgres_session.add(loan)
        postgres_session.flush()

        assert loan.agreement_document_id == doc_id
        assert loan.agreement_signed is True
        assert loan.agreement_signed_date == date.today()


@pytest.mark.postgres
class TestLoanInsuranceTracking:
    """Tests for insurance tracking."""

    def test_insurance_fields(self, postgres_session, test_tenant):
        """Insurance tracking fields work correctly."""
        exhibition = Exhibition(
            organization_id=test_tenant.organization_id,
            title='Test Exhibition',
            exhibition_type='temporary',
            status='in_preparation',
        )
        postgres_session.add(exhibition)
        postgres_session.flush()

        loan = ExhibitionLoan(
            organization_id=test_tenant.organization_id,
            exhibition_id=exhibition.exhibition_id,
            loan_id=uuid.uuid4(),
            loan_type=LoanType.LOAN_IN,
            party_name='Lender',
            status=LoanStatus.ON_LOAN,
            insurance_confirmed=True,
            insurance_policy='ART-FINE-2026-12345',
            insurance_value='$2,500,000',
        )
        postgres_session.add(loan)
        postgres_session.flush()

        assert loan.insurance_confirmed is True
        assert loan.insurance_policy == 'ART-FINE-2026-12345'
        assert loan.insurance_value == '$2,500,000'


@pytest.mark.postgres
class TestLoanCascadeDelete:
    """Tests for cascade delete behavior."""

    def test_exhibition_delete_cascades(self, postgres_session, test_tenant):
        """Deleting exhibition cascades to loan links."""
        exhibition = Exhibition(
            organization_id=test_tenant.organization_id,
            title='Test Exhibition',
            exhibition_type='temporary',
            status='in_preparation',
        )
        postgres_session.add(exhibition)
        postgres_session.flush()

        loan = ExhibitionLoan(
            organization_id=test_tenant.organization_id,
            exhibition_id=exhibition.exhibition_id,
            loan_id=uuid.uuid4(),
            loan_type=LoanType.LOAN_IN,
            party_name='Lender',
            status=LoanStatus.REQUESTED,
        )
        postgres_session.add(loan)
        postgres_session.flush()
        link_id = loan.link_id

        postgres_session.delete(exhibition)
        postgres_session.flush()

        result = postgres_session.query(ExhibitionLoan).filter(
            ExhibitionLoan.link_id == link_id
        ).first()
        assert result is None

    def test_loan_delete_cascades_to_objects(self, postgres_session, test_tenant):
        """Deleting loan link cascades to objects."""
        exhibition = Exhibition(
            organization_id=test_tenant.organization_id,
            title='Test Exhibition',
            exhibition_type='temporary',
            status='in_preparation',
        )
        postgres_session.add(exhibition)
        postgres_session.flush()

        loan = ExhibitionLoan(
            organization_id=test_tenant.organization_id,
            exhibition_id=exhibition.exhibition_id,
            loan_id=uuid.uuid4(),
            loan_type=LoanType.LOAN_IN,
            party_name='Lender',
            status=LoanStatus.ON_LOAN,
        )
        postgres_session.add(loan)
        postgres_session.flush()

        obj = ExhibitionLoanObject(
            link_id=loan.link_id,
            object_id=uuid.uuid4(),
            object_number='TEST.001',
        )
        postgres_session.add(obj)
        postgres_session.flush()
        obj_id = obj.loan_object_id

        postgres_session.delete(loan)
        postgres_session.flush()

        result = postgres_session.query(ExhibitionLoanObject).filter(
            ExhibitionLoanObject.loan_object_id == obj_id
        ).first()
        assert result is None


@pytest.mark.postgres
class TestLoanTypes:
    """Tests for loan type constants."""

    def test_loan_types(self):
        """Both loan types are defined."""
        assert LoanType.LOAN_IN == 'loan_in'
        assert LoanType.LOAN_OUT == 'loan_out'
        assert len(LoanType.ALL) == 2

    def test_loan_types_have_labels(self):
        """Every loan type has a display label."""
        for lt in LoanType.ALL:
            assert lt in LoanType.LABELS

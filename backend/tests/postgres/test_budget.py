"""
Tests for exhibition budget functionality.

Tests totals math, CRUD operations, and permissions.
"""

import pytest
from decimal import Decimal
from app.models import (
    ExhibitionBudgetLine,
    BudgetLineLink,
    BudgetCategory,
    Exhibition,
)
from app.fastapi_app.routers.budget import _calculate_totals as calculate_totals


@pytest.mark.postgres
class TestBudgetTotalsMath:
    """Tests for budget totals calculations."""

    def test_calculate_totals_empty(self):
        """Empty list returns zero totals."""
        totals = calculate_totals([])

        assert totals['total_estimated'] == 0
        assert totals['total_actual'] == 0
        assert totals['total_variance'] == 0
        assert totals['line_count'] == 0
        assert totals['by_category'] == []

    def test_calculate_totals_single_line(self, postgres_session, test_tenant):
        """Single budget line calculates correctly."""
        exhibition = Exhibition(
            organization_id=test_tenant.organization_id,
            title='Test Exhibition',
            exhibition_type='temporary',
            status='proposed',
        )
        postgres_session.add(exhibition)
        postgres_session.flush()

        line = ExhibitionBudgetLine(
            exhibition_id=exhibition.exhibition_id,
            category=BudgetCategory.SHIPPING,
            description='Crate shipment',
            estimated_amount=Decimal('1500.00'),
            actual_amount=Decimal('1650.50'),
        )
        postgres_session.add(line)
        postgres_session.flush()

        totals = calculate_totals([line])

        assert totals['total_estimated'] == 1500.00
        assert totals['total_actual'] == 1650.50
        assert totals['total_variance'] == 150.50
        assert totals['line_count'] == 1
        assert len(totals['by_category']) == 1
        assert totals['by_category'][0]['category'] == 'shipping'
        assert totals['by_category'][0]['estimated'] == 1500.00
        assert totals['by_category'][0]['actual'] == 1650.50

    def test_calculate_totals_multiple_categories(self, postgres_session, test_tenant):
        """Multiple categories sum correctly."""
        exhibition = Exhibition(
            organization_id=test_tenant.organization_id,
            title='Test Exhibition',
            exhibition_type='temporary',
            status='proposed',
        )
        postgres_session.add(exhibition)
        postgres_session.flush()

        lines = [
            ExhibitionBudgetLine(
                exhibition_id=exhibition.exhibition_id,
                category=BudgetCategory.SHIPPING,
                description='Shipment 1',
                estimated_amount=Decimal('1000.00'),
                actual_amount=Decimal('1100.00'),
            ),
            ExhibitionBudgetLine(
                exhibition_id=exhibition.exhibition_id,
                category=BudgetCategory.SHIPPING,
                description='Shipment 2',
                estimated_amount=Decimal('500.00'),
                actual_amount=Decimal('450.00'),
            ),
            ExhibitionBudgetLine(
                exhibition_id=exhibition.exhibition_id,
                category=BudgetCategory.INSURANCE,
                description='Transit insurance',
                estimated_amount=Decimal('2000.00'),
                actual_amount=Decimal('2000.00'),
            ),
            ExhibitionBudgetLine(
                exhibition_id=exhibition.exhibition_id,
                category=BudgetCategory.FABRICATION,
                description='Display cases',
                estimated_amount=Decimal('5000.00'),
                actual_amount=None,  # No actual yet
            ),
        ]
        for line in lines:
            postgres_session.add(line)
        postgres_session.flush()

        totals = calculate_totals(lines)

        # Overall totals
        assert totals['total_estimated'] == 8500.00
        assert totals['total_actual'] == 3550.00  # 1100 + 450 + 2000 + 0
        assert totals['total_variance'] == -4950.00  # actual - estimated
        assert totals['line_count'] == 4

        # Category totals
        by_cat = {c['category']: c for c in totals['by_category']}

        assert by_cat['shipping']['estimated'] == 1500.00
        assert by_cat['shipping']['actual'] == 1550.00
        assert by_cat['shipping']['count'] == 2

        assert by_cat['insurance']['estimated'] == 2000.00
        assert by_cat['insurance']['actual'] == 2000.00
        assert by_cat['insurance']['count'] == 1

        assert by_cat['fabrication']['estimated'] == 5000.00
        assert by_cat['fabrication']['actual'] == 0  # None treated as 0
        assert by_cat['fabrication']['count'] == 1

    def test_calculate_totals_handles_none_amounts(self, postgres_session, test_tenant):
        """None values are treated as zero in calculations."""
        exhibition = Exhibition(
            organization_id=test_tenant.organization_id,
            title='Test Exhibition',
            exhibition_type='temporary',
            status='proposed',
        )
        postgres_session.add(exhibition)
        postgres_session.flush()

        line = ExhibitionBudgetLine(
            exhibition_id=exhibition.exhibition_id,
            category=BudgetCategory.OTHER,
            description='Pending item',
            estimated_amount=Decimal('100.00'),
            actual_amount=None,
        )
        postgres_session.add(line)
        postgres_session.flush()

        totals = calculate_totals([line])

        assert totals['total_estimated'] == 100.00
        assert totals['total_actual'] == 0
        assert totals['total_variance'] == -100.00

    def test_calculate_totals_large_numbers(self, postgres_session, test_tenant):
        """Large monetary values calculate correctly."""
        exhibition = Exhibition(
            organization_id=test_tenant.organization_id,
            title='Test Exhibition',
            exhibition_type='temporary',
            status='proposed',
        )
        postgres_session.add(exhibition)
        postgres_session.flush()

        lines = [
            ExhibitionBudgetLine(
                exhibition_id=exhibition.exhibition_id,
                category=BudgetCategory.INSURANCE,
                description='High-value insurance',
                estimated_amount=Decimal('1500000.00'),
                actual_amount=Decimal('1750000.00'),
            ),
            ExhibitionBudgetLine(
                exhibition_id=exhibition.exhibition_id,
                category=BudgetCategory.RIGHTS,
                description='Image rights',
                estimated_amount=Decimal('250000.50'),
                actual_amount=Decimal('275000.75'),
            ),
        ]
        for line in lines:
            postgres_session.add(line)
        postgres_session.flush()

        totals = calculate_totals(lines)

        assert totals['total_estimated'] == 1750000.50
        assert totals['total_actual'] == 2025000.75
        assert abs(totals['total_variance'] - 275000.25) < 0.01

    def test_calculate_totals_negative_variance(self, postgres_session, test_tenant):
        """Under-budget items show negative variance."""
        exhibition = Exhibition(
            organization_id=test_tenant.organization_id,
            title='Test Exhibition',
            exhibition_type='temporary',
            status='proposed',
        )
        postgres_session.add(exhibition)
        postgres_session.flush()

        line = ExhibitionBudgetLine(
            exhibition_id=exhibition.exhibition_id,
            category=BudgetCategory.TRAVEL,
            description='Courier travel',
            estimated_amount=Decimal('5000.00'),
            actual_amount=Decimal('3500.00'),
        )
        postgres_session.add(line)
        postgres_session.flush()

        totals = calculate_totals([line])

        assert totals['total_variance'] == -1500.00
        assert totals['by_category'][0]['variance'] == -1500.00


@pytest.mark.postgres
class TestBudgetLineCRUD:
    """Tests for budget line CRUD operations."""

    def test_create_budget_line(self, postgres_session, test_tenant):
        """Create a budget line with all fields."""
        exhibition = Exhibition(
            organization_id=test_tenant.organization_id,
            title='Test Exhibition',
            exhibition_type='temporary',
            status='proposed',
        )
        postgres_session.add(exhibition)
        postgres_session.flush()

        line = ExhibitionBudgetLine(
            exhibition_id=exhibition.exhibition_id,
            category=BudgetCategory.FABRICATION,
            description='Custom display pedestals',
            estimated_amount=Decimal('3500.00'),
            actual_amount=Decimal('3750.00'),
            vendor='Acme Display Co.',
            notes='Rush order required',
            sort_order=1,
            currency_code='USD',
        )
        postgres_session.add(line)
        postgres_session.flush()

        assert line.line_id is not None
        assert line.category == 'fabrication'
        assert line.description == 'Custom display pedestals'
        assert line.estimated_amount == Decimal('3500.00')
        assert line.actual_amount == Decimal('3750.00')
        assert line.vendor == 'Acme Display Co.'
        assert line.notes == 'Rush order required'
        assert line.currency_code == 'USD'

    def test_budget_line_link(self, postgres_session, test_tenant):
        """Budget lines can be linked to other entities."""
        exhibition = Exhibition(
            organization_id=test_tenant.organization_id,
            title='Test Exhibition',
            exhibition_type='temporary',
            status='proposed',
        )
        postgres_session.add(exhibition)
        postgres_session.flush()

        line = ExhibitionBudgetLine(
            exhibition_id=exhibition.exhibition_id,
            category=BudgetCategory.SHIPPING,
            description='Shipment to venue',
            estimated_amount=Decimal('2000.00'),
        )
        postgres_session.add(line)
        postgres_session.flush()

        import uuid
        shipment_id = uuid.uuid4()

        link = BudgetLineLink(
            line_id=line.line_id,
            entity_type='shipment',
            entity_id=shipment_id,
            label='Outbound shipment #1',
        )
        postgres_session.add(link)
        postgres_session.flush()

        assert link.link_id is not None
        assert link.entity_type == 'shipment'
        assert link.entity_id == shipment_id
        assert link.label == 'Outbound shipment #1'

        # Verify relationship
        postgres_session.refresh(line)
        assert len(line.links) == 1
        assert line.links[0].entity_type == 'shipment'

    def test_cascade_delete(self, postgres_session, test_tenant):
        """Deleting exhibition cascades to budget lines."""
        exhibition = Exhibition(
            organization_id=test_tenant.organization_id,
            title='Test Exhibition',
            exhibition_type='temporary',
            status='proposed',
        )
        postgres_session.add(exhibition)
        postgres_session.flush()

        line = ExhibitionBudgetLine(
            exhibition_id=exhibition.exhibition_id,
            category=BudgetCategory.OTHER,
            description='Misc expense',
            estimated_amount=Decimal('100.00'),
        )
        postgres_session.add(line)
        postgres_session.flush()

        line_id = line.line_id

        # Delete exhibition
        postgres_session.delete(exhibition)
        postgres_session.flush()

        # Budget line should be gone
        result = postgres_session.query(ExhibitionBudgetLine).filter(
            ExhibitionBudgetLine.line_id == line_id
        ).first()
        assert result is None


@pytest.mark.postgres
class TestBudgetCategories:
    """Tests for budget category constants."""

    def test_all_categories_have_labels(self):
        """Every category in ALL has a corresponding label."""
        for cat in BudgetCategory.ALL:
            assert cat in BudgetCategory.LABELS, f"Category {cat} missing label"

    def test_category_count(self):
        """Expected number of categories."""
        assert len(BudgetCategory.ALL) == 11
        assert len(BudgetCategory.LABELS) == 11

    def test_expected_categories_exist(self):
        """All expected categories are defined."""
        expected = [
            'shipping', 'insurance', 'fabrication', 'printing', 'travel',
            'installation', 'mounts', 'conservation', 'rights', 'marketing', 'other'
        ]
        for cat in expected:
            assert cat in BudgetCategory.ALL

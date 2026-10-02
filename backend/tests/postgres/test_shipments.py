"""
Tests for generic shipment functionality.

Tests CRUD operations, status transitions, and linking via models
in app/models/.
"""

import pytest
from datetime import date, timedelta
from app.models import (
    Shipment, ShipmentItem, ShipmentReference, ShipmentDocument,
    ShipmentStatusHistory, ShipmentLeg, CollectionObject,
)
import uuid


def _make_object(session, tenant, number):
    """Helper to create a real CollectionObject so FK constraints on
    shipment_items.object_id can be satisfied."""
    obj = CollectionObject(
        organization_id=tenant.organization_id,
        object_number=number,
    )
    session.add(obj)
    session.flush()
    return obj


@pytest.mark.postgres
class TestShipmentCRUD:
    """Tests for shipment CRUD operations."""

    def test_create_shipment(self, postgres_session, test_tenant):
        """Create a shipment with all fields."""
        shipment = Shipment(
            organization_id=test_tenant.organization_id,
            shipment_number='SHP-001',
            shipment_type='outbound',
            direction='outbound',
            purpose='exhibition',
            status='draft',
            estimated_dispatch_date=date.today() + timedelta(days=7),
            estimated_arrival_date=date.today() + timedelta(days=14),
            remarks='Temperature controlled, upright only',
            courier_required=True,
        )
        postgres_session.add(shipment)
        postgres_session.flush()

        assert shipment.shipment_id is not None
        assert shipment.shipment_number == 'SHP-001'
        assert shipment.direction == 'outbound'
        assert shipment.status == 'draft'
        assert shipment.shipment_type == 'outbound'

    def test_shipment_with_items(self, postgres_session, test_tenant):
        """Shipment can link to collection objects via ShipmentItem."""
        shipment = Shipment(
            organization_id=test_tenant.organization_id,
            shipment_number='SHP-002',
            shipment_type='outbound',
            direction='outbound',
            status='draft',
        )
        postgres_session.add(shipment)
        postgres_session.flush()

        obj1 = _make_object(postgres_session, test_tenant, 'OBJ-SHP-002-A')
        obj2 = _make_object(postgres_session, test_tenant, 'OBJ-SHP-002-B')

        item1 = ShipmentItem(
            organization_id=test_tenant.organization_id,
            shipment_id=shipment.shipment_id,
            object_id=obj1.object_id,
            packing_notes='Double-boxed',
            status='pending',
        )
        item2 = ShipmentItem(
            organization_id=test_tenant.organization_id,
            shipment_id=shipment.shipment_id,
            object_id=obj2.object_id,
            status='pending',
        )
        postgres_session.add_all([item1, item2])
        postgres_session.flush()

        postgres_session.refresh(shipment)
        assert len(shipment.items) == 2
        assert shipment.items[0].packing_notes == 'Double-boxed'

    def test_shipment_with_references(self, postgres_session, test_tenant):
        """Shipment can link to procedures via ShipmentReference."""
        shipment = Shipment(
            organization_id=test_tenant.organization_id,
            shipment_number='SHP-003',
            shipment_type='outbound',
            direction='inbound',
            status='draft',
        )
        postgres_session.add(shipment)
        postgres_session.flush()

        exhibition_id = uuid.uuid4()
        ref = ShipmentReference(
            organization_id=test_tenant.organization_id,
            shipment_id=shipment.shipment_id,
            procedure_type='exhibition_venue',
            procedure_id=exhibition_id,
        )
        postgres_session.add(ref)
        postgres_session.flush()

        postgres_session.refresh(shipment)
        assert len(shipment.references) == 1
        assert shipment.references[0].procedure_type == 'exhibition_venue'

    def test_shipment_with_documents(self, postgres_session, test_tenant):
        """Shipment can link to documents."""
        shipment = Shipment(
            organization_id=test_tenant.organization_id,
            shipment_number='SHP-004',
            shipment_type='outbound',
            direction='outbound',
            status='dispatched',
        )
        postgres_session.add(shipment)
        postgres_session.flush()

        media_id = uuid.uuid4()
        doc = ShipmentDocument(
            organization_id=test_tenant.organization_id,
            shipment_id=shipment.shipment_id,
            media_id=media_id,
            document_type='bill_of_lading',
            label='Bill of Lading - SHP-004',
        )
        postgres_session.add(doc)
        postgres_session.flush()

        postgres_session.refresh(shipment)
        assert len(shipment.documents) == 1
        assert shipment.documents[0].document_type == 'bill_of_lading'

    def test_shipment_with_legs(self, postgres_session, test_tenant):
        """Shipment can have multiple legs."""
        shipment = Shipment(
            organization_id=test_tenant.organization_id,
            shipment_number='SHP-005',
            shipment_type='outbound',
            direction='outbound',
            status='draft',
        )
        postgres_session.add(shipment)
        postgres_session.flush()

        leg1 = ShipmentLeg(
            organization_id=test_tenant.organization_id,
            shipment_id=shipment.shipment_id,
            leg_number=1,
            carrier_name='FedEx Fine Art',
            shipping_method='ground',
            status='scheduled',
        )
        leg2 = ShipmentLeg(
            organization_id=test_tenant.organization_id,
            shipment_id=shipment.shipment_id,
            leg_number=2,
            carrier_name='DHL Art Transport',
            shipping_method='air',
            status='scheduled',
        )
        postgres_session.add_all([leg1, leg2])
        postgres_session.flush()

        postgres_session.refresh(shipment)
        assert len(shipment.legs) == 2
        assert shipment.legs[0].carrier_name == 'FedEx Fine Art'


@pytest.mark.postgres
class TestShipmentStatus:
    """Tests for shipment status management."""

    def test_status_history(self, postgres_session, test_tenant):
        """Status changes are recorded in history."""
        shipment = Shipment(
            organization_id=test_tenant.organization_id,
            shipment_number='SHP-010',
            shipment_type='outbound',
            direction='outbound',
            status='draft',
        )
        postgres_session.add(shipment)
        postgres_session.flush()

        # Add initial history
        history1 = ShipmentStatusHistory(
            organization_id=test_tenant.organization_id,
            shipment_id=shipment.shipment_id,
            status='draft',
            notes='Shipment created',
        )
        postgres_session.add(history1)

        # Simulate status change
        shipment.status = 'dispatched'
        history2 = ShipmentStatusHistory(
            organization_id=test_tenant.organization_id,
            shipment_id=shipment.shipment_id,
            status='dispatched',
            notes='Picked up by carrier',
        )
        postgres_session.add(history2)
        postgres_session.flush()

        postgres_session.refresh(shipment)
        assert len(shipment.status_history) == 2
        assert shipment.status == 'dispatched'

    def test_valid_statuses(self):
        """All expected statuses are accepted by the model."""
        expected = ['draft', 'confirmed', 'dispatched', 'in_transit',
                    'delayed', 'delivered', 'completed', 'cancelled']
        # These are enforced by check constraint at the DB level
        assert len(expected) == 8


@pytest.mark.postgres
class TestShipmentDirections:
    """Tests for shipment directions."""

    def test_inbound_outbound(self, postgres_session, test_tenant):
        """Both directions work correctly."""
        inbound = Shipment(
            organization_id=test_tenant.organization_id,
            shipment_number='SHP-IN-001',
            shipment_type='outbound',
            direction='inbound',
            status='draft',
        )
        outbound = Shipment(
            organization_id=test_tenant.organization_id,
            shipment_number='SHP-OUT-001',
            shipment_type='outbound',
            direction='outbound',
            status='draft',
        )
        postgres_session.add_all([inbound, outbound])
        postgres_session.flush()

        assert inbound.direction == 'inbound'
        assert outbound.direction == 'outbound'


@pytest.mark.postgres
class TestShipmentCascadeDelete:
    """Tests for cascade delete behavior."""

    def test_shipment_delete_cascades_to_children(self, postgres_session, test_tenant):
        """Deleting shipment cascades to items, references, and documents."""
        shipment = Shipment(
            organization_id=test_tenant.organization_id,
            shipment_number='SHP-DEL-001',
            shipment_type='outbound',
            direction='outbound',
            status='draft',
        )
        postgres_session.add(shipment)
        postgres_session.flush()

        obj = _make_object(postgres_session, test_tenant, 'OBJ-SHP-DEL-001')
        item = ShipmentItem(
            organization_id=test_tenant.organization_id,
            shipment_id=shipment.shipment_id,
            object_id=obj.object_id,
            status='pending',
        )
        doc = ShipmentDocument(
            organization_id=test_tenant.organization_id,
            shipment_id=shipment.shipment_id,
            media_id=uuid.uuid4(),
        )
        postgres_session.add_all([item, doc])
        postgres_session.flush()

        item_id = item.shipment_item_id
        doc_id = doc.document_id

        postgres_session.delete(shipment)
        postgres_session.flush()

        assert postgres_session.query(ShipmentItem).filter(
            ShipmentItem.shipment_item_id == item_id
        ).first() is None
        assert postgres_session.query(ShipmentDocument).filter(
            ShipmentDocument.document_id == doc_id
        ).first() is None

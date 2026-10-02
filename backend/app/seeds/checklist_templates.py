"""
Seed data for checklist templates.

Provides standard templates for:
- In-house exhibitions
- Incoming traveling exhibitions
- Outgoing traveling exhibitions
"""
from uuid import uuid4
from app.database import db
from app.models import (
    ChecklistTemplate, ChecklistTemplateVersion, ChecklistTemplateItem,
    ChecklistPhase, ChecklistRole, ChecklistExhibitionType
)


def seed_checklist_templates(org_id, user_id=None):
    """Create standard checklist templates for an organization."""

    templates_data = [
        {
            'name': 'In-House Exhibition',
            'description': 'Standard checklist for exhibitions created and hosted by our museum.',
            'exhibition_type': ChecklistExhibitionType.IN_HOUSE,
            'items': IN_HOUSE_ITEMS,
        },
        {
            'name': 'Incoming Traveling Exhibition',
            'description': 'Checklist for exhibitions traveling to our venue from another institution.',
            'exhibition_type': ChecklistExhibitionType.INCOMING_TRAVELING,
            'items': INCOMING_TRAVELING_ITEMS,
        },
        {
            'name': 'Outgoing Traveling Exhibition',
            'description': 'Checklist for exhibitions traveling from our museum to other venues.',
            'exhibition_type': ChecklistExhibitionType.OUTGOING_TRAVELING,
            'items': OUTGOING_TRAVELING_ITEMS,
        },
    ]

    created_templates = []

    for template_data in templates_data:
        # Check if template already exists
        existing = db.session.query(ChecklistTemplate).filter(
            ChecklistTemplate.org_id == org_id,
            ChecklistTemplate.name == template_data['name']
        ).first()

        if existing:
            continue

        template = ChecklistTemplate(
            template_id=uuid4(),
            org_id=org_id,
            name=template_data['name'],
            description=template_data['description'],
            exhibition_type=template_data['exhibition_type'],
            created_by=user_id,
        )
        db.session.add(template)
        db.session.flush()

        # Create version 1
        version = ChecklistTemplateVersion(
            version_id=uuid4(),
            template_id=template.template_id,
            version_number=1,
            is_published=True,
            is_locked=False,
            change_notes='Initial version',
            created_by=user_id,
        )
        db.session.add(version)
        db.session.flush()

        # Add items
        for idx, item_data in enumerate(template_data['items']):
            item = ChecklistTemplateItem(
                template_item_id=uuid4(),
                version_id=version.version_id,
                phase=item_data['phase'],
                title=item_data['title'],
                description=item_data.get('description'),
                responsible_role=item_data['role'],
                default_due_offset_days=item_data.get('due_offset'),
                sort_order=idx,
                is_required=item_data.get('required', True),
            )
            db.session.add(item)

        created_templates.append(template)

    db.session.commit()
    return created_templates


# === IN-HOUSE EXHIBITION ITEMS ===

IN_HOUSE_ITEMS = [
    # PLANNING PHASE
    {'phase': ChecklistPhase.PLANNING, 'title': 'Develop exhibition concept and theme', 'role': ChecklistRole.CURATOR, 'due_offset': -180},
    {'phase': ChecklistPhase.PLANNING, 'title': 'Create preliminary object list', 'role': ChecklistRole.CURATOR, 'due_offset': -150},
    {'phase': ChecklistPhase.PLANNING, 'title': 'Establish exhibition budget', 'role': ChecklistRole.EXHIBITIONS_MANAGER, 'due_offset': -150},
    {'phase': ChecklistPhase.PLANNING, 'title': 'Develop exhibition timeline', 'role': ChecklistRole.EXHIBITIONS_MANAGER, 'due_offset': -150},
    {'phase': ChecklistPhase.PLANNING, 'title': 'Assess conservation needs for objects', 'role': ChecklistRole.CONSERVATION, 'due_offset': -120},
    {'phase': ChecklistPhase.PLANNING, 'title': 'Begin loan requests for external objects', 'role': ChecklistRole.REGISTRAR, 'due_offset': -120},
    {'phase': ChecklistPhase.PLANNING, 'title': 'Develop gallery floor plan', 'role': ChecklistRole.EXHIBITIONS_MANAGER, 'due_offset': -90},
    {'phase': ChecklistPhase.PLANNING, 'title': 'Finalize object checklist', 'role': ChecklistRole.CURATOR, 'due_offset': -90},
    {'phase': ChecklistPhase.PLANNING, 'title': 'Develop interpretive content outline', 'role': ChecklistRole.CURATOR, 'due_offset': -90},

    # PRE-INSTALL PHASE
    {'phase': ChecklistPhase.PRE_INSTALL, 'title': 'Complete loan agreements', 'role': ChecklistRole.REGISTRAR, 'due_offset': -60},
    {'phase': ChecklistPhase.PRE_INSTALL, 'title': 'Arrange insurance for loaned objects', 'role': ChecklistRole.REGISTRAR, 'due_offset': -60},
    {'phase': ChecklistPhase.PRE_INSTALL, 'title': 'Write and edit label copy', 'role': ChecklistRole.CURATOR, 'due_offset': -45},
    {'phase': ChecklistPhase.PRE_INSTALL, 'title': 'Design graphics and signage', 'role': ChecklistRole.EXHIBITIONS_MANAGER, 'due_offset': -45},
    {'phase': ChecklistPhase.PRE_INSTALL, 'title': 'Complete conservation treatments', 'role': ChecklistRole.CONSERVATION, 'due_offset': -30},
    {'phase': ChecklistPhase.PRE_INSTALL, 'title': 'Fabricate mounts and display furniture', 'role': ChecklistRole.PREPARATOR, 'due_offset': -30},
    {'phase': ChecklistPhase.PRE_INSTALL, 'title': 'Coordinate shipping for incoming loans', 'role': ChecklistRole.REGISTRAR, 'due_offset': -21},
    {'phase': ChecklistPhase.PRE_INSTALL, 'title': 'Develop marketing materials', 'role': ChecklistRole.MARKETING, 'due_offset': -30},
    {'phase': ChecklistPhase.PRE_INSTALL, 'title': 'Produce labels and graphics', 'role': ChecklistRole.EXHIBITIONS_MANAGER, 'due_offset': -14},
    {'phase': ChecklistPhase.PRE_INSTALL, 'title': 'Prepare gallery space (paint, lighting)', 'role': ChecklistRole.PREPARATOR, 'due_offset': -14},

    # INSTALL PHASE
    {'phase': ChecklistPhase.INSTALL, 'title': 'Receive and condition report incoming loans', 'role': ChecklistRole.REGISTRAR, 'due_offset': -7},
    {'phase': ChecklistPhase.INSTALL, 'title': 'Install display furniture and cases', 'role': ChecklistRole.PREPARATOR, 'due_offset': -7},
    {'phase': ChecklistPhase.INSTALL, 'title': 'Install objects', 'role': ChecklistRole.PREPARATOR, 'due_offset': -5},
    {'phase': ChecklistPhase.INSTALL, 'title': 'Curatorial walkthrough and adjustments', 'role': ChecklistRole.CURATOR, 'due_offset': -3},
    {'phase': ChecklistPhase.INSTALL, 'title': 'Install graphics and labels', 'role': ChecklistRole.PREPARATOR, 'due_offset': -3},
    {'phase': ChecklistPhase.INSTALL, 'title': 'Final lighting adjustments', 'role': ChecklistRole.PREPARATOR, 'due_offset': -2},
    {'phase': ChecklistPhase.INSTALL, 'title': 'Security review', 'role': ChecklistRole.SECURITY, 'due_offset': -2},
    {'phase': ChecklistPhase.INSTALL, 'title': 'Final conservation check', 'role': ChecklistRole.CONSERVATION, 'due_offset': -1},
    {'phase': ChecklistPhase.INSTALL, 'title': 'Photography of installed exhibition', 'role': ChecklistRole.MARKETING, 'due_offset': -1},

    # OPEN PHASE
    {'phase': ChecklistPhase.OPEN, 'title': 'Staff preview/training', 'role': ChecklistRole.EDUCATION, 'due_offset': -1},
    {'phase': ChecklistPhase.OPEN, 'title': 'Media preview/press event', 'role': ChecklistRole.MARKETING, 'due_offset': 0},
    {'phase': ChecklistPhase.OPEN, 'title': 'Opening reception', 'role': ChecklistRole.EXHIBITIONS_MANAGER, 'due_offset': 0},
    {'phase': ChecklistPhase.OPEN, 'title': 'Monitor environmental conditions', 'role': ChecklistRole.CONSERVATION, 'due_offset': 7, 'required': False},
    {'phase': ChecklistPhase.OPEN, 'title': 'Mid-run conservation check', 'role': ChecklistRole.CONSERVATION, 'due_offset': 45, 'required': False},

    # CLOSE PHASE
    {'phase': ChecklistPhase.CLOSE, 'title': 'Send loan return notifications', 'role': ChecklistRole.REGISTRAR, 'due_offset': None, 'description': '30 days before close'},
    {'phase': ChecklistPhase.CLOSE, 'title': 'Schedule deinstallation', 'role': ChecklistRole.EXHIBITIONS_MANAGER, 'due_offset': None},
    {'phase': ChecklistPhase.CLOSE, 'title': 'Archive exhibition documentation', 'role': ChecklistRole.REGISTRAR, 'due_offset': None},

    # DEINSTALL PHASE
    {'phase': ChecklistPhase.DEINSTALL, 'title': 'Remove graphics and labels', 'role': ChecklistRole.PREPARATOR, 'due_offset': None},
    {'phase': ChecklistPhase.DEINSTALL, 'title': 'Deinstall objects', 'role': ChecklistRole.PREPARATOR, 'due_offset': None},
    {'phase': ChecklistPhase.DEINSTALL, 'title': 'Condition report all objects', 'role': ChecklistRole.REGISTRAR, 'due_offset': None},
    {'phase': ChecklistPhase.DEINSTALL, 'title': 'Pack and ship loan returns', 'role': ChecklistRole.REGISTRAR, 'due_offset': None},
    {'phase': ChecklistPhase.DEINSTALL, 'title': 'Return collection objects to storage', 'role': ChecklistRole.REGISTRAR, 'due_offset': None},
    {'phase': ChecklistPhase.DEINSTALL, 'title': 'Restore gallery to neutral state', 'role': ChecklistRole.PREPARATOR, 'due_offset': None},
    {'phase': ChecklistPhase.DEINSTALL, 'title': 'Exhibition debrief meeting', 'role': ChecklistRole.EXHIBITIONS_MANAGER, 'due_offset': None},
]


# === INCOMING TRAVELING EXHIBITION ITEMS ===

INCOMING_TRAVELING_ITEMS = [
    # PLANNING PHASE
    {'phase': ChecklistPhase.PLANNING, 'title': 'Review exhibition prospectus', 'role': ChecklistRole.CURATOR, 'due_offset': -180},
    {'phase': ChecklistPhase.PLANNING, 'title': 'Negotiate venue agreement', 'role': ChecklistRole.EXHIBITIONS_MANAGER, 'due_offset': -150},
    {'phase': ChecklistPhase.PLANNING, 'title': 'Review facility report requirements', 'role': ChecklistRole.REGISTRAR, 'due_offset': -150},
    {'phase': ChecklistPhase.PLANNING, 'title': 'Submit facility report to organizer', 'role': ChecklistRole.REGISTRAR, 'due_offset': -120},
    {'phase': ChecklistPhase.PLANNING, 'title': 'Confirm exhibition dates', 'role': ChecklistRole.EXHIBITIONS_MANAGER, 'due_offset': -120},
    {'phase': ChecklistPhase.PLANNING, 'title': 'Establish local budget', 'role': ChecklistRole.EXHIBITIONS_MANAGER, 'due_offset': -120},
    {'phase': ChecklistPhase.PLANNING, 'title': 'Review object checklist', 'role': ChecklistRole.REGISTRAR, 'due_offset': -90},
    {'phase': ChecklistPhase.PLANNING, 'title': 'Assess gallery space requirements', 'role': ChecklistRole.EXHIBITIONS_MANAGER, 'due_offset': -90},

    # PRE-INSTALL PHASE
    {'phase': ChecklistPhase.PRE_INSTALL, 'title': 'Execute loan agreement/contract', 'role': ChecklistRole.REGISTRAR, 'due_offset': -60},
    {'phase': ChecklistPhase.PRE_INSTALL, 'title': 'Arrange insurance coverage', 'role': ChecklistRole.REGISTRAR, 'due_offset': -60},
    {'phase': ChecklistPhase.PRE_INSTALL, 'title': 'Review installation manual', 'role': ChecklistRole.PREPARATOR, 'due_offset': -45},
    {'phase': ChecklistPhase.PRE_INSTALL, 'title': 'Order/fabricate local display elements', 'role': ChecklistRole.PREPARATOR, 'due_offset': -45},
    {'phase': ChecklistPhase.PRE_INSTALL, 'title': 'Coordinate shipping with organizer', 'role': ChecklistRole.REGISTRAR, 'due_offset': -30},
    {'phase': ChecklistPhase.PRE_INSTALL, 'title': 'Arrange courier accommodations', 'role': ChecklistRole.REGISTRAR, 'due_offset': -21},
    {'phase': ChecklistPhase.PRE_INSTALL, 'title': 'Localize marketing materials', 'role': ChecklistRole.MARKETING, 'due_offset': -30},
    {'phase': ChecklistPhase.PRE_INSTALL, 'title': 'Prepare gallery (paint, climate control)', 'role': ChecklistRole.PREPARATOR, 'due_offset': -14},

    # INSTALL PHASE
    {'phase': ChecklistPhase.INSTALL, 'title': 'Receive shipment', 'role': ChecklistRole.REGISTRAR, 'due_offset': -7},
    {'phase': ChecklistPhase.INSTALL, 'title': 'Joint condition reporting with courier', 'role': ChecklistRole.REGISTRAR, 'due_offset': -7},
    {'phase': ChecklistPhase.INSTALL, 'title': 'Install exhibition per manual', 'role': ChecklistRole.PREPARATOR, 'due_offset': -5},
    {'phase': ChecklistPhase.INSTALL, 'title': 'Courier sign-off on installation', 'role': ChecklistRole.REGISTRAR, 'due_offset': -2},
    {'phase': ChecklistPhase.INSTALL, 'title': 'Security walkthrough', 'role': ChecklistRole.SECURITY, 'due_offset': -2},
    {'phase': ChecklistPhase.INSTALL, 'title': 'Final lighting per specifications', 'role': ChecklistRole.PREPARATOR, 'due_offset': -1},

    # OPEN PHASE
    {'phase': ChecklistPhase.OPEN, 'title': 'Staff training on exhibition', 'role': ChecklistRole.EDUCATION, 'due_offset': -1},
    {'phase': ChecklistPhase.OPEN, 'title': 'Opening events', 'role': ChecklistRole.EXHIBITIONS_MANAGER, 'due_offset': 0},
    {'phase': ChecklistPhase.OPEN, 'title': 'Submit environmental monitoring reports', 'role': ChecklistRole.CONSERVATION, 'due_offset': 30, 'required': False},

    # CLOSE PHASE
    {'phase': ChecklistPhase.CLOSE, 'title': 'Coordinate outgoing shipping with next venue/organizer', 'role': ChecklistRole.REGISTRAR, 'due_offset': None},
    {'phase': ChecklistPhase.CLOSE, 'title': 'Arrange courier travel', 'role': ChecklistRole.REGISTRAR, 'due_offset': None},
    {'phase': ChecklistPhase.CLOSE, 'title': 'Compile exhibition report for organizer', 'role': ChecklistRole.EXHIBITIONS_MANAGER, 'due_offset': None},

    # DEINSTALL PHASE
    {'phase': ChecklistPhase.DEINSTALL, 'title': 'Deinstall per manual specifications', 'role': ChecklistRole.PREPARATOR, 'due_offset': None},
    {'phase': ChecklistPhase.DEINSTALL, 'title': 'Joint condition reporting', 'role': ChecklistRole.REGISTRAR, 'due_offset': None},
    {'phase': ChecklistPhase.DEINSTALL, 'title': 'Pack exhibition per manual', 'role': ChecklistRole.PREPARATOR, 'due_offset': None},
    {'phase': ChecklistPhase.DEINSTALL, 'title': 'Ship to next venue', 'role': ChecklistRole.REGISTRAR, 'due_offset': None},
    {'phase': ChecklistPhase.DEINSTALL, 'title': 'Return local materials/dispose', 'role': ChecklistRole.PREPARATOR, 'due_offset': None},
    {'phase': ChecklistPhase.DEINSTALL, 'title': 'Submit final report to organizer', 'role': ChecklistRole.EXHIBITIONS_MANAGER, 'due_offset': None},
]


# === OUTGOING TRAVELING EXHIBITION ITEMS ===

OUTGOING_TRAVELING_ITEMS = [
    # PLANNING PHASE
    {'phase': ChecklistPhase.PLANNING, 'title': 'Develop traveling exhibition concept', 'role': ChecklistRole.CURATOR, 'due_offset': -365},
    {'phase': ChecklistPhase.PLANNING, 'title': 'Create traveling exhibition prospectus', 'role': ChecklistRole.EXHIBITIONS_MANAGER, 'due_offset': -300},
    {'phase': ChecklistPhase.PLANNING, 'title': 'Establish tour budget and fee structure', 'role': ChecklistRole.EXHIBITIONS_MANAGER, 'due_offset': -300},
    {'phase': ChecklistPhase.PLANNING, 'title': 'Market exhibition to potential venues', 'role': ChecklistRole.EXHIBITIONS_MANAGER, 'due_offset': -270},
    {'phase': ChecklistPhase.PLANNING, 'title': 'Finalize object checklist', 'role': ChecklistRole.CURATOR, 'due_offset': -240},
    {'phase': ChecklistPhase.PLANNING, 'title': 'Assess conservation needs', 'role': ChecklistRole.CONSERVATION, 'due_offset': -240},
    {'phase': ChecklistPhase.PLANNING, 'title': 'Develop installation manual', 'role': ChecklistRole.PREPARATOR, 'due_offset': -180},
    {'phase': ChecklistPhase.PLANNING, 'title': 'Design crate specifications', 'role': ChecklistRole.PREPARATOR, 'due_offset': -180},
    {'phase': ChecklistPhase.PLANNING, 'title': 'Negotiate venue agreements', 'role': ChecklistRole.EXHIBITIONS_MANAGER, 'due_offset': -180},

    # PRE-INSTALL PHASE (for first venue)
    {'phase': ChecklistPhase.PRE_INSTALL, 'title': 'Execute venue contracts', 'role': ChecklistRole.EXHIBITIONS_MANAGER, 'due_offset': -120},
    {'phase': ChecklistPhase.PRE_INSTALL, 'title': 'Review venue facility reports', 'role': ChecklistRole.REGISTRAR, 'due_offset': -90},
    {'phase': ChecklistPhase.PRE_INSTALL, 'title': 'Complete conservation treatments', 'role': ChecklistRole.CONSERVATION, 'due_offset': -60},
    {'phase': ChecklistPhase.PRE_INSTALL, 'title': 'Fabricate traveling crates', 'role': ChecklistRole.PREPARATOR, 'due_offset': -60},
    {'phase': ChecklistPhase.PRE_INSTALL, 'title': 'Fabricate mounts and display elements', 'role': ChecklistRole.PREPARATOR, 'due_offset': -45},
    {'phase': ChecklistPhase.PRE_INSTALL, 'title': 'Finalize installation manual', 'role': ChecklistRole.PREPARATOR, 'due_offset': -30},
    {'phase': ChecklistPhase.PRE_INSTALL, 'title': 'Establish insurance coverage', 'role': ChecklistRole.REGISTRAR, 'due_offset': -30},
    {'phase': ChecklistPhase.PRE_INSTALL, 'title': 'Arrange courier travel', 'role': ChecklistRole.REGISTRAR, 'due_offset': -21},
    {'phase': ChecklistPhase.PRE_INSTALL, 'title': 'Coordinate shipping to first venue', 'role': ChecklistRole.REGISTRAR, 'due_offset': -14},

    # INSTALL PHASE
    {'phase': ChecklistPhase.INSTALL, 'title': 'Condition report objects before packing', 'role': ChecklistRole.REGISTRAR, 'due_offset': -10},
    {'phase': ChecklistPhase.INSTALL, 'title': 'Pack objects for travel', 'role': ChecklistRole.PREPARATOR, 'due_offset': -9},
    {'phase': ChecklistPhase.INSTALL, 'title': 'Ship to first venue', 'role': ChecklistRole.REGISTRAR, 'due_offset': -7},
    {'phase': ChecklistPhase.INSTALL, 'title': 'Courier supervision of installation', 'role': ChecklistRole.REGISTRAR, 'due_offset': -5},
    {'phase': ChecklistPhase.INSTALL, 'title': 'Sign off on installation', 'role': ChecklistRole.REGISTRAR, 'due_offset': -1},

    # TRAVEL PHASE (ongoing during tour)
    {'phase': ChecklistPhase.TRAVEL, 'title': 'Monitor environmental reports from venues', 'role': ChecklistRole.CONSERVATION, 'due_offset': None},
    {'phase': ChecklistPhase.TRAVEL, 'title': 'Review condition reports between venues', 'role': ChecklistRole.REGISTRAR, 'due_offset': None},
    {'phase': ChecklistPhase.TRAVEL, 'title': 'Coordinate inter-venue shipping', 'role': ChecklistRole.REGISTRAR, 'due_offset': None},
    {'phase': ChecklistPhase.TRAVEL, 'title': 'Arrange couriers for each venue', 'role': ChecklistRole.REGISTRAR, 'due_offset': None},
    {'phase': ChecklistPhase.TRAVEL, 'title': 'Approve installation at each venue', 'role': ChecklistRole.REGISTRAR, 'due_offset': None},
    {'phase': ChecklistPhase.TRAVEL, 'title': 'Track and respond to venue reports', 'role': ChecklistRole.EXHIBITIONS_MANAGER, 'due_offset': None},

    # DEINSTALL PHASE (from final venue)
    {'phase': ChecklistPhase.DEINSTALL, 'title': 'Coordinate return shipping from final venue', 'role': ChecklistRole.REGISTRAR, 'due_offset': None},
    {'phase': ChecklistPhase.DEINSTALL, 'title': 'Final condition reporting', 'role': ChecklistRole.REGISTRAR, 'due_offset': None},
    {'phase': ChecklistPhase.DEINSTALL, 'title': 'Receive objects from tour', 'role': ChecklistRole.REGISTRAR, 'due_offset': None},
    {'phase': ChecklistPhase.DEINSTALL, 'title': 'Post-tour conservation assessment', 'role': ChecklistRole.CONSERVATION, 'due_offset': None},
    {'phase': ChecklistPhase.DEINSTALL, 'title': 'Return objects to collection storage', 'role': ChecklistRole.REGISTRAR, 'due_offset': None},
    {'phase': ChecklistPhase.DEINSTALL, 'title': 'Archive tour documentation', 'role': ChecklistRole.REGISTRAR, 'due_offset': None},
    {'phase': ChecklistPhase.DEINSTALL, 'title': 'Tour financial reconciliation', 'role': ChecklistRole.EXHIBITIONS_MANAGER, 'due_offset': None},
    {'phase': ChecklistPhase.DEINSTALL, 'title': 'Tour debrief and assessment', 'role': ChecklistRole.EXHIBITIONS_MANAGER, 'due_offset': None},
]

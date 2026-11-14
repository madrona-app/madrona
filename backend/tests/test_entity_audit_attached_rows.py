"""Polymorphic and organization-less rows are on their record's history.

Loan renewals (attributed to the right loan), procedure images, exhibition
checklists and their items and links, information requests and their
documents, budget lines and their links, checklist and information-request
template items, shipment documents, audit check results and compliance
issues, placements and floor plans, download-request items, collection
feedback requests and responses, preservation actions and manual media
collection membership each record added / changed / removed events on the
record they belong to, with the organization taken from that record.

Machine churn is left out: generating an audit check list is one change on
the campaign, a smart collection's automatic membership sync records
nothing, and dragging a placement (coordinates only) records nothing.
Download link tokens and feedback tokens are never recorded.
"""
import json
import uuid
from datetime import date

import pytest

from app import context as ctx
from app.models import (
    AuditCampaign,
    CollectionObject,
    EntityAuditEvent,
    EntityAuditFieldDiff,
    Exhibition,
    LoanIn,
    LoanOut,
    Media,
    MediaCollection,
    Shipment,
    Venue,
)
from app.models.budget import BudgetLineLink, ExhibitionBudgetLine
from app.models.checklists import (
    ChecklistItem,
    ChecklistItemLink,
    ChecklistTemplate,
    ChecklistTemplateItem,
    ChecklistTemplateVersion,
    ExhibitionChecklist,
)
from app.models.compliance import AuditResult, ComplianceIssueItem, EntityImage
from app.models.discover import CollectionFeedbackRequest, CollectionFeedbackResponse
from app.models.exhibit import ExhibitionFloorPlan, FloorPlan, Placement
from app.models.info_requests import (
    ExhibitionInfoRequest,
    InfoRequestDocument,
    InfoRequestTemplate,
    InfoRequestTemplateItem,
)
from app.models.logistics import ShipmentDocument
from app.models.media import MediaCollectionItem, MediaDownloadRequest, MediaDownloadRequestItem
from app.models.preservation import PreservationActionPlan, PreservationPolicy
from app.models.procedures import LoanRenewal
from app.services import entity_audit as ea


def _child_events(db, org_id, entity_type, entity_id, child_type):
    db.expire_all()
    return (
        db.query(EntityAuditEvent)
        .filter(
            EntityAuditEvent.organization_id == org_id,
            EntityAuditEvent.entity_type == entity_type,
            EntityAuditEvent.entity_id == entity_id,
            EntityAuditEvent.child_entity_type == child_type,
        )
        .order_by(EntityAuditEvent.changed_at)
        .all()
    )


def _diffs(event):
    return {d.field_name: (d.old_value, d.new_value) for d in event.field_diffs}


@pytest.fixture()
def acting_user(auth_setup):
    _, org, user = auth_setup
    token = ctx.request_user_id.set(str(user.user_id))
    try:
        yield org, user
    finally:
        ctx.request_user_id.reset(token)


def _media(db, o, name="doc.pdf"):
    m = Media(organization_id=o, s3_key=f"k/{uuid.uuid4()}", filename=name, file_size=1,
              mime_type="application/pdf", media_type="document")
    db.add(m)
    db.flush()
    return m


def _exhibition(db, o):
    e = Exhibition(organization_id=o, title="Touch the Past")
    db.add(e)
    db.flush()
    return e


# Each builder returns (row, parent_type, parent_id, child_type, field, new_value).


def b_loan_renewal_in(db, o, user):
    loan = LoanIn(organization_id=o, loan_number="LI-1", loan_purpose="exhibition")
    db.add(loan)
    db.flush()
    row = LoanRenewal(organization_id=o, loan_type="loan_in", loan_id=loan.loan_in_id, renewal_number=1,
                      new_end_date=date(2027, 6, 30))
    return row, "loan_in", loan.loan_in_id, "loan_renewal", "reason", "Extended for the tour"


def b_loan_renewal_out(db, o, user):
    loan = LoanOut(organization_id=o, loan_number="LO-1", loan_purpose="exhibition")
    db.add(loan)
    db.flush()
    row = LoanRenewal(organization_id=o, loan_type="loan_out", loan_id=loan.loan_out_id, renewal_number=1)
    return row, "loan_out", loan.loan_out_id, "loan_renewal", "note", "Borrower asked for three months"


def b_entity_image(db, o, user):
    from app.models import IncidentReport

    from datetime import datetime, timezone

    ir = IncidentReport(organization_id=o, report_number="IR-1", report_date=date.today(), incident_type="damage",
                        discovered_date=datetime.now(timezone.utc), incident_description="Scuffed frame")
    db.add(ir)
    db.flush()
    row = EntityImage(organization_id=o, entity_type="incident_report", entity_id=ir.report_id, image_phase="before",
                      media_id=_media(db, o, "scuff.jpg").media_id)
    return row, "incident_report", ir.report_id, "entity_image", "caption", "Lower left corner"


def b_checklist(db, o, user):
    e = _exhibition(db, o)
    return ExhibitionChecklist(exhibition_id=e.exhibition_id, name="Install"), "exhibition", e.exhibition_id, \
        "exhibition_checklist", "name", "Install and opening"


def b_checklist_item(db, o, user):
    e = _exhibition(db, o)
    cl = ExhibitionChecklist(exhibition_id=e.exhibition_id, name="Install")
    db.add(cl)
    db.flush()
    row = ChecklistItem(checklist_id=cl.checklist_id, phase="install", title="Hang braille labels",
                        responsible_role="registrar")
    return row, "exhibition", e.exhibition_id, "checklist_item", "status", "done"


def b_checklist_item_link(db, o, user):
    e = _exhibition(db, o)
    cl = ExhibitionChecklist(exhibition_id=e.exhibition_id, name="Install")
    db.add(cl)
    db.flush()
    item = ChecklistItem(checklist_id=cl.checklist_id, phase="install", title="Courier", responsible_role="registrar")
    db.add(item)
    db.flush()
    row = ChecklistItemLink(item_id=item.item_id, linked_entity_type="shipment", linked_entity_id=uuid.uuid4())
    return row, "exhibition", e.exhibition_id, "checklist_item_link", "linked_entity_type", "loan_in"


def b_template_version(db, o, user):
    t = ChecklistTemplate(organization_id=o, name="Standard install")
    db.add(t)
    db.flush()
    row = ChecklistTemplateVersion(template_id=t.template_id, version_number=1)
    return row, "checklist_template", t.template_id, "checklist_template_version", "change_notes", "Added courier step"


def b_template_item(db, o, user):
    t = ChecklistTemplate(organization_id=o, name="Standard install")
    db.add(t)
    db.flush()
    v = ChecklistTemplateVersion(template_id=t.template_id, version_number=1)
    db.add(v)
    db.flush()
    row = ChecklistTemplateItem(version_id=v.version_id, phase="install", title="Light levels", responsible_role="conservator")
    return row, "checklist_template", t.template_id, "checklist_template_item", "title", "Light levels under 50 lux"


def b_info_template_item(db, o, user):
    t = InfoRequestTemplate(organization_id=o, name="Lender pack")
    db.add(t)
    db.flush()
    row = InfoRequestTemplateItem(template_id=t.template_id, request_type="facility_report", title="Facility report")
    return row, "info_request_template", t.template_id, "info_request_template_item", "title", "Facility report (current)"


def b_info_request(db, o, user):
    e = _exhibition(db, o)
    row = ExhibitionInfoRequest(exhibition_id=e.exhibition_id, request_type="facility_report", title="Facility report")
    return row, "exhibition", e.exhibition_id, "exhibition_info_request", "status", "received"


def b_info_request_document(db, o, user):
    e = _exhibition(db, o)
    r = ExhibitionInfoRequest(exhibition_id=e.exhibition_id, request_type="facility_report", title="Facility report")
    db.add(r)
    db.flush()
    row = InfoRequestDocument(request_id=r.request_id, media_id=_media(db, o).media_id, label="Report")
    return row, "exhibition", e.exhibition_id, "info_request_document", "label", "Signed report"


def b_budget_line(db, o, user):
    e = _exhibition(db, o)
    row = ExhibitionBudgetLine(exhibition_id=e.exhibition_id, category="design", description="Tactile models",
                               estimated_amount=1200)
    return row, "exhibition", e.exhibition_id, "exhibition_budget_line", "description", "Tactile 3D models"


def b_budget_link(db, o, user):
    e = _exhibition(db, o)
    line = ExhibitionBudgetLine(exhibition_id=e.exhibition_id, category="design", description="Models")
    db.add(line)
    db.flush()
    row = BudgetLineLink(line_id=line.line_id, entity_type="shipment", entity_id=uuid.uuid4(), label="Crate shipping")
    return row, "exhibition", e.exhibition_id, "budget_line_link", "label", "Crate shipping (return)"


def b_shipment_document(db, o, user):
    s = Shipment(organization_id=o, shipment_number="SH-1", shipment_type="outbound")
    db.add(s)
    db.flush()
    row = ShipmentDocument(organization_id=o, shipment_id=s.shipment_id, media_id=_media(db, o, "bol.pdf").media_id,
                           document_type="bill_of_lading", label="Bill of lading")
    return row, "shipment", s.shipment_id, "shipment_document", "label", "Bill of lading (signed)"


def b_audit_result(db, o, user):
    c = AuditCampaign(organization_id=o, campaign_number="AC-1", title="Spot check", audit_type="spot_check")
    obj = CollectionObject(organization_id=o, object_number="AR.1")
    db.add_all([c, obj])
    db.flush()
    row = AuditResult(campaign_id=c.campaign_id, organization_id=o, object_id=obj.object_id, result_status="pending")
    return row, "audit_campaign", c.campaign_id, "audit_result", "result_status", "verified"


def b_compliance_issue(db, o, user):
    c = AuditCampaign(organization_id=o, campaign_number="AC-2", title="Spot check", audit_type="spot_check")
    db.add(c)
    db.flush()
    r = AuditResult(campaign_id=c.campaign_id, organization_id=o, result_status="pending")
    db.add(r)
    db.flush()
    row = ComplianceIssueItem(organization_id=o, result_id=r.result_id, issue_type="documentation",
                              description="No condition report")
    return row, "audit_campaign", c.campaign_id, "compliance_issue_item", "resolved", True


def b_floor_plan(db, o, user):
    v = Venue(organization_id=o, name="Main hall")
    db.add(v)
    db.flush()
    row = FloorPlan(venue_id=v.venue_id, name="Level 1")
    return row, "venue", v.venue_id, "floor_plan", "wall_color", "#eeeeee"


def b_exhibition_floor_plan(db, o, user):
    v = Venue(organization_id=o, name="Main hall")
    db.add(v)
    db.flush()
    fp = FloorPlan(venue_id=v.venue_id, name="Level 1")
    e = _exhibition(db, o)
    db.add(fp)
    db.flush()
    row = ExhibitionFloorPlan(exhibition_id=e.exhibition_id, floor_plan_id=fp.floor_plan_id, visit_order=1)
    return row, "exhibition", e.exhibition_id, "exhibition_floor_plan", "visit_order", 2


def b_placement(db, o, user):
    v = Venue(organization_id=o, name="Main hall")
    db.add(v)
    db.flush()
    fp = FloorPlan(venue_id=v.venue_id, name="Level 1")
    e = _exhibition(db, o)
    db.add(fp)
    db.flush()
    row = Placement(exhibition_id=e.exhibition_id, floor_plan_id=fp.floor_plan_id, source_type="external",
                    display_title="Bronze hand", width_cm=20, height_cm=30, wall_id="north", position_x=1, position_y=1)
    return row, "exhibition", e.exhibition_id, "placement", "label_text", "Please touch"


def b_download_item(db, o, user):
    req = MediaDownloadRequest(organization_id=o, request_number="DR-1", requester_id=user.user_id,
                               requester_name="Sam", requester_email="sam@example.org", purpose="research",
                               intended_use="Thesis figures")
    db.add(req)
    db.flush()
    row = MediaDownloadRequestItem(request_id=req.request_id, media_id=_media(db, o, "plate.tif").media_id)
    return row, "media_download_request", req.request_id, "media_download_request_item", "item_status", "approved"


def b_feedback_request(db, o, user):
    coll = MediaCollection(organization_id=o, name="Review set")
    db.add(coll)
    db.flush()
    row = CollectionFeedbackRequest(collection_id=coll.collection_id, organization_id=o,
                                    token="fb-secret-token-123", recipient_email="curator@example.org")
    return row, "media_collection", coll.collection_id, "collection_feedback_request", "is_active", False


def b_feedback_response(db, o, user):
    coll = MediaCollection(organization_id=o, name="Review set")
    db.add(coll)
    db.flush()
    fr = CollectionFeedbackRequest(collection_id=coll.collection_id, organization_id=o, token="fb-token-xyz")
    db.add(fr)
    db.flush()
    row = CollectionFeedbackResponse(request_id=fr.request_id, media_id=_media(db, o, "a.jpg").media_id,
                                     rating=4, respondent_name="Guest reviewer")
    return row, "media_collection", coll.collection_id, "collection_feedback_response", "comment", "Lovely detail"


def b_preservation_action(db, o, user):
    p = PreservationPolicy(organization_id=o, name="TIFF to JPEG2000", policy_type="format_migration")
    m = _media(db, o, "scan.tif")
    db.add(p)
    db.flush()
    row = PreservationActionPlan(organization_id=o, policy_id=p.policy_id, media_id=m.media_id, action_type="migrate_format")
    return row, "media", m.media_id, "preservation_action", "status", "approved"


def b_collection_item(db, o, user):
    coll = MediaCollection(organization_id=o, name="Highlights")
    db.add(coll)
    db.flush()
    row = MediaCollectionItem(collection_id=coll.collection_id, media_id=_media(db, o, "h.jpg").media_id)
    return row, "media_collection", coll.collection_id, "media_collection_item", "notes", "Cover image"


BUILDERS = [
    b_loan_renewal_in, b_loan_renewal_out, b_entity_image, b_checklist, b_checklist_item, b_checklist_item_link,
    b_template_version, b_template_item, b_info_template_item, b_info_request, b_info_request_document,
    b_budget_line, b_budget_link, b_shipment_document, b_audit_result, b_compliance_issue, b_floor_plan,
    b_exhibition_floor_plan, b_placement, b_download_item, b_feedback_request, b_feedback_response,
    b_preservation_action, b_collection_item,
]


@pytest.mark.parametrize("builder", BUILDERS, ids=[b.__name__[2:] for b in BUILDERS])
def test_child_row_add_change_remove(acting_user, db_session, builder):
    org, user = acting_user
    row, parent_type, parent_id, child_type, field, value = builder(db_session, org.organization_id, user)
    db_session.add(row)
    db_session.commit()
    old = getattr(row, field)
    setattr(row, field, value)
    db_session.commit()
    db_session.delete(row)
    db_session.commit()

    events = _child_events(db_session, org.organization_id, parent_type, parent_id, child_type)
    assert [e.change_type for e in events] == ["link_added", "link_updated", "link_removed"], builder.__name__
    assert _diffs(events[1]) == {field: (ea._serialize_value(old), value)}
    assert all(e.changed_by == user.user_id for e in events)
    assert all(e.organization_id == org.organization_id for e in events)


def test_every_new_child_parent_type_is_readable(auth_setup):
    from app.fastapi_app.routers.collections_discover import ENTITY_TYPE_PERMISSIONS

    for b in BUILDERS:
        name = {
            "loan_renewal_in": "loan_in", "loan_renewal_out": "loan_out", "entity_image": "incident_report",
        }.get(b.__name__[2:])
        if name:
            assert name in ENTITY_TYPE_PERMISSIONS


# ---------------------------------------------------------------------------
# Machine churn and secrets
# ---------------------------------------------------------------------------


def test_placement_drag_records_nothing_but_a_wall_move_does(acting_user, db_session):
    org, _ = acting_user
    row, _, exhibition_id, _, _, _ = b_placement(db_session, org.organization_id, None)
    db_session.add(row)
    db_session.commit()
    for x in range(1, 40):  # a drag
        row.position_x = x
        row.position_y = x * 2
        db_session.commit()
    row.wall_id = "east"
    db_session.commit()
    events = _child_events(db_session, org.organization_id, "exhibition", exhibition_id, "placement")
    assert [e.change_type for e in events] == ["link_added", "link_updated"]
    assert _diffs(events[1]) == {"wall_id": ("north", "east")}


def test_detaching_a_floor_plan_records_each_placement_removed(auth_setup, db_session):
    client, org, _ = auth_setup
    row, _, exhibition_id, _, _, _ = b_placement(db_session, org.organization_id, None)
    db_session.add(row)
    db_session.add(ExhibitionFloorPlan(exhibition_id=exhibition_id, floor_plan_id=row.floor_plan_id))
    db_session.commit()
    resp = client.delete(
        f"/api/organizations/{org.organization_id}/exhibit/exhibitions/{exhibition_id}/floor-plans/{row.floor_plan_id}")
    assert resp.status_code == 200, resp.get_json()
    removed = [e for e in _child_events(db_session, org.organization_id, "exhibition", exhibition_id, "placement")
               if e.change_type == "link_removed"]
    assert [e.child_display_key for e in removed] == ["Bronze hand"]


def test_check_list_generation_is_one_change_on_the_campaign(acting_user, db_session):
    from app.models import Location
    from app.services.audit_checklist_service import generate_check_list

    org, user = acting_user
    loc = Location(organization_id=org.organization_id, code="S1", name="Store 1", path="S1", location_type="room")
    db_session.add(loc)
    db_session.flush()
    for i in range(5):
        db_session.add(CollectionObject(organization_id=org.organization_id, object_number=f"GEN.{i}",
                                        current_location_id=loc.location_id))
    c = AuditCampaign(organization_id=org.organization_id, campaign_number="AC-G", title="Full count",
                      audit_type="spot_check")
    db_session.add(c)
    db_session.commit()
    generate_check_list(db_session, c, user_id=user.user_id)
    db_session.commit()
    assert db_session.query(AuditResult).filter(AuditResult.campaign_id == c.campaign_id).count() == 5
    assert _child_events(db_session, org.organization_id, "audit_campaign", c.campaign_id, "audit_result") == []
    db_session.expire_all()
    campaign_updates = db_session.query(EntityAuditEvent).filter(
        EntityAuditEvent.entity_id == c.campaign_id, EntityAuditEvent.change_type == "updated").all()
    assert len(campaign_updates) == 1 and "check_list_seed" in campaign_updates[0].changed_fields

    # A staff edit to one result afterwards is recorded.
    first = db_session.query(AuditResult).filter(AuditResult.campaign_id == c.campaign_id).first()
    first.result_note = "Found on the wrong shelf"
    db_session.commit()
    assert len(_child_events(db_session, org.organization_id, "audit_campaign", c.campaign_id, "audit_result")) == 1


def test_smart_collection_sync_is_left_out_but_manual_adds_are_recorded(auth_setup, db_session):
    client, org, user = auth_setup
    coll = MediaCollection(organization_id=org.organization_id, name="Smart set", collection_type="smart",
                           created_by=user.user_id)
    db_session.add(coll)
    db_session.flush()
    m1, m2 = _media(db_session, org.organization_id, "s1.jpg"), _media(db_session, org.organization_id, "s2.jpg")
    db_session.commit()

    with ea.suppress_link_audit(db_session, "MediaCollectionItem"):
        db_session.add(MediaCollectionItem(collection_id=coll.collection_id, media_id=m1.media_id))
    db_session.commit()
    assert _child_events(db_session, org.organization_id, "media_collection", coll.collection_id,
                         "media_collection_item") == []

    resp = client.post(f"/api/organizations/{org.organization_id}/media-collections/{coll.collection_id}/items",
                       data=json.dumps({"media_id": str(m2.media_id)}), content_type="application/json")
    assert resp.status_code in (200, 201), resp.get_json()
    events = _child_events(db_session, org.organization_id, "media_collection", coll.collection_id, "media_collection_item")
    assert [(e.change_type, e.child_display_key) for e in events] == [("link_added", "s2.jpg")]
    # The item count kept by the system is not a change to the collection.
    db_session.expire_all()
    assert not db_session.query(EntityAuditEvent).filter(
        EntityAuditEvent.entity_id == coll.collection_id, EntityAuditEvent.change_type == "updated").all()


def test_download_and_share_tokens_are_never_recorded(acting_user, db_session):
    org, user = acting_user
    req = MediaDownloadRequest(organization_id=org.organization_id, request_number="DR-9", requester_id=user.user_id,
                               requester_name="Sam", requester_email="sam@example.org", purpose="research",
                               intended_use="Figures")
    db_session.add(req)
    db_session.commit()
    req.status = "approved"
    req.download_token = "dl-secret-token-abc"
    req.download_count = 3
    db_session.commit()
    db_session.expire_all()
    updated = db_session.query(EntityAuditEvent).filter(
        EntityAuditEvent.entity_id == req.request_id, EntityAuditEvent.change_type == "updated").one()
    assert _diffs(updated)["download_token"] == (None, ea.MASKED_VALUE)
    assert "download_count" not in _diffs(updated)

    coll = MediaCollection(organization_id=org.organization_id, name="Shared")
    db_session.add(coll)
    db_session.commit()
    coll.public_share_token = "share-secret-token-def"
    coll.public_share_password_hash = "pbkdf2$hash-value"
    db_session.commit()
    row, *_ = b_feedback_request(db_session, org.organization_id, user)
    db_session.add(row)
    db_session.commit()

    db_session.expire_all()
    dump = json.dumps([[d.old_value, d.new_value] for d in db_session.query(EntityAuditFieldDiff).all()])
    for secret in ("dl-secret-token-abc", "share-secret-token-def", "pbkdf2$hash-value", "fb-secret-token-123"):
        assert secret not in dump, secret


def test_download_request_lifecycle_and_history_api(auth_setup, db_session):
    from app.models import Role
    from tests.conftest import _create_permission, _create_role_permission

    client, org, user = auth_setup
    role = db_session.query(Role).filter(Role.role_key == "admin").first()
    _create_role_permission(db_session, role, _create_permission(db_session, "download_requests.view"))
    token = ctx.request_user_id.set(str(user.user_id))
    try:
        req = MediaDownloadRequest(organization_id=org.organization_id, request_number="DR-2", requester_id=user.user_id,
                                   requester_name="Sam", requester_email="sam@example.org", purpose="research",
                                   intended_use="Figures")
        db_session.add(req)
        db_session.commit()
        req.review_note = "Approved for non-commercial use"
        db_session.commit()
    finally:
        ctx.request_user_id.reset(token)
    resp = client.get(f"/api/organizations/{org.organization_id}/entity-history/media_download_request/{req.request_id}")
    assert resp.status_code == 200, resp.get_json()
    assert [e["change_type"] for e in resp.get_json()["items"]] == ["updated", "created"]
    rid = req.request_id
    db_session.delete(req)
    db_session.commit()
    assert db_session.query(EntityAuditEvent).filter(
        EntityAuditEvent.entity_id == rid, EntityAuditEvent.change_type == "deleted").count() == 1

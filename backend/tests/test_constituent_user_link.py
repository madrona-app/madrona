"""The user↔constituent bridge: find_or_create_staff_constituent."""

from uuid import uuid4

from app.models import Constituent, Organization, User
from app.services.constituent_service import find_or_create_staff_constituent


def _org_user(db_session):
    org = Organization(name="Link Museum", slug=f"link-{uuid4().hex[:8]}")
    db_session.add(org)
    db_session.flush()
    user = User(email=f"staff-{uuid4().hex[:8]}@example.com", display_name="Jane Staff")
    db_session.add(user)
    db_session.flush()
    return org, user


def test_creates_a_staff_constituent_linked_to_the_user(db_session):
    org, user = _org_user(db_session)
    c = find_or_create_staff_constituent(db_session, org.organization_id, user.user_id)
    assert c is not None
    assert c.user_id == user.user_id
    assert c.constituent_type == "person"
    assert c.name == "Jane Staff"
    assert c.email == user.email


def test_is_idempotent(db_session):
    org, user = _org_user(db_session)
    c1 = find_or_create_staff_constituent(db_session, org.organization_id, user.user_id)
    c2 = find_or_create_staff_constituent(db_session, org.organization_id, user.user_id)
    assert c1.constituent_id == c2.constituent_id
    assert (
        db_session.query(Constituent)
        .filter(Constituent.organization_id == org.organization_id,
                Constituent.user_id == user.user_id)
        .count()
    ) == 1


def test_unknown_user_returns_none(db_session):
    org, _ = _org_user(db_session)
    assert find_or_create_staff_constituent(db_session, org.organization_id, uuid4()) is None

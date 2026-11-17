"""Conservation "Materials Used" round trip.

The staff form sends ``materials_used``; it used to be dropped silently
because the treatment has no such column (materials live in
treatment_materials). Writes now create, keep and remove those rows.
"""
from app.models import CollectionObject
from app.models.procedures import TreatmentMaterial


def _url(org, treatment_id=None):
    base = f"/api/organizations/{org.organization_id}/collections/conservation"
    return base if treatment_id is None else f"{base}/{treatment_id}"


def _object(db_session, org):
    obj = CollectionObject(organization_id=org.organization_id, object_number="MAT-1", object_name="Bowl")
    db_session.add(obj)
    db_session.commit()
    return obj


def _names(body):
    return [m["material_name"] for m in body["materials_used"]]


def test_materials_round_trip(auth_setup, db_session):
    client, org, _ = auth_setup
    obj = _object(db_session, org)

    resp = client.post(_url(org), json={
        "treatment_type": "remedial",
        "object_id": str(obj.object_id),
        "materials_used": ["Paraloid B-72", "Deionised water"],
    })
    assert resp.status_code == 201, resp.text
    tid = resp.json["treatment_id"]
    assert _names(resp.json) == ["Paraloid B-72", "Deionised water"]

    got = client.get(_url(org, tid))
    assert _names(got.json) == ["Paraloid B-72", "Deionised water"]

    # Details on a kept material survive a save of the name list.
    row = db_session.query(TreatmentMaterial).filter_by(material_name="Paraloid B-72").one()
    row.manufacturer = "Kremer"
    db_session.commit()

    resp = client.put(_url(org, tid), json={"materials_used": "Klucel G\nparaloid b-72\n\n"})
    assert resp.status_code == 200, resp.text
    assert _names(resp.json) == ["Klucel G", "Paraloid B-72"]
    kept = [m for m in resp.json["materials_used"] if m["material_name"] == "Paraloid B-72"][0]
    assert kept["manufacturer"] == "Kremer"
    assert db_session.query(TreatmentMaterial).filter_by(material_name="Deionised water").count() == 0

    # Leaving materials_used out of a save does not touch them.
    resp = client.put(_url(org, tid), json={"treatment_note": "note"})
    assert _names(resp.json) == ["Klucel G", "Paraloid B-72"]

    # An empty list clears them.
    resp = client.put(_url(org, tid), json={"materials_used": []})
    assert resp.json["materials_used"] == []


def test_materials_bad_shape_is_422(auth_setup, db_session):
    client, org, _ = auth_setup
    obj = _object(db_session, org)
    resp = client.post(_url(org), json={"treatment_type": "remedial", "object_id": str(obj.object_id)})
    tid = resp.json["treatment_id"]
    resp = client.put(_url(org, tid), json={"materials_used": 42})
    assert resp.status_code == 422, resp.text

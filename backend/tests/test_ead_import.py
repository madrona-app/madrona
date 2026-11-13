"""EAD 2002 import into the archival hierarchy, and round trip to EAD3."""
import pathlib

import pytest
from lxml import etree

from app.models import CollectionObject, ObjectSubject, SubjectAuthority

SAMPLE = (pathlib.Path(__file__).parent / "fixtures" / "ead" / "sample_ead2002.xml").read_bytes()
NS = {"e": "http://ead3.archivists.org/schema/"}


def _url(org):
    return f"/api/organizations/{org.organization_id}/collections/ead/import"


def _post(client, org, data, dry_run=True):
    return client.post(_url(org), files={"file": ("guide.xml", data, "application/xml")},
                       data={"dry_run": "true" if dry_run else "false"})


def test_preview_lists_records_without_creating(auth_setup, db_session):
    client, org, _ = auth_setup
    resp = _post(client, org, SAMPLE)
    assert resp.status_code == 200, resp.get_json()
    body = resp.get_json()
    assert body["dry_run"] is True
    assert body["by_level"] == {"collection": 1, "series": 2, "box": 2, "folder": 3, "file": 3}
    nums = [r["number"] for r in body["records"]]
    assert nums[:4] == ["TP", "TP.1", "TP.1.B1", "TP.1.B1.F1"]
    assert "TP.2" in nums
    assert db_session.query(CollectionObject).filter(CollectionObject.organization_id == org.organization_id).count() == 0


def test_import_builds_hierarchy_and_round_trips_to_ead3(auth_setup, db_session):
    client, org, _ = auth_setup
    resp = _post(client, org, SAMPLE, dry_run=False)
    assert resp.status_code == 200, resp.get_json()
    root_id = resp.get_json()["root_object_id"]
    assert resp.get_json()["created"] == 11

    objs = {o.object_number: o for o in db_session.query(CollectionObject).filter(
        CollectionObject.organization_id == org.organization_id)}
    root = objs["TP"]
    assert root.catalog_level == "collection" and root.parent_object_id is None
    assert root.full_description == "First paragraph.\n\nSecond paragraph."
    assert root.object_history_note == "A short biography."
    assert root.creation_date_display == "1940-1968"
    assert "otherfindaid" in root.extra_metadata["ead"]["unmapped"][-1]
    box1, folder2 = objs["TP.1.B1"], objs["TP.1.B1.F2"]
    assert box1.catalog_level == "box" and box1.parent_object_id == objs["TP.1"].object_id
    assert folder2.parent_object_id == box1.object_id
    letters = [o for o in objs.values() if o.object_name == "Letters, 1950"][0]
    assert letters.parent_object_id == objs["TP.1.B1.F1"].object_id and letters.catalog_level == "file"

    # Subjects: LCSH id kept; a component's subject is on the component, not the collection.
    sa = db_session.query(SubjectAuthority).filter(SubjectAuthority.organization_id == org.organization_id,
                                                   SubjectAuthority.lcsh_id == "sh85014896").one()
    linked = {l.object_id for l in db_session.query(ObjectSubject).filter(ObjectSubject.subject_authority_id == sa.authority_id)}
    assert linked == {root.object_id}
    braille = db_session.query(SubjectAuthority).filter(SubjectAuthority.preferred_term == "Braille").one()
    assert {l.object_id for l in db_session.query(ObjectSubject).filter(
        ObjectSubject.subject_authority_id == braille.authority_id)} == {letters.object_id}

    xml = client.get(f"/api/organizations/{org.organization_id}/collections/objects/{root_id}/ead").content
    doc = etree.fromstring(xml)
    arch = doc.find("e:archdesc", NS)
    assert arch.find("e:did/e:unittitle", NS).text == "Test Papers"
    assert arch.find("e:origination/e:persname/e:part", NS).text == "Example, Person"
    subj = arch.find("e:controlaccess/e:subject", NS)
    assert subj.get("identifier").endswith("sh85014896")
    files = [c for c in doc.iter("{http://ead3.archivists.org/schema/}c") if c.get("level") == "file"]
    assert len(files) == 3
    assert [(x.get("localtype"), x.text) for x in files[0].findall("e:did/e:container", NS)] == [
        ("box", "TP.1.B1"), ("folder", "TP.1.B1.F1")]


def test_existing_numbers_block_import(auth_setup):
    client, org, _ = auth_setup
    assert _post(client, org, SAMPLE, dry_run=False).status_code == 200
    preview = _post(client, org, SAMPLE).get_json()
    assert "TP" in preview["conflicts"]
    resp = _post(client, org, SAMPLE, dry_run=False)
    assert resp.status_code == 422
    assert "already exist" in str(resp.get_json())


@pytest.mark.parametrize("bad, msg", [
    (b"not xml", "readable XML"),
    (b"<root/>", "not an EAD"),
    (b'<?xml version="1.0"?><!DOCTYPE ead [<!ENTITY x SYSTEM "file:///etc/passwd">]><ead><archdesc>&x;</archdesc></ead>',
     "readable XML"),
])
def test_rejects_bad_and_hostile_files(auth_setup, bad, msg):
    client, org, _ = auth_setup
    resp = _post(client, org, bad)
    assert resp.status_code == 422
    assert msg in str(resp.get_json())

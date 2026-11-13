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
    assert root.extra_metadata["ead"]["notes"]["otherfindaid"] == "A card index exists."
    assert any("langmaterial" in x for x in root.extra_metadata["ead"]["unmapped"])
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
     "declares its own XML entities"),
])
def test_rejects_bad_and_hostile_files(auth_setup, bad, msg):
    client, org, _ = auth_setup
    resp = _post(client, org, bad)
    assert resp.status_code == 422
    assert msg in str(resp.get_json())


LEGACY = (pathlib.Path(__file__).parent / "fixtures" / "ead" / "legacy_ead2002_dtd.xml").read_bytes()


def test_legacy_dtd_based_finding_aid(auth_setup, db_session):
    """A realistic legacy EAD 2002 file: DOCTYPE, no namespace, named entities,
    unnumbered <c>, bulk dates, lists, chronlist, dao, physloc, MARC punctuation."""
    client, org, _ = auth_setup
    preview = _post(client, org, LEGACY).get_json()
    assert preview["by_level"] == {"collection": 1, "series": 2, "box": 2, "folder": 2, "file": 3, "item": 1}, preview
    resp = _post(client, org, LEGACY, dry_run=False)
    assert resp.status_code == 200, resp.get_json()
    root_id = resp.get_json()["root_object_id"]
    objs = {o.object_number: o for o in db_session.query(CollectionObject).filter(
        CollectionObject.organization_id == org.organization_id)}
    root = objs["MS 0042"]
    assert root.object_name == "Records of a State Affiliate"          # trailing comma removed
    assert root.creation_date_display == "1940–1975, bulk 1950–1960"    # &ndash; resolved, bulk kept
    assert root.full_description == "The records include:\n\n- Minutes\n- Correspondence"
    assert root.extra_metadata["ead"]["notes"]["prefercite"].startswith("[Item], Records")
    folder = [o for o in objs.values() if o.catalog_level == "folder" and o.object_name == "Folder 1–3"][0]
    minutes = [o for o in objs.values() if o.object_name == "Minutes, 1940–1945"][0]
    assert minutes.parent_object_id == folder.object_id
    assert minutes.creation_date_display == "1940–1945"                 # date nested in the title
    digitized = [o for o in objs.values() if o.object_name == "Minutes, 1946–1950"][0]
    assert digitized.external_links == [{"url": "https://example.org/digital/1", "label": "Digitized minutes",
                                         "link_type": "website"}]
    subjects = {s.preferred_term for s in db_session.query(SubjectAuthority).filter(
        SubjectAuthority.organization_id == org.organization_id)}
    assert "Blind—United States—Societies, etc." in subjects

    xml = client.get(f"/api/organizations/{org.organization_id}/collections/objects/{root_id}/ead").content
    doc = etree.fromstring(xml)
    arch = doc.find("e:archdesc", NS)
    assert arch.find("e:prefercite/e:p", NS).text.startswith("[Item]")
    assert arch.find("e:accessrestrict/e:p", NS).text == "Open for research."
    assert [i.text for i in arch.findall("e:scopecontent/e:list/e:item", NS)] == ["Minutes", "Correspondence"]


def test_declared_entities_refused(auth_setup):
    client, org, _ = auth_setup
    bomb = (b'<?xml version="1.0"?><!DOCTYPE ead [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;">]>'
            b"<ead><archdesc><did><unittitle>&b;</unittitle></did></archdesc></ead>")
    resp = _post(client, org, bomb)
    assert resp.status_code == 422 and "declares its own XML entities" in str(resp.get_json())


def test_utf16_file(auth_setup):
    client, org, _ = auth_setup
    data = SAMPLE.decode("utf-8").replace('encoding="UTF-8"', 'encoding="UTF-16"').encode("utf-16")
    resp = _post(client, org, data)
    assert resp.status_code == 200, resp.get_json()
    assert resp.get_json()["by_level"]["collection"] == 1

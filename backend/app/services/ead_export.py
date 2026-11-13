"""EAD3 export of an archival hierarchy (collection > series > ... > item).

Builds an EAD3 finding aid from a top record and its descendants:
- <control>: recordid, filedesc/titlestmt/titleproper, maintenance status,
  agency and history (as EAD3 requires);
- <archdesc level="collection"> with <did> (unitid, unittitle, unitdate,
  physdesc, repository) and the descriptive elements we hold;
- <controlaccess>: subjects and names with their authority identifiers;
- <dsc> of nested <c> elements in sibling order. Box and folder levels are
  exported as level="otherlevel" otherlevel="box|folder", and each
  descendant also carries <container localtype="box|folder"> for the boxes
  and folders above it, so tools that read either convention find them.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from lxml import etree
from sqlalchemy.orm import Session

from app.models import CollectionObject, Constituent, ConstituentXref, ObjectSubject, Organization, SubjectAuthority
from app.services import archival_hierarchy as ah

EAD3_NS = "http://ead3.archivists.org/schema/"
XLINK_NS = "http://www.w3.org/1999/xlink"
_EAD_LEVELS = {"collection", "subcollection", "series", "subseries", "file", "item", "fonds", "recordgrp", "subgrp"}
_CONTAINER_LEVELS = {"box", "folder"}
MAX_NODES = 20_000


def _el(parent, tag, text=None, **attrs):
    e = etree.SubElement(parent, f"{{{EAD3_NS}}}{tag}", {k: v for k, v in attrs.items() if v is not None})
    if text is not None:
        e.text = str(text)
    return e


def _paragraphs(parent, tag, text: str | None, head: str | None = None):
    if not text or not text.strip():
        return None
    block = _el(parent, tag)
    if head:
        _el(block, "head", head)
    for para in [p.strip() for p in text.split("\n\n") if p.strip()]:
        _el(block, "p", para)
    return block


def _level_attrs(level: str | None) -> dict:
    level = level or "item"
    if level in _EAD_LEVELS:
        return {"level": level}
    return {"level": "otherlevel", "otherlevel": level}


def _subjects(db: Session, obj: CollectionObject):
    return (
        db.query(SubjectAuthority)
        .join(ObjectSubject, ObjectSubject.subject_authority_id == SubjectAuthority.authority_id)
        .filter(ObjectSubject.object_id == obj.object_id)
        .all()
    )


def _names(db: Session, obj: CollectionObject):
    return (
        db.query(ConstituentXref, Constituent)
        .join(Constituent, Constituent.constituent_id == ConstituentXref.constituent_id)
        .filter(ConstituentXref.entity_type.in_(("collection_object", "object")),
                ConstituentXref.entity_id == obj.object_id)
        .order_by(ConstituentXref.display_order)
        .all()
    )


def _subject_identifier(sa: SubjectAuthority) -> tuple[str | None, str | None]:
    if getattr(sa, "lcsh_id", None):
        return "lcsh", f"http://id.loc.gov/authorities/subjects/{sa.lcsh_id}"
    if sa.aat_id:
        return "aat", f"http://vocab.getty.edu/aat/{sa.aat_id}"
    if sa.iconclass_id:
        return "iconclass", f"https://iconclass.org/{sa.iconclass_id}"
    if sa.wikidata_id:
        return "wikidata", f"http://www.wikidata.org/entity/{sa.wikidata_id}"
    return "local", None


def _name_identifier(c: Constituent) -> tuple[str | None, str | None]:
    if c.loc_id:
        return "lcnaf", c.loc_id if c.loc_id.startswith("http") else f"http://id.loc.gov/authorities/names/{c.loc_id}"
    if c.ulan_id:
        return "ulan", f"http://vocab.getty.edu/ulan/{c.ulan_id}"
    if c.viaf_id:
        return "viaf", f"http://viaf.org/viaf/{c.viaf_id}"
    if c.wikidata_id:
        return "wikidata", f"http://www.wikidata.org/entity/{c.wikidata_id}"
    return "local", None


def _name_tag(c: Constituent) -> str:
    t = (c.constituent_type or "").lower()
    if t == "person":
        return "persname"
    if t == "family":
        return "famname"
    return "corpname"


def _did(db: Session, parent, obj: CollectionObject, containers: list[tuple[str, str]], repository: str | None):
    did = _el(parent, "did")
    for localtype, value in containers:
        _el(did, "container", value, localtype=localtype)
    if obj.object_number:
        _el(did, "unitid", obj.object_number)
    _el(did, "unittitle", ah.display_title(obj))
    if obj.creation_date_display or obj.creation_date_earliest:
        normal = None
        if obj.creation_date_earliest and obj.creation_date_latest and obj.creation_date_earliest != obj.creation_date_latest:
            normal = f"{obj.creation_date_earliest}/{obj.creation_date_latest}"
        elif obj.creation_date_earliest:
            normal = str(obj.creation_date_earliest)
        _el(did, "unitdate", obj.creation_date_display or normal, normal=normal)
    if obj.physical_description:
        _el(did, "physdesc", obj.physical_description)
    if obj.brief_description and not obj.full_description:
        _el(did, "abstract", obj.brief_description)
    if repository:
        repo = _el(did, "repository")
        _el(_el(repo, "corpname"), "part", repository)
    return did


def _description(db: Session, parent, obj: CollectionObject):
    names = _names(db, obj)
    creators = [(x, c) for x, c in names if (x.role or "").lower() in ("creator", "maker", "author", "artist")]
    if creators:
        orig = _el(parent, "origination", label="Creator")
        for x, c in creators:
            source, ident = _name_identifier(c)
            n = _el(orig, _name_tag(c), source=source, identifier=ident)
            _el(n, "part", x.display_name_override or c.display_name)
    _paragraphs(parent, "scopecontent", obj.full_description or obj.content_description or
                (obj.brief_description if obj.full_description else None))
    _paragraphs(parent, "arrangement", obj.arrangement)
    _paragraphs(parent, "custodhist", obj.provenance or obj.object_history_note)
    _paragraphs(parent, "acqinfo", obj.credit_line or obj.acquisition_note)
    if getattr(obj, "external_links", None):
        rel = _el(parent, "relatedmaterial")
        for link in obj.external_links:
            p = _el(rel, "p")
            ref = _el(p, "ref", link.get("label") or link.get("url"))
            ref.set("href", link.get("url"))
    subjects = _subjects(db, obj)
    others = [(x, c) for x, c in names if (x, c) not in creators]
    if subjects or others:
        ca = _el(parent, "controlaccess")
        for sa in subjects:
            source, ident = _subject_identifier(sa)
            s = _el(ca, "subject", source=source, identifier=ident)
            _el(s, "part", sa.preferred_term)
        for x, c in others:
            source, ident = _name_identifier(c)
            n = _el(ca, _name_tag(c), source=source, identifier=ident, relator=x.role)
            _el(n, "part", x.display_name_override or c.display_name)


def build_ead3(db: Session, org_id: UUID, root: CollectionObject) -> bytes:
    org = db.get(Organization, org_id)
    repository = org.name if org else None
    now = datetime.now(timezone.utc)

    ead = etree.Element(f"{{{EAD3_NS}}}ead", nsmap={None: EAD3_NS, "xlink": XLINK_NS})
    control = _el(ead, "control")
    _el(control, "recordid", f"{(org.slug if org else 'org')}-{root.object_number or root.object_id}")
    filedesc = _el(control, "filedesc")
    _el(_el(filedesc, "titlestmt"), "titleproper", f"Guide to the {ah.display_title(root)}")
    if repository:
        _el(_el(filedesc, "publicationstmt"), "publisher", repository)
    _el(control, "maintenancestatus", value="derived")
    _el(_el(control, "maintenanceagency"), "agencyname", repository or "Madrona")
    langdecl = _el(control, "languagedeclaration")
    _el(langdecl, "language", "English", langcode="eng")
    _el(langdecl, "script", "Latin", scriptcode="Latn")
    history = _el(control, "maintenancehistory")
    event = _el(history, "maintenanceevent")
    _el(event, "eventtype", value="derived")
    _el(event, "eventdatetime", now.strftime("%Y-%m-%dT%H:%M:%SZ"), standarddatetime=now.strftime("%Y-%m-%dT%H:%M:%SZ"))
    _el(event, "agenttype", value="machine")
    _el(event, "agent", "Madrona EAD3 export")

    archdesc = _el(ead, "archdesc", **_level_attrs(root.catalog_level or "collection"))
    _did(db, archdesc, root, [], repository)
    _description(db, archdesc, root)

    count = [0]

    def add_children(parent_el, parent_obj, containers):
        kids, _ = ah.children(db, org_id, parent_obj.object_id, limit=MAX_NODES)
        if not kids:
            return
        for kid in kids:
            count[0] += 1
            if count[0] > MAX_NODES:
                raise ValueError(f"The finding aid has more than {MAX_NODES} components")
            c = _el(parent_el, "c", **_level_attrs(kid.catalog_level), id=f"c-{kid.object_id}")
            kid_containers = list(containers)
            if kid.catalog_level in _CONTAINER_LEVELS:
                kid_containers = containers + [(kid.catalog_level, kid.object_number or ah.display_title(kid))]
            _did(db, c, kid, containers, None)
            _description(db, c, kid)
            add_children(c, kid, kid_containers)

    dsc = etree.SubElement(archdesc, f"{{{EAD3_NS}}}dsc")
    add_children(dsc, root, [])
    if len(dsc) == 0:
        archdesc.remove(dsc)

    return etree.tostring(ead, xml_declaration=True, encoding="UTF-8", pretty_print=True)

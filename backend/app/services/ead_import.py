"""Import EAD 2002 finding aids into the archival hierarchy.

- <archdesc> becomes the top record (its @level, usually collection);
  each <c> / <c01>..<c12> becomes a child record, in document order.
- <did><container type="box|folder"> on a component creates (once per
  parent) Box and Folder records between the parent and the component, so
  NFB's collection > series > box > folder > item structure is rebuilt.
- Text elements map to object fields (scopecontent -> full description,
  bioghist/custodhist -> history and provenance, arrangement, acqinfo ->
  credit line, physdesc -> physical description).
- <controlaccess> subjects link to subject authorities (LCSH id kept from
  @authfilenumber/@source); names link to constituents; <origination>
  names are linked as creators.
- Every element we do not map is kept as XML in extra_metadata["ead"]
  so nothing in the finding aid is lost.

Parsing uses defusedxml (no external entities, no entity expansion bombs).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from uuid import UUID, uuid4

from defusedxml import ElementTree as SafeET
from sqlalchemy.orm import Session

from app.models import (
    CollectionObject, Constituent, ConstituentXref, ObjectPart, ObjectSubject, ObjectTitle, SubjectAuthority,
)
from app.services.archival_hierarchy import ARCHIVAL_LEVELS, CATALOG_LEVELS

MAX_BYTES = 30 * 1024 * 1024
MAX_COMPONENTS = 50_000
_COMPONENT = re.compile(r"^c(0[1-9]|1[0-2])?$")
_MAPPED = {"did", "scopecontent", "bioghist", "custodhist", "arrangement", "acqinfo", "controlaccess", "dsc",
           "c", "head"} | {f"c{i:02d}" for i in range(1, 13)}


class EADImportError(ValueError):
    pass


def _local(tag) -> str:
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def _children(el, name=None):
    return [c for c in el if isinstance(c.tag, str) and (name is None or _local(c.tag) == name)]


def _first(el, name):
    for c in _children(el, name):
        return c
    return None


def _text(el) -> str:
    if el is None:
        return ""
    return re.sub(r"\s+", " ", "".join(el.itertext())).strip()


def _paragraphs(el) -> str | None:
    """Text of a note: paragraphs, list items and chronology entries, in order."""
    if el is None:
        return None
    blocks: list[str] = []
    for node in el.iter():
        tag = _local(node.tag)
        if tag == "p":
            t = _text(node)
            if t:
                blocks.append(t)
        elif tag == "item":
            t = _text(node)
            if t:
                blocks.append(f"- {t}")
        elif tag == "chronitem":
            t = " — ".join(x for x in (_text(_first(node, "date")), _text(_first(node, "event")) or
                                        _text(_first(node, "eventgrp"))) if x)
            if t:
                blocks.append(t)
    if not blocks:
        return _text(el) or None
    out, prev_item = "", False
    for b in blocks:
        is_item = b.startswith("- ")
        sep = "\n" if (is_item and prev_item) else "\n\n"
        out = b if not out else out + sep + b
        prev_item = is_item
    return out


# EAD notes we keep by name and write back out on EAD3 export.
NOTE_ELEMENTS = ("accessrestrict", "userestrict", "prefercite", "otherfindaid", "relatedmaterial",
                 "separatedmaterial", "processinfo", "appraisal", "accruals", "altformavail",
                 "originalsloc", "phystech", "odd", "fileplan", "bibliography")


def _clean_title(t: str) -> str:
    # Legacy (MARC-derived) titles often end in ISBD punctuation: "Papers,".
    return re.sub(r"[\s,;:/]+$", "", t).strip()


def _level(el, default="item") -> str:
    level = (el.get("level") or "").lower()
    if level == "otherlevel":
        level = (el.get("otherlevel") or "").lower()
    mapping = {"fonds": "collection", "recordgrp": "collection", "subgrp": "subcollection", "class": "series"}
    level = mapping.get(level, level)
    return level if level in CATALOG_LEVELS else default


@dataclass
class Node:
    level: str
    number: str | None
    title: str
    date_display: str | None = None
    date_normal: str | None = None
    physdesc: str | None = None
    fields: dict = field(default_factory=dict)
    containers: list[tuple[str, str]] = field(default_factory=list)
    subjects: list[tuple[str, str | None]] = field(default_factory=list)   # (term, lcsh id)
    names: list[tuple[str, str, str]] = field(default_factory=list)        # (name, type, role)
    extra: list[str] = field(default_factory=list)
    notes: dict = field(default_factory=dict)
    links: list[dict] = field(default_factory=list)
    children: list["Node"] = field(default_factory=list)


def _lcsh_id(el) -> str | None:
    for attr in ("authfilenumber", "identifier"):
        v = (el.get(attr) or "").strip()
        m = re.search(r"(sh\d{5,})", v)
        if m:
            return m.group(1)
    return None


def _parse_unit(el, default_level: str) -> Node:
    did = _first(el, "did")
    unittitle = _first(did, "unittitle") if did is not None else None
    title = _clean_title(_text(unittitle))
    unitid = _text(_first(did, "unitid")) if did is not None else ""
    dates = _children(did, "unitdate") if did is not None else []
    if not dates and unittitle is not None:
        dates = _children(unittitle, "unitdate")
    main = next((d for d in dates if (d.get("type") or "").lower() != "bulk"), dates[0] if dates else None)
    bulk = next((d for d in dates if (d.get("type") or "").lower() == "bulk" and d is not main), None)
    display = _text(main) or None
    if display and bulk is not None and _text(bulk):
        b = _text(bulk)
        display = f"{display}, {b if b.lower().startswith('bulk') else 'bulk ' + b}"
    node = Node(level=_level(el, default_level), number=unitid or None, title=title or "Untitled",
                date_display=display, date_normal=(main.get("normal") if main is not None else None))
    if did is not None:
        node.physdesc = _text(_first(did, "physdesc")) or None
        for cont in _children(did, "container"):
            ctype = (cont.get("type") or cont.get("localtype") or "").lower()
            if ctype in ("box", "folder") and _text(cont):
                node.containers.append((ctype, _text(cont)))
        origination = _first(did, "origination")
        if origination is not None:
            for name in _children(origination):
                kind = _local(name.tag)
                if kind in ("persname", "corpname", "famname") and _text(name):
                    node.names.append((_text(name), kind, "creator"))
        for extra in _children(did):
            if _local(extra.tag) not in ("unittitle", "unitid", "unitdate", "physdesc", "container", "origination", "head"):
                node.extra.append(SafeET.tostring(extra, encoding="unicode"))
    node.fields = {
        "full_description": _paragraphs(_first(el, "scopecontent")),
        "object_history_note": _paragraphs(_first(el, "bioghist")),
        "provenance": _paragraphs(_first(el, "custodhist")),
        "arrangement": _paragraphs(_first(el, "arrangement")),
        "credit_line": _paragraphs(_first(el, "acqinfo")),
    }
    node.notes = {tag: _paragraphs(_first(el, tag)) for tag in NOTE_ELEMENTS if _first(el, tag) is not None}
    # Digital objects become the record's external links: this unit's own
    # <dao>/<daogrp><daoloc> (in the component or its <did>), not its children's.
    own = list(_children(el)) + (list(_children(did)) if did is not None else [])
    daos = []
    for x in own:
        if _local(x.tag) == "dao":
            daos.append(x)
        elif _local(x.tag) == "daogrp":
            daos += [d for d in x.iter() if _local(d.tag) == "daoloc"]
    for dao in daos:
        href = dao.get("href") or dao.get("{http://www.w3.org/1999/xlink}href") or ""
        if href.startswith(("http://", "https://")):
            label = dao.get("title") or dao.get("{http://www.w3.org/1999/xlink}title") or _text(dao) or "Digital object"
            node.links.append({"url": href, "label": label[:300], "link_type": "website"})
    # This unit's own <controlaccess> (and ones nested inside it), never its
    # components': those belong to the child records.
    pending = list(_children(el, "controlaccess"))
    while pending:
        ca = pending.pop(0)
        for term in _children(ca):
            kind = _local(term.tag)
            if kind == "controlaccess":
                pending.append(term)
            elif kind in ("subject", "genreform", "geogname", "occupation", "function") and _text(term):
                node.subjects.append((_text(term), _lcsh_id(term)))
            elif kind in ("persname", "corpname", "famname") and _text(term):
                node.names.append((_text(term), kind, (term.get("role") or "subject").lower()[:50]))
    for child in _children(el):
        name = _local(child.tag)
        if name in _MAPPED or name in ("controlaccess", "dao", "daogrp") or name in NOTE_ELEMENTS:
            continue
        node.extra.append(SafeET.tostring(child, encoding="unicode"))
    containers = _first(el, "dsc") if _local(el.tag) == "archdesc" else el
    if containers is not None:
        for c in _children(containers):
            if _COMPONENT.match(_local(c.tag)):
                node.children.append(_parse_unit(c, "item"))
    return node


_XML_PREDEFINED = {b"amp", b"lt", b"gt", b"quot", b"apos"}
_NAMED_ENTITY = re.compile(rb"&([A-Za-z][A-Za-z0-9]{1,31});")


def _numeric_entities(data: bytes) -> bytes:
    """Replace HTML named entities (&mdash; &eacute; ...) with numeric references.

    Legacy EAD 2002 files are DTD-based and use entities the EAD DTD defines.
    We never load DTDs (that is how XML external-entity attacks work), so
    these would be undefined. Numeric references mean the same characters
    and need no DTD. Unknown names are left for the parser to report.
    """
    import html.entities as he

    def sub(m: re.Match) -> bytes:
        name = m.group(1)
        if name in _XML_PREDEFINED:
            return m.group(0)
        cp = he.name2codepoint.get(name.decode("ascii"))
        return f"&#{cp};".encode("ascii") if cp else m.group(0)

    return _NAMED_ENTITY.sub(sub, data)


def parse(data: bytes) -> Node:
    if len(data) > MAX_BYTES:
        raise EADImportError(f"The file is larger than {MAX_BYTES // 1_048_576} MB")
    head = data[:4096]
    if b"<!ENTITY" in data[: data.find(b"<ead") if b"<ead" in data else 4096]:
        raise EADImportError("This file declares its own XML entities, which are not accepted for security reasons")
    if head.startswith((b"\xff\xfe", b"\xfe\xff")):
        try:
            data = data.decode("utf-16").encode("utf-8").replace(b'encoding="UTF-16"', b'encoding="UTF-8"', 1)
        except UnicodeDecodeError:
            raise EADImportError("This is not a readable XML file: bad UTF-16")
    data = _numeric_entities(data)
    try:
        root = SafeET.fromstring(data)
    except Exception as e:  # defusedxml raises its own errors for entities/DTD tricks
        raise EADImportError(f"This is not a readable XML file: {e}")
    if _local(root.tag) != "ead":
        raise EADImportError("This is not an EAD file (the root element is not <ead>)")
    archdesc = _first(root, "archdesc")
    if archdesc is None:
        raise EADImportError("The finding aid has no <archdesc>")
    node = _parse_unit(archdesc, "collection")
    if node.level not in ARCHIVAL_LEVELS:
        node.level = "collection"
    if node.title == "Untitled":
        titleproper = next((t for t in root.iter() if _local(t.tag) == "titleproper"), None)
        if titleproper is not None and _text(titleproper):
            node.title = _text(titleproper)
    return node


def _count(node: Node) -> int:
    return 1 + sum(_count(c) for c in node.children)


@dataclass
class Plan:
    records: list[dict]
    by_level: dict[str, int]
    warnings: list[str]
    conflicts: list[str]


def _plan(db: Session, org_id: UUID, root: Node, number_prefix: str | None) -> tuple[Plan, list]:
    """Flatten into create operations, inventing numbers and container records."""
    ops: list[dict] = []
    warnings: list[str] = []
    used: set[str] = set()

    def number_for(node: Node, parent_number: str | None, index: int) -> str:
        base = node.number or (f"{parent_number}.{index}" if parent_number else (number_prefix or "EAD"))
        num, k = base, 2
        while num in used:
            num, k = f"{base}-{k}", k + 1
        if node.number and num != node.number:
            warnings.append(f"Duplicate identifier {node.number} in the finding aid; used {num}")
        used.add(num)
        return num

    def walk(node: Node, parent_key: str | None, parent_number: str | None, index: int, container_cache: dict):
        attach_to, attach_number = parent_key, parent_number
        for ctype, value in node.containers:
            cache_key = (attach_to, ctype, value)
            if cache_key not in container_cache:
                base = f"{attach_number or number_prefix or 'EAD'}.{ctype[0].upper()}{value}"
                number, k = base, 2
                while number in used:
                    number, k = f"{base}-{k}", k + 1
                used.add(number)
                key = f"k{len(ops)}"
                ops.append({"key": key, "parent": attach_to, "level": ctype, "number": number,
                            "title": f"{ctype.title()} {value}", "node": None})
                container_cache[cache_key] = (key, number)
            attach_to, attach_number = container_cache[cache_key]
        number = number_for(node, attach_number, index)
        key = f"k{len(ops)}"
        ops.append({"key": key, "parent": attach_to, "level": node.level, "number": number, "title": node.title, "node": node})
        cache: dict = {}
        for i, child in enumerate(node.children, start=1):
            walk(child, key, number, i, cache)

    walk(root, None, None, 1, {})
    if len(ops) > MAX_COMPONENTS:
        raise EADImportError(f"The finding aid has more than {MAX_COMPONENTS} components")
    existing = {
        n for (n,) in db.query(CollectionObject.object_number).filter(
            CollectionObject.organization_id == org_id,
            CollectionObject.object_number.in_([o["number"] for o in ops]),
        )
    }
    conflicts = sorted(existing)
    by_level: dict[str, int] = {}
    for o in ops:
        by_level[o["level"]] = by_level.get(o["level"], 0) + 1
    records = [{"number": o["number"], "level": o["level"], "title": o["title"],
                "parent_number": next((p["number"] for p in ops if p["key"] == o["parent"]), None)} for o in ops]
    return Plan(records=records, by_level=by_level, warnings=warnings, conflicts=conflicts), ops


def preview(db: Session, org_id: UUID, data: bytes, number_prefix: str | None = None) -> Plan:
    plan, _ = _plan(db, org_id, parse(data), number_prefix)
    return plan


def _subject(db: Session, org_id: UUID, term: str, lcsh_id: str | None, actor) -> SubjectAuthority:
    q = db.query(SubjectAuthority).filter(SubjectAuthority.organization_id == org_id)
    sa = q.filter(SubjectAuthority.lcsh_id == lcsh_id).first() if lcsh_id else None
    sa = sa or q.filter(SubjectAuthority.preferred_term == term[:500]).first()
    if sa is None:
        sa = SubjectAuthority(authority_id=uuid4(), organization_id=org_id, preferred_term=term[:500], lcsh_id=lcsh_id)
        db.add(sa)
    elif lcsh_id and not sa.lcsh_id:
        sa.lcsh_id = lcsh_id
    return sa


def _constituent(db: Session, org_id: UUID, name: str, kind: str) -> Constituent:
    c = db.query(Constituent).filter(Constituent.organization_id == org_id, Constituent.display_name == name[:500]).first()
    if c is None:
        ctype = {"persname": "person", "famname": "family"}.get(kind, "organization")
        c = Constituent(constituent_id=uuid4(), organization_id=org_id, constituent_type=ctype,
                        name=name[:500], display_name=name[:500])
        db.add(c)
    return c


def import_ead(db: Session, org_id: UUID, data: bytes, actor: UUID, number_prefix: str | None = None) -> dict:
    """Create the records. Does not commit; refuses if any object number already exists."""
    plan, ops = _plan(db, org_id, parse(data), number_prefix)
    if plan.conflicts:
        shown = ", ".join(plan.conflicts[:10]) + ("…" if len(plan.conflicts) > 10 else "")
        raise EADImportError(f"{len(plan.conflicts)} object numbers already exist in this organization: {shown}")
    ids: dict[str, UUID] = {}
    order: dict[str | None, int] = {}
    for op in ops:
        node: Node | None = op["node"]
        oid = uuid4()
        ids[op["key"]] = oid
        parent_id = ids.get(op["parent"]) if op["parent"] else None
        order[op["parent"]] = order.get(op["parent"], 0) + 1
        obj = CollectionObject(
            object_id=oid, organization_id=org_id, object_number=op["number"], object_name=op["title"][:255],
            catalog_level=op["level"], parent_object_id=parent_id,
            sibling_order=order[op["parent"]] if parent_id else None,
            created_by=actor, updated_by=actor,
        )
        if node is not None:
            obj.creation_date_display = (node.date_display or "")[:100] or None
            for k, v in node.fields.items():
                if v:
                    setattr(obj, k, v if k != "credit_line" else v[:2000])
            if node.physdesc:
                obj.physical_description = node.physdesc
            ead_meta = {}
            if node.notes:
                ead_meta["notes"] = {k: v for k, v in node.notes.items() if v}
            if node.extra:
                ead_meta["unmapped"] = node.extra
            if ead_meta:
                obj.extra_metadata = {"ead": ead_meta}
            if node.links:
                obj.external_links = node.links[:50]
        db.add(obj)
        if len(ids) % 500 == 0:
            db.flush()
        db.add(ObjectTitle(organization_id=org_id, object_id=oid, title=op["title"], is_preferred=True,
                           display_order=0, created_by=actor))
        db.add(ObjectPart(organization_id=org_id, object_id=oid, display_order=0, created_by=actor, updated_by=actor,
                          barcode=oid.hex.upper()))
        if node is not None:
            seen_subjects = set()
            for term, lcsh in node.subjects:
                sa = _subject(db, org_id, term, lcsh, actor)
                if sa.authority_id in seen_subjects:
                    continue
                seen_subjects.add(sa.authority_id)
                db.add(ObjectSubject(organization_id=org_id, object_id=oid, subject_authority_id=sa.authority_id))
            for i, (name, kind, role) in enumerate(node.names):
                c = _constituent(db, org_id, name, kind)
                db.add(ConstituentXref(organization_id=org_id, constituent_id=c.constituent_id,
                                       entity_type="collection_object", entity_id=oid, role=role or "associated",
                                       display_order=i, is_primary=(i == 0)))
    db.flush()
    root_key = ops[0]["key"]
    return {"root_object_id": str(ids[root_key]), "created": len(ops), "by_level": plan.by_level,
            "warnings": plan.warnings}

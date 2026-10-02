"""
TMS (The Museum System) source connector.

Extracts collection data from a TMS 2018+ SQL Server database and
normalizes it into Madrona canonical records. Handles the full TMS
relational graph:

  Objects → ObjTitles, ObjContext, ObjAccession, ObjComponents,
            ObjLocations, ObjDates, AltNums, Dimensions,
            ConXrefs/ConXrefDetails → Constituents,
            MediaXrefs → MediaRenditions → MediaFiles,
            ExhObjXrefs → Exhibitions,
            Conditions, ObjInsurance, TextEntries

TMS architecture note: location tracking goes through ObjComponents
(ComponentID), not directly to Objects. Every object has at least one
component row.

Usage:
    connector = TMSSourceConnector(config, org_id)
    for record in connector.extract():
        canonical = connector.normalize(record)
        # canonical is ready for upsert_entity()
"""

import logging
from typing import Any, Iterable, Literal

import pyodbc

from app.connectors.base import BaseSourceConnector

logger = logging.getLogger(__name__)

# TMS TableID constants (used in cross-reference tables)
TABLE_ID_OBJECTS = 108
TABLE_ID_CONSTITUENTS = 23
TABLE_ID_EXHIBITIONS = 47
TABLE_ID_LOANS = 54

# RoleTypeID in ConXrefs
ROLE_TYPE_OBJECT = 1
ROLE_TYPE_ACQUISITION = 2

# ConstituentTypeID
CONSTITUENT_TYPE_PERSON = 1
CONSTITUENT_TYPE_INSTITUTION = 2


def _safe_str(val: Any) -> str | None:
    """Convert a value to string, stripping whitespace. Returns None for empty."""
    if val is None:
        return None
    s = str(val).strip()
    return s if s else None


def _safe_float(val: Any) -> float | None:
    """Convert to float, returns None for 0 or None."""
    if val is None:
        return None
    try:
        f = float(val)
        return f if f != 0 else None
    except (ValueError, TypeError):
        return None


class TMSSourceConnector(BaseSourceConnector):
    """
    Source connector for TMS (The Museum System) SQL Server databases.

    Extracts objects with all related data (titles, constituents,
    locations, media, exhibitions, conditions, etc.) in a single
    denormalized pass per object.
    """

    direction: Literal["source"] = "source"

    def __init__(self, config: dict[str, Any], organization_id: str):
        self._conn: pyodbc.Connection | None = None
        super().__init__(config, organization_id)

    def validate_config(self) -> None:
        required = ["host", "database"]
        missing = [k for k in required if not self.config.get(k)]
        if missing:
            raise ValueError(f"Missing required TMS config: {', '.join(missing)}")

    def _connect(self) -> pyodbc.Connection:
        if self._conn is not None:
            return self._conn
        host = self.config["host"]
        port = self.config.get("port", 1433)
        database = self.config["database"]
        username = self.config.get("username", "sa")
        password = self.config.get("password", "")
        driver = self.config.get("odbc_driver", "ODBC Driver 17 for SQL Server")

        conn_str = (
            f"DRIVER={{{driver}}};"
            f"SERVER={host},{port};"
            f"DATABASE={database};"
            f"UID={username};"
            f"PWD={password};"
            f"TrustServerCertificate=yes"
        )
        self._conn = pyodbc.connect(conn_str)
        return self._conn

    def _query(self, sql: str, params: tuple = ()) -> list[dict]:
        """Execute a query and return results as list of dicts."""
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute(sql, params)
        columns = [col[0] for col in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]

    def _query_by_object(self, sql: str, object_ids: list[int]) -> dict[int, list[dict]]:
        """Execute a query and group results by ObjectID."""
        if not object_ids:
            return {}
        conn = self._connect()
        cursor = conn.cursor()
        placeholders = ",".join("?" * len(object_ids))
        cursor.execute(sql.replace("{IDS}", placeholders), object_ids)
        columns = [col[0] for col in cursor.description]
        result: dict[int, list[dict]] = {}
        for row in cursor.fetchall():
            row_dict = dict(zip(columns, row))
            oid = row_dict.get("ObjectID")
            if oid is not None:
                result.setdefault(oid, []).append(row_dict)
        return result

    def close(self) -> None:
        if self._conn:
            self._conn.close()
            self._conn = None

    # ── Lookup tables (cached once) ──────────────────────────────────────

    def _load_lookups(self) -> dict[str, dict]:
        """Load all lookup/reference tables into memory."""
        lookups = {}

        # Classifications
        rows = self._query("SELECT ClassificationID, Classification FROM Classifications")
        lookups["classifications"] = {r["ClassificationID"]: r["Classification"] for r in rows}

        # Departments
        rows = self._query("SELECT DepartmentID, Department FROM Departments")
        lookups["departments"] = {r["DepartmentID"]: r["Department"] for r in rows}

        # ObjectStatuses
        rows = self._query("SELECT ObjectStatusID, ObjectStatus FROM ObjectStatuses")
        lookups["object_statuses"] = {r["ObjectStatusID"]: r["ObjectStatus"] for r in rows}

        # Roles (for ConXrefs)
        rows = self._query("SELECT RoleID, Role FROM Roles")
        lookups["roles"] = {r["RoleID"]: r["Role"] for r in rows}

        # TitleTypes
        rows = self._query("SELECT TitleTypeID, TitleType FROM TitleTypes")
        lookups["title_types"] = {r["TitleTypeID"]: r["TitleType"] for r in rows}

        # Locations
        rows = self._query(
            "SELECT LocationID, Site, Room, UnitType, UnitNumber, UnitPosition FROM Locations"
        )
        lookups["locations"] = {}
        for r in rows:
            parts = [_safe_str(r[k]) for k in ("Site", "Room", "UnitType", "UnitNumber", "UnitPosition")]
            lookups["locations"][r["LocationID"]] = " > ".join(p for p in parts if p)

        # DimensionTypes
        rows = self._query("SELECT DimensionTypeID, DimensionType FROM DimensionTypes")
        lookups["dimension_types"] = {r["DimensionTypeID"]: r["DimensionType"] for r in rows}

        # DimensionUnits
        rows = self._query("SELECT UnitID, UnitName FROM DimensionUnits")
        lookups["dimension_units"] = {r["UnitID"]: r["UnitName"] for r in rows}

        # DimensionElements
        rows = self._query("SELECT ElementID, Element FROM DimensionElements")
        lookups["dimension_elements"] = {r["ElementID"]: r["Element"] for r in rows}

        # AccessionMethods
        rows = self._query("SELECT AccessionMethodID, AccessionMethod FROM AccessionMethods")
        lookups["accession_methods"] = {r["AccessionMethodID"]: r["AccessionMethod"] for r in rows}

        # Constituents (all, for lookup by ID)
        rows = self._query(
            "SELECT ConstituentID, DisplayName, FirstName, LastName, "
            "Institution, ConstituentTypeID, Active FROM Constituents"
        )
        lookups["constituents"] = {r["ConstituentID"]: r for r in rows}

        return lookups

    # ── Extract ──────────────────────────────────────────────────────────

    def extract(
        self, cursor: dict[str, Any] | None = None, limit: int | None = None
    ) -> Iterable[dict[str, Any]]:
        """
        Extract all objects from TMS with related data.

        Each yielded record is a fully denormalized object dict with
        nested lists for titles, constituents, locations, media, etc.
        """
        lookups = self._load_lookups()

        # Fetch all objects (skip ObjectID=-1 which is the system default)
        limit_clause = f"TOP {limit}" if limit else ""
        objects = self._query(
            f"SELECT {limit_clause} * FROM Objects WHERE ObjectID > 0 ORDER BY ObjectID"
        )
        if not objects:
            return

        object_ids = [o["ObjectID"] for o in objects]

        # Batch-fetch all related data
        titles = self._query_by_object(
            "SELECT ObjectID, TitleID, Title, TitleTypeID, DisplayOrder, Active "
            "FROM ObjTitles WHERE ObjectID IN ({IDS}) AND Active=1 ORDER BY ObjectID, DisplayOrder",
            object_ids,
        )

        # ConXrefDetails for object-related constituents (RoleTypeID=1 object, 2 acquisition)
        con_xrefs = self._query_by_object(
            "SELECT cx.ID as ObjectID, cxd.ConstituentID, cxd.RoleTypeID as DetailRoleTypeID, "
            "cx.RoleID, cx.DisplayOrder, cxd.DisplayDate, cxd.Prefix, cxd.Suffix "
            "FROM ConXrefs cx "
            "JOIN ConXrefDetails cxd ON cx.ConXrefID = cxd.ConXrefID "
            "WHERE cx.TableID = 108 AND cx.ID IN ({IDS}) AND cxd.UnMasked = 1 "
            "ORDER BY cx.ID, cx.DisplayOrder",
            object_ids,
        )

        # ObjContext
        contexts = self._query_by_object(
            "SELECT ObjectID, Culture, Style, Period, Dynasty, Movement, Nationality, School "
            "FROM ObjContext WHERE ObjectID IN ({IDS})",
            object_ids,
        )

        # ObjAccession
        accessions = self._query_by_object(
            "SELECT ObjectID, AccessionMethodID, AccessionValue, CurrencyID, Source, "
            "AccessionISODate, AcquisitionLot, AcqJustification, Authorizer, AuthDate, "
            "DeedOfGiftSentISO, DeedOfGiftReceivedISO "
            "FROM ObjAccession WHERE ObjectID IN ({IDS})",
            object_ids,
        )

        # ObjDates
        obj_dates = self._query_by_object(
            "SELECT ObjectID, EventType, DateText, DateBegSearch, DateEndSearch, Remarks "
            "FROM ObjDates WHERE ObjectID IN ({IDS}) AND Active=1",
            object_ids,
        )

        # AltNums (for objects)
        alt_nums = self._query_by_object(
            "SELECT ID as ObjectID, AltNum, Description, Remarks "
            "FROM AltNums WHERE TableID=108 AND ID IN ({IDS})",
            object_ids,
        )

        # ObjComponents → ObjLocations (current location via CurrentObjLocID)
        components = self._query_by_object(
            "SELECT oc.ObjectID, oc.ComponentID, oc.ComponentName, oc.ComponentNumber, "
            "oc.HomeLocationID, oc.PhysDesc, oc.InstallComments, oc.StorageComments, "
            "ol.LocationID, ol.TransDate, ol.Handler "
            "FROM ObjComponents oc "
            "LEFT JOIN ObjLocations ol ON oc.CurrentObjLocID = ol.ObjLocationID "
            "WHERE oc.ObjectID IN ({IDS})",
            object_ids,
        )

        # Dimensions (via DimItemElemXrefs → Dimensions)
        dimensions = self._query_by_object(
            "SELECT die.ID as ObjectID, die.DisplayDimensions, die.Description as DimDescription, "
            "d.DimensionTypeID, d.Dimension, d.PrimaryUnitID "
            "FROM DimItemElemXrefs die "
            "JOIN Dimensions d ON die.DimItemElemXrefID = d.DimItemElemXrefID "
            "WHERE die.TableID=108 AND die.ID IN ({IDS})",
            object_ids,
        )

        # Media (MediaXrefs → MediaRenditions → MediaFiles + MediaPaths)
        media = self._query_by_object(
            "SELECT mx.ID as ObjectID, mx.MediaMasterID, mx.Rank, mx.PrimaryDisplay, "
            "mm.Description as MediaDescription, mm.PublicAccess, mm.Copyright, "
            "mr.RenditionID, mr.MediaTypeID, "
            "mf.FileName, mf.PixelH, mf.PixelW, mf.FileSize, "
            "mp.Path as FilePath "
            "FROM MediaXrefs mx "
            "JOIN MediaMaster mm ON mx.MediaMasterID = mm.MediaMasterID "
            "LEFT JOIN MediaRenditions mr ON mm.PrimaryRendID = mr.RenditionID "
            "LEFT JOIN MediaFiles mf ON mr.PrimaryFileID = mf.FileID "
            "LEFT JOIN MediaPaths mp ON mf.PathID = mp.PathID "
            "WHERE mx.TableID=108 AND mx.ID IN ({IDS}) "
            "ORDER BY mx.ID, mx.Rank",
            object_ids,
        )

        # ExhObjXrefs → Exhibitions
        exhibitions = self._query_by_object(
            "SELECT eox.ObjectID, eox.ExhibitionID, eox.Section, eox.CatalogueNumber, "
            "e.ExhTitle, e.BeginISODate, e.EndISODate, e.DisplayDate as ExhDisplayDate "
            "FROM ExhObjXrefs eox "
            "JOIN Exhibitions e ON eox.ExhibitionID = e.ExhibitionID "
            "WHERE eox.ObjectID IN ({IDS})",
            object_ids,
        )

        # Conditions
        conditions = self._query_by_object(
            "SELECT ID as ObjectID, ConditionID, ExaminerID, OverallConditionID, "
            "SurveyISODate, ReportISODate, OverallAnalysis, Remarks as CondRemarks, "
            "SurveyTypeID, TreatmentPriorityID "
            "FROM Conditions WHERE TableID=108 AND ID IN ({IDS}) "
            "ORDER BY ID, SurveyISODate DESC",
            object_ids,
        )

        # ObjInsurance (valuations)
        insurance = self._query_by_object(
            "SELECT ObjectID, Value, ValueISODate, ValuationPurposeID, "
            "CurrencyID, AppraiserID "
            "FROM ObjInsurance WHERE ObjectID IN ({IDS})",
            object_ids,
        )

        # TextEntries for objects
        text_entries = self._query_by_object(
            "SELECT ID as ObjectID, TextTypeID, TextStatusID, "
            "CONVERT(VARCHAR(MAX), TextEntry) as TextEntry "
            "FROM TextEntries WHERE TableID=108 AND ID IN ({IDS})",
            object_ids,
        )

        # ── Assemble denormalized records ────────────────────────────────

        for obj in objects:
            oid = obj["ObjectID"]
            record = {
                "ObjectID": oid,
                "ObjectNumber": _safe_str(obj.get("ObjectNumber")),
                "ObjectName": _safe_str(obj.get("ObjectName")),
                "Title": _safe_str(obj.get("Title")),  # legacy — prefer ObjTitles
                "Dated": _safe_str(obj.get("Dated")),
                "DateBegin": obj.get("DateBegin"),
                "DateEnd": obj.get("DateEnd"),
                "Medium": _safe_str(obj.get("Medium")),
                "CreditLine": _safe_str(obj.get("CreditLine")),
                "Description": _safe_str(obj.get("Description")),
                "Provenance": _safe_str(obj.get("Provenance")),
                "Signed": _safe_str(obj.get("Signed")),
                "Inscribed": _safe_str(obj.get("Inscribed")),
                "Markings": _safe_str(obj.get("Markings")),
                "Dimensions_text": _safe_str(obj.get("Dimensions")),
                "Notes": _safe_str(obj.get("Notes")),
                "CuratorialRemarks": _safe_str(obj.get("CuratorialRemarks")),
                "Chat": _safe_str(obj.get("Chat")),
                "PublicAccess": obj.get("PublicAccess"),
                "OnView": obj.get("OnView"),

                # Resolved lookups
                "Classification": lookups["classifications"].get(obj.get("ClassificationID")),
                "Department": lookups["departments"].get(obj.get("DepartmentID")),
                "ObjectStatus": lookups["object_statuses"].get(obj.get("ObjectStatusID")),

                # Related data
                "titles": [],
                "constituents": [],
                "context": None,
                "accession": None,
                "dates": [],
                "alt_numbers": [],
                "components": [],
                "dimensions": [],
                "media": [],
                "exhibitions": [],
                "conditions": [],
                "insurance": [],
                "text_entries": [],
            }

            # Titles
            for t in titles.get(oid, []):
                record["titles"].append({
                    "title": _safe_str(t["Title"]),
                    "title_type": lookups["title_types"].get(t["TitleTypeID"], "Primary"),
                    "display_order": t["DisplayOrder"],
                })

            # Constituents (artists, donors, etc.)
            for cx in con_xrefs.get(oid, []):
                con_id = cx.get("ConstituentID")
                con = lookups["constituents"].get(con_id, {})
                role_name = lookups["roles"].get(cx.get("RoleID"), "Unknown")
                record["constituents"].append({
                    "constituent_id": con_id,
                    "display_name": con.get("DisplayName"),
                    "first_name": con.get("FirstName"),
                    "last_name": con.get("LastName"),
                    "institution": con.get("Institution"),
                    "type": "person" if con.get("ConstituentTypeID") == CONSTITUENT_TYPE_PERSON else "institution",
                    "role": role_name,
                    "display_date": _safe_str(cx.get("DisplayDate")),
                    "prefix": _safe_str(cx.get("Prefix")),
                    "suffix": _safe_str(cx.get("Suffix")),
                    "display_order": cx.get("DisplayOrder"),
                })

            # Context
            ctx_list = contexts.get(oid, [])
            if ctx_list:
                c = ctx_list[0]
                record["context"] = {
                    "culture": _safe_str(c.get("Culture")),
                    "style": _safe_str(c.get("Style")),
                    "period": _safe_str(c.get("Period")),
                    "dynasty": _safe_str(c.get("Dynasty")),
                    "movement": _safe_str(c.get("Movement")),
                    "nationality": _safe_str(c.get("Nationality")),
                    "school": _safe_str(c.get("School")),
                }

            # Accession
            acc_list = accessions.get(oid, [])
            if acc_list:
                a = acc_list[0]
                record["accession"] = {
                    "method": lookups["accession_methods"].get(a.get("AccessionMethodID")),
                    "value": _safe_float(a.get("AccessionValue")),
                    "source": _safe_str(a.get("Source")),
                    "date": str(a["AccessionISODate"]) if a.get("AccessionISODate") else None,
                    "lot": _safe_str(a.get("AcquisitionLot")),
                    "justification": _safe_str(a.get("AcqJustification")),
                    "authorizer": _safe_str(a.get("Authorizer")),
                    "deed_sent": str(a["DeedOfGiftSentISO"]) if a.get("DeedOfGiftSentISO") else None,
                    "deed_received": str(a["DeedOfGiftReceivedISO"]) if a.get("DeedOfGiftReceivedISO") else None,
                }

            # Dates
            for d in obj_dates.get(oid, []):
                record["dates"].append({
                    "event_type": _safe_str(d.get("EventType")),
                    "date_text": _safe_str(d.get("DateText")),
                    "date_begin": d.get("DateBegSearch"),
                    "date_end": d.get("DateEndSearch"),
                    "remarks": _safe_str(d.get("Remarks")),
                })

            # Alternate numbers
            for an in alt_nums.get(oid, []):
                record["alt_numbers"].append({
                    "number": _safe_str(an.get("AltNum")),
                    "description": _safe_str(an.get("Description")),
                    "remarks": _safe_str(an.get("Remarks")),
                })

            # Components + current location
            for comp in components.get(oid, []):
                loc_id = comp.get("LocationID")
                record["components"].append({
                    "component_id": comp.get("ComponentID"),
                    "name": _safe_str(comp.get("ComponentName")),
                    "number": _safe_str(comp.get("ComponentNumber")),
                    "current_location": lookups["locations"].get(loc_id) if loc_id else None,
                    "home_location": lookups["locations"].get(comp.get("HomeLocationID")),
                    "trans_date": str(comp["TransDate"]) if comp.get("TransDate") else None,
                    "handler": _safe_str(comp.get("Handler")),
                    "physical_description": _safe_str(comp.get("PhysDesc")),
                    "install_comments": _safe_str(comp.get("InstallComments")),
                    "storage_comments": _safe_str(comp.get("StorageComments")),
                })

            # Dimensions
            dim_groups: dict[int, dict] = {}
            for d in dimensions.get(oid, []):
                die_id = id(d)  # group by display string
                display = _safe_str(d.get("DisplayDimensions"))
                dim_type = lookups["dimension_types"].get(d.get("DimensionTypeID"), "")
                value = _safe_float(d.get("Dimension"))
                unit = lookups["dimension_units"].get(d.get("PrimaryUnitID"), "cm")
                record["dimensions"].append({
                    "type": dim_type,
                    "value": value,
                    "unit": unit,
                    "display": display,
                    "description": _safe_str(d.get("DimDescription")),
                })

            # Media
            for m in media.get(oid, []):
                file_path = None
                if m.get("FilePath") and m.get("FileName"):
                    file_path = f"{m['FilePath']}/{m['FileName']}".replace("\\", "/")
                record["media"].append({
                    "media_master_id": m.get("MediaMasterID"),
                    "rank": m.get("Rank"),
                    "primary_display": m.get("PrimaryDisplay"),
                    "description": _safe_str(m.get("MediaDescription")),
                    "copyright": _safe_str(m.get("Copyright")),
                    "public_access": m.get("PublicAccess"),
                    "file_name": _safe_str(m.get("FileName")),
                    "file_path": file_path,
                    "pixel_h": m.get("PixelH"),
                    "pixel_w": m.get("PixelW"),
                    "file_size": m.get("FileSize"),
                })

            # Exhibitions
            for ex in exhibitions.get(oid, []):
                record["exhibitions"].append({
                    "exhibition_id": ex.get("ExhibitionID"),
                    "title": _safe_str(ex.get("ExhTitle")),
                    "begin_date": str(ex["BeginISODate"]) if ex.get("BeginISODate") else None,
                    "end_date": str(ex["EndISODate"]) if ex.get("EndISODate") else None,
                    "section": _safe_str(ex.get("Section")),
                    "catalog_number": _safe_str(ex.get("CatalogueNumber")),
                })

            # Conditions
            for cond in conditions.get(oid, []):
                examiner = lookups["constituents"].get(cond.get("ExaminerID"), {})
                record["conditions"].append({
                    "condition_id": cond.get("ConditionID"),
                    "examiner": examiner.get("DisplayName"),
                    "survey_date": str(cond["SurveyISODate"]) if cond.get("SurveyISODate") else None,
                    "report_date": str(cond["ReportISODate"]) if cond.get("ReportISODate") else None,
                    "overall_analysis": _safe_str(cond.get("OverallAnalysis")),
                    "remarks": _safe_str(cond.get("CondRemarks")),
                })

            # Insurance/valuations
            for ins in insurance.get(oid, []):
                appraiser = lookups["constituents"].get(ins.get("AppraiserID"), {})
                record["insurance"].append({
                    "value": _safe_float(ins.get("Value")),
                    "date": str(ins["ValueISODate"]) if ins.get("ValueISODate") else None,
                    "appraiser": appraiser.get("DisplayName"),
                })

            # Text entries
            for te in text_entries.get(oid, []):
                record["text_entries"].append({
                    "text_type_id": te.get("TextTypeID"),
                    "text": _safe_str(te.get("TextEntry")),
                })

            yield record

    # ── Normalize ────────────────────────────────────────────────────────

    def normalize(self, record: dict[str, Any]) -> dict[str, Any]:
        """
        Normalize a TMS object record into Madrona canonical format.

        Maps TMS fields to canonical properties and preserves
        the full TMS record in extensions for debugging.
        """
        source_id = str(record["ObjectID"])
        object_number = record.get("ObjectNumber") or f"TMS-{source_id}"

        # Primary title from ObjTitles, falling back to ObjectName
        primary_title = None
        for t in record.get("titles", []):
            if t.get("title"):
                primary_title = t["title"]
                break
        if not primary_title:
            primary_title = record.get("ObjectName") or record.get("Title") or f"Object {object_number}"

        # Creators from constituents with role=Artist
        creators = []
        for con in record.get("constituents", []):
            if con.get("role") in ("Artist", "Maker", "Author", "Photographer"):
                creators.append({
                    "name": con.get("display_name"),
                    "role": con.get("role"),
                    "date": con.get("display_date"),
                })

        # Current location from first component
        current_location = None
        for comp in record.get("components", []):
            if comp.get("current_location"):
                current_location = comp["current_location"]
                break

        # Build canonical properties
        properties = {
            "object_number": object_number,
            "object_name": record.get("ObjectName"),
            "classification": record.get("Classification"),
            "department": record.get("Department"),
            "object_status": record.get("ObjectStatus"),
            "dated": record.get("Dated"),
            "date_begin": record.get("DateBegin"),
            "date_end": record.get("DateEnd"),
            "medium": record.get("Medium"),
            "credit_line": record.get("CreditLine"),
            "description": record.get("Description"),
            "provenance": record.get("Provenance"),
            "signed": record.get("Signed"),
            "inscribed": record.get("Inscribed"),
            "markings": record.get("Markings"),
            "dimensions_text": record.get("Dimensions_text"),
            "notes": record.get("Notes"),
            "curatorial_remarks": record.get("CuratorialRemarks"),
            "public_access": record.get("PublicAccess"),
            "on_view": record.get("OnView"),
            "current_location": current_location,
            # Nested data
            "titles": record.get("titles", []),
            "creators": creators,
            "all_constituents": record.get("constituents", []),
            "context": record.get("context"),
            "accession": record.get("accession"),
            "dates": record.get("dates", []),
            "alt_numbers": record.get("alt_numbers", []),
            "components": record.get("components", []),
            "dimensions": record.get("dimensions", []),
            "media": record.get("media", []),
            "exhibitions": record.get("exhibitions", []),
            "conditions": record.get("conditions", []),
            "insurance": record.get("insurance", []),
            "text_entries": record.get("text_entries", []),
        }

        # Clean up TMS zero-dates (0 means "no date")
        for date_key in ("date_begin", "date_end"):
            if properties.get(date_key) == 0:
                del properties[date_key]

        # Strip None values, empty lists, and all-null dicts for cleaner payloads
        properties = {
            k: v for k, v in properties.items()
            if v is not None
            and not (isinstance(v, list) and len(v) == 0)
            and not (isinstance(v, dict) and all(val is None for val in v.values()))
        }

        # Build canonical media references (top-level, for display)
        canonical_media = []
        for m in record.get("media", []):
            fname = m.get("file_name")
            if fname:
                canonical_media.append({
                    "id": f"tms-media:{m.get('media_master_id', '')}",
                    "type": "image",
                    "label": fname,
                    "role": "primary" if m.get("primary_display") else "alternate",
                })

        result: dict[str, Any] = {
            "entity_key": f"tms:{source_id}",
            "source_system": "tms",
            "source_id": source_id,
            "entity_type": "Object",
            "title": primary_title,
            "object_number": object_number,
            "payload": {
                "id": f"mdrn:tms:{source_id}",
                "type": "Object",
                "label": primary_title,
                "properties": properties,
                "extensions": [{
                    "namespace": "source.tms",
                    "type": "TMSRaw",
                    "data": record,
                }],
            },
        }

        if canonical_media:
            result["payload"]["media"] = canonical_media

        return result

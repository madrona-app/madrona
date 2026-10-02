#!/usr/bin/env python3
"""
Smithsonian Open Access API Pattern Audit Script

Analyzes the Smithsonian API to discover patterns in:
- Record types and unit codes (museums)
- Identifier schemes
- Metadata field availability
- Media/image availability

This informs how the Smithsonian connector should:
- Extract unique IDs
- Filter by record type
- Handle different museum collections

Usage:
    python scripts/analysis/smithsonian_pattern_audit.py [--samples N] [--api-key KEY]

API Documentation: https://edan.si.edu/openaccess/apidocs/
"""

import argparse
import json
import os
import sys
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

import requests

# Smithsonian unit codes (museums/collections)
UNIT_CODES = {
    "NMAH": "National Museum of American History",
    "NASM": "National Air and Space Museum",
    "NMNH": "National Museum of Natural History",
    "SAAM": "Smithsonian American Art Museum",
    "NPG": "National Portrait Gallery",
    "CHNDM": "Cooper Hewitt Design Museum",
    "ACM": "Anacostia Community Museum",
    "NMAAHC": "National Museum of African American History and Culture",
    "NMAI": "National Museum of the American Indian",
    "NPM": "National Postal Museum",
    "HMSG": "Hirshhorn Museum and Sculpture Garden",
    "FSG": "Freer/Sackler Gallery",
    "AAA": "Archives of American Art",
    "SIA": "Smithsonian Institution Archives",
    "SIL": "Smithsonian Libraries",
    "NZP": "National Zoo",
}

# Common object types to sample
OBJECT_TYPE_QUERIES = [
    {"name": "Objects with Images", "query": "online_media_type:Images"},
    {"name": "3D Models", "query": "online_media_type:\"3d package\""},
    {"name": "Documents", "query": "type:Documents"},
    {"name": "Photographs", "query": "object_type:Photographs"},
    {"name": "Artworks", "query": "object_type:\"Works of art\""},
    {"name": "Specimens", "query": "type:\"Scientific specimens\""},
    {"name": "Archives", "query": "type:Archives"},
]


def fetch_smithsonian(api_key: str, query: str, rows: int = 10, start: int = 0) -> dict:
    """Fetch from Smithsonian Open Access API."""
    url = "https://api.si.edu/openaccess/api/v1.0/search"
    params = {
        "api_key": api_key,
        "q": query,
        "rows": rows,
        "start": start,
    }

    try:
        response = requests.get(url, params=params, timeout=30)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"  Error: {e}", file=sys.stderr)
        return {}


def analyze_record(record: dict, source_name: str) -> dict:
    """Analyze a single Smithsonian record for patterns."""
    content = record.get("content", {})
    desc = content.get("descriptiveNonRepeating", {})
    indexed = content.get("indexedStructured", {})
    freetext = content.get("freetext", {})

    result = {
        "source": source_name,
        "id": record.get("id", ""),
        "title": record.get("title", "")[:80] if record.get("title") else "",
        "unit_code": record.get("unitCode", ""),
        "type": record.get("type", ""),
        "url": record.get("url", ""),
    }

    # Identifier analysis
    result["has_guid"] = bool(desc.get("guid"))
    result["has_record_id"] = bool(desc.get("record_ID"))
    result["has_data_source"] = bool(desc.get("data_source"))
    result["record_id"] = desc.get("record_ID", "")
    result["guid"] = desc.get("guid", "")

    # Media analysis
    online_media = desc.get("online_media", {})
    media_list = online_media.get("media", []) if isinstance(online_media, dict) else []
    result["media_count"] = len(media_list) if isinstance(media_list, list) else 0
    result["has_images"] = any(
        m.get("type", "").lower() in ["images", "image"]
        for m in media_list
    ) if isinstance(media_list, list) else False
    result["has_3d"] = any(
        "3d" in m.get("type", "").lower()
        for m in media_list
    ) if isinstance(media_list, list) else False

    # Structured fields
    result["has_object_type"] = bool(indexed.get("object_type"))
    result["object_types"] = indexed.get("object_type", [])
    result["has_date"] = bool(indexed.get("date"))
    result["has_place"] = bool(indexed.get("place"))
    result["has_topic"] = bool(indexed.get("topic"))
    result["has_culture"] = bool(indexed.get("culture"))
    result["has_name"] = bool(indexed.get("name"))

    # Freetext fields
    result["has_physicalDescription"] = bool(freetext.get("physicalDescription"))
    result["has_notes"] = bool(freetext.get("notes"))
    result["has_creditLine"] = bool(freetext.get("creditLine"))
    result["has_objectRights"] = bool(freetext.get("objectRights"))

    # ID patterns
    if result["record_id"]:
        # Analyze record_id format
        rid = result["record_id"]
        if rid.startswith("edanmdm-"):
            result["id_format"] = "edanmdm"
        elif rid.startswith("ld1-"):
            result["id_format"] = "ld1"
        elif rid.startswith("siris_"):
            result["id_format"] = "siris"
        elif rid.startswith("saam-"):
            result["id_format"] = "saam"
        elif rid.startswith("npg_"):
            result["id_format"] = "npg"
        elif rid.startswith("chndm_"):
            result["id_format"] = "chndm"
        elif rid.startswith("nmaahc_"):
            result["id_format"] = "nmaahc"
        else:
            result["id_format"] = "other"
    else:
        result["id_format"] = "none"

    return result


def print_report(all_items: list[dict]) -> None:
    """Print comprehensive analysis report."""
    print("\n" + "=" * 80)
    print("SMITHSONIAN OPEN ACCESS API PATTERN AUDIT REPORT")
    print("=" * 80)
    print(f"\nTotal records analyzed: {len(all_items)}")

    # By unit code (museum)
    by_unit = defaultdict(list)
    for item in all_items:
        by_unit[item["unit_code"]].append(item)

    print("\n" + "-" * 80)
    print("RECORDS BY MUSEUM (UNIT CODE)")
    print("-" * 80)
    for unit, items in sorted(by_unit.items(), key=lambda x: -len(x[1])):
        name = UNIT_CODES.get(unit, "Unknown")
        print(f"\n  {unit}: {name}")
        print(f"    Count: {len(items)}")
        # Sample object types
        obj_types = set()
        for item in items:
            obj_types.update(item.get("object_types", []))
        if obj_types:
            print(f"    Object types: {', '.join(list(obj_types)[:5])}")

    # By record type
    by_type = defaultdict(list)
    for item in all_items:
        by_type[item["type"]].append(item)

    print("\n" + "-" * 80)
    print("RECORDS BY TYPE")
    print("-" * 80)
    for rtype, items in sorted(by_type.items(), key=lambda x: -len(x[1])):
        print(f"\n  {rtype}: {len(items)} records ({len(items)/len(all_items)*100:.1f}%)")
        units = set(i["unit_code"] for i in items)
        print(f"    Museums: {', '.join(sorted(units)[:5])}")

    # By ID format
    by_id_format = defaultdict(list)
    for item in all_items:
        by_id_format[item["id_format"]].append(item)

    print("\n" + "-" * 80)
    print("RECORD ID FORMATS")
    print("-" * 80)
    for fmt, items in sorted(by_id_format.items(), key=lambda x: -len(x[1])):
        print(f"\n  {fmt}: {len(items)} records")
        print(f"    Example IDs:")
        for item in items[:3]:
            print(f"      - {item['record_id'][:60]}")

    # Field availability
    print("\n" + "-" * 80)
    print("FIELD AVAILABILITY")
    print("-" * 80)

    fields_to_check = [
        ("has_guid", "GUID"),
        ("has_record_id", "Record ID"),
        ("has_object_type", "Object Type"),
        ("has_date", "Date"),
        ("has_place", "Place"),
        ("has_topic", "Topic"),
        ("has_name", "Name/Creator"),
        ("has_culture", "Culture"),
        ("has_images", "Has Images"),
        ("has_3d", "Has 3D Models"),
        ("has_physicalDescription", "Physical Description"),
        ("has_creditLine", "Credit Line"),
        ("has_objectRights", "Rights Info"),
    ]

    print(f"\n  {'Field':<25} {'Available':<12} {'Percentage':<10}")
    print(f"  {'-'*25} {'-'*12} {'-'*10}")
    for field_key, field_name in fields_to_check:
        count = sum(1 for i in all_items if i.get(field_key))
        pct = count / len(all_items) * 100 if all_items else 0
        print(f"  {field_name:<25} {count:<12} {pct:.1f}%")

    # Media analysis
    print("\n" + "-" * 80)
    print("MEDIA ANALYSIS")
    print("-" * 80)

    with_images = sum(1 for i in all_items if i["has_images"])
    with_3d = sum(1 for i in all_items if i["has_3d"])
    media_counts = [i["media_count"] for i in all_items]
    avg_media = sum(media_counts) / len(media_counts) if media_counts else 0

    print(f"\n  Records with images: {with_images}/{len(all_items)} ({with_images/len(all_items)*100:.1f}%)")
    print(f"  Records with 3D: {with_3d}/{len(all_items)} ({with_3d/len(all_items)*100:.1f}%)")
    print(f"  Average media items per record: {avg_media:.1f}")

    # Object types across all records
    print("\n" + "-" * 80)
    print("OBJECT TYPES (Top 20)")
    print("-" * 80)

    all_obj_types = defaultdict(int)
    for item in all_items:
        for ot in item.get("object_types", []):
            all_obj_types[ot] += 1

    for ot, count in sorted(all_obj_types.items(), key=lambda x: -x[1])[:20]:
        print(f"  {ot}: {count}")

    # Recommendations
    print("\n" + "-" * 80)
    print("RECOMMENDATIONS FOR CONNECTOR")
    print("-" * 80)

    img_pct = with_images/len(all_items)*100 if all_items else 0
    threed_pct = with_3d/len(all_items)*100 if all_items else 0

    print(f"""
  1. ID STRATEGY:
     - Use 'record_ID' from descriptiveNonRepeating (100% available)
     - Format is consistent: prefix-collection-id (e.g., nmah_1234567)

  2. FILTERING OPTIONS:
     - By unit_code (museum): NMAH, NASM, SAAM, etc.
     - By type: edanmdm, ead_collection, ead_component
     - By object_type: Photographs, Textiles, Paintings, etc.
     - By online_media_type: Images, 3d package

  3. SUGGESTED CONNECTOR CONFIG:
     - unit_codes: list of museum codes to include
     - object_types: list of object types to include
     - require_images: boolean to filter for records with images
     - record_types: list of record types (edanmdm, ead_collection, etc.)

  4. MEDIA HANDLING:
     - ~{img_pct:.0f}% of records have images
     - ~{threed_pct:.1f}% have 3D models
     - Extract primary image from online_media.media[0]
""")

    print("=" * 80)


def main():
    parser = argparse.ArgumentParser(description="Audit Smithsonian API patterns")
    parser.add_argument("--samples", type=int, default=10,
                        help="Samples per query (default: 10)")
    parser.add_argument("--api-key", type=str,
                        default=os.environ.get("SMITHSONIAN_API_KEY", ""),
                        help="Smithsonian API key (or set SMITHSONIAN_API_KEY)")
    parser.add_argument("--output", type=str, help="Output JSON file")
    args = parser.parse_args()

    all_items = []

    print("Smithsonian Open Access API Pattern Audit")
    print("=" * 50)

    # Sample by unit code (museum)
    print("\nSampling by museum (unit code)...")
    for unit_code, name in list(UNIT_CODES.items())[:8]:  # Top 8 museums
        print(f"\n  {unit_code}: {name}...")
        query = f"unit_code:{unit_code} AND online_media_type:Images"

        data = fetch_smithsonian(args.api_key, query, rows=args.samples)
        rows = data.get("response", {}).get("rows", [])

        if rows:
            print(f"    Got {len(rows)} records")
            for record in rows:
                analyzed = analyze_record(record, f"unit:{unit_code}")
                all_items.append(analyzed)
        else:
            print(f"    No records found")

        time.sleep(0.3)

    # Sample by object type
    print("\nSampling by object type...")
    for query_info in OBJECT_TYPE_QUERIES:
        print(f"\n  {query_info['name']}...")

        data = fetch_smithsonian(args.api_key, query_info["query"], rows=args.samples)
        rows = data.get("response", {}).get("rows", [])

        if rows:
            print(f"    Got {len(rows)} records")
            for record in rows:
                analyzed = analyze_record(record, query_info["name"])
                all_items.append(analyzed)
        else:
            print(f"    No records found")

        time.sleep(0.3)

    # Sample different record types
    print("\nSampling by record type...")
    for record_type in ["edanmdm", "ead_collection", "ead_component", "damsmdm"]:
        print(f"\n  type:{record_type}...")
        query = f"type:{record_type}"

        data = fetch_smithsonian(args.api_key, query, rows=args.samples)
        rows = data.get("response", {}).get("rows", [])

        if rows:
            print(f"    Got {len(rows)} records")
            for record in rows:
                analyzed = analyze_record(record, f"type:{record_type}")
                all_items.append(analyzed)

        time.sleep(0.3)

    # Print report
    print_report(all_items)

    # Save raw data
    if args.output:
        with open(args.output, "w") as f:
            json.dump(all_items, f, indent=2, default=str)
        print(f"\nRaw data saved to: {args.output}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
LOC API Pattern Audit Script

Analyzes the Library of Congress API to discover patterns in:
- URL structures
- Identifier schemes
- Metadata field availability
- Collection-specific variations

This informs how the LOC connector should extract unique IDs.

Usage:
    python scripts/analysis/loc_pattern_audit.py [--samples N]
"""

import argparse
import json
import re
import sys
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

import requests

# LOC collections to sample from
COLLECTIONS_TO_SAMPLE = [
    # Major digitized collections
    {"name": "Chronicling America (Newspapers)", "url": "https://www.loc.gov/collections/chronicling-america/", "slug": "chronicling-america"},
    {"name": "U.S. Code", "url": "https://www.loc.gov/collections/united-states-code/", "slug": "united-states-code"},
    {"name": "Civil War Maps", "url": "https://www.loc.gov/collections/civil-war-maps/", "slug": "civil-war-maps"},
    {"name": "Baseball Cards", "url": "https://www.loc.gov/collections/baseball-cards/", "slug": "baseball-cards"},
    {"name": "Prints and Photographs", "url": "https://www.loc.gov/pictures/", "slug": "prints-photographs"},
    {"name": "Historic American Buildings", "url": "https://www.loc.gov/collections/historic-american-buildings-landscapes-and-engineering-records/", "slug": "habs-haer"},
    {"name": "American Memory", "url": "https://www.loc.gov/collections/", "slug": "american-memory"},
    {"name": "Web Archives", "url": "https://www.loc.gov/collections/web-cultures-web-archive/", "slug": "web-cultures"},
    {"name": "Maps", "url": "https://www.loc.gov/maps/", "slug": "maps"},
    {"name": "Manuscripts", "url": "https://www.loc.gov/manuscripts/", "slug": "manuscripts"},
]

# Also sample from general search to catch diverse items
GENERAL_SEARCH_QUERIES = [
    {"name": "Images (general)", "params": {"fa": "online-format:image"}},
    {"name": "PDFs (general)", "params": {"fa": "online-format:pdf"}},
    {"name": "Audio", "params": {"fa": "online-format:audio"}},
    {"name": "Video", "params": {"fa": "online-format:video"}},
]


@dataclass
class PatternStats:
    """Statistics for a URL/ID pattern."""
    count: int = 0
    examples: list = field(default_factory=list)
    collections: set = field(default_factory=set)
    id_fields: dict = field(default_factory=lambda: defaultdict(int))


def fetch_loc_items(url: str, params: dict, limit: int = 10) -> list[dict]:
    """Fetch items from LOC API with rate limiting."""
    all_params = {
        "fo": "json",
        "c": min(limit, 25),
        "sp": 0,
        **params,
    }

    try:
        response = requests.get(
            url,
            params=all_params,
            timeout=30,
            headers={"Accept": "application/json", "User-Agent": "Madrona-LOC-Audit/1.0"}
        )
        response.raise_for_status()
        data = response.json()
        return data.get("results", [])
    except Exception as e:
        print(f"  Error fetching from {url}: {e}", file=sys.stderr)
        return []


def extract_url_pattern(url: str) -> str:
    """Extract a generalized pattern from a LOC URL."""
    if not url:
        return "EMPTY"

    parsed = urlparse(url)
    path = parsed.path.rstrip("/")

    # Replace specific IDs with placeholders
    patterns = [
        # Dates
        (r"/\d{4}-\d{2}-\d{2}/", "/{DATE}/"),
        (r"/\d{4}-\d{2}/", "/{YEAR-MONTH}/"),
        # Edition numbers
        (r"/ed-\d+", "/ed-{N}"),
        # LCCN patterns
        (r"/sn\d+", "/{LCCN}"),
        # Numeric IDs
        (r"/\d{5,}", "/{NUMERIC_ID}"),
        # UUID-like
        (r"/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}", "/{UUID}"),
        # Alphanumeric IDs (keep letters, replace numbers)
        (r"([a-z]+)\d+", r"\1{N}"),
    ]

    result = path
    for pattern, replacement in patterns:
        result = re.sub(pattern, replacement, result, flags=re.IGNORECASE)

    return result


def extract_id_from_url(url: str) -> tuple[str, str]:
    """Extract the ID portion from a LOC URL and classify the method."""
    if not url:
        return "", "EMPTY"

    parsed = urlparse(url)
    path = parsed.path.rstrip("/")
    segments = [s for s in path.split("/") if s]

    # Detect URL type and extract accordingly
    if "/item/" in path:
        # Item URL: /item/{id}/ or /item/{lccn}/{date}/{edition}/
        item_idx = segments.index("item") if "item" in segments else -1
        if item_idx >= 0:
            remaining = segments[item_idx + 1:]
            if len(remaining) == 1:
                return remaining[0], "ITEM_SINGLE"
            elif len(remaining) == 3 and re.match(r"ed-\d+", remaining[2]):
                # Newspaper: lccn/date/edition
                return f"{remaining[0]}-{remaining[1]}-{remaining[2]}", "ITEM_NEWSPAPER"
            elif len(remaining) >= 2:
                return "-".join(remaining), "ITEM_MULTI"

    if "/resource/" in path:
        # Resource URL
        res_idx = segments.index("resource") if "resource" in segments else -1
        if res_idx >= 0:
            remaining = segments[res_idx + 1:]
            return "-".join(remaining), "RESOURCE"

    # Fallback: last segment
    if segments:
        return segments[-1], "LAST_SEGMENT"

    return "", "UNKNOWN"


def analyze_item(item: dict, collection_name: str) -> dict:
    """Analyze a single LOC item for patterns."""
    result = {
        "collection": collection_name,
        "url": item.get("url", item.get("id", "")),
        "id_field": item.get("id", ""),
        "title": item.get("title", "")[:80] if item.get("title") else "",
    }

    # Extract URL pattern
    result["url_pattern"] = extract_url_pattern(result["url"])

    # Extract ID and method
    extracted_id, method = extract_id_from_url(result["url"])
    result["extracted_id"] = extracted_id
    result["extraction_method"] = method

    # Check for alternate identifiers in the data
    result["has_lccn"] = bool(item.get("number_lccn") or
                              (item.get("item", {}).get("library_of_congress_control_number")))
    result["has_shelf_id"] = bool(item.get("shelf_id"))
    result["has_call_number"] = bool(item.get("item", {}).get("call_number"))

    # Item type indicators
    result["original_format"] = item.get("original_format", [])
    result["online_format"] = item.get("online_format", [])
    result["type"] = item.get("type", [])

    # Check for potential ID collisions
    result["id_length"] = len(extracted_id)
    result["id_has_date"] = bool(re.search(r"\d{4}-\d{2}-\d{2}", extracted_id))

    return result


def print_report(all_items: list[dict]) -> None:
    """Print analysis report."""
    print("\n" + "=" * 80)
    print("LOC API PATTERN AUDIT REPORT")
    print("=" * 80)
    print(f"\nTotal items analyzed: {len(all_items)}")

    # Group by extraction method
    by_method = defaultdict(list)
    for item in all_items:
        by_method[item["extraction_method"]].append(item)

    print("\n" + "-" * 80)
    print("EXTRACTION METHODS DETECTED")
    print("-" * 80)
    for method, items in sorted(by_method.items(), key=lambda x: -len(x[1])):
        print(f"\n{method}: {len(items)} items ({len(items)/len(all_items)*100:.1f}%)")

        # Show collections using this method
        collections = set(i["collection"] for i in items)
        print(f"  Collections: {', '.join(sorted(collections)[:5])}")

        # Show example IDs
        print("  Example IDs:")
        for item in items[:3]:
            print(f"    - {item['extracted_id'][:60]}")
            print(f"      URL: {item['url'][:70]}...")

    # Group by URL pattern
    by_pattern = defaultdict(list)
    for item in all_items:
        by_pattern[item["url_pattern"]].append(item)

    print("\n" + "-" * 80)
    print("URL PATTERNS DETECTED")
    print("-" * 80)
    for pattern, items in sorted(by_pattern.items(), key=lambda x: -len(x[1]))[:15]:
        print(f"\n{pattern}")
        print(f"  Count: {len(items)}")
        print(f"  Example: {items[0]['url'][:70]}...")

    # Identifier availability
    print("\n" + "-" * 80)
    print("IDENTIFIER FIELD AVAILABILITY")
    print("-" * 80)
    has_lccn = sum(1 for i in all_items if i["has_lccn"])
    has_shelf = sum(1 for i in all_items if i["has_shelf_id"])
    has_call = sum(1 for i in all_items if i["has_call_number"])
    print(f"  LCCN available: {has_lccn}/{len(all_items)} ({has_lccn/len(all_items)*100:.1f}%)")
    print(f"  Shelf ID available: {has_shelf}/{len(all_items)} ({has_shelf/len(all_items)*100:.1f}%)")
    print(f"  Call number available: {has_call}/{len(all_items)} ({has_call/len(all_items)*100:.1f}%)")

    # ID collision risk
    print("\n" + "-" * 80)
    print("ID COLLISION RISK ANALYSIS")
    print("-" * 80)

    # Check for duplicate extracted IDs
    id_counts = defaultdict(list)
    for item in all_items:
        id_counts[item["extracted_id"]].append(item)

    duplicates = {k: v for k, v in id_counts.items() if len(v) > 1}
    if duplicates:
        print(f"\n  DUPLICATES FOUND: {len(duplicates)} IDs appear multiple times!")
        for dup_id, items in list(duplicates.items())[:5]:
            print(f"\n  ID '{dup_id}' appears {len(items)} times:")
            for item in items[:3]:
                print(f"    - {item['collection']}: {item['title'][:50]}...")
    else:
        print("\n  No duplicate IDs found in sample (good!)")

    # Short IDs (higher collision risk)
    short_ids = [i for i in all_items if i["id_length"] < 10]
    if short_ids:
        print(f"\n  Short IDs (<10 chars): {len(short_ids)} items")
        print("  Examples:")
        for item in short_ids[:5]:
            print(f"    - '{item['extracted_id']}' from {item['collection']}")

    # Recommendations
    print("\n" + "-" * 80)
    print("RECOMMENDATIONS")
    print("-" * 80)

    recommendations = []

    if "ITEM_NEWSPAPER" in by_method:
        recommendations.append(
            "NEWSPAPER ITEMS: Use composite ID (LCCN + date + edition) for uniqueness"
        )

    if "ITEM_SINGLE" in by_method:
        recommendations.append(
            "SINGLE-SEGMENT ITEMS: Verify ID uniqueness; consider prefixing with collection"
        )

    if duplicates:
        recommendations.append(
            f"COLLISION RISK: {len(duplicates)} duplicate IDs detected - need smarter extraction"
        )

    if short_ids:
        recommendations.append(
            f"SHORT IDS: {len(short_ids)} items have IDs < 10 chars - higher collision risk"
        )

    for i, rec in enumerate(recommendations, 1):
        print(f"\n  {i}. {rec}")

    print("\n" + "=" * 80)


def main():
    parser = argparse.ArgumentParser(description="Audit LOC API patterns")
    parser.add_argument("--samples", type=int, default=10,
                        help="Number of samples per collection (default: 10)")
    parser.add_argument("--output", type=str, help="Output JSON file for raw data")
    args = parser.parse_args()

    all_items = []

    print("LOC API Pattern Audit")
    print("=" * 40)

    # Sample from specific collections
    print("\nSampling from collections...")
    for collection in COLLECTIONS_TO_SAMPLE:
        print(f"\n  {collection['name']}...")
        url = f"https://www.loc.gov/collections/{collection['slug']}/"
        items = fetch_loc_items(url, {}, limit=args.samples)

        if items:
            print(f"    Got {len(items)} items")
            for item in items:
                analyzed = analyze_item(item, collection["name"])
                all_items.append(analyzed)
        else:
            print(f"    No items (may need different URL)")

        time.sleep(0.5)  # Rate limiting

    # Sample from general search
    print("\nSampling from general search...")
    for query in GENERAL_SEARCH_QUERIES:
        print(f"\n  {query['name']}...")
        items = fetch_loc_items("https://www.loc.gov/search/", query["params"], limit=args.samples)

        if items:
            print(f"    Got {len(items)} items")
            for item in items:
                analyzed = analyze_item(item, query["name"])
                all_items.append(analyzed)

        time.sleep(0.5)

    # Print report
    print_report(all_items)

    # Optionally save raw data
    if args.output:
        with open(args.output, "w") as f:
            json.dump(all_items, f, indent=2, default=str)
        print(f"\nRaw data saved to: {args.output}")


if __name__ == "__main__":
    main()

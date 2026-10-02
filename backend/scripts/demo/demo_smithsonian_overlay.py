"""
Demo script to show Smithsonian base connector + org overlay pattern.

This script demonstrates:
1. Loading the base Smithsonian connector (shared implementation)
2. Loading the Example Museum org overlay (custom implementation)
3. Showing how org overlay inherits from base but customizes behavior

Run with:
    python demo_smithsonian_overlay.py
"""

import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

from app.connectors.core.smithsonian_base import SmithsonianBaseConnector
from app.connectors.orgs.example_museum.smithsonian import SmithsonianConnector
from app.connectors.loader import load_connector_class, resolve_org_overlay_implementation


def demo_base_connector():
    """Demonstrate the base Smithsonian connector."""
    print("=" * 80)
    print("1. BASE SMITHSONIAN CONNECTOR (Shared Implementation)")
    print("=" * 80)
    
    config = {"api_key": "demo-api-key-123"}
    org_id = "generic-org-uuid"
    
    connector = SmithsonianBaseConnector(config, org_id)
    
    print(f"Class: {connector.__class__.__name__}")
    print(f"Module: {connector.__class__.__module__}")
    print(f"Direction: {connector.direction}")
    print(f"Default Query: {connector.get_default_query()}")
    print(f"Default Rows Per Page: {connector.DEFAULT_ROWS_PER_PAGE}")
    print()
    
    # Test transform_entity (base returns unchanged)
    mock_record = {"id": "test-123", "title": "Test Object"}
    base_entity = {
        "entity_key": "smithsonian:test-123",
        "source_system": "smithsonian",
        "title": "Test Object",
        "payload": {}
    }
    
    transformed = connector.transform_entity(mock_record, base_entity)
    print(f"Base transform_entity: {list(transformed['payload'].keys())}")
    print(f"  └─ No custom fields added (base implementation)")
    print()


def demo_org_overlay():
    """Demonstrate the Example Museum org overlay."""
    print("=" * 80)
    print("2. EXAMPLE MUSEUM ORG OVERLAY (Custom Implementation)")
    print("=" * 80)
    
    config = {"api_key": "demo-api-key-456"}
    org_id = "example-museum-org-uuid"
    
    connector = SmithsonianConnector(config, org_id)
    
    print(f"Class: {connector.__class__.__name__}")
    print(f"Module: {connector.__class__.__module__}")
    print(f"Direction: {connector.direction}")
    print(f"Default Query: {connector.get_default_query()}")  # Customized!
    print(f"Inherits from: {connector.__class__.__bases__[0].__name__}")
    print()
    
    # Test transform_entity (org overlay adds custom fields)
    mock_record = {
        "id": "test-456",
        "title": "Museum Painting",
        "content": {
            "indexedStructured": {
                "object_type": ["Painting", "Canvas"],
                "date": ["1920s"],
                "topic": ["Art", "Modern"],
                "place": ["New York"]
            }
        }
    }
    base_entity = {
        "entity_key": "smithsonian:test-456",
        "source_system": "smithsonian",
        "title": "Museum Painting",
        "payload": {}
    }
    
    transformed = connector.transform_entity(mock_record, base_entity)
    print(f"Org transform_entity: {list(transformed['payload'].keys())}")
    print(f"  ├─ jb_object_type_hints: {transformed['payload'].get('jb_object_type_hints')}")
    print(f"  ├─ jb_creation_dates: {transformed['payload'].get('jb_creation_dates')}")
    print(f"  ├─ jb_topics: {transformed['payload'].get('jb_topics')}")
    print(f"  └─ jb_places: {transformed['payload'].get('jb_places')}")
    print()


def demo_dynamic_loading():
    """Demonstrate dynamic loading via implementation_key."""
    print("=" * 80)
    print("3. DYNAMIC LOADING VIA IMPLEMENTATION_KEY")
    print("=" * 80)
    
    # Base connector
    base_impl_key = "app.connectors.core.smithsonian_base:SmithsonianBaseConnector"
    print(f"Loading base: {base_impl_key}")
    base_class = load_connector_class(base_impl_key)
    print(f"  └─ Loaded: {base_class.__name__} from {base_class.__module__}")
    print()
    
    # Org overlay
    org_impl_key = "app.connectors.orgs.example_museum.smithsonian:SmithsonianConnector"
    print(f"Loading org overlay: {org_impl_key}")
    org_class = load_connector_class(org_impl_key)
    print(f"  └─ Loaded: {org_class.__name__} from {org_class.__module__}")
    print()


def demo_org_overlay_resolution():
    """Demonstrate automatic org overlay resolution."""
    print("=" * 80)
    print("4. AUTOMATIC ORG OVERLAY RESOLUTION")
    print("=" * 80)
    
    default_impl = "app.connectors.core.smithsonian_base:SmithsonianConnector"
    connector_key = "smithsonian-openaccess"
    
    # Without org overlay (feature disabled)
    print("Scenario A: Feature disabled (default)")
    result = resolve_org_overlay_implementation(
        default_implementation_key=default_impl,
        connector_definition_key=connector_key,
        org_slug="example_museum",
        enable_overlay=False
    )
    print(f"  Result: {result}")
    print(f"  └─ Uses default (no overlay)")
    print()
    
    # With org overlay (feature enabled, org has custom connector)
    print("Scenario B: Feature enabled, org has custom connector")
    result = resolve_org_overlay_implementation(
        default_implementation_key=default_impl,
        connector_definition_key=connector_key,
        org_slug="example_museum",
        enable_overlay=True
    )
    print(f"  Result: {result}")
    print(f"  └─ Uses org-specific: app.connectors.orgs.example_museum.smithsonian:SmithsonianConnector")
    print()
    
    # With org overlay (feature enabled, org has NO custom connector)
    print("Scenario C: Feature enabled, org has NO custom connector")
    result = resolve_org_overlay_implementation(
        default_implementation_key=default_impl,
        connector_definition_key=connector_key,
        org_slug="other_museum",  # Doesn't exist
        enable_overlay=True
    )
    print(f"  Result: {result}")
    print(f"  └─ Falls back to default (org-specific not found)")
    print()


def demo_comparison():
    """Side-by-side comparison of base vs org overlay."""
    print("=" * 80)
    print("5. SIDE-BY-SIDE COMPARISON")
    print("=" * 80)
    
    config = {"api_key": "demo-comparison"}
    
    base = SmithsonianBaseConnector(config, "base-org")
    overlay = SmithsonianConnector(config, "jb-org")
    
    print(f"{'Feature':<30} {'Base':<30} {'Example Museum Overlay':<30}")
    print("-" * 90)
    print(f"{'Default Query':<30} {base.get_default_query():<30} {overlay.get_default_query():<30}")
    print(f"{'Rows Per Page':<30} {base.DEFAULT_ROWS_PER_PAGE:<30} {overlay.DEFAULT_ROWS_PER_PAGE:<30}")
    
    # Thumbnail comparison
    record = {
        "content": {
            "descriptiveNonRepeating": {
                "idsId": "TEST-ID-789"
            }
        }
    }
    base_thumb = base.extract_thumbnail(record)
    overlay_thumb = overlay.extract_thumbnail(record)
    
    print(f"{'Thumbnail Size':<30} {'150px (base)':<30} {'300px (higher quality)':<30}")
    print()


if __name__ == "__main__":
    print("\n")
    print("╔" + "=" * 78 + "╗")
    print("║" + " " * 10 + "SMITHSONIAN BASE CONNECTOR + ORG OVERLAY DEMO" + " " * 23 + "║")
    print("╚" + "=" * 78 + "╝")
    print()
    
    demo_base_connector()
    demo_org_overlay()
    demo_dynamic_loading()
    demo_org_overlay_resolution()
    demo_comparison()
    
    print("=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print("✓ Base connector provides shared implementation (paging, retry, incremental)")
    print("✓ Org overlay inherits from base and customizes field mapping/transforms")
    print("✓ Dynamic loading via implementation_key works for both")
    print("✓ Automatic resolution detects org-specific implementations when enabled")
    print("✓ Fallback to base connector when org-specific doesn't exist")
    print()
    print("Architecture Benefits:")
    print("  • DRY: Complex logic (API, pagination, retry) lives in one place")
    print("  • Flexible: Orgs can customize only what they need")
    print("  • Safe: Base connector tested once, org overlays are thin customizations")
    print("  • Scalable: New orgs can use base or create custom overlays")
    print()

#!/usr/bin/env python3
"""
Create example entity updates for testing diff display in UI.

This script:
1. Creates entities in the first run
2. Updates some of them in a second run (generating field diffs)
3. Leaves some unchanged (no change events)

Run from backend directory:
    python scripts/create_update_examples.py
"""

import sys
import os

# Add the app directory to the path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import datetime, timezone
from uuid import uuid4

from app.database import get_session
from app.models import Organization, Run, Dataset
from app.services.canonical_store import batch_upsert_entities

def create_update_examples():
    """Create entity updates with various diff scenarios."""

    with get_session() as session:
        # Find a suitable organization (use demo org or first active)
        org = session.query(Organization).filter(
            Organization.status == "active"
        ).first()

        if not org:
            print("No active organization found")
            return

        print(f"Using organization: {org.name} ({org.organization_id})")

        # Find or create a dataset
        dataset = session.query(Dataset).filter(
            Dataset.organization_id == org.organization_id
        ).first()

        if not dataset:
            dataset = Dataset(
                organization_id=org.organization_id,
                name="Test Update Examples",
                key="test_updates",
                source_type="artwork",
            )
            session.add(dataset)
            session.flush()
            print(f"Created dataset: {dataset.name}")
        else:
            print(f"Using dataset: {dataset.name}")

        # Create first run - initial entity creation
        run1 = Run(
            organization_id=org.organization_id,
            dataset_id=dataset.dataset_id,
            status="running",
            triggered_by="manual",
            parameters={},
            processed_count=0,
            created_count=0,
            updated_count=0,
            skipped_count=0,
            failed_count=0,
        )
        session.add(run1)
        session.flush()
        print(f"Created Run 1: {run1.run_id}")

        # Helper to create canonical payload
        def make_canonical(id, label, description, properties):
            """Create a canonical-format payload."""
            return {
                "id": id,
                "type": "Object",
                "label": label,
                "description": description,
                "properties": properties,
            }

        # Initial entities (using canonical format for proper hash detection)
        initial_records = [
            {
                "entity_key": "test_updates:artwork_001",
                "source_system": "test_updates",
                "source_id": "artwork_001",
                "title": "Starry Night",
                "object_number": "1889.001",
                "canonical_url": "https://example.com/artwork/001",
                "thumbnail_url": "https://example.com/thumb/001.jpg",
                "payload": make_canonical(
                    id="artwork_001",
                    label="Starry Night",
                    description="A painting by Vincent van Gogh",
                    properties={
                        "artist": "Vincent van Gogh",
                        "year": 1889,
                        "medium": "Oil on canvas",
                        "dimensions": "73.7 cm x 92.1 cm",
                        "department": "Post-Impressionism",
                    },
                ),
            },
            {
                "entity_key": "test_updates:artwork_002",
                "source_system": "test_updates",
                "source_id": "artwork_002",
                "title": "The Persistence of Memory",
                "object_number": "1931.002",
                "canonical_url": "https://example.com/artwork/002",
                "thumbnail_url": "https://example.com/thumb/002.jpg",
                "payload": make_canonical(
                    id="artwork_002",
                    label="The Persistence of Memory",
                    description="A surrealist painting by Salvador Dali",
                    properties={
                        "artist": "Salvador Dali",
                        "year": 1931,
                        "medium": "Oil on canvas",
                        "dimensions": "24 cm x 33 cm",
                        "department": "Surrealism",
                    },
                ),
            },
            {
                "entity_key": "test_updates:artwork_003",
                "source_system": "test_updates",
                "source_id": "artwork_003",
                "title": "Water Lilies",
                "object_number": "1906.003",
                "canonical_url": "https://example.com/artwork/003",
                "thumbnail_url": "https://example.com/thumb/003.jpg",
                "payload": make_canonical(
                    id="artwork_003",
                    label="Water Lilies",
                    description="An impressionist painting by Claude Monet",
                    properties={
                        "artist": "Claude Monet",
                        "year": 1906,
                        "medium": "Oil on canvas",
                        "dimensions": "89 cm x 93 cm",
                        "department": "Impressionism",
                    },
                ),
            },
            {
                "entity_key": "test_updates:artwork_004",
                "source_system": "test_updates",
                "source_id": "artwork_004",
                "title": "The Great Wave",
                "object_number": "1831.004",
                "payload": make_canonical(
                    id="artwork_004",
                    label="The Great Wave",
                    description="A woodblock print by Katsushika Hokusai",
                    properties={
                        "artist": "Katsushika Hokusai",
                        "year": 1831,
                        "medium": "Woodblock print",
                        "dimensions": "25.7 cm x 37.9 cm",
                        "department": "Asian Art",
                    },
                ),
            },
        ]

        counts1 = batch_upsert_entities(
            session=session,
            organization_id=org.organization_id,
            run_id=run1.run_id,
            pipeline_id=None,
            canonical_records=initial_records,
            dataset_id=dataset.dataset_id,
        )

        run1.status = "success"
        run1.created_count = counts1["created"]
        run1.updated_count = counts1["updated"]
        run1.skipped_count = counts1["noop"]
        run1.processed_count = counts1["created"] + counts1["updated"] + counts1["noop"]
        run1.finished_at = datetime.now(timezone.utc)

        session.commit()
        print(f"Run 1 complete: {counts1}")

        # Create second run - updates
        run2 = Run(
            organization_id=org.organization_id,
            dataset_id=dataset.dataset_id,
            status="running",
            triggered_by="manual",
            parameters={},
            processed_count=0,
            created_count=0,
            updated_count=0,
            skipped_count=0,
            failed_count=0,
        )
        session.add(run2)
        session.flush()
        print(f"Created Run 2: {run2.run_id}")

        # Updated entities - various changes (using canonical format)
        updated_records = [
            # artwork_001: Label change + new property
            {
                "entity_key": "test_updates:artwork_001",
                "source_system": "test_updates",
                "source_id": "artwork_001",
                "title": "The Starry Night",  # Added "The"
                "object_number": "1889.001",
                "canonical_url": "https://example.com/artwork/001",
                "thumbnail_url": "https://example.com/thumb/001-hires.jpg",  # Updated
                "payload": make_canonical(
                    id="artwork_001",
                    label="The Starry Night",  # Changed from "Starry Night"
                    description="A famous painting by Vincent van Gogh depicting a swirling night sky",  # Updated
                    properties={
                        "artist": "Vincent van Gogh",
                        "year": 1889,
                        "medium": "Oil on canvas",
                        "dimensions": "73.7 cm x 92.1 cm",
                        "department": "Post-Impressionism",
                        "provenance": "MoMA, New York",  # New property
                    },
                ),
            },
            # artwork_002: Multiple field changes
            {
                "entity_key": "test_updates:artwork_002",
                "source_system": "test_updates",
                "source_id": "artwork_002",
                "title": "The Persistence of Memory (Melting Clocks)",
                "object_number": "MoMA.1931.002",
                "canonical_url": "https://moma.org/artwork/002",
                "thumbnail_url": "https://example.com/thumb/002.jpg",
                "payload": make_canonical(
                    id="artwork_002",
                    label="The Persistence of Memory (Melting Clocks)",  # Extended
                    description="Salvador Dali's iconic surrealist masterpiece featuring melting clocks",  # Updated
                    properties={
                        "artist": "Salvador Dali",
                        "year": 1931,
                        "medium": "Oil on canvas",
                        "dimensions": "24.1 cm x 33 cm",  # Slight dimension change
                        "department": "Surrealism",
                        "location": "Gallery 517",  # New property
                    },
                ),
            },
            # artwork_003: No changes (should be noop)
            {
                "entity_key": "test_updates:artwork_003",
                "source_system": "test_updates",
                "source_id": "artwork_003",
                "title": "Water Lilies",
                "object_number": "1906.003",
                "canonical_url": "https://example.com/artwork/003",
                "thumbnail_url": "https://example.com/thumb/003.jpg",
                "payload": make_canonical(
                    id="artwork_003",
                    label="Water Lilies",
                    description="An impressionist painting by Claude Monet",  # Same
                    properties={
                        "artist": "Claude Monet",
                        "year": 1906,
                        "medium": "Oil on canvas",
                        "dimensions": "89 cm x 93 cm",
                        "department": "Impressionism",
                    },
                ),
            },
            # artwork_004: Label change + new properties
            {
                "entity_key": "test_updates:artwork_004",
                "source_system": "test_updates",
                "source_id": "artwork_004",
                "title": "The Great Wave off Kanagawa",
                "object_number": "1831.004",
                "canonical_url": "https://example.com/artwork/004",
                "thumbnail_url": "https://example.com/thumb/004.jpg",
                "payload": make_canonical(
                    id="artwork_004",
                    label="The Great Wave off Kanagawa",  # Full name
                    description="Hokusai's iconic ukiyo-e woodblock print from the Thirty-six Views series",  # Updated
                    properties={
                        "artist": "Katsushika Hokusai",
                        "year": 1831,
                        "medium": "Woodblock print (nishiki-e)",  # More specific
                        "dimensions": "25.7 cm x 37.9 cm",
                        "department": "Asian Art",
                        "series": "Thirty-six Views of Mount Fuji",  # New property
                    },
                ),
            },
            # artwork_005: New entity
            {
                "entity_key": "test_updates:artwork_005",
                "source_system": "test_updates",
                "source_id": "artwork_005",
                "title": "Girl with a Pearl Earring",
                "object_number": "1665.005",
                "canonical_url": "https://example.com/artwork/005",
                "thumbnail_url": "https://example.com/thumb/005.jpg",
                "payload": make_canonical(
                    id="artwork_005",
                    label="Girl with a Pearl Earring",
                    description="A famous portrait by Johannes Vermeer",
                    properties={
                        "artist": "Johannes Vermeer",
                        "year": 1665,
                        "medium": "Oil on canvas",
                        "dimensions": "44.5 cm x 39 cm",
                        "department": "Dutch Golden Age",
                    },
                ),
            },
        ]

        counts2 = batch_upsert_entities(
            session=session,
            organization_id=org.organization_id,
            run_id=run2.run_id,
            pipeline_id=None,
            canonical_records=updated_records,
            dataset_id=dataset.dataset_id,
        )

        run2.status = "success"
        run2.created_count = counts2["created"]
        run2.updated_count = counts2["updated"]
        run2.skipped_count = counts2["noop"]
        run2.processed_count = counts2["created"] + counts2["updated"] + counts2["noop"]
        run2.finished_at = datetime.now(timezone.utc)

        session.commit()
        print(f"Run 2 complete: {counts2}")

        print("\n=== Summary ===")
        print(f"Organization: {org.name}")
        print(f"Dataset: {dataset.name} ({dataset.dataset_id})")
        print(f"Run 1 (initial): {run1.run_id}")
        print(f"Run 2 (updates): {run2.run_id}")
        print(f"\nExpected results:")
        print(f"  - artwork_001: UPDATED (title, thumbnail_url)")
        print(f"  - artwork_002: UPDATED (title, object_number, canonical_url)")
        print(f"  - artwork_003: NOOP (no changes)")
        print(f"  - artwork_004: UPDATED (title, canonical_url, thumbnail_url)")
        print(f"  - artwork_005: CREATED (new entity)")
        print(f"\nView in UI:")
        print(f"  - Run History: /organizations/{org.organization_id}/runs")
        print(f"  - Run 2 Detail: /organizations/{org.organization_id}/runs/{run2.run_id}")


if __name__ == "__main__":
    create_update_examples()

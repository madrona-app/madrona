#!/usr/bin/env python3
"""
Generate JSON Schema for a dataset.

Analyzes existing entity payloads to infer schema structure and stores
the result in datasets.schema column.

Usage:
    python scripts/generate_dataset_schema.py <dataset_id>
    python scripts/generate_dataset_schema.py d9111f38-60ac-427d-ad50-227931345377
"""

import sys
import json
from uuid import UUID
from collections import Counter
from typing import Any

from app import create_app, db
from app.models import Dataset, EntityCurrent


def infer_type(value: Any) -> str:
    """Infer JSON Schema type from a Python value."""
    if value is None:
        return "null"
    elif isinstance(value, bool):
        return "boolean"
    elif isinstance(value, int):
        return "integer"
    elif isinstance(value, float):
        return "number"
    elif isinstance(value, str):
        return "string"
    elif isinstance(value, list):
        return "array"
    elif isinstance(value, dict):
        return "object"
    else:
        return "string"


def analyze_payloads(payloads: list[dict]) -> dict:
    """
    Analyze a collection of entity payloads to infer schema.

    Returns a JSON Schema draft with properties inferred from the data.
    """
    if not payloads:
        return {
            "type": "object",
            "properties": {},
            "additionalProperties": True
        }

    # Collect all keys and their types across all payloads
    field_types = {}
    field_examples = {}

    for payload in payloads:
        for key, value in payload.items():
            if key not in field_types:
                field_types[key] = Counter()
                field_examples[key] = []

            field_types[key][infer_type(value)] += 1
            if len(field_examples[key]) < 3 and value is not None:
                field_examples[key].append(value)

    # Build schema properties
    properties = {}
    for field, type_counts in field_types.items():
        # Get most common type
        most_common_type = type_counts.most_common(1)[0][0]

        # Check if field appears in all payloads (required)
        appears_in = sum(type_counts.values())
        total_payloads = len(payloads)

        properties[field] = {
            "type": most_common_type,
            "description": f"Appears in {appears_in}/{total_payloads} entities"
        }

        # Add example if available
        if field_examples.get(field):
            properties[field]["examples"] = field_examples[field][:3]

    return {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": properties,
        "additionalProperties": True
    }


def generate_schema(dataset_id: str):
    """Generate schema for a dataset."""
    app = create_app()

    with app.app_context():
        # Validate dataset exists
        try:
            dataset_uuid = UUID(dataset_id)
        except ValueError:
            print(f"Error: Invalid dataset ID format: {dataset_id}")
            return 1

        dataset = db.session.query(Dataset).filter_by(dataset_id=dataset_uuid).first()
        if not dataset:
            print(f"Error: Dataset not found: {dataset_id}")
            return 1

        print(f"Analyzing dataset: {dataset.name} ({dataset_id})")

        # Sample entities (limit to 100 for performance)
        entities = (
            db.session.query(EntityCurrent)
            .filter_by(dataset_id=dataset_uuid)
            .limit(100)
            .all()
        )

        if not entities:
            print("Error: No entities found for this dataset")
            return 1

        print(f"Analyzing {len(entities)} sample entities...")

        # Extract payloads
        payloads = [entity.payload for entity in entities]

        # Generate schema
        schema = analyze_payloads(payloads)
        print(f"Generated schema with {len(schema['properties'])} fields")

        # Update dataset with schema
        dataset.schema = schema

        # Commit changes
        db.session.commit()

        print("\n✅ Success!")
        print(f"   Schema: {len(schema['properties'])} fields")

        return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python scripts/generate_dataset_schema.py <dataset_id>")
        sys.exit(1)

    dataset_id = sys.argv[1]
    sys.exit(generate_schema(dataset_id))

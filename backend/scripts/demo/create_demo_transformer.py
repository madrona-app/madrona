"""
Manual transformer creator for quick demo (no AI required).

This creates a simple Dublin Core transformer for Smithsonian data
without needing Claude API or Ollama. Useful for immediate testing.
"""
from app.database import get_session
from app.models import Dataset, DatasetTransformer
from datetime import datetime
from uuid import UUID

# Simple Dublin Core transformer for Smithsonian EDAN format
DUBLIN_CORE_TRANSFORMER = '''def transform(payload):
    """Transform Smithsonian EDAN to Dublin Core."""
    content = payload.get("content", {})
    descriptive = content.get("descriptiveNonRepeating", {})
    indexed = content.get("indexedStructured", {})
    freetext = content.get("freetext", {})
    
    # Extract title
    title = None
    if "title" in descriptive and isinstance(descriptive["title"], dict) and "label" in descriptive["title"]:
        title = descriptive["title"]["label"]
    elif "title" in freetext and freetext["title"]:
        first_title = freetext["title"][0]
        if isinstance(first_title, dict):
            title = first_title.get("content")
        elif isinstance(first_title, str):
            title = first_title
    
    # Extract creators
    creators = []
    if "name" in indexed:
        for name_entry in indexed["name"]:
            if isinstance(name_entry, dict):
                label = name_entry.get("label", "").lower()
                if any(role in label for role in ["artist", "creator", "maker"]):
                    creators.append(name_entry.get("content"))
            elif isinstance(name_entry, str):
                creators.append(name_entry)
    
    # Extract subjects
    subjects = []
    if "topic" in indexed:
        for t in indexed["topic"]:
            if isinstance(t, dict) and t.get("content"):
                subjects.append(t.get("content"))
            elif isinstance(t, str):
                subjects.append(t)
    
    # Extract description
    descriptions = []
    for key in ["notes", "description", "physicalDescription"]:
        if key in freetext:
            for entry in freetext[key]:
                if isinstance(entry, dict) and entry.get("content"):
                    descriptions.append(entry["content"])
                elif isinstance(entry, str):
                    descriptions.append(entry)
    description = " ".join(descriptions) if descriptions else None
    
    # Extract dates
    dates = []
    if "date" in indexed:
        for d in indexed["date"]:
            if isinstance(d, dict) and d.get("content"):
                dates.append(d.get("content"))
            elif isinstance(d, str):
                dates.append(d)
    
    # Extract identifiers
    identifiers = []
    if "record_ID" in descriptive:
        identifiers.append(f"Smithsonian ID: {descriptive['record_ID']}")
    if "record_link" in descriptive:
        identifiers.append(f"URL: {descriptive['record_link']}")
    
    # Extract rights
    rights = "Contact Institution for Rights Information"
    if "creditLine" in freetext and freetext["creditLine"]:
        first_credit = freetext["creditLine"][0]
        if isinstance(first_credit, dict):
            rights = first_credit.get("content", rights)
        elif isinstance(first_credit, str):
            rights = first_credit
    
    return {
        "title": title,
        "creator": creators,
        "subject": subjects,
        "description": description,
        "publisher": "Smithsonian Institution",
        "contributor": [],
        "date": dates,
        "type": ["PhysicalObject"],
        "format": None,
        "identifier": identifiers,
        "source": descriptive.get("data_source"),
        "language": [],
        "relation": [],
        "coverage": [],
        "rights": rights
    }
'''

with get_session() as session:
    # Find demo dataset with entities (the correct one!)
    dataset = session.query(Dataset).filter_by(
        dataset_id=UUID('d9111f38-60ac-427d-ad50-227931345377')
    ).first()
    
    if not dataset:
        print("✗ Demo dataset not found")
        exit(1)
    
    print(f"Found dataset: {dataset.name}")
    print(f"Dataset ID: {dataset.dataset_id}")
    
    # Check if transformer already exists
    existing = session.query(DatasetTransformer).filter_by(
        dataset_id=dataset.dataset_id,
        target_format='dublin-core',
        status='active'
    ).first()
    
    if existing:
        print(f"\n✓ Active Dublin Core transformer already exists")
        print(f"  Transformer ID: {existing.transformer_id}")
        print(f"  Generated: {existing.generated_at}")
    else:
        # Create transformer
        transformer = DatasetTransformer(
            dataset_id=dataset.dataset_id,
            organization_id=dataset.organization_id,
            target_format='dublin-core',
            transformer_code=DUBLIN_CORE_TRANSFORMER,
            status='active',  # Create as active
            ai_provider='manual',
            sample_count=0,
            activated_at=datetime.utcnow()
        )
        
        session.add(transformer)
        session.commit()
        
        print(f"\n✓ Created and activated Dublin Core transformer")
        print(f"  Transformer ID: {transformer.transformer_id}")
        print(f"  Code length: {len(transformer.transformer_code)} characters")
    
    print(f"\nNow you can:")
    print(f"  1. Visit http://localhost:5173/organizations/{dataset.organization_id}/datasets/{dataset.dataset_id}")
    print(f"  2. See the blue 'AI-Generated Transformers Active' banner")
    print(f"  3. Click 'Export All' and select 'Dublin Core' format")
    print(f"  4. Download transformed data in Dublin Core format!")

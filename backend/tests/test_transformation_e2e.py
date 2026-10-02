"""
End-to-end test of AI-powered transformation system.

This demonstrates the complete workflow:
1. Generate Dublin Core transformer from Smithsonian sample data
2. Activate the transformer
3. Export data with transformation applied
4. Verify the transformed output
"""
import requests
import json
import os

BASE_URL = "http://localhost:8000/api"
AUTH_HEADER = {"Authorization": "Bearer demo-admin-token"}

# Set this to your Anthropic API key to test with Claude
# Otherwise it will try Ollama (which needs to be running)
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")

def main():
    print("=" * 70)
    print("AI-POWERED TRANSFORMATION SYSTEM - END-TO-END TEST")
    print("=" * 70)
    
    # Get demo dataset
    print("\n1. Finding demo dataset...")
    response = requests.get(f"{BASE_URL}/datasets", headers=AUTH_HEADER)
    datasets = response.json().get("datasets", [])
    demo_dataset = next((d for d in datasets if d["key"] == "demo_objects"), None)
    
    if not demo_dataset:
        print("✗ Demo dataset not found")
        return
    
    dataset_id = demo_dataset["dataset_id"]
    print(f"✓ Found dataset: {demo_dataset['name']}")
    print(f"  Dataset ID: {dataset_id}")
    print(f"  Source type: {demo_dataset.get('source_type', 'unknown')}")
    
    # Check if API key is configured
    if ANTHROPIC_API_KEY:
        print(f"\n  Using Claude API (key: {ANTHROPIC_API_KEY[:8]}...)")
    else:
        print("\n  No ANTHROPIC_API_KEY - will try Ollama fallback")
        print("  (Install Ollama from https://ollama.ai if not running)")
    
    # Generate transformer
    print("\n2. Generating Dublin Core transformer...")
    response = requests.post(
        f"{BASE_URL}/datasets/{dataset_id}/transformers/generate",
        headers=AUTH_HEADER,
        json={"target_format": "dublin-core", "sample_count": 3}
    )
    
    if response.status_code != 201:
        error_msg = response.json().get("error", "Unknown error")
        print(f"✗ Failed to generate transformer: {error_msg}")
        if "Ollama" in error_msg and not ANTHROPIC_API_KEY:
            print("\n  To fix: Set ANTHROPIC_API_KEY environment variable")
            print("  export ANTHROPIC_API_KEY='your-key-here'")
        return
    
    result = response.json()
    transformer_id = result['transformer_id']
    print(f"✓ Transformer generated successfully!")
    print(f"  Transformer ID: {transformer_id}")
    print(f"  AI Provider: {result['ai_provider']}")
    print(f"  Code length: {result['code_length']} characters")
    print(f"  Status: {result['status']}")
    print(f"  Sample count: {result['sample_count']} entities")
    
    # Activate transformer
    print("\n3. Activating transformer...")
    response = requests.post(
        f"{BASE_URL}/datasets/transformers/{transformer_id}/activate",
        headers=AUTH_HEADER
    )
    
    if response.status_code != 200:
        print(f"✗ Failed to activate: {response.json()}")
        return
    
    print(f"✓ Transformer activated!")
    
    # Test export with transformation
    print("\n4. Testing export with Dublin Core transformation...")
    response = requests.get(
        f"{BASE_URL}/entities-current/export",
        headers=AUTH_HEADER,
        params={
            "organization_id": demo_dataset["organization_id"],
            "dataset_id": dataset_id,
            "format": "dublin-core"
        }
    )
    
    if response.status_code != 200:
        print(f"✗ Export failed: {response.status_code}")
        print(f"  Error: {response.text}")
        return
    
    # Parse JSONL response
    lines = response.text.strip().split('\n')
    print(f"✓ Export successful!")
    print(f"  Exported {len(lines)} transformed records")
    
    # Show first transformed record
    if lines:
        first_record = json.loads(lines[0])
        print(f"\n5. Sample transformed record (Dublin Core format):")
        print("=" * 70)
        print(json.dumps(first_record, indent=2))
        print("=" * 70)
        
        # Verify Dublin Core elements
        dc_elements = [
            'title', 'creator', 'subject', 'description', 'publisher',
            'contributor', 'date', 'type', 'format', 'identifier',
            'source', 'language', 'relation', 'coverage', 'rights'
        ]
        present_elements = [e for e in dc_elements if e in first_record and first_record[e]]
        print(f"\n✓ Dublin Core elements present: {len(present_elements)}/15")
        for element in present_elements:
            value = first_record[element]
            if isinstance(value, list):
                print(f"  - {element}: {len(value)} value(s)")
            elif isinstance(value, str) and len(value) > 60:
                print(f"  - {element}: {value[:60]}...")
            else:
                print(f"  - {element}: {value}")
    
    print("\n" + "=" * 70)
    print("SUCCESS! AI transformation system working end-to-end")
    print("=" * 70)
    print("\nNext steps:")
    print("  1. Visit http://localhost:5173 to see transformers in UI")
    print("  2. Try exporting with different formats (lido, schema-org)")
    print("  3. Generate transformers for other datasets")

if __name__ == "__main__":
    main()

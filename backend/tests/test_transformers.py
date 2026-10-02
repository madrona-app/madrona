"""
Test script for AI-generated transformer system.

This demonstrates:
1. Generating transformer code from sample data using AI
2. Viewing the generated code
3. Activating the transformer
4. Listing all transformers

Without API keys configured, will show helpful error messages about Ollama.
"""
import requests
import json

BASE_URL = "http://localhost:5001/api"
AUTH_HEADER = {"Authorization": "Bearer demo-admin-token"}

def main():
    # Get demo dataset ID
    response = requests.get(f"{BASE_URL}/datasets", headers=AUTH_HEADER)
    datasets = response.json().get("datasets", [])
    
    demo_dataset = next((d for d in datasets if d["key"] == "demo_objects"), None)
    
    if not demo_dataset:
        print("Demo dataset not found")
        return
    
    dataset_id = demo_dataset["dataset_id"]
    print(f"Testing with dataset: {demo_dataset['name']}")
    print(f"Dataset ID: {dataset_id}\n")
    
    # Generate Dublin Core transformer
    print("=" * 60)
    print("1. Generating Dublin Core transformer...")
    print("=" * 60)
    
    response = requests.post(
        f"{BASE_URL}/datasets/{dataset_id}/transformers/generate",
        headers=AUTH_HEADER,
        json={"target_format": "dublin-core", "sample_count": 3}
    )
    
    if response.status_code == 201:
        result = response.json()
        print("✓ Transformer generated successfully!")
        print(f"  Transformer ID: {result['transformer_id']}")
        print(f"  AI Provider: {result['ai_provider']}")
        print(f"  Code length: {result['code_length']} characters")
        print(f"  Status: {result['status']}")
        
        transformer_id = result['transformer_id']
        
        # View the code
        print("\n" + "=" * 60)
        print("2. Viewing generated transformer code...")
        print("=" * 60)
        
        response = requests.get(
            f"{BASE_URL}/datasets/{dataset_id}/transformers/dublin-core",
            headers=AUTH_HEADER
        )
        
        if response.status_code == 404:
            # Not activated yet, get from list
            response = requests.get(
                f"{BASE_URL}/datasets/{dataset_id}/transformers",
                headers=AUTH_HEADER
            )
            transformers = response.json().get("transformers", [])
            if transformers:
                print(f"Found {len(transformers)} transformer(s)")
                for t in transformers:
                    print(f"  - {t['target_format']}: {t['status']} ({t['ai_provider']})")
        
        # Activate transformer
        print("\n" + "=" * 60)
        print("3. Activating transformer...")
        print("=" * 60)
        
        response = requests.post(
            f"{BASE_URL}/datasets/transformers/{transformer_id}/activate",
            headers=AUTH_HEADER
        )
        
        if response.status_code == 200:
            print("✓ Transformer activated!")
            result = response.json()
            print(f"  Status: {result['status']}")
            print(f"  Activated at: {result['activated_at']}")
        else:
            print(f"✗ Failed to activate: {response.json()}")
        
    else:
        print(f"✗ Failed to generate transformer")
        error_msg = response.json().get("error", "Unknown error")
        print(f"  Error: {error_msg}")
        print(f"\nThis is expected if no AI provider is configured.")
        print(f"To fix:")
        print(f"  1. Add ANTHROPIC_API_KEY to backend/.env (recommended)")
        print(f"  2. OR install and run Ollama: https://ollama.ai")

if __name__ == "__main__":
    main()

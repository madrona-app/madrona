from app.database import get_session
from app.models import ConnectorInstance, ConnectorDefinition

with get_session() as session:
    # Get all connector definitions
    definitions = session.query(ConnectorDefinition).all()
    print(f"\nAvailable connector definitions ({len(definitions)}):")
    for d in definitions:
        print(f"  - {d.display_name} ({d.key}) - {d.direction}")
    
    # Get all connector instances
    instances = session.query(ConnectorInstance).all()
    print(f"\nTotal connector instances: {len(instances)}")
    
    if len(definitions) < 3:
        print("\n⚠️  Need at least 3 different connector definitions for variety")
        exit(0)
    
    # Distribute instances across all available definitions
    # This will give each instance a different definition type for testing
    updated_count = 0
    for i, instance in enumerate(instances):
        # Cycle through definitions
        target_def = definitions[i % len(definitions)]
        
        if instance.connector_definition_id != target_def.connector_definition_id:
            print(f"  Updating '{instance.name}' -> {target_def.display_name}")
            instance.connector_definition_id = target_def.connector_definition_id
            
            # Update config based on definition type
            if 'sheet' in target_def.key.lower():
                instance.config = {
                    "service_account_json": instance.config.get("service_account_json", "{}"),
                    "spreadsheet_id": instance.config.get("spreadsheet_id", "")
                }
            elif 'smithsonian' in target_def.key.lower():
                instance.config = {
                    "api_key": instance.config.get("api_key", "DEMO-KEY"),
                    "rows_per_page": instance.config.get("rows_per_page", 100)
                }
            else:
                # Keep existing config for other types
                pass
            
            updated_count += 1
    
    if updated_count > 0:
        session.commit()
        print(f"\n✅ Updated {updated_count} connector instance(s)!")
    else:
        print("\n✅ No updates needed")
    
    # Show final distribution
    print(f"\nFinal connector distribution:")
    def_counts = {}
    for instance in session.query(ConnectorInstance).all():
        definition = session.query(ConnectorDefinition).filter_by(
            connector_definition_id=instance.connector_definition_id
        ).first()
        def_name = definition.display_name if definition else 'Unknown'
        if def_name not in def_counts:
            def_counts[def_name] = []
        def_counts[def_name].append(instance.name)
    
    for def_name, instance_names in def_counts.items():
        print(f"\n{def_name} ({len(instance_names)} instances):")
        for name in instance_names[:3]:  # Show first 3
            print(f"  - {name}")
        if len(instance_names) > 3:
            print(f"  ... and {len(instance_names) - 3} more")


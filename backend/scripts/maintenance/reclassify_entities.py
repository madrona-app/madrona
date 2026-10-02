"""
Batch re-classify entity types using AI.

This script re-analyzes existing entities and updates their entity_type field.
Useful for:
- Applying entity type detection to entities ingested without AI
- Re-classifying entities with a better AI model
- Fixing misclassifications
"""

import argparse
import logging
import sys
from datetime import datetime, timezone
from uuid import UUID

from app.database import get_session
from app.models import EntityCurrent, Dataset
from app.services.ai_service import get_ai_service
from sqlalchemy import func

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)


def reclassify_entities(
    dataset_id: UUID | None = None,
    source_system: str | None = None,
    limit: int | None = None,
    dry_run: bool = False
):
    """
    Re-classify entities using AI entity type detection.
    
    Args:
        dataset_id: Only re-classify entities in this dataset (optional)
        source_system: Only re-classify entities from this source (optional)
        limit: Maximum number of entities to process (optional)
        dry_run: If True, don't commit changes to database
    """
    with get_session() as session:
        # Build query
        query = session.query(EntityCurrent)
        
        if dataset_id:
            query = query.filter(EntityCurrent.dataset_id == dataset_id)
        
        if source_system:
            query = query.filter(EntityCurrent.source_system == source_system)
        
        if limit:
            query = query.limit(limit)
        
        entities = query.all()
        total = len(entities)
        
        logger.info(f"Found {total} entities to re-classify")
        
        if total == 0:
            logger.info("No entities to process")
            return
        
        # Initialize AI service
        try:
            ai_service = get_ai_service()
        except Exception as e:
            logger.error(f"Failed to initialize AI service: {e}")
            logger.error("Make sure ANTHROPIC_API_KEY or OLLAMA_BASE_URL is configured")
            return
        
        # Track statistics
        updated = 0
        unchanged = 0
        errors = 0
        type_changes = {}
        
        for i, entity in enumerate(entities, 1):
            try:
                old_type = entity.entity_type
                
                # Detect new entity type from payload
                new_type = ai_service.detect_entity_type(
                    entity.payload,
                    source_system=entity.source_system
                )
                
                if new_type != old_type:
                    logger.info(
                        f"[{i}/{total}] {entity.entity_key}: {old_type} → {new_type}"
                    )
                    
                    if not dry_run:
                        entity.entity_type = new_type
                        entity.updated_at = datetime.now(timezone.utc)
                    
                    # Track type changes
                    change_key = f"{old_type} → {new_type}"
                    type_changes[change_key] = type_changes.get(change_key, 0) + 1
                    updated += 1
                else:
                    logger.debug(f"[{i}/{total}] {entity.entity_key}: unchanged ({old_type})")
                    unchanged += 1
                
                # Commit every 100 entities
                if not dry_run and i % 100 == 0:
                    session.commit()
                    logger.info(f"Committed batch at {i}/{total}")
                
            except Exception as e:
                logger.error(f"[{i}/{total}] Failed to re-classify {entity.entity_key}: {e}")
                errors += 1
        
        # Final commit
        if not dry_run and updated > 0:
            session.commit()
            logger.info("Final commit completed")
        
        # Print summary
        logger.info("\n" + "="*60)
        logger.info("Re-classification Summary")
        logger.info("="*60)
        logger.info(f"Total processed: {total}")
        logger.info(f"Updated: {updated}")
        logger.info(f"Unchanged: {unchanged}")
        logger.info(f"Errors: {errors}")
        
        if type_changes:
            logger.info("\nType changes:")
            for change, count in sorted(type_changes.items(), key=lambda x: -x[1]):
                logger.info(f"  {change}: {count}")
        
        if dry_run:
            logger.info("\n⚠️  DRY RUN - No changes were saved to database")
        else:
            logger.info("\n✅ Changes committed to database")


def main():
    parser = argparse.ArgumentParser(
        description="Re-classify entity types using AI"
    )
    parser.add_argument(
        '--dataset-id',
        type=str,
        help='Only process entities in this dataset (UUID)'
    )
    parser.add_argument(
        '--source-system',
        type=str,
        help='Only process entities from this source system (e.g., "smithsonian")'
    )
    parser.add_argument(
        '--limit',
        type=int,
        help='Maximum number of entities to process'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Preview changes without committing to database'
    )
    
    args = parser.parse_args()
    
    # Convert dataset_id to UUID if provided
    dataset_id = None
    if args.dataset_id:
        try:
            dataset_id = UUID(args.dataset_id)
        except ValueError:
            logger.error(f"Invalid dataset_id UUID: {args.dataset_id}")
            sys.exit(1)
    
    reclassify_entities(
        dataset_id=dataset_id,
        source_system=args.source_system,
        limit=args.limit,
        dry_run=args.dry_run
    )


if __name__ == '__main__':
    main()

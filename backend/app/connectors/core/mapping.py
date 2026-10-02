"""
Mapping utilities for connectors.

Common patterns for transforming source data to canonical format.
"""

from typing import Any, Optional, Callable
import logging


logger = logging.getLogger(__name__)


def safe_get(data: dict, *keys: str, default: Any = None) -> Any:
    """
    Safely get nested dictionary values.
    
    Args:
        data: Source dictionary
        *keys: Sequence of keys to traverse
        default: Default value if key path doesn't exist
    
    Returns:
        Value at key path or default
    
    Example:
        safe_get(data, 'user', 'profile', 'name', default='Unknown')
    """
    current = data
    for key in keys:
        if not isinstance(current, dict):
            return default
        current = current.get(key)
        if current is None:
            return default
    return current


def map_fields(
    source: dict[str, Any],
    field_map: dict[str, str | Callable[[dict], Any]],
) -> dict[str, Any]:
    """
    Map source fields to target fields.
    
    Args:
        source: Source dictionary
        field_map: Mapping of target_key -> source_key or transform function
    
    Returns:
        Mapped dictionary
    
    Example:
        map_fields(
            source={'first': 'John', 'last': 'Doe'},
            field_map={
                'name': lambda s: f"{s['first']} {s['last']}",
                'email': 'email_address',
            }
        )
    """
    result = {}
    for target_key, mapping in field_map.items():
        if callable(mapping):
            # Use transform function
            try:
                result[target_key] = mapping(source)
            except Exception as e:
                logger.warning(f"Error mapping field {target_key}: {e}")
                result[target_key] = None
        elif isinstance(mapping, str):
            # Direct field mapping
            result[target_key] = source.get(mapping)
        else:
            logger.warning(f"Invalid mapping for {target_key}: {mapping}")
            result[target_key] = None
    
    return result


def flatten_dict(
    data: dict[str, Any],
    parent_key: str = '',
    sep: str = '.',
) -> dict[str, Any]:
    """
    Flatten nested dictionary.
    
    Args:
        data: Source dictionary
        parent_key: Prefix for keys
        sep: Separator between nested keys
    
    Returns:
        Flattened dictionary
    
    Example:
        flatten_dict({'a': {'b': 1, 'c': 2}})
        # Returns: {'a.b': 1, 'a.c': 2}
    """
    items = []
    for key, value in data.items():
        new_key = f"{parent_key}{sep}{key}" if parent_key else key
        if isinstance(value, dict):
            items.extend(flatten_dict(value, new_key, sep).items())
        else:
            items.append((new_key, value))
    return dict(items)


def extract_thumbnail(
    source: dict[str, Any],
    thumbnail_keys: list[str],
    size_preference: Optional[list[str]] = None,
) -> Optional[str]:
    """
    Extract thumbnail URL from various possible locations.
    
    Args:
        source: Source record
        thumbnail_keys: List of keys to check for thumbnail
        size_preference: Preferred sizes in order (e.g., ['medium', 'small', 'large'])
    
    Returns:
        Thumbnail URL or None
    """
    for key in thumbnail_keys:
        value = safe_get(source, *key.split('.'))
        if not value:
            continue
        
        # Handle string URL
        if isinstance(value, str):
            return value
        
        # Handle dict with size variants
        if isinstance(value, dict) and size_preference:
            for size in size_preference:
                if url := value.get(size):
                    return url
            # Return first available if no preference match
            return next(iter(value.values()), None)
        
        # Handle list of thumbnails
        if isinstance(value, list) and value:
            first = value[0]
            if isinstance(first, str):
                return first
            if isinstance(first, dict) and 'url' in first:
                return first['url']
    
    return None


def normalize_date(date_value: Any) -> Optional[str]:
    """
    Normalize various date formats to ISO 8601 string.
    
    Args:
        date_value: Date in various formats (string, timestamp, etc.)
    
    Returns:
        ISO 8601 date string or None
    """
    if not date_value:
        return None
    
    # Already a string, return as-is
    if isinstance(date_value, str):
        return date_value
    
    # Handle timestamp (seconds or milliseconds)
    if isinstance(date_value, (int, float)):
        from datetime import datetime
        # Assume milliseconds if > 1e10
        if date_value > 1e10:
            date_value = date_value / 1000
        return datetime.fromtimestamp(date_value).isoformat()
    
    # Handle datetime object
    if hasattr(date_value, 'isoformat'):
        return date_value.isoformat()
    
    logger.warning(f"Cannot normalize date value: {date_value}")
    return None

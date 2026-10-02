"""
Dynamic connector loading and instantiation.

Loads connector classes from connector_definitions.implementation_key using importlib.
Validates connector configuration against JSON schema before instantiation.

Per DB Schema v1.1, implementation_key format is: "package.module:ClassName"
Example: "app.connectors.core.smithsonian_base:SmithsonianBaseConnector"

SCHEMA SOURCE (v1 design decision):
Config schemas are stored in connector_definitions.config_schema (JSONB in database).
This enables:
- UI-driven connector configuration forms (dynamic from schema)
- Centralized schema management without code deployments
- Admin can update schemas via API without connector code changes

Connector classes do NOT define their own schemas. The schema is data-driven,
fetched from the database, and passed to create_connector().

VALIDATION POLICY (validate-on-run):
When schemas change in connector_definitions:
- Existing connector_instances are NOT automatically revalidated
- Validation happens at run time when connector is instantiated
- If config is invalid under current schema, connector creation fails fast
- Error message clearly states: "Connector config is invalid under the current schema"
- This ensures bad configs never execute, while allowing schema evolution

DEFAULTS POLICY (v1 approach):
Config defaults are stored in connector_definitions.default_config (JSONB).
For v1, recommended approach:
- Merge defaults → config at connector_instance creation time
- Store merged config in connector_instances.config
- Validate merged config (no runtime merging needed)
- This gives stable, predictable behavior across runs

SCHEMA VERSIONING (future-proof v1 approach):
- Schema fingerprint (SHA256) is computed and logged for every validation
- Future: store schema_hash_used in connector_instances at creation time
- Future: optionally store schema metadata ($id, x-schema-version) in config_schema JSONB
- This enables debugging "why did this validate yesterday?" scenarios

SECURITY POLICY (Prompt 7 - No Python-in-DB):
Connector code MUST NOT be stored or executed from the database.
- implementation_key must be a module import path (e.g., "app.connectors.core.smithsonian_base:SmithsonianBaseConnector")
- Code is loaded via safe importlib.import_module() - NO exec(), eval(), or compile()
- Inline code, code snippets, or Python source strings in implementation_key are REJECTED
- This ensures all connector code goes through version control, code review, and deployment
- Prevents arbitrary code execution vulnerabilities
"""

import copy
import hashlib
import importlib
import json
import logging
from functools import lru_cache
from typing import Any, Type
from uuid import UUID

import jsonschema
from jsonschema import ValidationError

from .base import BaseConnector

logger = logging.getLogger(__name__)


class ConnectorLoadError(Exception):
    """
    Raised when a connector cannot be loaded or instantiated.
    
    Maps to run status 'failed' with error details in runs.last_error.
    """

    pass


class ConnectorConfigError(Exception):
    """
    Raised when connector configuration is invalid.
    
    Maps to run status 'failed' with validation error details.
    """

    pass


class ConnectorExecutionError(Exception):
    """
    Raised when a connector fails during extract/publish operations.
    
    Maps to run status 'failed' or 'warning' depending on severity.
    """

    pass


@lru_cache(maxsize=256)
def load_connector_class(implementation_key: str) -> Type[BaseConnector]:
    """
    Dynamically import and return a connector class.
    
    Caches loaded classes to avoid repeated importlib lookups (up to 256 unique implementation_keys).
    This makes repeated connector instantiation significantly faster.
    
    SECURITY: implementation_key must be a module import path, NOT inline code.
    This function uses importlib.import_module() which is safe for loading
    pre-existing Python modules. It does NOT use exec(), eval(), or compile().
    
    Args:
        implementation_key: String in format "package.module:ClassName"
                          Examples:
                          - "app.connectors.core.smithsonian_base:SmithsonianBaseConnector"
                          - "app.connectors.orgs.example_museum.smithsonian:SmithsonianConnector"
        
    Returns:
        Connector class (not instantiated)
        
    Raises:
        ConnectorLoadError: If module or class cannot be imported, or class is not a BaseConnector subclass
        
    Example:
        >>> cls = load_connector_class("app.connectors.orgs.example_museum.smithsonian:SmithsonianConnector")
        >>> connector = cls(config={...}, organization_id="uuid")
    """
    if not implementation_key:
        raise ConnectorLoadError(
            "implementation_key cannot be empty"
        )
    
    # SECURITY: Reject implementation_key that looks like inline code (Prompt 7 guardrail)
    # Prevents storing Python code in database and executing it
    inline_code_indicators = [
        "\n",  # Newlines indicate multi-line code
        "def ",  # Function definitions
        "class ",  # Class definitions
        "import ",  # Import statements
        "from ",  # From-import statements
        "lambda ",  # Lambda expressions
        "exec(",  # Direct exec calls
        "eval(",  # Direct eval calls
        "compile(",  # Compile calls
        "__import__",  # Dynamic imports
    ]
    
    for indicator in inline_code_indicators:
        if indicator in implementation_key:
            raise ConnectorLoadError(
                f"Invalid implementation_key: contains '{indicator.strip()}'. "
                f"implementation_key must be a module import path (e.g., 'app.connectors.core.smithsonian_base:SmithsonianBaseConnector'), "
                f"NOT inline Python code. Connector code must be deployed as modules, not stored in database."
            )
    
    if ":" not in implementation_key:
        raise ConnectorLoadError(
            f"Invalid implementation_key format: '{implementation_key}'. "
            f"Expected 'package.module:ClassName'"
        )

    module_path, class_name = implementation_key.rsplit(":", 1)
    
    if not module_path or not class_name:
        raise ConnectorLoadError(
            f"Invalid implementation_key format: '{implementation_key}'. "
            f"Module path and class name cannot be empty"
        )

    try:
        module = importlib.import_module(module_path)
    except ModuleNotFoundError as e:
        raise ConnectorLoadError(
            f"Module not found for implementation_key '{implementation_key}': {e}"
        ) from e
    except ImportError as e:
        raise ConnectorLoadError(
            f"Failed to import module '{module_path}' from implementation_key '{implementation_key}': {e}"
        ) from e

    try:
        connector_class = getattr(module, class_name)
    except AttributeError as e:
        raise ConnectorLoadError(
            f"Class '{class_name}' not found in module '{module_path}' "
            f"(implementation_key: '{implementation_key}'): {e}"
        ) from e
    
    # Validate it's a class
    if not isinstance(connector_class, type):
        raise ConnectorLoadError(
            f"'{class_name}' in module '{module_path}' is not a class "
            f"(implementation_key: '{implementation_key}')"
        )

    # Validate it's a subclass of BaseConnector
    if not issubclass(connector_class, BaseConnector):
        raise ConnectorLoadError(
            f"Class '{class_name}' in module '{module_path}' is not a subclass of BaseConnector "
            f"(implementation_key: '{implementation_key}')"
        )

    logger.debug(f"Successfully loaded connector: {implementation_key}")

    return connector_class


# Alias for the requested function name
load_connector = load_connector_class


def resolve_org_overlay_implementation(
    default_implementation_key: str,
    connector_definition_key: str,
    org_slug: str,
    enable_overlay: bool = False
) -> str:
    """
    Resolve connector implementation with org overlay support.
    
    When org overlay resolution is enabled, attempts to load an org-specific
    implementation first before falling back to the default shared implementation.
    
    Resolution logic:
    1. If overlay disabled, return default_implementation_key
    2. If overlay enabled:
       a. Extract class name from default implementation_key
       b. Construct org-specific path: app.connectors.orgs.<org_slug>.<connector_key>:<ClassName>
       c. Try to load org-specific implementation
       d. If successful, return org-specific path
       e. If failed, return default_implementation_key (fallback)
    
    Args:
        default_implementation_key: Default implementation from connector_definition
        connector_definition_key: Connector definition key (e.g., "smithsonian-openaccess")
        org_slug: Organization slug (normalized, lowercase with underscores)
        enable_overlay: Feature flag to enable org overlay resolution
        
    Returns:
        Resolved implementation_key to use
        
    Example:
        >>> resolve_org_overlay_implementation(
        ...     default_implementation_key="app.connectors.core.smithsonian:SmithsonianConnector",
        ...     connector_definition_key="smithsonian-openaccess",
        ...     org_slug="example_museum",
        ...     enable_overlay=True
        ... )
        # Returns: "app.connectors.orgs.example_museum.smithsonian:SmithsonianConnector"
        # (if org-specific implementation exists)
    """
    if not enable_overlay:
        logger.debug(
            "Org overlay resolution disabled, using default implementation: %s",
            default_implementation_key
        )
        return default_implementation_key
    
    # Extract class name from default implementation_key
    if ":" not in default_implementation_key:
        logger.warning(
            "Invalid implementation_key format (no colon), cannot resolve org overlay: %s",
            default_implementation_key
        )
        return default_implementation_key
    
    _, class_name = default_implementation_key.rsplit(":", 1)
    
    # Normalize connector key for filesystem (remove special chars, use lowercase)
    # Example: "smithsonian-openaccess" -> "smithsonian"
    # Take the first part before hyphen/underscore if it exists
    connector_key_normalized = connector_definition_key.split("-")[0].split("_")[0]
    
    # Normalize org_slug for filesystem (replace hyphens with underscores, lowercase)
    org_key = org_slug.lower().replace("-", "_")
    
    # Construct org-specific implementation path
    org_implementation_key = f"app.connectors.orgs.{org_key}.{connector_key_normalized}:{class_name}"
    
    # Try to load org-specific implementation
    try:
        load_connector_class(org_implementation_key)
        logger.info(
            "✓ Org overlay found for org='%s', connector='%s': using %s",
            org_key,
            connector_definition_key,
            org_implementation_key
        )
        return org_implementation_key
    except ConnectorLoadError as e:
        logger.info(
            "○ No org overlay for org='%s', connector='%s': falling back to default %s (reason: %s)",
            org_key,
            connector_definition_key,
            default_implementation_key,
            str(e)
        )
        return default_implementation_key


def compute_schema_fingerprint(config_schema: dict[str, Any]) -> str:
    """
    Compute a stable SHA256 fingerprint of a JSON schema.
    
    This fingerprint can be used for:
    - Debugging "why did this validate yesterday?" issues
    - Detecting schema changes between runs
    - Future schema versioning and migration tracking
    
    The fingerprint is computed from canonical JSON (sorted keys, no whitespace)
    to ensure stability across serialization boundaries.
    
    Args:
        config_schema: JSON Schema dictionary
        
    Returns:
        SHA256 hex digest (64 characters)
        
    Example:
        >>> schema = {"type": "object", "properties": {"api_key": {"type": "string"}}}
        >>> fingerprint = compute_schema_fingerprint(schema)
        >>> len(fingerprint)
        64
        
    Note:
        Not persisted in v1, but used in logs and future connector_instances.schema_hash_used field.
    """
    canonical_json = json.dumps(config_schema, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(canonical_json.encode('utf-8')).hexdigest()


def validate_connector_config(
    config: dict[str, Any], config_schema: dict[str, Any]
) -> None:
    """
    Validate connector configuration against JSON schema.
    
    Validation behavior (v1):
    - Unknown keys are REJECTED (additionalProperties: false by default)
    - Required fields must be present
    - Type checking is strict
    - No automatic default application (defaults in connector_definitions.default_config)
    
    Args:
        config: Configuration dictionary to validate
        config_schema: JSON Schema to validate against (from connector_definitions.config_schema)
        
    Raises:
        ConnectorConfigError: If configuration is invalid or schema is missing
        
    Example:
        >>> schema = {
        ...     "type": "object",
        ...     "properties": {"api_key": {"type": "string"}},
        ...     "required": ["api_key"],
        ...     "additionalProperties": False
        ... }
        >>> validate_connector_config({"api_key": "abc123"}, schema)
    """
    # Guard: schema must be provided (schema source of truth is DB)
    if not config_schema:
        raise ConnectorConfigError(
            "config_schema is required. Schema must come from connector_definitions.config_schema in database."
        )
    
    # Guard: config must be a dict/object
    # If connector_instances.config is None or a list, schema validation will give confusing errors.
    if not isinstance(config, dict):
        raise ConnectorConfigError(
            f"config must be an object (dict), got {type(config).__name__}"
        )
    
    # IMPORTANT: Deep copy schema to avoid mutating DB record in-place
    # Without this, setting additionalProperties would modify the dict from the database,
    # causing "schemas change themselves" when serialized back later.
    schema = copy.deepcopy(config_schema)
    
    # Guard: Ensure schema is object type (v1 requirement)
    # Only object schemas support additionalProperties.
    # For v1, we enforce that all connector schemas must be objects with properties.
    if schema.get("type") != "object" or "properties" not in schema:
        raise ConnectorConfigError(
            "config_schema must be an object schema with 'properties' field. "
            f"Got type={schema.get('type')}, has properties={('properties' in schema)}"
        )
    
    # Ensure strict validation: reject unknown keys unless explicitly allowed
    if "additionalProperties" not in schema:
        schema["additionalProperties"] = False
    
    try:
        jsonschema.validate(instance=config, schema=schema)
    except ValidationError as e:
        raise ConnectorConfigError(
            f"Connector config is invalid under the current schema. "
            f"Validation error: {e.message}. "
            f"path={list(e.path)} schema_path={list(e.schema_path)}. "
            f"This may indicate the connector_definitions.config_schema was updated after this instance was created."
        ) from e
    except jsonschema.SchemaError as e:
        raise ConnectorConfigError(
            f"Invalid JSON schema: {e.message}"
        ) from e


def create_connector(
    implementation_key: str,
    config: dict[str, Any],
    config_schema: dict[str, Any],
    organization_id: str,
) -> BaseConnector:
    """
    Create and initialize a connector instance with validated configuration.
    
    This is the primary function for instantiating connectors from database records.
    It performs the complete workflow:
    1. Validate config against JSON schema (from connector_definitions.config_schema)
    2. Load connector class from implementation_key
    3. Instantiate connector with validated config
    4. Connector runs its own validate_config() for additional checks
    
    IMPORTANT: Do NOT pull schema from connector class. Schema source of truth is
    connector_definitions.config_schema in the database. This function enforces that
    config_schema must be provided (cannot be None or empty).
    
    Args:
        implementation_key: String in format "package.module:ClassName"
        config: Configuration dictionary (from connector_instances.config)
        config_schema: JSON Schema for validation (from connector_definitions.config_schema) - REQUIRED
        organization_id: Organization identifier
        
    Returns:
        Instantiated and validated connector
        
    Raises:
        ConnectorLoadError: If connector cannot be loaded
        ConnectorConfigError: If configuration is invalid or schema is missing
        
    Example:
        >>> # Typical usage: fetch from DB and create connector
        >>> connector = create_connector(
        ...     implementation_key="app.connectors.core.smithsonian_base:SmithsonianBaseConnector",
        ...     config={"api_key": "abc123", "base_url": "https://api.si.edu"},
        ...     config_schema={"type": "object", "properties": {...}},  # from DB
        ...     organization_id="550e8400-e29b-41d4-a716-446655440000"
        ... )
        >>> for record in connector.extract():
        ...     print(record)
    """
    # Guard: schema must be provided (prevent bypass of DB-driven schema)
    if not config_schema:
        raise ConnectorConfigError(
            "config_schema is required and cannot be empty. "
            "Schema must come from connector_definitions.config_schema in database."
        )
    
    # Compute schema fingerprint for debugging (future: store in connector_instances.schema_hash_used)
    schema_fingerprint = compute_schema_fingerprint(config_schema)
    
    logger.info(
        "Creating connector implementation_key=%s organization_id=%s schema_fingerprint=%s...",
        implementation_key,
        organization_id,
        schema_fingerprint[:12],
    )

    # Step 1: Validate config against JSON schema (DO NOT pull from connector class)
    validate_connector_config(config, config_schema)
    logger.debug(
        "Configuration validated against JSON schema (fingerprint=%s...)",
        schema_fingerprint[:12],
    )

    # Step 2: Load connector class
    connector_class = load_connector_class(implementation_key)
    logger.debug("Loaded connector class: %s", connector_class.__name__)

    # Step 3: Instantiate connector (will call validate_config internally)
    try:
        connector = connector_class(config=config, organization_id=organization_id)
    except Exception as e:
        raise ConnectorLoadError(
            f"Failed to instantiate connector '{connector_class.__name__}': {e}"
        ) from e

    logger.info(
        "Successfully created connector: %s (direction=%s)",
        connector_class.__name__,
        connector.direction,
    )

    return connector


def load_connector_from_db_record(
    connector_instance: dict[str, Any],
    connector_definition: dict[str, Any],
    organization_id: str | UUID,
    org_slug: str | None = None,
    enable_org_overlay: bool | None = None,
) -> BaseConnector:
    """
    Convenience function to load connector from database records.
    
    Supports org overlay resolution when enabled. If org_slug is provided and
    org overlay is enabled, attempts to load an org-specific implementation
    before falling back to the default shared implementation.
    
    Extracts required fields from DB records with clear error messages if fields are missing.
    
    Args:
        connector_instance: Row from connector_instances table (with 'config' field)
        connector_definition: Row from connector_definitions table (with 'implementation_key', 'config_schema', and 'key')
        organization_id: Organization identifier (str or UUID)
        org_slug: Optional organization slug for org overlay resolution
        enable_org_overlay: Optional override for org overlay feature flag (defaults to settings)
        
    Returns:
        Instantiated connector
        
    Raises:
        ConnectorLoadError: If required DB fields are missing
        
    Example:
        >>> # Assume we've fetched from database
        >>> instance = {
        ...     "connector_instance_id": "uuid",
        ...     "config": {"api_key": "abc123"}
        ... }
        >>> definition = {
        ...     "key": "smithsonian-openaccess",
        ...     "implementation_key": "app.connectors.core.smithsonian:SmithsonianConnector",
        ...     "config_schema": {...}
        ... }
        >>> connector = load_connector_from_db_record(
        ...     instance, definition, "org-uuid", org_slug="example_museum", enable_org_overlay=True
        ... )
    """
    # Guard: Extract required fields with actionable errors if missing
    try:
        default_implementation_key = connector_definition["implementation_key"]
        config_schema = connector_definition["config_schema"]
        config = connector_instance["config"]
    except KeyError as e:
        raise ConnectorLoadError(
            f"Missing required DB field: {e.args[0]}. "
            f"Ensure connector_definition has 'implementation_key' and 'config_schema', "
            f"and connector_instance has 'config'."
        ) from e
    
    # Normalize organization_id to string for consistency
    organization_id_str = str(organization_id)
    
    # Resolve implementation_key with org overlay support
    implementation_key = default_implementation_key
    
    if org_slug:
        # Get feature flag from settings if not explicitly provided
        if enable_org_overlay is None:
            try:
                from app.config import get_settings
                settings = get_settings()
                enable_org_overlay = settings.connectors_use_org_overlay
            except Exception as e:
                logger.warning(
                    "Failed to load settings for org overlay resolution, defaulting to disabled: %s",
                    e
                )
                enable_org_overlay = False
        
        # Get connector definition key for resolution
        connector_definition_key = connector_definition.get("key", "unknown")
        
        # Resolve org-specific implementation if available
        implementation_key = resolve_org_overlay_implementation(
            default_implementation_key=default_implementation_key,
            connector_definition_key=connector_definition_key,
            org_slug=org_slug,
            enable_overlay=enable_org_overlay
        )
    
    return create_connector(
        implementation_key=implementation_key,
        config=config,
        config_schema=config_schema,
        organization_id=organization_id_str,
    )

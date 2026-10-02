"""
Database connector package.

Provides database source connectors with:
- Connection factory with TLS/secrets support
- Connectivity testing
- Schema discovery
- Safe preview
"""

from app.connectors.db.errors import (
    DbError,
    DbErrorCode,
    normalize_db_error,
    normalize_postgres_error,
    normalize_mysql_error,
    normalize_sqlserver_error,
    normalize_oracle_error,
    normalize_mongodb_error,
)

from app.connectors.db.connection import (
    ConnectionTestResult,
    test_database_connection,
    test_postgres_connection,
    test_mysql_connection,
    test_sqlserver_connection,
    test_oracle_connection,
    test_mongodb_connection,
)

from app.connectors.db.secrets import (
    SecretResolutionError,
    resolve_secret_ref,
    resolve_password,
    resolve_certificate,
)

from app.connectors.db.catalog import (
    CatalogItem,
    CatalogItemKind,
    CatalogResult,
    discover_catalog,
    discover_postgres_catalog,
    discover_mysql_catalog,
    discover_sqlserver_catalog,
    discover_oracle_catalog,
    discover_mongodb_catalog,
    generate_object_id,
)

from app.connectors.db.describe import (
    ColumnInfo,
    MongoFieldInfo,
    SqlObjectDescription,
    MongoCollectionDescription,
    describe_object,
    describe_postgres_object,
    describe_mysql_object,
    describe_sqlserver_object,
    describe_oracle_object,
    describe_mongodb_collection,
)

from app.connectors.db.preview import (
    PreviewFilter,
    PreviewSort,
    PreviewRequest,
    PreviewResult,
    preview_data,
    preview_postgres,
    preview_mysql,
    preview_sqlserver,
    preview_oracle,
    preview_mongodb,
    validate_identifier,
    quote_identifier,
    validate_columns_against_schema,
    MAX_PREVIEW_LIMIT,
    MAX_RESPONSE_BYTES,
)

from app.connectors.db.stats import (
    ObjectStats,
    SampleValues,
    PermissionCheck,
    get_object_stats,
    get_sample_values,
    check_permissions,
    MAX_SAMPLE_VALUES,
)

__all__ = [
    # Errors
    "DbError",
    "DbErrorCode",
    "normalize_db_error",
    "normalize_postgres_error",
    "normalize_mysql_error",
    "normalize_sqlserver_error",
    "normalize_oracle_error",
    "normalize_mongodb_error",
    # Connection testing
    "ConnectionTestResult",
    "test_database_connection",
    "test_postgres_connection",
    "test_mysql_connection",
    "test_sqlserver_connection",
    "test_oracle_connection",
    "test_mongodb_connection",
    # Secrets
    "SecretResolutionError",
    "resolve_secret_ref",
    "resolve_password",
    "resolve_certificate",
    # Catalog discovery
    "CatalogItem",
    "CatalogItemKind",
    "CatalogResult",
    "discover_catalog",
    "discover_postgres_catalog",
    "discover_mysql_catalog",
    "discover_sqlserver_catalog",
    "discover_oracle_catalog",
    "discover_mongodb_catalog",
    "generate_object_id",
    # Object description
    "ColumnInfo",
    "MongoFieldInfo",
    "SqlObjectDescription",
    "MongoCollectionDescription",
    "describe_object",
    "describe_postgres_object",
    "describe_mysql_object",
    "describe_sqlserver_object",
    "describe_oracle_object",
    "describe_mongodb_collection",
    # Data preview
    "PreviewFilter",
    "PreviewSort",
    "PreviewRequest",
    "PreviewResult",
    "preview_data",
    "preview_postgres",
    "preview_mysql",
    "preview_sqlserver",
    "preview_oracle",
    "preview_mongodb",
    "validate_identifier",
    "quote_identifier",
    "validate_columns_against_schema",
    "MAX_PREVIEW_LIMIT",
    "MAX_RESPONSE_BYTES",
    # Stats and sampling
    "ObjectStats",
    "SampleValues",
    "PermissionCheck",
    "get_object_stats",
    "get_sample_values",
    "check_permissions",
    "MAX_SAMPLE_VALUES",
]

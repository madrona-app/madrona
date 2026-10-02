"""
Tests for database catalog discovery.

Tests cover:
- Object ID generation (deterministic, stable)
- Catalog item serialization
- Per-vendor discovery using mocks (no live DB required)
- System schema filtering
- Error handling
"""

import sys
from unittest.mock import MagicMock, patch
import pytest

from app.connectors.db.catalog import (
    CatalogItem,
    CatalogItemKind,
    CatalogResult,
    discover_catalog,
    generate_object_id,
    POSTGRES_SYSTEM_SCHEMAS,
    MYSQL_SYSTEM_DATABASES,
    MONGODB_SYSTEM_DATABASES,
)
from app.connectors.db.errors import DbErrorCode


class TestGenerateObjectId:
    """Test object ID generation."""

    def test_deterministic(self):
        """Same inputs always produce same output."""
        id1 = generate_object_id("src1", "postgres", "mydb", "public", "users")
        id2 = generate_object_id("src1", "postgres", "mydb", "public", "users")
        assert id1 == id2

    def test_different_inputs_different_ids(self):
        """Different inputs produce different IDs."""
        id1 = generate_object_id("src1", "postgres", "mydb", "public", "users")
        id2 = generate_object_id("src1", "postgres", "mydb", "public", "orders")
        assert id1 != id2

    def test_source_id_matters(self):
        """Different source IDs produce different object IDs."""
        id1 = generate_object_id("src1", "postgres", "mydb", "public", "users")
        id2 = generate_object_id("src2", "postgres", "mydb", "public", "users")
        assert id1 != id2

    def test_vendor_matters(self):
        """Different vendors produce different object IDs."""
        id1 = generate_object_id("src1", "postgres", "mydb", None, "users")
        id2 = generate_object_id("src1", "mysql", "mydb", None, "users")
        assert id1 != id2

    def test_url_safe(self):
        """Object IDs are URL-safe."""
        object_id = generate_object_id("src1", "postgres", "mydb", "public", "users")
        # Should only contain alphanumeric, dash, underscore
        import re
        assert re.match(r'^[a-zA-Z0-9_-]+$', object_id)

    def test_handles_none_values(self):
        """Object ID generation handles None values."""
        # Database-only (e.g., for MySQL)
        id1 = generate_object_id("src1", "mysql", "mydb")
        assert id1

        # Schema-only
        id2 = generate_object_id("src1", "postgres", "mydb", "public")
        assert id2

        # Full path
        id3 = generate_object_id("src1", "postgres", "mydb", "public", "users")
        assert id3

        # All different
        assert id1 != id2 != id3


class TestCatalogItem:
    """Test CatalogItem dataclass."""

    def test_to_dict_minimal(self):
        """CatalogItem serializes correctly without meta."""
        item = CatalogItem(
            kind=CatalogItemKind.TABLE,
            name="users",
            path=["mydb", "public", "users"],
            object_id="abc123",
        )
        result = item.to_dict()

        assert result["kind"] == "table"
        assert result["name"] == "users"
        assert result["path"] == ["mydb", "public", "users"]
        assert result["objectId"] == "abc123"
        assert "meta" not in result

    def test_to_dict_with_meta(self):
        """CatalogItem serializes correctly with meta."""
        item = CatalogItem(
            kind=CatalogItemKind.TABLE,
            name="users",
            path=["mydb", "public", "users"],
            object_id="abc123",
            meta={"comment": "User accounts table"},
        )
        result = item.to_dict()

        assert result["meta"] == {"comment": "User accounts table"}

    def test_all_kinds(self):
        """All CatalogItemKind values serialize correctly."""
        for kind in CatalogItemKind:
            item = CatalogItem(
                kind=kind,
                name="test",
                path=["test"],
                object_id="test123",
            )
            assert item.to_dict()["kind"] == kind.value


class TestCatalogResult:
    """Test CatalogResult dataclass."""

    def test_to_dict_success(self):
        """CatalogResult serializes correctly on success."""
        result = CatalogResult(
            source_id="src1",
            vendor="postgres",
            items=[
                CatalogItem(
                    kind=CatalogItemKind.TABLE,
                    name="users",
                    path=["mydb", "public", "users"],
                    object_id="abc123",
                ),
            ],
        )
        output = result.to_dict()

        assert output["sourceId"] == "src1"
        assert output["vendor"] == "postgres"
        assert len(output["items"]) == 1
        assert output["items"][0]["name"] == "users"
        assert "error" not in output

    def test_to_dict_with_error(self):
        """CatalogResult serializes correctly with error."""
        from app.connectors.db.errors import DbError, DbErrorCode

        result = CatalogResult(
            source_id="src1",
            vendor="postgres",
            error=DbError(
                DbErrorCode.AUTH_FAILED,
                "Authentication failed",
                "28P01",
                False,
            ),
        )
        output = result.to_dict()

        assert output["sourceId"] == "src1"
        assert output["items"] == []
        assert output["error"]["code"] == "AUTH_FAILED"


class TestPostgresDiscovery:
    """Test PostgreSQL catalog discovery using mocks."""

    def test_discovers_schemas_and_tables(self):
        """Discovers schemas and tables correctly."""
        # Create mock module
        mock_psycopg = MagicMock()
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_psycopg.connect.return_value = mock_conn

        # Mock schema query results
        mock_cursor.fetchall.side_effect = [
            # Schemas
            [("public", "Public schema"), ("app", None)],
            # Tables for 'public'
            [("users", "BASE TABLE", "User accounts"), ("orders", "VIEW", None)],
            # Tables for 'app'
            [("settings", "BASE TABLE", None)],
        ]

        with patch.dict(sys.modules, {'psycopg': mock_psycopg}):
            # Re-import to use mocked module
            from app.connectors.db.catalog import discover_postgres_catalog

            config = {
                "type": "postgres",
                "host": "localhost",
                "port": 5432,
                "database": "testdb",
                "username": "testuser",
                "auth": {"password": "secret"},
            }

            result = discover_postgres_catalog(config, "src1")

            assert result.vendor == "postgres"
            assert result.error is None

            # Should have schemas and tables
            schemas = [i for i in result.items if i.kind == CatalogItemKind.SCHEMA]
            tables = [i for i in result.items if i.kind == CatalogItemKind.TABLE]
            views = [i for i in result.items if i.kind == CatalogItemKind.VIEW]

            assert len(schemas) == 2
            assert len(tables) == 2  # users + settings
            assert len(views) == 1  # orders

    def test_handles_driver_not_installed(self):
        """Returns error when driver is not installed."""
        # Remove psycopg and psycopg2 from modules
        with patch.dict(sys.modules, {'psycopg': None, 'psycopg2': None}):
            # Force reimport
            import importlib
            from app.connectors.db import catalog
            importlib.reload(catalog)

            config = {
                "type": "postgres",
                "host": "localhost",
                "port": 5432,
                "database": "testdb",
                "username": "testuser",
            }

            result = catalog.discover_postgres_catalog(config, "src1")

            assert result.error is not None
            assert result.error.code == DbErrorCode.UNSUPPORTED_FEATURE
            assert "driver" in result.error.message.lower()


class TestMySQLDiscovery:
    """Test MySQL catalog discovery using mocks."""

    def test_discovers_databases_and_tables(self):
        """Discovers databases and tables correctly."""
        mock_mysql = MagicMock()
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_mysql.connect.return_value = mock_conn

        # Mock query results
        mock_cursor.fetchall.side_effect = [
            # SHOW DATABASES
            [("myapp",), ("analytics",)],
            # Tables for myapp
            [("users", "BASE TABLE", "User accounts"), ("orders", "VIEW", None)],
            # Tables for analytics
            [("events", "BASE TABLE", None)],
        ]

        with patch.dict(sys.modules, {'pymysql': mock_mysql}):
            from app.connectors.db.catalog import discover_mysql_catalog

            config = {
                "type": "mysql",
                "host": "localhost",
                "port": 3306,
                "username": "testuser",
                "auth": {"password": "secret"},
            }

            result = discover_mysql_catalog(config, "src1")

            assert result.vendor == "mysql"
            assert result.error is None

            databases = [i for i in result.items if i.kind == CatalogItemKind.DATABASE]
            tables = [i for i in result.items if i.kind == CatalogItemKind.TABLE]
            views = [i for i in result.items if i.kind == CatalogItemKind.VIEW]

            assert len(databases) == 2
            assert len(tables) == 2  # users + events
            assert len(views) == 1  # orders


class TestMongoDBDiscovery:
    """Test MongoDB catalog discovery using mocks."""

    def test_discovers_databases_and_collections(self):
        """Discovers databases and collections correctly."""
        mock_pymongo = MagicMock()
        mock_client_class = MagicMock()
        mock_client = MagicMock()
        mock_db = MagicMock()

        mock_pymongo.MongoClient = mock_client_class
        mock_client_class.return_value = mock_client

        mock_client.list_database_names.return_value = ["myapp", "analytics"]
        mock_client.__getitem__.return_value = mock_db

        # First call for myapp, second for analytics
        mock_db.list_collections.side_effect = [
            [{"name": "users"}, {"name": "orders"}],
            [{"name": "events"}],
        ]

        with patch.dict(sys.modules, {'pymongo': mock_pymongo, 'pymongo.errors': MagicMock()}):
            from app.connectors.db.catalog import discover_mongodb_catalog

            config = {
                "type": "mongodb",
                "host": "localhost",
                "port": 27017,
                "username": "testuser",
                "auth": {"password": "secret"},
            }

            result = discover_mongodb_catalog(config, "src1")

            assert result.vendor == "mongodb"
            assert result.error is None

            databases = [i for i in result.items if i.kind == CatalogItemKind.DATABASE]
            collections = [i for i in result.items if i.kind == CatalogItemKind.COLLECTION]

            assert len(databases) == 2
            assert len(collections) == 3  # users + orders + events

    def test_excludes_system_databases_by_default(self):
        """System databases are excluded by default."""
        mock_pymongo = MagicMock()
        mock_client_class = MagicMock()
        mock_client = MagicMock()
        mock_db = MagicMock()

        mock_pymongo.MongoClient = mock_client_class
        mock_client_class.return_value = mock_client

        mock_client.list_database_names.return_value = ["myapp", "admin", "config", "local"]
        mock_client.__getitem__.return_value = mock_db
        mock_db.list_collections.return_value = [{"name": "users"}]

        with patch.dict(sys.modules, {'pymongo': mock_pymongo, 'pymongo.errors': MagicMock()}):
            from app.connectors.db.catalog import discover_mongodb_catalog

            config = {
                "type": "mongodb",
                "host": "localhost",
                "port": 27017,
                "username": "testuser",
            }

            result = discover_mongodb_catalog(config, "src1", include_system=False)

            databases = [i for i in result.items if i.kind == CatalogItemKind.DATABASE]
            db_names = [d.name for d in databases]

            assert "myapp" in db_names
            assert "admin" not in db_names
            assert "config" not in db_names
            assert "local" not in db_names


class TestDiscoverCatalogDispatcher:
    """Test the main discover_catalog dispatcher."""

    def test_missing_type_error(self):
        """Missing type returns error."""
        config = {"host": "localhost"}
        result = discover_catalog(config, "src1")

        assert result.error is not None
        assert result.error.code == DbErrorCode.UNKNOWN
        assert "type" in result.error.message.lower()

    def test_unsupported_type_error(self):
        """Unsupported type returns error."""
        config = {"type": "couchdb", "host": "localhost"}
        result = discover_catalog(config, "src1")

        assert result.error is not None
        assert result.error.code == DbErrorCode.UNSUPPORTED_FEATURE


class TestObjectIdStability:
    """Test that object IDs are stable across calls."""

    def test_same_inputs_produce_same_id(self):
        """Same inputs always produce same object ID."""
        id1 = generate_object_id("src1", "postgres", "testdb", "public", "users")
        id2 = generate_object_id("src1", "postgres", "testdb", "public", "users")
        assert id1 == id2

    def test_id_encodes_full_path(self):
        """Object ID is different for different paths."""
        id_schema = generate_object_id("src1", "postgres", "testdb", "public")
        id_table = generate_object_id("src1", "postgres", "testdb", "public", "users")
        assert id_schema != id_table

    def test_id_is_stable_format(self):
        """Object ID has consistent format."""
        object_id = generate_object_id("src1", "postgres", "testdb", "public", "users")

        # Should be base64 URL-safe encoded
        import base64
        # Pad to valid base64 length
        padded = object_id + "=" * (4 - len(object_id) % 4)
        try:
            decoded = base64.urlsafe_b64decode(padded)
            assert len(decoded) == 16  # SHA-256 truncated to 16 bytes
        except Exception:
            pytest.fail("Object ID should be valid base64")


class TestSystemSchemaFiltering:
    """Test system schema/database filtering."""

    def test_postgres_system_schemas_defined(self):
        """PostgreSQL system schemas are defined."""
        assert "pg_catalog" in POSTGRES_SYSTEM_SCHEMAS
        assert "information_schema" in POSTGRES_SYSTEM_SCHEMAS

    def test_mysql_system_databases_defined(self):
        """MySQL system databases are defined."""
        assert "mysql" in MYSQL_SYSTEM_DATABASES
        assert "information_schema" in MYSQL_SYSTEM_DATABASES
        assert "sys" in MYSQL_SYSTEM_DATABASES

    def test_mongodb_system_databases_defined(self):
        """MongoDB system databases are defined."""
        assert "admin" in MONGODB_SYSTEM_DATABASES
        assert "config" in MONGODB_SYSTEM_DATABASES
        assert "local" in MONGODB_SYSTEM_DATABASES


class TestCatalogItemKind:
    """Test CatalogItemKind enum."""

    def test_all_kinds_have_values(self):
        """All catalog item kinds have string values."""
        expected = {"database", "schema", "table", "view", "collection"}
        actual = {kind.value for kind in CatalogItemKind}
        assert actual == expected

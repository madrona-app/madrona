"""
Tests for database object description.

Tests cover:
- Column/field metadata extraction
- Type normalization (SQL databases)
- MongoDB field inference from samples
- Primary key detection
- Error handling
"""

import sys
from unittest.mock import MagicMock, patch
import pytest

from app.connectors.db.describe import (
    ColumnInfo,
    MongoFieldInfo,
    SqlObjectDescription,
    MongoCollectionDescription,
    describe_object,
    normalize_sql_type,
    infer_mongo_field_type,
    POSTGRES_TYPE_MAP,
    MYSQL_TYPE_MAP,
    SQLSERVER_TYPE_MAP,
    ORACLE_TYPE_MAP,
)
from app.connectors.db.errors import DbErrorCode


class TestColumnInfo:
    """Test ColumnInfo dataclass."""

    def test_to_dict_minimal(self):
        """ColumnInfo serializes correctly with minimal fields."""
        col = ColumnInfo(
            name="id",
            type="integer",
            nullable=False,
            native_type="int4",
        )
        result = col.to_dict()

        assert result["name"] == "id"
        assert result["type"] == "integer"
        assert result["nullable"] is False
        assert result["nativeType"] == "int4"
        assert "primaryKey" not in result
        assert "maxLength" not in result

    def test_to_dict_with_primary_key(self):
        """ColumnInfo includes primaryKey when true."""
        col = ColumnInfo(
            name="id",
            type="integer",
            nullable=False,
            primary_key=True,
            native_type="int4",
        )
        result = col.to_dict()

        assert result["primaryKey"] is True

    def test_to_dict_with_max_length(self):
        """ColumnInfo includes maxLength when set."""
        col = ColumnInfo(
            name="name",
            type="string",
            nullable=True,
            native_type="varchar(255)",
            max_length=255,
        )
        result = col.to_dict()

        assert result["maxLength"] == 255


class TestMongoFieldInfo:
    """Test MongoFieldInfo dataclass."""

    def test_to_dict_minimal(self):
        """MongoFieldInfo serializes correctly with minimal fields."""
        field = MongoFieldInfo(
            name="_id",
            type="string",
        )
        result = field.to_dict()

        assert result["name"] == "_id"
        assert result["type"] == "string"
        assert "examples" not in result
        assert "presencePct" not in result

    def test_to_dict_with_examples(self):
        """MongoFieldInfo includes examples."""
        field = MongoFieldInfo(
            name="status",
            type="string",
            examples=["active", "inactive", "pending"],
        )
        result = field.to_dict()

        assert result["examples"] == ["active", "inactive", "pending"]

    def test_to_dict_with_presence_pct(self):
        """MongoFieldInfo includes presencePct."""
        field = MongoFieldInfo(
            name="email",
            type="string",
            presence_pct=95.5,
        )
        result = field.to_dict()

        assert result["presencePct"] == 95.5

    def test_examples_truncated(self):
        """Examples are truncated to max 5."""
        field = MongoFieldInfo(
            name="tags",
            type="string",
            examples=["a", "b", "c", "d", "e", "f", "g"],
        )
        result = field.to_dict()

        assert len(result["examples"]) == 5


class TestSqlObjectDescription:
    """Test SqlObjectDescription dataclass."""

    def test_to_dict_success(self):
        """SqlObjectDescription serializes correctly."""
        desc = SqlObjectDescription(
            object_id="abc123",
            kind="table",
            name="users",
            path=["mydb", "public", "users"],
            columns=[
                ColumnInfo("id", "integer", False, True, "int4"),
                ColumnInfo("name", "string", True, False, "varchar(255)", 255),
            ],
            primary_key=["id"],
            meta={"rowEstimate": 1000, "comment": "User accounts"},
        )
        result = desc.to_dict()

        assert result["objectId"] == "abc123"
        assert result["kind"] == "table"
        assert result["name"] == "users"
        assert result["path"] == ["mydb", "public", "users"]
        assert len(result["columns"]) == 2
        assert result["columns"][0]["name"] == "id"
        assert result["primaryKey"] == ["id"]
        assert result["meta"]["rowEstimate"] == 1000
        assert result["meta"]["comment"] == "User accounts"

    def test_to_dict_with_error(self):
        """SqlObjectDescription with error returns error dict."""
        from app.connectors.db.errors import DbError

        desc = SqlObjectDescription(
            object_id="abc123",
            kind="table",
            name="users",
            path=["mydb", "public", "users"],
            error=DbError(DbErrorCode.AUTH_FAILED, "Auth failed", None, False),
        )
        result = desc.to_dict()

        assert result["objectId"] == "abc123"
        assert result["error"]["code"] == "AUTH_FAILED"
        assert "columns" not in result


class TestMongoCollectionDescription:
    """Test MongoCollectionDescription dataclass."""

    def test_to_dict_success(self):
        """MongoCollectionDescription serializes correctly."""
        desc = MongoCollectionDescription(
            object_id="xyz789",
            name="orders",
            path=["mydb", "orders"],
            fields=[
                MongoFieldInfo("_id", "string"),
                MongoFieldInfo("amount", "number", presence_pct=100.0),
            ],
            meta={"sampleSize": 50},
        )
        result = desc.to_dict()

        assert result["objectId"] == "xyz789"
        assert result["kind"] == "collection"
        assert result["name"] == "orders"
        assert result["path"] == ["mydb", "orders"]
        assert len(result["fields"]) == 2
        assert result["meta"]["sampleSize"] == 50


class TestTypeNormalization:
    """Test SQL type normalization."""

    def test_postgres_types(self):
        """PostgreSQL types normalize correctly."""
        assert normalize_sql_type("integer", POSTGRES_TYPE_MAP) == "integer"
        assert normalize_sql_type("INT4", POSTGRES_TYPE_MAP) == "integer"
        assert normalize_sql_type("bigint", POSTGRES_TYPE_MAP) == "integer"
        assert normalize_sql_type("numeric", POSTGRES_TYPE_MAP) == "number"
        assert normalize_sql_type("double precision", POSTGRES_TYPE_MAP) == "number"
        assert normalize_sql_type("boolean", POSTGRES_TYPE_MAP) == "boolean"
        assert normalize_sql_type("varchar", POSTGRES_TYPE_MAP) == "string"
        assert normalize_sql_type("character varying", POSTGRES_TYPE_MAP) == "string"
        assert normalize_sql_type("text", POSTGRES_TYPE_MAP) == "string"
        assert normalize_sql_type("timestamp", POSTGRES_TYPE_MAP) == "datetime"
        assert normalize_sql_type("timestamptz", POSTGRES_TYPE_MAP) == "datetime"
        assert normalize_sql_type("jsonb", POSTGRES_TYPE_MAP) == "json"

    def test_mysql_types(self):
        """MySQL types normalize correctly."""
        assert normalize_sql_type("INT", MYSQL_TYPE_MAP) == "integer"
        assert normalize_sql_type("bigint", MYSQL_TYPE_MAP) == "integer"
        assert normalize_sql_type("decimal", MYSQL_TYPE_MAP) == "number"
        assert normalize_sql_type("varchar", MYSQL_TYPE_MAP) == "string"
        assert normalize_sql_type("text", MYSQL_TYPE_MAP) == "string"
        assert normalize_sql_type("datetime", MYSQL_TYPE_MAP) == "datetime"
        assert normalize_sql_type("json", MYSQL_TYPE_MAP) == "json"

    def test_sqlserver_types(self):
        """SQL Server types normalize correctly."""
        assert normalize_sql_type("int", SQLSERVER_TYPE_MAP) == "integer"
        assert normalize_sql_type("bigint", SQLSERVER_TYPE_MAP) == "integer"
        assert normalize_sql_type("bit", SQLSERVER_TYPE_MAP) == "boolean"
        assert normalize_sql_type("decimal", SQLSERVER_TYPE_MAP) == "number"
        assert normalize_sql_type("nvarchar", SQLSERVER_TYPE_MAP) == "string"
        assert normalize_sql_type("datetime2", SQLSERVER_TYPE_MAP) == "datetime"
        assert normalize_sql_type("uniqueidentifier", SQLSERVER_TYPE_MAP) == "string"

    def test_oracle_types(self):
        """Oracle types normalize correctly."""
        assert normalize_sql_type("NUMBER", ORACLE_TYPE_MAP) == "number"
        assert normalize_sql_type("varchar2", ORACLE_TYPE_MAP) == "string"
        assert normalize_sql_type("clob", ORACLE_TYPE_MAP) == "string"
        assert normalize_sql_type("date", ORACLE_TYPE_MAP) == "datetime"
        assert normalize_sql_type("timestamp", ORACLE_TYPE_MAP) == "datetime"
        assert normalize_sql_type("blob", ORACLE_TYPE_MAP) == "binary"

    def test_types_with_parameters(self):
        """Types with parameters normalize correctly."""
        assert normalize_sql_type("varchar(255)", POSTGRES_TYPE_MAP) == "string"
        assert normalize_sql_type("numeric(10,2)", POSTGRES_TYPE_MAP) == "number"
        assert normalize_sql_type("char(1)", MYSQL_TYPE_MAP) == "string"

    def test_array_types(self):
        """Array types normalize correctly."""
        assert normalize_sql_type("integer[]", POSTGRES_TYPE_MAP) == "array"
        assert normalize_sql_type("text[]", POSTGRES_TYPE_MAP) == "array"
        assert normalize_sql_type("ARRAY", POSTGRES_TYPE_MAP) == "array"

    def test_unknown_type(self):
        """Unknown types return 'unknown'."""
        assert normalize_sql_type("someweirdtype", POSTGRES_TYPE_MAP) == "unknown"


class TestMongoFieldTypeInference:
    """Test MongoDB field type inference."""

    def test_infer_null(self):
        """None infers to null."""
        assert infer_mongo_field_type(None) == "null"

    def test_infer_bool(self):
        """Boolean infers to bool."""
        assert infer_mongo_field_type(True) == "bool"
        assert infer_mongo_field_type(False) == "bool"

    def test_infer_number(self):
        """Numbers infer to number."""
        assert infer_mongo_field_type(42) == "number"
        assert infer_mongo_field_type(3.14) == "number"
        assert infer_mongo_field_type(0) == "number"
        assert infer_mongo_field_type(-100) == "number"

    def test_infer_string(self):
        """Strings infer to string."""
        assert infer_mongo_field_type("hello") == "string"
        assert infer_mongo_field_type("") == "string"

    def test_infer_array(self):
        """Lists infer to array."""
        assert infer_mongo_field_type([]) == "array"
        assert infer_mongo_field_type([1, 2, 3]) == "array"

    def test_infer_object(self):
        """Dicts infer to object."""
        assert infer_mongo_field_type({}) == "object"
        assert infer_mongo_field_type({"key": "value"}) == "object"


class TestPostgresDescribe:
    """Test PostgreSQL object description using mocks."""

    def test_describes_table_columns(self):
        """Describes table columns correctly."""
        mock_psycopg = MagicMock()
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_psycopg.connect.return_value = mock_conn

        # Mock query results
        mock_cursor.fetchall.side_effect = [
            # Column info
            [
                ("id", "integer", "NO", None, "int4", True),
                ("name", "character varying", "YES", 255, "varchar", False),
                ("email", "character varying", "NO", 100, "varchar", False),
            ],
        ]
        mock_cursor.fetchone.side_effect = [
            (1000,),  # Row estimate
            ("User accounts table",),  # Comment
        ]

        with patch.dict(sys.modules, {'psycopg': mock_psycopg}):
            from app.connectors.db.describe import describe_postgres_object

            config = {
                "type": "postgres",
                "host": "localhost",
                "port": 5432,
                "username": "testuser",
                "auth": {"password": "secret"},
            }

            result = describe_postgres_object(
                config, "src1", "testdb", "public", "users", "table"
            )

            assert result.kind == "table"
            assert result.name == "users"
            assert result.error is None
            assert len(result.columns) == 3

            # Check columns
            id_col = result.columns[0]
            assert id_col.name == "id"
            assert id_col.type == "integer"
            assert id_col.nullable is False
            assert id_col.primary_key is True

            name_col = result.columns[1]
            assert name_col.name == "name"
            assert name_col.type == "string"
            assert name_col.nullable is True
            assert name_col.max_length == 255

    def test_handles_driver_not_installed(self):
        """Returns error when driver is not installed."""
        with patch.dict(sys.modules, {'psycopg': None, 'psycopg2': None}):
            import importlib
            from app.connectors.db import describe
            importlib.reload(describe)

            config = {
                "type": "postgres",
                "host": "localhost",
                "port": 5432,
                "database": "testdb",
                "username": "testuser",
            }

            result = describe.describe_postgres_object(
                config, "src1", "testdb", "public", "users", "table"
            )

            assert result.error is not None
            assert result.error.code == DbErrorCode.UNSUPPORTED_FEATURE
            assert "driver" in result.error.message.lower()


class TestMySQLDescribe:
    """Test MySQL object description using mocks."""

    def test_describes_table_columns(self):
        """Describes table columns correctly."""
        mock_mysql = MagicMock()
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_mysql.connect.return_value = mock_conn

        # Mock query results
        mock_cursor.fetchall.return_value = [
            ("id", "int", "int(11)", "NO", None, "PRI"),
            ("name", "varchar", "varchar(255)", "YES", 255, ""),
        ]
        mock_cursor.fetchone.return_value = (1000, "User table")

        with patch.dict(sys.modules, {'pymysql': mock_mysql}):
            from app.connectors.db.describe import describe_mysql_object

            config = {
                "type": "mysql",
                "host": "localhost",
                "port": 3306,
                "username": "testuser",
                "auth": {"password": "secret"},
            }

            result = describe_mysql_object(
                config, "src1", "mydb", "users", "table"
            )

            assert result.kind == "table"
            assert result.name == "users"
            assert result.error is None
            assert len(result.columns) == 2

            id_col = result.columns[0]
            assert id_col.name == "id"
            assert id_col.primary_key is True


class TestMongoDBDescribe:
    """Test MongoDB collection description using mocks."""

    def test_describes_collection_fields(self):
        """Describes collection fields correctly from samples."""
        mock_pymongo = MagicMock()
        mock_client_class = MagicMock()
        mock_client = MagicMock()
        mock_db = MagicMock()
        mock_collection = MagicMock()

        mock_pymongo.MongoClient = mock_client_class
        mock_client_class.return_value = mock_client
        mock_client.__getitem__.return_value = mock_db
        mock_db.__getitem__.return_value = mock_collection

        # Sample documents
        mock_collection.find.return_value.limit.return_value = [
            {"_id": "1", "name": "Alice", "age": 30, "active": True},
            {"_id": "2", "name": "Bob", "age": 25, "active": False},
            {"_id": "3", "name": "Carol", "email": "carol@test.com"},
        ]

        with patch.dict(sys.modules, {'pymongo': mock_pymongo, 'pymongo.errors': MagicMock()}):
            from app.connectors.db.describe import describe_mongodb_collection

            config = {
                "type": "mongodb",
                "host": "localhost",
                "port": 27017,
                "username": "testuser",
            }

            result = describe_mongodb_collection(
                config, "src1", "mydb", "users"
            )

            assert result.kind == "collection"
            assert result.name == "users"
            assert result.error is None
            assert result.meta["sampleSize"] == 3

            # Check inferred fields
            field_names = [f.name for f in result.fields]
            assert "_id" in field_names
            assert "name" in field_names
            assert "age" in field_names
            assert "active" in field_names
            assert "email" in field_names

            # Check presence percentages
            for field in result.fields:
                if field.name in ("_id", "name"):
                    assert field.presence_pct == 100.0
                elif field.name == "email":
                    # Only 1 out of 3 documents have email
                    assert field.presence_pct == pytest.approx(33.3, rel=0.1)

    def test_empty_collection(self):
        """Handles empty collection gracefully."""
        mock_pymongo = MagicMock()
        mock_client_class = MagicMock()
        mock_client = MagicMock()
        mock_db = MagicMock()
        mock_collection = MagicMock()

        mock_pymongo.MongoClient = mock_client_class
        mock_client_class.return_value = mock_client
        mock_client.__getitem__.return_value = mock_db
        mock_db.__getitem__.return_value = mock_collection

        mock_collection.find.return_value.limit.return_value = []

        with patch.dict(sys.modules, {'pymongo': mock_pymongo, 'pymongo.errors': MagicMock()}):
            from app.connectors.db.describe import describe_mongodb_collection

            config = {
                "type": "mongodb",
                "host": "localhost",
                "port": 27017,
            }

            result = describe_mongodb_collection(
                config, "src1", "mydb", "empty_collection"
            )

            assert result.error is None
            assert len(result.fields) == 0
            assert result.meta["sampleSize"] == 0


class TestDescribeObjectDispatcher:
    """Test the main describe_object dispatcher."""

    def test_postgres_path_validation(self):
        """PostgreSQL requires 3-part path."""
        config = {"type": "postgres"}
        result = describe_object(config, "src1", ["db", "table"], "table")

        assert result.error is not None
        assert "path must be" in result.error.message.lower()

    def test_mysql_path_validation(self):
        """MySQL requires 2-part path."""
        config = {"type": "mysql"}
        result = describe_object(config, "src1", ["db", "schema", "table"], "table")

        assert result.error is not None
        assert "path must be" in result.error.message.lower()

    def test_mongodb_path_validation(self):
        """MongoDB requires 2-part path."""
        config = {"type": "mongodb"}
        result = describe_object(config, "src1", ["db", "schema", "collection"], "collection")

        assert result.error is not None
        assert "path must be" in result.error.message.lower()

    def test_unsupported_type(self):
        """Unsupported database type returns error."""
        config = {"type": "couchdb"}
        result = describe_object(config, "src1", ["db", "collection"], "collection")

        assert result.error is not None
        assert result.error.code == DbErrorCode.UNSUPPORTED_FEATURE


class TestObjectIdGeneration:
    """Test that object IDs are stable and unique."""

    def test_same_path_same_id(self):
        """Same path produces same object ID."""
        from app.connectors.db.catalog import generate_object_id

        id1 = generate_object_id("src1", "postgres", "db", "public", "users")
        id2 = generate_object_id("src1", "postgres", "db", "public", "users")
        assert id1 == id2

    def test_different_path_different_id(self):
        """Different paths produce different object IDs."""
        from app.connectors.db.catalog import generate_object_id

        id1 = generate_object_id("src1", "postgres", "db", "public", "users")
        id2 = generate_object_id("src1", "postgres", "db", "public", "orders")
        assert id1 != id2

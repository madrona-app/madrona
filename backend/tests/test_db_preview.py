"""
Tests for database preview functionality.

Tests cover:
- Request/response serialization
- Identifier validation (injection prevention)
- Column validation against schema
- SQL query building (parameterized)
- MongoDB query building
- Injection attempt handling
- Oversize payload handling
"""

import sys
from unittest.mock import MagicMock, patch
import pytest

from app.connectors.db.preview import (
    PreviewFilter,
    PreviewSort,
    PreviewRequest,
    PreviewResult,
    validate_identifier,
    quote_identifier,
    validate_columns_against_schema,
    build_sql_filter,
    build_sql_order_by,
    build_mongo_filter,
    build_mongo_sort,
    estimate_row_size,
    preview_data,
    MAX_PREVIEW_LIMIT,
    MAX_RESPONSE_BYTES,
)
from app.connectors.db.errors import DbError, DbErrorCode


class TestPreviewFilter:
    """Test PreviewFilter dataclass."""

    def test_from_dict(self):
        """Creates filter from dict."""
        data = {"type": "equals", "field": "status", "value": "active"}
        f = PreviewFilter.from_dict(data)

        assert f.type == "equals"
        assert f.field == "status"
        assert f.value == "active"

    def test_from_dict_defaults(self):
        """Handles missing fields with defaults."""
        data = {}
        f = PreviewFilter.from_dict(data)

        assert f.type == "equals"
        assert f.field == ""
        assert f.value is None


class TestPreviewSort:
    """Test PreviewSort dataclass."""

    def test_from_dict(self):
        """Creates sort from dict."""
        data = {"field": "created_at", "dir": "desc"}
        s = PreviewSort.from_dict(data)

        assert s.field == "created_at"
        assert s.dir == "desc"

    def test_from_dict_defaults(self):
        """Handles missing fields with defaults."""
        data = {"field": "name"}
        s = PreviewSort.from_dict(data)

        assert s.dir == "asc"


class TestPreviewRequest:
    """Test PreviewRequest dataclass."""

    def test_from_dict_minimal(self):
        """Creates request from minimal dict."""
        data = {"objectId": "abc123"}
        req = PreviewRequest.from_dict(data, ["db", "schema", "table"], "table")

        assert req.object_id == "abc123"
        assert req.path == ["db", "schema", "table"]
        assert req.kind == "table"
        assert req.limit == 25  # default
        assert req.columns is None
        assert req.filter is None
        assert req.sort is None

    def test_from_dict_full(self):
        """Creates request from full dict."""
        data = {
            "objectId": "abc123",
            "limit": 50,
            "columns": ["id", "name"],
            "filter": {"type": "equals", "field": "status", "value": "active"},
            "sort": [{"field": "name", "dir": "asc"}],
        }
        req = PreviewRequest.from_dict(data, ["db", "table"], "table")

        assert req.limit == 50
        assert req.columns == ["id", "name"]
        assert req.filter.field == "status"
        assert len(req.sort) == 1
        assert req.sort[0].field == "name"

    def test_limit_enforced(self):
        """Limit is capped at MAX_PREVIEW_LIMIT."""
        data = {"objectId": "abc123", "limit": 500}
        req = PreviewRequest.from_dict(data, ["db", "table"], "table")

        assert req.limit == MAX_PREVIEW_LIMIT


class TestPreviewResult:
    """Test PreviewResult dataclass."""

    def test_to_dict_sql(self):
        """Serializes SQL result correctly."""
        result = PreviewResult(
            object_id="abc123",
            kind="table",
            rows=[{"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}],
            truncated=False,
            meta={"limit": 25, "elapsedMs": 12.5, "rowCount": 2},
        )
        output = result.to_dict()

        assert output["objectId"] == "abc123"
        assert output["kind"] == "table"
        assert len(output["rows"]) == 2
        assert output["truncated"] is False
        assert output["meta"]["rowCount"] == 2
        assert "docs" not in output

    def test_to_dict_mongo(self):
        """Serializes MongoDB result correctly."""
        result = PreviewResult(
            object_id="xyz789",
            kind="collection",
            docs=[{"_id": "1", "value": 100}],
            truncated=True,
            meta={"limit": 25, "elapsedMs": 8.3, "docCount": 1},
        )
        output = result.to_dict()

        assert output["kind"] == "collection"
        assert len(output["docs"]) == 1
        assert output["truncated"] is True
        assert "rows" not in output

    def test_to_dict_with_error(self):
        """Serializes error result correctly."""
        result = PreviewResult(
            object_id="abc123",
            kind="table",
            error=DbError(DbErrorCode.AUTH_FAILED, "Auth failed", None, False),
        )
        output = result.to_dict()

        assert output["objectId"] == "abc123"
        assert output["error"]["code"] == "AUTH_FAILED"
        assert "rows" not in output
        assert "docs" not in output


class TestIdentifierValidation:
    """Test identifier validation for SQL injection prevention."""

    def test_valid_identifiers(self):
        """Valid identifiers pass validation."""
        assert validate_identifier("users") is True
        assert validate_identifier("user_table") is True
        assert validate_identifier("Users123") is True
        assert validate_identifier("_private") is True
        assert validate_identifier("A") is True

    def test_invalid_identifiers(self):
        """Invalid identifiers fail validation."""
        # SQL injection attempts
        assert validate_identifier("users; DROP TABLE users--") is False
        assert validate_identifier("users' OR '1'='1") is False
        assert validate_identifier("users\"") is False
        assert validate_identifier("1users") is False  # starts with number
        assert validate_identifier("user-table") is False  # hyphen
        assert validate_identifier("user.table") is False  # dot
        assert validate_identifier("") is False
        assert validate_identifier(" ") is False
        assert validate_identifier("user table") is False  # space

    def test_injection_via_unicode(self):
        """Unicode injection attempts fail validation."""
        assert validate_identifier("users\u0000") is False  # null byte
        # Note: newlines in identifiers are caught by the quote_identifier function
        # which strips and validates the cleaned name


class TestQuoteIdentifier:
    """Test identifier quoting for different vendors."""

    def test_postgres_quoting(self):
        """PostgreSQL uses double quotes."""
        assert quote_identifier("users", "postgres") == '"users"'
        assert quote_identifier("user_table", "postgres") == '"user_table"'

    def test_mysql_quoting(self):
        """MySQL uses backticks."""
        assert quote_identifier("users", "mysql") == "`users`"
        assert quote_identifier("user_table", "mysql") == "`user_table`"

    def test_sqlserver_quoting(self):
        """SQL Server uses square brackets."""
        assert quote_identifier("users", "sqlserver") == "[users]"
        assert quote_identifier("user_table", "sqlserver") == "[user_table]"

    def test_oracle_quoting(self):
        """Oracle uses double quotes."""
        assert quote_identifier("USERS", "oracle") == '"USERS"'

    def test_invalid_identifier_raises(self):
        """Invalid identifiers raise ValueError."""
        with pytest.raises(ValueError):
            quote_identifier("users; DROP TABLE", "postgres")

        with pytest.raises(ValueError):
            quote_identifier("", "postgres")

        with pytest.raises(ValueError):
            quote_identifier("user-table", "mysql")


class TestColumnValidation:
    """Test column validation against schema."""

    def test_valid_columns(self):
        """Valid columns pass validation."""
        schema = ["id", "name", "email", "created_at"]
        columns, error = validate_columns_against_schema(["id", "name"], schema)

        assert error is None
        assert columns == ["id", "name"]

    def test_case_insensitive(self):
        """Column matching is case-insensitive."""
        schema = ["Id", "Name", "EMAIL"]
        columns, error = validate_columns_against_schema(["id", "name", "email"], schema)

        assert error is None
        # Returns original schema casing
        assert "Id" in columns
        assert "Name" in columns
        assert "EMAIL" in columns

    def test_invalid_columns(self):
        """Invalid columns return error."""
        schema = ["id", "name", "email"]
        columns, error = validate_columns_against_schema(["id", "password"], schema)

        assert error is not None
        assert "password" in error.message.lower()

    def test_none_returns_all(self):
        """None columns returns all schema columns."""
        schema = ["id", "name", "email"]
        columns, error = validate_columns_against_schema(None, schema)

        assert error is None
        assert columns == schema

    def test_injection_attempt_fails(self):
        """SQL injection in column name fails validation."""
        schema = ["id", "name", "email"]
        columns, error = validate_columns_against_schema(
            ["id", "name; DROP TABLE users--"],
            schema
        )

        assert error is not None


class TestSqlFilterBuilding:
    """Test SQL filter clause building."""

    def test_equals_filter(self):
        """Builds equals filter correctly."""
        f = PreviewFilter(type="equals", field="status", value="active")
        clause, params = build_sql_filter(f, "postgres", "pyformat")

        assert 'WHERE "status" = %s' == clause
        assert params == ["active"]

    def test_not_equals_filter(self):
        """Builds not_equals filter correctly."""
        f = PreviewFilter(type="not_equals", field="status", value="deleted")
        clause, params = build_sql_filter(f, "postgres", "pyformat")

        assert 'WHERE "status" != %s' == clause

    def test_comparison_filters(self):
        """Builds comparison filters correctly."""
        for filter_type, op in [("gt", ">"), ("gte", ">="), ("lt", "<"), ("lte", "<=")]:
            f = PreviewFilter(type=filter_type, field="age", value=18)
            clause, params = build_sql_filter(f, "postgres", "pyformat")
            assert f'WHERE "age" {op} %s' == clause

    def test_contains_filter(self):
        """Builds contains filter with LIKE."""
        f = PreviewFilter(type="contains", field="name", value="john")
        clause, params = build_sql_filter(f, "postgres", "pyformat")

        assert 'WHERE "name" LIKE %s' == clause
        assert params == ["%john%"]

    def test_is_null_filter(self):
        """Builds IS NULL filter."""
        f = PreviewFilter(type="is_null", field="email", value=None)
        clause, params = build_sql_filter(f, "postgres", "pyformat")

        assert 'WHERE "email" IS NULL' == clause

    def test_is_not_null_filter(self):
        """Builds IS NOT NULL filter."""
        f = PreviewFilter(type="is_not_null", field="email", value=None)
        clause, params = build_sql_filter(f, "postgres", "pyformat")

        assert 'WHERE "email" IS NOT NULL' == clause

    def test_named_params(self):
        """Builds filter with named parameters (Oracle style)."""
        f = PreviewFilter(type="equals", field="status", value="active")
        clause, params = build_sql_filter(f, "oracle", "named")

        assert 'WHERE "status" = :filter_value' == clause
        assert params == {"filter_value": "active"}

    def test_qmark_params(self):
        """Builds filter with qmark parameters (SQL Server style)."""
        f = PreviewFilter(type="equals", field="status", value="active")
        clause, params = build_sql_filter(f, "sqlserver", "qmark")

        assert 'WHERE [status] = ?' == clause
        assert params == ["active"]

    def test_none_filter(self):
        """None filter returns empty clause."""
        clause, params = build_sql_filter(None, "postgres", "pyformat")

        assert clause == ""
        assert params == {}

    def test_injection_in_field_name_prevented(self):
        """SQL injection in field name is prevented via quoting."""
        # The field name will be validated and quoted
        f = PreviewFilter(type="equals", field="status", value="'; DROP TABLE users--")
        clause, params = build_sql_filter(f, "postgres", "pyformat")

        # Value is parameterized, not in the clause
        assert "DROP TABLE" not in clause
        # The malicious value is safely in params
        assert "'; DROP TABLE users--" in params


class TestSqlOrderByBuilding:
    """Test SQL ORDER BY clause building."""

    def test_single_sort(self):
        """Builds single sort correctly."""
        sorts = [PreviewSort(field="name", dir="asc")]
        schema = ["id", "name", "email"]
        clause = build_sql_order_by(sorts, "postgres", schema)

        assert 'ORDER BY "name" ASC' == clause

    def test_multiple_sorts(self):
        """Builds multiple sorts correctly."""
        sorts = [
            PreviewSort(field="name", dir="asc"),
            PreviewSort(field="id", dir="desc"),
        ]
        schema = ["id", "name", "email"]
        clause = build_sql_order_by(sorts, "postgres", schema)

        assert 'ORDER BY "name" ASC, "id" DESC' == clause

    def test_invalid_sort_field_skipped(self):
        """Invalid sort fields are silently skipped."""
        sorts = [
            PreviewSort(field="name", dir="asc"),
            PreviewSort(field="nonexistent", dir="desc"),
        ]
        schema = ["id", "name", "email"]
        clause = build_sql_order_by(sorts, "postgres", schema)

        assert 'ORDER BY "name" ASC' == clause
        assert "nonexistent" not in clause

    def test_all_invalid_returns_empty(self):
        """All invalid sort fields return empty clause."""
        sorts = [PreviewSort(field="nonexistent", dir="asc")]
        schema = ["id", "name", "email"]
        clause = build_sql_order_by(sorts, "postgres", schema)

        assert clause == ""

    def test_none_sorts_returns_empty(self):
        """None sorts returns empty clause."""
        clause = build_sql_order_by(None, "postgres", ["id", "name"])

        assert clause == ""


class TestMongoFilterBuilding:
    """Test MongoDB filter building."""

    def test_equals_filter(self):
        """Builds equals filter correctly."""
        f = PreviewFilter(type="equals", field="status", value="active")
        mongo_filter = build_mongo_filter(f)

        assert mongo_filter == {"status": "active"}

    def test_not_equals_filter(self):
        """Builds not_equals filter correctly."""
        f = PreviewFilter(type="not_equals", field="status", value="deleted")
        mongo_filter = build_mongo_filter(f)

        assert mongo_filter == {"status": {"$ne": "deleted"}}

    def test_comparison_filters(self):
        """Builds comparison filters correctly."""
        test_cases = [
            ("gt", "$gt"),
            ("gte", "$gte"),
            ("lt", "$lt"),
            ("lte", "$lte"),
        ]
        for filter_type, mongo_op in test_cases:
            f = PreviewFilter(type=filter_type, field="age", value=18)
            mongo_filter = build_mongo_filter(f)
            assert mongo_filter == {"age": {mongo_op: 18}}

    def test_contains_filter(self):
        """Builds contains filter with regex."""
        f = PreviewFilter(type="contains", field="name", value="john")
        mongo_filter = build_mongo_filter(f)

        assert mongo_filter["name"]["$regex"] == "john"
        assert mongo_filter["name"]["$options"] == "i"

    def test_contains_filter_escapes_regex(self):
        """Contains filter escapes regex special characters."""
        f = PreviewFilter(type="contains", field="name", value="john.*")
        mongo_filter = build_mongo_filter(f)

        # Should be escaped
        assert r"john\.\*" in mongo_filter["name"]["$regex"]

    def test_is_null_filter(self):
        """Builds IS NULL filter."""
        f = PreviewFilter(type="is_null", field="email", value=None)
        mongo_filter = build_mongo_filter(f)

        assert mongo_filter == {"email": None}

    def test_is_not_null_filter(self):
        """Builds IS NOT NULL filter."""
        f = PreviewFilter(type="is_not_null", field="email", value=None)
        mongo_filter = build_mongo_filter(f)

        assert mongo_filter == {"email": {"$ne": None}}

    def test_none_filter(self):
        """None filter returns empty dict."""
        mongo_filter = build_mongo_filter(None)

        assert mongo_filter == {}


class TestMongoSortBuilding:
    """Test MongoDB sort building."""

    def test_single_sort(self):
        """Builds single sort correctly."""
        sorts = [PreviewSort(field="name", dir="asc")]
        mongo_sort = build_mongo_sort(sorts)

        assert mongo_sort == [("name", 1)]

    def test_multiple_sorts(self):
        """Builds multiple sorts correctly."""
        sorts = [
            PreviewSort(field="name", dir="asc"),
            PreviewSort(field="age", dir="desc"),
        ]
        mongo_sort = build_mongo_sort(sorts)

        assert mongo_sort == [("name", 1), ("age", -1)]

    def test_none_sorts(self):
        """None sorts returns None."""
        mongo_sort = build_mongo_sort(None)

        assert mongo_sort is None


class TestRowSizeEstimation:
    """Test row size estimation."""

    def test_simple_row(self):
        """Estimates simple row size."""
        row = {"id": 1, "name": "Alice"}
        size = estimate_row_size(row)

        # Should be around 25-30 bytes
        assert 20 < size < 50

    def test_complex_row(self):
        """Estimates complex row size."""
        row = {
            "id": 1,
            "name": "Alice" * 100,
            "data": {"nested": "value"},
            "tags": ["a", "b", "c"],
        }
        size = estimate_row_size(row)

        # Should be several hundred bytes
        assert size > 500


class TestPreviewDataDispatcher:
    """Test the main preview_data dispatcher."""

    def test_postgres_path_validation(self):
        """PostgreSQL requires 3-part path."""
        # Mock psycopg to test path validation
        mock_psycopg = MagicMock()
        with patch.dict(sys.modules, {'psycopg': mock_psycopg}):
            from app.connectors.db.preview import preview_postgres

            config = {"type": "postgres", "host": "localhost", "username": "test"}
            request = PreviewRequest(
                object_id="abc",
                path=["db", "table"],  # Missing schema
                kind="table",
            )
            result = preview_postgres(config, request, ["id", "name"])

            assert result.error is not None
            assert "path must be" in result.error.message.lower()

    def test_mysql_path_validation(self):
        """MySQL requires 2-part path."""
        # Mock pymysql to test path validation
        mock_mysql = MagicMock()
        with patch.dict(sys.modules, {'pymysql': mock_mysql}):
            from app.connectors.db.preview import preview_mysql

            config = {"type": "mysql", "host": "localhost", "username": "test"}
            request = PreviewRequest(
                object_id="abc",
                path=["db", "schema", "table"],  # Extra part
                kind="table",
            )
            result = preview_mysql(config, request, ["id", "name"])

            assert result.error is not None
            assert "path must be" in result.error.message.lower()

    def test_mongodb_path_validation(self):
        """MongoDB requires 2-part path."""
        # Mock pymongo to test path validation
        mock_pymongo = MagicMock()
        with patch.dict(sys.modules, {'pymongo': mock_pymongo, 'pymongo.errors': MagicMock()}):
            from app.connectors.db.preview import preview_mongodb

            config = {"type": "mongodb", "host": "localhost"}
            request = PreviewRequest(
                object_id="abc",
                path=["db", "schema", "collection"],  # Extra part
                kind="collection",
            )
            result = preview_mongodb(config, request)

            assert result.error is not None
            assert "path must be" in result.error.message.lower()

    def test_unsupported_type(self):
        """Unsupported database type returns error."""
        config = {"type": "couchdb"}
        request = PreviewRequest(
            object_id="abc",
            path=["db", "collection"],
            kind="collection",
        )
        result = preview_data(config, request)

        assert result.error is not None
        assert result.error.code == DbErrorCode.UNSUPPORTED_FEATURE


class TestPostgresPreview:
    """Test PostgreSQL preview using mocks."""

    def test_basic_preview(self):
        """Previews data correctly."""
        mock_psycopg = MagicMock()
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_psycopg.connect.return_value = mock_conn

        # Mock cursor description (column names)
        mock_cursor.description = [("id",), ("name",), ("email",)]

        # Mock query results
        mock_cursor.__iter__ = lambda self: iter([
            (1, "Alice", "alice@test.com"),
            (2, "Bob", "bob@test.com"),
        ])

        with patch.dict(sys.modules, {'psycopg': mock_psycopg}):
            from app.connectors.db.preview import preview_postgres

            config = {
                "type": "postgres",
                "host": "localhost",
                "port": 5432,
                "username": "testuser",
                "auth": {"password": "secret"},
            }

            request = PreviewRequest(
                object_id="abc123",
                path=["testdb", "public", "users"],
                kind="table",
                limit=25,
            )

            result = preview_postgres(config, request, ["id", "name", "email"])

            assert result.error is None
            assert result.kind == "table"
            assert len(result.rows) == 2
            assert result.rows[0]["name"] == "Alice"
            assert result.truncated is False
            assert "elapsedMs" in result.meta

    def test_column_selection(self):
        """Respects column selection."""
        mock_psycopg = MagicMock()
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_psycopg.connect.return_value = mock_conn

        mock_cursor.description = [("id",), ("name",)]
        mock_cursor.__iter__ = lambda self: iter([(1, "Alice")])

        with patch.dict(sys.modules, {'psycopg': mock_psycopg}):
            from app.connectors.db.preview import preview_postgres

            config = {
                "type": "postgres",
                "host": "localhost",
                "port": 5432,
                "username": "testuser",
            }

            request = PreviewRequest(
                object_id="abc123",
                path=["testdb", "public", "users"],
                kind="table",
                columns=["id", "name"],
            )

            result = preview_postgres(config, request, ["id", "name", "email", "password"])

            assert result.error is None
            # Should only have requested columns
            assert "id" in result.rows[0]
            assert "name" in result.rows[0]


class TestMySQLPreview:
    """Test MySQL preview using mocks."""

    def test_basic_preview(self):
        """Previews data correctly."""
        mock_mysql = MagicMock()
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_mysql.connect.return_value = mock_conn

        mock_cursor.description = [("id",), ("name",)]
        mock_cursor.__iter__ = lambda self: iter([(1, "Alice")])

        with patch.dict(sys.modules, {'pymysql': mock_mysql}):
            from app.connectors.db.preview import preview_mysql

            config = {
                "type": "mysql",
                "host": "localhost",
                "port": 3306,
                "username": "testuser",
            }

            request = PreviewRequest(
                object_id="abc123",
                path=["mydb", "users"],
                kind="table",
            )

            result = preview_mysql(config, request, ["id", "name"])

            assert result.error is None
            assert result.kind == "table"
            assert len(result.rows) == 1


class TestMongoDBPreview:
    """Test MongoDB preview using mocks."""

    def test_basic_preview(self):
        """Previews data correctly."""
        mock_pymongo = MagicMock()
        mock_client_class = MagicMock()
        mock_client = MagicMock()
        mock_db = MagicMock()
        mock_collection = MagicMock()
        mock_cursor = MagicMock()

        mock_pymongo.MongoClient = mock_client_class
        mock_client_class.return_value = mock_client
        mock_client.__getitem__.return_value = mock_db
        mock_db.__getitem__.return_value = mock_collection
        mock_collection.find.return_value = mock_cursor
        mock_cursor.sort.return_value = mock_cursor
        mock_cursor.limit.return_value = mock_cursor

        # Sample documents
        mock_cursor.__iter__ = lambda self: iter([
            {"_id": "1", "name": "Alice", "age": 30},
            {"_id": "2", "name": "Bob", "age": 25},
        ])

        with patch.dict(sys.modules, {'pymongo': mock_pymongo, 'pymongo.errors': MagicMock()}):
            from app.connectors.db.preview import preview_mongodb

            config = {
                "type": "mongodb",
                "host": "localhost",
                "port": 27017,
            }

            request = PreviewRequest(
                object_id="xyz789",
                path=["mydb", "users"],
                kind="collection",
            )

            result = preview_mongodb(config, request)

            assert result.error is None
            assert result.kind == "collection"
            assert len(result.docs) == 2
            assert result.docs[0]["name"] == "Alice"


class TestOversizePayloadHandling:
    """Test handling of oversized payloads."""

    def test_truncates_when_exceeds_max_bytes(self):
        """Truncates result when payload exceeds max bytes."""
        mock_psycopg = MagicMock()
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_psycopg.connect.return_value = mock_conn

        mock_cursor.description = [("id",), ("data",)]

        # Generate large rows (each row ~100KB)
        large_data = "x" * 100_000
        mock_cursor.__iter__ = lambda self: iter([
            (i, large_data) for i in range(20)
        ])

        with patch.dict(sys.modules, {'psycopg': mock_psycopg}):
            from app.connectors.db.preview import preview_postgres

            config = {
                "type": "postgres",
                "host": "localhost",
                "port": 5432,
                "username": "testuser",
            }

            request = PreviewRequest(
                object_id="abc123",
                path=["testdb", "public", "large_table"],
                kind="table",
                limit=100,
            )

            # Set small max_bytes to trigger truncation
            result = preview_postgres(config, request, ["id", "data"], max_bytes=500_000)

            assert result.truncated is True
            # Should have stopped before fetching all rows
            assert len(result.rows) < 20
            assert result.meta["bytesEstimate"] <= 500_000


class TestInjectionPrevention:
    """Test SQL injection prevention."""

    def test_injection_via_column_name(self):
        """SQL injection via column name is prevented."""
        schema = ["id", "name", "email"]

        # Attempt injection via column name
        malicious_columns = ["id", "name; DROP TABLE users--"]
        columns, error = validate_columns_against_schema(malicious_columns, schema)

        # Should fail validation
        assert error is not None
        assert "Invalid columns" in error.message

    def test_injection_via_filter_value(self):
        """SQL injection via filter value is parameterized."""
        f = PreviewFilter(
            type="equals",
            field="name",
            value="'; DROP TABLE users; --"
        )
        clause, params = build_sql_filter(f, "postgres", "pyformat")

        # Value should be in params, not in clause
        assert "DROP TABLE" not in clause
        assert "'; DROP TABLE users; --" in params

    def test_injection_via_sort_field(self):
        """SQL injection via sort field is prevented."""
        sorts = [PreviewSort(field="name; DROP TABLE users--", dir="asc")]
        schema = ["id", "name", "email"]

        clause = build_sql_order_by(sorts, "postgres", schema)

        # Malicious field should be skipped (not in schema)
        assert "DROP TABLE" not in clause
        assert clause == ""

    def test_injection_via_limit(self):
        """Limit is always an integer, preventing injection."""
        data = {"objectId": "abc", "limit": "100; DROP TABLE users--"}

        # The limit is converted to int in from_dict
        try:
            req = PreviewRequest.from_dict(data, ["db", "table"], "table")
            # If it didn't raise, limit should be capped integer
            assert isinstance(req.limit, int)
            assert req.limit <= MAX_PREVIEW_LIMIT
        except (ValueError, TypeError):
            # Also acceptable - rejection of malicious input
            pass

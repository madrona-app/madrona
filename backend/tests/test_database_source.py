"""
Tests for database source configuration schema and validation.

Tests cover:
- Config validation per database type
- Required field enforcement
- Secret reference patterns
- TLS and network configuration
- Capabilities per database type
"""

import pytest

from app.schemas.database_source import (
    DATABASE_CONFIG_SCHEMAS,
    DATABASE_DISPLAY_NAMES,
    DEFAULT_PORTS,
    DatabaseType,
    get_database_capabilities,
    validate_database_config,
)


class TestDatabaseTypeEnum:
    """Test DatabaseType enum values."""

    def test_all_types_defined(self):
        """All expected database types are defined."""
        expected = {"postgres", "mysql", "sqlserver", "oracle", "mongodb"}
        actual = {t.value for t in DatabaseType}
        assert actual == expected

    def test_schemas_exist_for_all_types(self):
        """Config schemas exist for all database types."""
        for db_type in DatabaseType:
            assert db_type.value in DATABASE_CONFIG_SCHEMAS


class TestDefaultPorts:
    """Test default port assignments."""

    def test_postgres_port(self):
        assert DEFAULT_PORTS["postgres"] == 5432

    def test_mysql_port(self):
        assert DEFAULT_PORTS["mysql"] == 3306

    def test_sqlserver_port(self):
        assert DEFAULT_PORTS["sqlserver"] == 1433

    def test_oracle_port(self):
        assert DEFAULT_PORTS["oracle"] == 1521

    def test_mongodb_port(self):
        assert DEFAULT_PORTS["mongodb"] == 27017


class TestPostgresValidation:
    """Test PostgreSQL config validation."""

    def test_valid_minimal_config(self):
        """Valid minimal PostgreSQL config passes validation."""
        config = {
            "name": "Test PG",
            "type": "postgres",
            "host": "localhost",
            "port": 5432,
            "database": "testdb",
            "username": "testuser",
            "auth": {"mode": "password", "password": "secret"},
        }
        is_valid, errors = validate_database_config(config)
        assert is_valid, f"Unexpected errors: {errors}"
        assert errors == []

    def test_missing_host_fails(self):
        """Missing host fails validation."""
        config = {
            "name": "Test PG",
            "type": "postgres",
            "port": 5432,
            "database": "testdb",
            "username": "testuser",
        }
        is_valid, errors = validate_database_config(config)
        assert not is_valid
        assert any("host" in e for e in errors)

    def test_missing_database_fails(self):
        """Missing database fails validation."""
        config = {
            "name": "Test PG",
            "type": "postgres",
            "host": "localhost",
            "port": 5432,
            "username": "testuser",
        }
        is_valid, errors = validate_database_config(config)
        assert not is_valid
        assert any("database" in e for e in errors)

    def test_missing_username_fails(self):
        """Missing username fails validation."""
        config = {
            "name": "Test PG",
            "type": "postgres",
            "host": "localhost",
            "port": 5432,
            "database": "testdb",
        }
        is_valid, errors = validate_database_config(config)
        assert not is_valid
        assert any("username" in e for e in errors)


class TestMySQLValidation:
    """Test MySQL config validation."""

    def test_valid_config(self):
        """Valid MySQL config passes validation."""
        config = {
            "name": "Test MySQL",
            "type": "mysql",
            "host": "mysql.example.com",
            "port": 3306,
            "database": "myapp",
            "username": "reader",
            "auth": {"mode": "password", "password": "secret"},
        }
        is_valid, errors = validate_database_config(config)
        assert is_valid, f"Unexpected errors: {errors}"


class TestSQLServerValidation:
    """Test SQL Server config validation."""

    def test_valid_config(self):
        """Valid SQL Server config passes validation."""
        config = {
            "name": "Test SQLServer",
            "type": "sqlserver",
            "host": "sql.example.com",
            "port": 1433,
            "database": "ERP",
            "username": "sa",
            "auth": {"mode": "password", "password": "secret"},
        }
        is_valid, errors = validate_database_config(config)
        assert is_valid, f"Unexpected errors: {errors}"


class TestOracleValidation:
    """Test Oracle config validation."""

    def test_valid_with_service_name(self):
        """Valid Oracle config with serviceName passes."""
        config = {
            "name": "Test Oracle",
            "type": "oracle",
            "host": "oracle.example.com",
            "port": 1521,
            "serviceName": "ORCL",
            "username": "SYSTEM",
            "auth": {"mode": "password", "password": "secret"},
        }
        is_valid, errors = validate_database_config(config)
        assert is_valid, f"Unexpected errors: {errors}"

    def test_valid_with_sid(self):
        """Valid Oracle config with SID passes."""
        config = {
            "name": "Test Oracle",
            "type": "oracle",
            "host": "oracle.example.com",
            "port": 1521,
            "sid": "ORCL",
            "username": "SYSTEM",
            "auth": {"mode": "password", "password": "secret"},
        }
        is_valid, errors = validate_database_config(config)
        assert is_valid, f"Unexpected errors: {errors}"

    def test_valid_with_connect_string(self):
        """Valid Oracle config with connectString passes."""
        config = {
            "name": "Test Oracle",
            "type": "oracle",
            "host": "oracle.example.com",
            "port": 1521,
            "connectString": "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=ora.example.com)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=ORCL)))",
            "username": "SYSTEM",
            "auth": {"mode": "password", "password": "secret"},
        }
        is_valid, errors = validate_database_config(config)
        assert is_valid, f"Unexpected errors: {errors}"

    def test_missing_connection_identifier_fails(self):
        """Oracle without serviceName, sid, or connectString fails."""
        config = {
            "name": "Test Oracle",
            "type": "oracle",
            "host": "oracle.example.com",
            "port": 1521,
            "username": "SYSTEM",
        }
        is_valid, errors = validate_database_config(config)
        assert not is_valid
        assert any("serviceName" in e or "sid" in e or "connectString" in e for e in errors)

    def test_multiple_connection_identifiers_fails(self):
        """Oracle with both serviceName and sid fails."""
        config = {
            "name": "Test Oracle",
            "type": "oracle",
            "host": "oracle.example.com",
            "port": 1521,
            "serviceName": "ORCL",
            "sid": "ORCL",
            "username": "SYSTEM",
        }
        is_valid, errors = validate_database_config(config)
        assert not is_valid
        assert any("only one" in e.lower() for e in errors)


class TestMongoDBValidation:
    """Test MongoDB config validation."""

    def test_valid_with_connection_uri(self):
        """Valid MongoDB config with connectionUri passes."""
        config = {
            "name": "Test MongoDB",
            "type": "mongodb",
            "connectionUri": "mongodb://localhost:27017/testdb",
            "username": "admin",
            "auth": {"mode": "password", "password": "secret"},
        }
        is_valid, errors = validate_database_config(config)
        assert is_valid, f"Unexpected errors: {errors}"

    def test_valid_with_host_port(self):
        """Valid MongoDB config with host+port passes."""
        config = {
            "name": "Test MongoDB",
            "type": "mongodb",
            "host": "mongo.example.com",
            "port": 27017,
            "database": "myapp",
            "username": "reader",
            "auth": {"mode": "password", "password": "secret"},
        }
        is_valid, errors = validate_database_config(config)
        assert is_valid, f"Unexpected errors: {errors}"

    def test_mongodb_srv_uri_valid(self):
        """MongoDB SRV URI is valid."""
        config = {
            "name": "Test MongoDB Atlas",
            "type": "mongodb",
            "connectionUri": "mongodb+srv://cluster0.example.mongodb.net/",
            "username": "admin",
        }
        is_valid, errors = validate_database_config(config)
        assert is_valid, f"Unexpected errors: {errors}"

    def test_missing_both_uri_and_host_fails(self):
        """MongoDB without connectionUri or host fails."""
        config = {
            "name": "Test MongoDB",
            "type": "mongodb",
            "username": "reader",
        }
        is_valid, errors = validate_database_config(config)
        assert not is_valid
        assert any("connectionUri" in e or "host" in e for e in errors)

    def test_both_uri_and_host_fails(self):
        """MongoDB with both connectionUri and host fails."""
        config = {
            "name": "Test MongoDB",
            "type": "mongodb",
            "connectionUri": "mongodb://localhost:27017/",
            "host": "localhost",
        }
        is_valid, errors = validate_database_config(config)
        assert not is_valid
        assert any("either" in e.lower() for e in errors)

    def test_invalid_uri_format_fails(self):
        """MongoDB with invalid URI format fails."""
        config = {
            "name": "Test MongoDB",
            "type": "mongodb",
            "connectionUri": "postgres://localhost:5432/db",  # Wrong protocol
        }
        is_valid, errors = validate_database_config(config)
        assert not is_valid
        assert any("mongodb://" in e or "mongodb+srv://" in e for e in errors)


class TestSecretRefValidation:
    """Test secret reference configuration."""

    def test_password_auth_with_secret_ref(self):
        """Config with secretRef is valid."""
        config = {
            "name": "Test PG",
            "type": "postgres",
            "host": "localhost",
            "port": 5432,
            "database": "testdb",
            "username": "testuser",
            "auth": {
                "mode": "password",
                "secretRef": {"type": "vault", "key": "secret/data/pg/password"},
            },
        }
        is_valid, errors = validate_database_config(config)
        assert is_valid, f"Unexpected errors: {errors}"

    def test_ssm_secret_ref(self):
        """SSM secret reference is valid."""
        config = {
            "name": "Test PG",
            "type": "postgres",
            "host": "localhost",
            "port": 5432,
            "database": "testdb",
            "username": "testuser",
            "auth": {
                "mode": "password",
                "secretRef": {"type": "ssm", "key": "/prod/pg/password"},
            },
        }
        is_valid, errors = validate_database_config(config)
        assert is_valid, f"Unexpected errors: {errors}"


class TestNetworkConfig:
    """Test network configuration validation."""

    def test_direct_mode_valid(self):
        """Direct network mode is valid."""
        config = {
            "name": "Test PG",
            "type": "postgres",
            "host": "localhost",
            "port": 5432,
            "database": "testdb",
            "username": "testuser",
            "network": {"mode": "direct"},
        }
        is_valid, errors = validate_database_config(config)
        assert is_valid, f"Unexpected errors: {errors}"

    def test_ssh_tunnel_requires_config(self):
        """SSH tunnel mode requires sshTunnelRef."""
        config = {
            "name": "Test PG",
            "type": "postgres",
            "host": "10.0.1.50",
            "port": 5432,
            "database": "testdb",
            "username": "testuser",
            "network": {"mode": "ssh_tunnel"},
        }
        is_valid, errors = validate_database_config(config)
        assert not is_valid
        assert any("sshTunnelRef" in e for e in errors)

    def test_ssh_tunnel_with_config_valid(self):
        """SSH tunnel with proper config is valid."""
        config = {
            "name": "Test PG",
            "type": "postgres",
            "host": "10.0.1.50",
            "port": 5432,
            "database": "testdb",
            "username": "testuser",
            "network": {
                "mode": "ssh_tunnel",
                "sshTunnelRef": {
                    "host": "bastion.example.com",
                    "username": "tunnel_user",
                    "privateKeyRef": {"type": "vault", "key": "secret/ssh/key"},
                },
            },
        }
        is_valid, errors = validate_database_config(config)
        assert is_valid, f"Unexpected errors: {errors}"


class TestDatabaseCapabilities:
    """Test capabilities per database type."""

    def test_postgres_capabilities(self):
        """PostgreSQL has expected capabilities."""
        caps = get_database_capabilities("postgres")
        assert caps["supportsSchemas"] is True
        assert caps["supportsViews"] is True
        assert caps["supportsSql"] is True
        assert caps["defaultSchema"] == "public"

    def test_mysql_capabilities(self):
        """MySQL has expected capabilities."""
        caps = get_database_capabilities("mysql")
        assert caps["supportsSchemas"] is False  # Databases act as schemas
        assert caps["supportsViews"] is True
        assert caps["supportsSql"] is True

    def test_sqlserver_capabilities(self):
        """SQL Server has expected capabilities."""
        caps = get_database_capabilities("sqlserver")
        assert caps["supportsSchemas"] is True
        assert caps["defaultSchema"] == "dbo"

    def test_oracle_capabilities(self):
        """Oracle has expected capabilities."""
        caps = get_database_capabilities("oracle")
        assert caps["supportsSchemas"] is True
        assert caps["supportsViews"] is True

    def test_mongodb_capabilities(self):
        """MongoDB has expected capabilities."""
        caps = get_database_capabilities("mongodb")
        assert caps["supportsSchemas"] is False
        assert caps["supportsViews"] is False
        assert caps["supportsSql"] is False
        assert caps["supportsTableDiscovery"] is True
        assert caps["supportsColumnDiscovery"] is False  # Schemaless


class TestUnsupportedType:
    """Test handling of unsupported database types."""

    def test_unknown_type_fails(self):
        """Unknown database type fails validation."""
        config = {
            "name": "Test Unknown",
            "type": "couchdb",  # Not supported
            "host": "localhost",
            "port": 5984,
        }
        is_valid, errors = validate_database_config(config)
        assert not is_valid
        assert any("Unsupported" in e for e in errors)

    def test_missing_type_fails(self):
        """Missing type fails validation."""
        config = {
            "name": "Test",
            "host": "localhost",
            "port": 5432,
        }
        is_valid, errors = validate_database_config(config)
        assert not is_valid
        assert any("type" in e.lower() for e in errors)


class TestDisplayNames:
    """Test display name mappings."""

    def test_all_types_have_display_names(self):
        """All database types have display names."""
        for db_type in DatabaseType:
            assert db_type.value in DATABASE_DISPLAY_NAMES
            assert len(DATABASE_DISPLAY_NAMES[db_type.value]) > 0

    def test_display_name_values(self):
        """Display names are human-readable."""
        assert DATABASE_DISPLAY_NAMES["postgres"] == "PostgreSQL"
        assert DATABASE_DISPLAY_NAMES["mysql"] == "MySQL"
        assert DATABASE_DISPLAY_NAMES["sqlserver"] == "Microsoft SQL Server"
        assert DATABASE_DISPLAY_NAMES["oracle"] == "Oracle Database"
        assert DATABASE_DISPLAY_NAMES["mongodb"] == "MongoDB"

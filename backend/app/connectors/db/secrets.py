"""
Secrets resolution for database connectors.

Resolves secret references to actual values. Supports:
- Inline values (for dev/test)
- Environment variables
- AWS Secrets Manager (via boto3)
- AWS SSM Parameter Store (via boto3)
- HashiCorp Vault (via hvac)
- File-based secrets

Optional dependencies:
- ``boto3`` for AWS SSM and Secrets Manager
- ``hvac`` for HashiCorp Vault
"""

import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)


class SecretResolutionError(Exception):
    """Raised when a secret cannot be resolved."""

    pass


def _resolve_vault(key: str) -> str:
    """
    Resolve a secret from HashiCorp Vault (KV v2 engine).

    The ``key`` should be in the format ``mount/path#field``, e.g.
    ``secret/data/myapp/db#password``.  If no ``#field`` suffix is
    provided, the entire secret JSON is returned as a string.

    Environment variables used for configuration:
    - VAULT_ADDR: Vault server URL (required)
    - VAULT_TOKEN: Authentication token (required unless VAULT_ROLE_ID set)
    - VAULT_ROLE_ID / VAULT_SECRET_ID: AppRole authentication
    - VAULT_NAMESPACE: Optional namespace for Vault Enterprise
    - VAULT_MOUNT_POINT: KV engine mount point (default: "secret")
    """
    try:
        import hvac
    except ImportError:
        raise SecretResolutionError(
            "HashiCorp Vault support requires the 'hvac' package. "
            "Install it with: pip install hvac"
        )

    vault_addr = os.environ.get("VAULT_ADDR")
    if not vault_addr:
        raise SecretResolutionError(
            "VAULT_ADDR environment variable is required for Vault secret resolution"
        )

    namespace = os.environ.get("VAULT_NAMESPACE")
    client = hvac.Client(url=vault_addr, namespace=namespace)

    # Authenticate: token takes precedence, then AppRole
    vault_token = os.environ.get("VAULT_TOKEN")
    if vault_token:
        client.token = vault_token
    else:
        role_id = os.environ.get("VAULT_ROLE_ID")
        secret_id = os.environ.get("VAULT_SECRET_ID")
        if role_id and secret_id:
            client.auth.approle.login(role_id=role_id, secret_id=secret_id)
        else:
            raise SecretResolutionError(
                "Vault authentication requires either VAULT_TOKEN or "
                "VAULT_ROLE_ID + VAULT_SECRET_ID environment variables"
            )

    if not client.is_authenticated():
        raise SecretResolutionError("Failed to authenticate with Vault")

    # Parse key: "path#field" or just "path"
    field = None
    path = key
    if "#" in key:
        path, field = key.rsplit("#", 1)

    mount_point = os.environ.get("VAULT_MOUNT_POINT", "secret")

    try:
        response = client.secrets.kv.v2.read_secret_version(
            path=path, mount_point=mount_point
        )
    except Exception as e:
        raise SecretResolutionError(f"Failed to read Vault secret at '{path}': {e}")

    secret_data = response.get("data", {}).get("data", {})
    if not secret_data:
        raise SecretResolutionError(f"Vault secret at '{path}' is empty or not found")

    if field:
        if field not in secret_data:
            raise SecretResolutionError(
                f"Field '{field}' not found in Vault secret at '{path}'. "
                f"Available fields: {list(secret_data.keys())}"
            )
        return str(secret_data[field])

    # No field specified — return first value if single-field, else JSON
    if len(secret_data) == 1:
        return str(next(iter(secret_data.values())))
    return json.dumps(secret_data)


def _resolve_ssm(key: str) -> str:
    """
    Resolve a secret from AWS SSM Parameter Store.

    The ``key`` is the SSM parameter name, e.g. ``/myapp/db/password``.
    Always fetches with decryption enabled for SecureString parameters.

    Uses the default boto3 credential chain (env vars, instance profile,
    config files, etc.).
    """
    try:
        import boto3
        from botocore.exceptions import ClientError
    except ImportError:
        raise SecretResolutionError(
            "AWS SSM support requires the 'boto3' package. "
            "Install it with: pip install boto3"
        )

    region = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION"))
    try:
        client = boto3.client("ssm", region_name=region)
        response = client.get_parameter(Name=key, WithDecryption=True)
        return response["Parameter"]["Value"]
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "")
        if error_code == "ParameterNotFound":
            raise SecretResolutionError(f"SSM parameter '{key}' not found")
        raise SecretResolutionError(f"Failed to resolve SSM parameter '{key}': {e}")
    except Exception as e:
        raise SecretResolutionError(f"Failed to resolve SSM parameter '{key}': {e}")


def _resolve_secrets_manager(key: str) -> str:
    """
    Resolve a secret from AWS Secrets Manager.

    The ``key`` can be:
    - A secret name or ARN: returns the full secret string
    - ``name#field``: parses the secret as JSON and returns a specific field

    Uses the default boto3 credential chain.
    """
    try:
        import boto3
        from botocore.exceptions import ClientError
    except ImportError:
        raise SecretResolutionError(
            "AWS Secrets Manager support requires the 'boto3' package. "
            "Install it with: pip install boto3"
        )

    # Parse key: "secret_name#field" or just "secret_name"
    field = None
    secret_id = key
    if "#" in key and not key.startswith("arn:"):
        secret_id, field = key.rsplit("#", 1)

    region = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION"))
    try:
        client = boto3.client("secretsmanager", region_name=region)
        response = client.get_secret_value(SecretId=secret_id)
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "")
        if error_code == "ResourceNotFoundException":
            raise SecretResolutionError(
                f"Secrets Manager secret '{secret_id}' not found"
            )
        raise SecretResolutionError(
            f"Failed to resolve Secrets Manager secret '{secret_id}': {e}"
        )
    except Exception as e:
        raise SecretResolutionError(
            f"Failed to resolve Secrets Manager secret '{secret_id}': {e}"
        )

    secret_string = response.get("SecretString")
    if secret_string is None:
        raise SecretResolutionError(
            f"Secrets Manager secret '{secret_id}' has no string value "
            "(binary secrets are not supported)"
        )

    if field:
        try:
            secret_data = json.loads(secret_string)
        except json.JSONDecodeError:
            raise SecretResolutionError(
                f"Cannot extract field '{field}' — secret '{secret_id}' "
                "is not valid JSON"
            )
        if field not in secret_data:
            raise SecretResolutionError(
                f"Field '{field}' not found in secret '{secret_id}'. "
                f"Available fields: {list(secret_data.keys())}"
            )
        return str(secret_data[field])

    return secret_string


def resolve_secret_ref(secret_ref: dict[str, Any]) -> str:
    """
    Resolve a secret reference to its actual value.

    Args:
        secret_ref: Dict with 'type' and 'key' fields.
            Supported types: env, vault, ssm, secrets_manager, file

    Returns:
        The resolved secret value

    Raises:
        SecretResolutionError: If the secret cannot be resolved
    """
    ref_type = secret_ref.get("type")
    key = secret_ref.get("key")

    if not ref_type or not key:
        raise SecretResolutionError("secretRef must have 'type' and 'key' fields")

    if ref_type == "env":
        value = os.environ.get(key)
        if value is None:
            raise SecretResolutionError(f"Environment variable '{key}' not found")
        return value

    elif ref_type == "vault":
        return _resolve_vault(key)

    elif ref_type == "ssm":
        return _resolve_ssm(key)

    elif ref_type == "secrets_manager":
        return _resolve_secrets_manager(key)

    elif ref_type == "file":
        # Read secret from file (useful for certificates)
        try:
            with open(key, "r") as f:
                return f.read().strip()
        except FileNotFoundError:
            raise SecretResolutionError(f"Secret file not found: {key}")
        except PermissionError:
            raise SecretResolutionError(f"Permission denied reading secret file: {key}")

    else:
        raise SecretResolutionError(f"Unknown secret reference type: {ref_type}")


def resolve_password(auth_config: dict[str, Any]) -> str | None:
    """
    Resolve password from auth configuration.

    Supports both inline password and secretRef.

    Args:
        auth_config: Auth configuration dict with 'password' or 'secretRef'

    Returns:
        The resolved password, or None if no password configured

    Raises:
        SecretResolutionError: If secretRef cannot be resolved
    """
    if not auth_config:
        return None

    # Inline password takes precedence (for dev/test convenience)
    if "password" in auth_config:
        return auth_config["password"]

    # Resolve from secret reference
    if "secretRef" in auth_config:
        return resolve_secret_ref(auth_config["secretRef"])

    return None


def resolve_certificate(cert_ref: dict[str, Any] | None) -> str | None:
    """
    Resolve a certificate reference to its content or path.

    For database drivers, certificates are typically referenced by path.
    This function resolves the reference and returns the path or content.

    Args:
        cert_ref: Certificate reference dict with 'type' and 'key'

    Returns:
        Certificate content or path, or None if not configured

    Raises:
        SecretResolutionError: If certificate cannot be resolved
    """
    if not cert_ref:
        return None

    ref_type = cert_ref.get("type")
    key = cert_ref.get("key")

    if not ref_type or not key:
        return None

    if ref_type == "file":
        # For files, just return the path - driver will read it
        if not os.path.exists(key):
            raise SecretResolutionError(f"Certificate file not found: {key}")
        return key

    elif ref_type == "env":
        # Environment variable containing path or base64-encoded cert
        value = os.environ.get(key)
        if value is None:
            raise SecretResolutionError(f"Certificate env var '{key}' not found")
        return value

    else:
        # For vault/ssm/secrets_manager, resolve and return content
        return resolve_secret_ref(cert_ref)

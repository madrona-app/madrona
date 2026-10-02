"""
Shared utilities for ops scripts.

Provides:
- Destructive operation confirmation
- Database session management
- Audit logging for ops actions
- Common Cognito admin operations
"""

import os
import sys
import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

import boto3
from botocore.exceptions import ClientError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

# Add app to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

from app.models import AuditLog, User, Organization, OrganizationMembership, Role

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# =============================================================================
# Confirmation Requirement
# =============================================================================

CONFIRMATION_ENV_VAR = 'I_UNDERSTAND_THIS_IS_DESTRUCTIVE'


def require_confirmation(operation_name: str) -> None:
    """
    Require explicit confirmation for destructive operations.

    Checks for environment variable:
        I_UNDERSTAND_THIS_IS_DESTRUCTIVE=true

    Args:
        operation_name: Human-readable name of the operation

    Raises:
        SystemExit: If confirmation env var is not set
    """
    confirmation = os.environ.get(CONFIRMATION_ENV_VAR, '').lower()

    if confirmation != 'true':
        logger.error(
            f"Operation '{operation_name}' requires explicit confirmation.\n"
            f"Set environment variable: {CONFIRMATION_ENV_VAR}=true\n"
            f"Example: {CONFIRMATION_ENV_VAR}=true python scripts/ops/{operation_name}.py ..."
        )
        sys.exit(1)

    logger.info(f"Confirmation received for operation: {operation_name}")


# =============================================================================
# Database Session Management
# =============================================================================


def get_database_url() -> str:
    """Get database URL from environment."""
    url = os.environ.get('DATABASE_URL')
    if not url:
        # Try constructing from individual vars
        host = os.environ.get('DB_HOST', 'localhost')
        port = os.environ.get('DB_PORT', '5432')
        name = os.environ.get('DB_NAME', 'madrona')
        user = os.environ.get('DB_USER', 'postgres')
        password = os.environ.get('DB_PASSWORD', '')

        if password:
            url = f"postgresql://{user}:{password}@{host}:{port}/{name}"
        else:
            url = f"postgresql://{user}@{host}:{port}/{name}"

    return url


def get_db_session() -> Session:
    """
    Create a database session for ops scripts.

    Uses DATABASE_URL or constructs from DB_* env vars.

    Returns:
        SQLAlchemy Session
    """
    url = get_database_url()
    engine = create_engine(url)
    SessionLocal = sessionmaker(bind=engine)
    return SessionLocal()


# =============================================================================
# Cognito Admin Operations
#
# Core admin methods live in app.services.cognito.CognitoService.
# We re-export wrappers here for backwards compatibility with ops scripts,
# plus keep ops-only helpers (disable MFA, devices, get user) below.
# =============================================================================

from app.services.cognito import (
    cognito_admin_create_user as _cognito_create,
    cognito_admin_set_user_password,
    cognito_admin_delete_user,
    CognitoAuthError,
)


def cognito_admin_create_user(
    email: str,
    temporary_password: str,
    suppress_welcome_email: bool = False,
) -> dict:
    """
    Create a new user in Cognito using AdminCreateUser.

    Thin wrapper that maps the legacy suppress_welcome_email param name
    to the canonical suppress_welcome param on CognitoService.
    """
    return _cognito_create(
        email=email,
        temporary_password=temporary_password,
        suppress_welcome=suppress_welcome_email,
    )


def get_cognito_client():
    """Get boto3 Cognito IDP client."""
    region = os.environ.get('AWS_REGION', 'us-west-2')
    return boto3.client('cognito-idp', region_name=region)


def get_user_pool_id() -> str:
    """Get Cognito User Pool ID from environment."""
    pool_id = os.environ.get('COGNITO_USER_POOL_ID')
    if not pool_id:
        logger.error("COGNITO_USER_POOL_ID environment variable is required")
        sys.exit(1)
    return pool_id


def cognito_admin_disable_mfa(email: str) -> None:
    """
    Disable all MFA for a user using AdminSetUserMFAPreference.

    Args:
        email: User's email (username)

    Raises:
        ClientError: Cognito API error
    """
    client = get_cognito_client()
    pool_id = get_user_pool_id()

    client.admin_set_user_mfa_preference(
        UserPoolId=pool_id,
        Username=email.lower(),
        SoftwareTokenMfaSettings={
            'Enabled': False,
            'PreferredMfa': False,
        },
        SMSMfaSettings={
            'Enabled': False,
            'PreferredMfa': False,
        },
    )

    logger.info(f"Disabled MFA for user: {email}")


def cognito_admin_forget_device(email: str, device_key: str) -> None:
    """
    Forget a remembered device for a user.

    Args:
        email: User's email (username)
        device_key: Device key to forget

    Raises:
        ClientError: Cognito API error
    """
    client = get_cognito_client()
    pool_id = get_user_pool_id()

    client.admin_forget_device(
        UserPoolId=pool_id,
        Username=email.lower(),
        DeviceKey=device_key,
    )

    logger.info(f"Forgot device {device_key} for user: {email}")


def cognito_admin_list_devices(email: str) -> list:
    """
    List all devices for a user.

    Args:
        email: User's email (username)

    Returns:
        List of device records

    Raises:
        ClientError: Cognito API error
    """
    client = get_cognito_client()
    pool_id = get_user_pool_id()

    try:
        response = client.admin_list_devices(
            UserPoolId=pool_id,
            Username=email.lower(),
            Limit=60,
        )
        return response.get('Devices', [])
    except ClientError as e:
        if e.response['Error']['Code'] == 'InvalidParameterException':
            # User has no devices
            return []
        raise


def cognito_admin_get_user(email: str) -> dict:
    """
    Get user info from Cognito using admin API.

    Args:
        email: User's email (username)

    Returns:
        User data dict

    Raises:
        ClientError: Cognito API error
    """
    client = get_cognito_client()
    pool_id = get_user_pool_id()

    response = client.admin_get_user(
        UserPoolId=pool_id,
        Username=email.lower(),
    )

    # Parse attributes into dict
    user_data = {
        'username': response.get('Username'),
        'status': response.get('UserStatus'),
        'enabled': response.get('Enabled'),
        'created': response.get('UserCreateDate'),
        'modified': response.get('UserLastModifiedDate'),
        'mfa_settings': response.get('UserMFASettingList', []),
        'preferred_mfa': response.get('PreferredMfaSetting'),
    }

    for attr in response.get('UserAttributes', []):
        user_data[attr['Name']] = attr['Value']

    return user_data


# =============================================================================
# Audit Logging for Ops
# =============================================================================


def log_ops_action(
    db: Session,
    action: str,
    operator_email: str,
    target_email: Optional[str] = None,
    organization_id: Optional[UUID] = None,
    details: Optional[dict] = None,
) -> AuditLog:
    """
    Log an ops action to the audit log.

    For ops actions performed outside of normal app flow, we log with:
    - action: prefixed with 'ops.' (e.g., 'ops.user_created', 'ops.mfa_reset')
    - acting_user_id: The operator's user ID (if they exist in the system)
    - details: Include operator email and context

    Args:
        db: Database session
        action: Action name (will be prefixed with 'ops.')
        operator_email: Email of the operator performing the action
        target_email: Email of the target user (if applicable)
        organization_id: Organization context (if applicable)
        details: Additional details to log

    Returns:
        Created AuditLog record
    """
    # Find operator in database (they may not exist)
    operator = db.query(User).filter_by(email=operator_email.lower()).first()

    # Find target user in database (if specified)
    target_user = None
    if target_email:
        target_user = db.query(User).filter_by(email=target_email.lower()).first()

    # If no org specified, try to get from operator's membership
    if not organization_id and operator:
        membership = db.query(OrganizationMembership).filter_by(
            user_id=operator.user_id
        ).first()
        if membership:
            organization_id = membership.organization_id

    # If still no org and we have a target user, try their membership
    if not organization_id and target_user:
        membership = db.query(OrganizationMembership).filter_by(
            user_id=target_user.user_id
        ).first()
        if membership:
            organization_id = membership.organization_id

    # Build details
    log_details = {
        'operator_email': operator_email,
        'performed_at': datetime.now(timezone.utc).isoformat(),
        'script': sys.argv[0] if sys.argv else 'unknown',
    }
    if target_email:
        log_details['target_email'] = target_email
    if details:
        log_details.update(details)

    audit_log = AuditLog(
        organization_id=organization_id,
        acting_user_id=operator.user_id if operator else None,
        target_user_id=target_user.user_id if target_user else None,
        action=f'ops.{action}',
        details=log_details,
    )

    db.add(audit_log)
    db.flush()

    logger.info(f"Audit: ops.{action} - {operator_email} -> {target_email or 'N/A'}")

    return audit_log


# =============================================================================
# Database Lookup Helpers
# =============================================================================


def get_user_by_email(db: Session, email: str) -> Optional[User]:
    """Get user by email address."""
    return db.query(User).filter_by(email=email.lower()).first()


def get_role_by_key(db: Session, role_key: str) -> Optional[Role]:
    """Get role by role_key (e.g., 'registrar')."""
    return db.query(Role).filter_by(role_key=role_key).first()


def get_organization_by_id(db: Session, org_id: UUID) -> Optional[Organization]:
    """Get organization by ID."""
    return db.query(Organization).filter_by(organization_id=org_id).first()


def get_organization_by_name(db: Session, name: str) -> Optional[Organization]:
    """Get organization by name (case-insensitive partial match)."""
    return db.query(Organization).filter(
        Organization.name.ilike(f'%{name}%')
    ).first()

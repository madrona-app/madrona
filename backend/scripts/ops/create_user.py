#!/usr/bin/env python3
"""
Create a new user in Cognito and optionally in the Madrona database.

Usage:
    I_UNDERSTAND_THIS_IS_DESTRUCTIVE=true python scripts/ops/create_user.py \\
        --email user@example.com \\
        --temp-password TempPass123! \\
        --operator admin@madrona.com \\
        [--suppress-email] \\
        [--org-name "Organization Name"] \\
        [--role registrar]

This script:
1. Creates user in Cognito with temporary password
2. Optionally creates user in Madrona database
3. Optionally assigns to organization with role
4. Logs action to audit trail

The user will be prompted to change their password on first login.

Environment variables required:
    I_UNDERSTAND_THIS_IS_DESTRUCTIVE=true
    AWS_REGION (default: us-west-2)
    COGNITO_USER_POOL_ID
    DATABASE_URL (or DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD)
"""

import argparse
import secrets
import string
import sys
import os
from uuid import uuid4

# Add parent directories to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

from scripts.ops.utils import (
    require_confirmation,
    get_db_session,
    cognito_admin_create_user,
    cognito_admin_get_user,
    log_ops_action,
    get_user_by_email,
    get_role_by_key,
    get_organization_by_name,
    logger,
)
from app.models import User, OrganizationMembership
from botocore.exceptions import ClientError


def generate_temp_password(length: int = 16) -> str:
    """Generate a secure temporary password meeting Cognito requirements."""
    # Must have: uppercase, lowercase, digit, special char
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    while True:
        password = ''.join(secrets.choice(alphabet) for _ in range(length))
        # Verify it meets requirements
        if (any(c.isupper() for c in password) and
            any(c.islower() for c in password) and
            any(c.isdigit() for c in password) and
            any(c in "!@#$%^&*" for c in password)):
            return password


def main():
    parser = argparse.ArgumentParser(
        description='Create a new user in Cognito and Madrona',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument(
        '--email', '-e',
        required=True,
        help='Email address for the new user'
    )
    parser.add_argument(
        '--temp-password', '-p',
        help='Temporary password (auto-generated if not provided)'
    )
    parser.add_argument(
        '--operator', '-o',
        required=True,
        help='Email of the operator performing this action (for audit)'
    )
    parser.add_argument(
        '--suppress-email',
        action='store_true',
        help='Do not send welcome email from Cognito'
    )
    parser.add_argument(
        '--org-name',
        help='Organization name to add user to (optional)'
    )
    parser.add_argument(
        '--org-id',
        help='Organization ID to add user to (optional, alternative to --org-name)'
    )
    parser.add_argument(
        '--role',
        default='viewer',
        help=(
            'Role to assign (default: viewer — least privilege). '
            'Options: admin, registrar, curator, publisher, viewer.'
        ),
    )
    parser.add_argument(
        '--cognito-only',
        action='store_true',
        help='Only create in Cognito, skip Madrona database'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would be done without making changes'
    )

    args = parser.parse_args()

    # Require confirmation for destructive operations
    if not args.dry_run:
        require_confirmation('create_user')

    email = args.email.lower().strip()
    temp_password = args.temp_password or generate_temp_password()

    logger.info(f"Creating user: {email}")

    # Dry run mode
    if args.dry_run:
        logger.info("[DRY RUN] Would create user in Cognito")
        if not args.cognito_only:
            logger.info("[DRY RUN] Would create user in Madrona database")
            if args.org_name or args.org_id:
                logger.info(f"[DRY RUN] Would assign role '{args.role}' in organization")
        if not args.temp_password:
            logger.info(f"[DRY RUN] Generated temporary password: {temp_password}")
        return

    # Step 1: Create user in Cognito
    try:
        cognito_user = cognito_admin_create_user(
            email=email,
            temporary_password=temp_password,
            suppress_welcome_email=args.suppress_email,
        )
        cognito_sub = cognito_user['Username']
        logger.info(f"Created Cognito user with sub: {cognito_sub}")
    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', '')
        if error_code == 'UsernameExistsException':
            logger.error(f"User {email} already exists in Cognito")
            # Try to get existing user info
            try:
                existing = cognito_admin_get_user(email)
                cognito_sub = existing.get('sub') or existing.get('username')
                logger.info(f"Existing Cognito user sub: {cognito_sub}")
            except Exception:
                logger.error("Could not retrieve existing user info")
                sys.exit(1)
        else:
            logger.error(f"Cognito error: {e}")
            sys.exit(1)

    if args.cognito_only:
        logger.info("Cognito-only mode, skipping database creation")
        print(f"\nUser created in Cognito:")
        print(f"  Email: {email}")
        print(f"  Temporary password: {temp_password}")
        print(f"  Status: FORCE_CHANGE_PASSWORD")
        return

    # Step 2: Create user in Madrona database
    db = get_db_session()
    try:
        # Check if user already exists in database
        existing_user = get_user_by_email(db, email)
        if existing_user:
            logger.warning(f"User {email} already exists in database (ID: {existing_user.user_id})")
            user = existing_user
        else:
            user = User(
                user_id=uuid4(),
                email=email,
                cognito_sub=cognito_sub,
                status='active',
                email_status='active',
            )
            db.add(user)
            db.flush()
            logger.info(f"Created database user: {user.user_id}")

        # Step 3: Assign to organization with role (if specified)
        organization = None
        if args.org_id:
            from uuid import UUID
            organization = db.query(__import__('app.models', fromlist=['Organization']).Organization).filter_by(
                organization_id=UUID(args.org_id)
            ).first()
        elif args.org_name:
            organization = get_organization_by_name(db, args.org_name)

        if organization:
            # Check if membership already exists
            existing_membership = db.query(OrganizationMembership).filter_by(
                user_id=user.user_id,
                organization_id=organization.organization_id,
            ).first()

            if existing_membership:
                logger.warning(f"User already has membership in {organization.name}")
            else:
                role = get_role_by_key(db, args.role)
                if not role:
                    logger.error(f"Role '{args.role}' not found")
                    db.rollback()
                    sys.exit(1)

                membership = OrganizationMembership(
                    membership_id=uuid4(),
                    user_id=user.user_id,
                    organization_id=organization.organization_id,
                    role_id=role.role_id,
                    role=args.role.replace('org_', '') if args.role.startswith('org_') else args.role,  # Legacy compat
                    status='active',
                )
                db.add(membership)
                logger.info(f"Added user to organization '{organization.name}' with role '{args.role}'")

        # Step 4: Log audit entry
        log_ops_action(
            db=db,
            action='user_created',
            operator_email=args.operator,
            target_email=email,
            organization_id=organization.organization_id if organization else None,
            details={
                'cognito_sub': cognito_sub,
                'role': args.role if organization else None,
                'organization_name': organization.name if organization else None,
                'suppress_email': args.suppress_email,
            }
        )

        db.commit()
        logger.info("Database changes committed")

    except Exception as e:
        logger.error(f"Database error: {e}")
        db.rollback()
        raise
    finally:
        db.close()

    # Print summary
    print(f"\nUser created successfully:")
    print(f"  Email: {email}")
    print(f"  Temporary password: {temp_password}")
    print(f"  User ID: {user.user_id}")
    if organization:
        print(f"  Organization: {organization.name}")
        print(f"  Role: {args.role}")
    print(f"\nThe user must change their password on first login.")


if __name__ == '__main__':
    main()

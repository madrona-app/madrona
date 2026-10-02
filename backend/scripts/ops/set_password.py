#!/usr/bin/env python3
"""
Set a user's password in Cognito.

Usage:
    I_UNDERSTAND_THIS_IS_DESTRUCTIVE=true python scripts/ops/set_password.py \\
        --email user@example.com \\
        --password NewSecurePass123! \\
        --operator admin@madrona.com \\
        [--temporary]

This script:
1. Sets user's password in Cognito using AdminSetUserPassword
2. By default, password is permanent (no force change required)
3. Use --temporary to require password change on next login
4. Logs action to audit trail

Use cases:
- Reset password for locked out users
- Set permanent password after admin-created temp password
- Emergency password reset

Environment variables required:
    I_UNDERSTAND_THIS_IS_DESTRUCTIVE=true
    AWS_REGION (default: us-west-2)
    COGNITO_USER_POOL_ID
    DATABASE_URL (for audit logging)
"""

import argparse
import getpass
import sys
import os

# Add parent directories to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

from scripts.ops.utils import (
    require_confirmation,
    get_db_session,
    cognito_admin_set_user_password,
    cognito_admin_get_user,
    log_ops_action,
    get_user_by_email,
    logger,
)
from botocore.exceptions import ClientError


def main():
    parser = argparse.ArgumentParser(
        description='Set a user\'s password in Cognito',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument(
        '--email', '-e',
        required=True,
        help='Email address of the user'
    )
    parser.add_argument(
        '--password', '-p',
        help='New password (prompted securely if not provided)'
    )
    parser.add_argument(
        '--operator', '-o',
        required=True,
        help='Email of the operator performing this action (for audit)'
    )
    parser.add_argument(
        '--temporary', '-t',
        action='store_true',
        help='Set as temporary password (user must change on login)'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would be done without making changes'
    )

    args = parser.parse_args()

    # Require confirmation for destructive operations
    if not args.dry_run:
        require_confirmation('set_password')

    email = args.email.lower().strip()

    # Get password securely if not provided
    password = args.password
    if not password and not args.dry_run:
        password = getpass.getpass(f"Enter new password for {email}: ")
        confirm = getpass.getpass("Confirm password: ")
        if password != confirm:
            logger.error("Passwords do not match")
            sys.exit(1)

    permanent = not args.temporary

    logger.info(f"Setting password for: {email} (permanent={permanent})")

    # Dry run mode
    if args.dry_run:
        logger.info(f"[DRY RUN] Would set {'temporary' if args.temporary else 'permanent'} password for {email}")
        return

    # Verify user exists in Cognito
    try:
        cognito_user = cognito_admin_get_user(email)
        logger.info(f"Found Cognito user: {cognito_user.get('username')} (status: {cognito_user.get('status')})")
    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', '')
        if error_code == 'UserNotFoundException':
            logger.error(f"User {email} not found in Cognito")
            sys.exit(1)
        raise

    # Set the password
    try:
        cognito_admin_set_user_password(
            email=email,
            password=password,
            permanent=permanent,
        )
        logger.info(f"Password set successfully for {email}")
    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', '')
        error_msg = e.response.get('Error', {}).get('Message', str(e))
        if error_code == 'InvalidPasswordException':
            logger.error(f"Invalid password: {error_msg}")
            logger.error("Password must meet Cognito requirements (uppercase, lowercase, number, special char, min 8 chars)")
        else:
            logger.error(f"Failed to set password: {error_msg}")
        sys.exit(1)

    # Log audit entry
    db = get_db_session()
    try:
        user = get_user_by_email(db, email)

        log_ops_action(
            db=db,
            action='password_reset',
            operator_email=args.operator,
            target_email=email,
            details={
                'permanent': permanent,
                'user_status_before': cognito_user.get('status'),
            }
        )

        db.commit()
        logger.info("Audit log entry created")
    except Exception as e:
        logger.warning(f"Failed to create audit log (non-fatal): {e}")
        db.rollback()
    finally:
        db.close()

    # Print summary
    print(f"\nPassword {'set' if permanent else 'reset'} successfully:")
    print(f"  User: {email}")
    print(f"  Type: {'Permanent' if permanent else 'Temporary (must change on login)'}")


if __name__ == '__main__':
    main()

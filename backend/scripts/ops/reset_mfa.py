#!/usr/bin/env python3
"""
Reset MFA for a user (disable TOTP and optionally forget devices).

Usage:
    I_UNDERSTAND_THIS_IS_DESTRUCTIVE=true python scripts/ops/reset_mfa.py \\
        --email user@example.com \\
        --operator admin@madrona.com \\
        [--forget-devices] \\
        [--reason "User lost phone"]

This script:
1. Disables SOFTWARE_TOKEN_MFA for the user (AdminSetUserMFAPreference)
2. Optionally forgets all remembered devices
3. Logs action to audit trail with reason

SECURITY NOTE: Only use this for legitimate support requests.
The user will need to re-enroll in MFA after this reset.

Use cases:
- User lost their phone/authenticator
- User locked out of MFA
- Device migration issues

Environment variables required:
    I_UNDERSTAND_THIS_IS_DESTRUCTIVE=true
    AWS_REGION (default: us-west-2)
    COGNITO_USER_POOL_ID
    DATABASE_URL (for audit logging)
"""

import argparse
import sys
import os

# Add parent directories to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

from scripts.ops.utils import (
    require_confirmation,
    get_db_session,
    cognito_admin_disable_mfa,
    cognito_admin_get_user,
    cognito_admin_list_devices,
    cognito_admin_forget_device,
    log_ops_action,
    get_user_by_email,
    logger,
)
from botocore.exceptions import ClientError


def main():
    parser = argparse.ArgumentParser(
        description='Reset MFA for a user in Cognito',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument(
        '--email', '-e',
        required=True,
        help='Email address of the user'
    )
    parser.add_argument(
        '--operator', '-o',
        required=True,
        help='Email of the operator performing this action (for audit)'
    )
    parser.add_argument(
        '--reason', '-r',
        default='No reason provided',
        help='Reason for MFA reset (for audit trail)'
    )
    parser.add_argument(
        '--forget-devices',
        action='store_true',
        help='Also forget all remembered devices for this user'
    )
    parser.add_argument(
        '--show-mfa-status',
        action='store_true',
        help='Show current MFA status and exit'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would be done without making changes'
    )

    args = parser.parse_args()

    email = args.email.lower().strip()

    # Get current MFA status
    try:
        cognito_user = cognito_admin_get_user(email)
        mfa_settings = cognito_user.get('mfa_settings', [])
        preferred_mfa = cognito_user.get('preferred_mfa')

        logger.info(f"User: {email}")
        logger.info(f"Cognito status: {cognito_user.get('status')}")
        logger.info(f"MFA settings: {mfa_settings}")
        logger.info(f"Preferred MFA: {preferred_mfa}")

        # List devices
        devices = cognito_admin_list_devices(email)
        logger.info(f"Remembered devices: {len(devices)}")
        for device in devices:
            logger.info(f"  - {device.get('DeviceKey')}: {device.get('DeviceAttributes', [])}")

    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', '')
        if error_code == 'UserNotFoundException':
            logger.error(f"User {email} not found in Cognito")
            sys.exit(1)
        raise

    # If just showing status, exit here
    if args.show_mfa_status:
        print(f"\nMFA Status for {email}:")
        print(f"  Enabled methods: {', '.join(mfa_settings) or 'None'}")
        print(f"  Preferred: {preferred_mfa or 'None'}")
        print(f"  Remembered devices: {len(devices)}")
        return

    # Require confirmation for destructive operations
    if not args.dry_run:
        require_confirmation('reset_mfa')

    # Dry run mode
    if args.dry_run:
        logger.info(f"[DRY RUN] Would disable MFA for {email}")
        if mfa_settings:
            logger.info(f"[DRY RUN] Current MFA methods: {mfa_settings}")
        else:
            logger.info(f"[DRY RUN] User has no MFA enabled (nothing to disable)")

        if args.forget_devices:
            logger.info(f"[DRY RUN] Would forget {len(devices)} device(s)")
            for device in devices:
                logger.info(f"[DRY RUN]   - {device.get('DeviceKey')}")
        return

    # Check if there's actually MFA to reset
    if not mfa_settings:
        logger.warning(f"User {email} has no MFA enabled")
        if not args.forget_devices or not devices:
            logger.info("Nothing to reset")
            return

    # Step 1: Disable MFA
    if mfa_settings:
        try:
            cognito_admin_disable_mfa(email)
            logger.info("MFA disabled successfully")
        except ClientError as e:
            logger.error(f"Failed to disable MFA: {e}")
            sys.exit(1)

    # Step 2: Forget devices (if requested)
    devices_forgotten = 0
    if args.forget_devices and devices:
        for device in devices:
            device_key = device.get('DeviceKey')
            try:
                cognito_admin_forget_device(email, device_key)
                devices_forgotten += 1
                logger.info(f"Forgot device: {device_key}")
            except ClientError as e:
                logger.warning(f"Failed to forget device {device_key}: {e}")

    # Step 3: Log audit entry
    db = get_db_session()
    try:
        log_ops_action(
            db=db,
            action='mfa_reset',
            operator_email=args.operator,
            target_email=email,
            details={
                'reason': args.reason,
                'mfa_methods_disabled': mfa_settings,
                'preferred_mfa_was': preferred_mfa,
                'devices_forgotten': devices_forgotten,
                'forget_devices_requested': args.forget_devices,
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
    print(f"\nMFA Reset Complete:")
    print(f"  User: {email}")
    print(f"  MFA methods disabled: {', '.join(mfa_settings) or 'None'}")
    print(f"  Devices forgotten: {devices_forgotten}")
    print(f"  Reason: {args.reason}")
    print(f"\nThe user will need to re-enroll in MFA on their next admin login.")


if __name__ == '__main__':
    main()

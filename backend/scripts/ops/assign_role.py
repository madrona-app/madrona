#!/usr/bin/env python3
"""
Assign or update a user's role in an organization.

Usage:
    I_UNDERSTAND_THIS_IS_DESTRUCTIVE=true python scripts/ops/assign_role.py \\
        --email user@example.com \\
        --org-name "Organization Name" \\
        --role admin \\
        --operator admin@madrona.com

This script:
1. Creates or updates organization membership
2. Assigns specified role to the user
3. Logs action to audit trail

Available roles (each inherits the one below it):
- admin: Full organization administration
- registrar: Accessioning, loans, movements, approvals
- curator: Cataloguing and exhibition content
- publisher: Publish to the public site
- viewer: Read-only access

Environment variables required:
    I_UNDERSTAND_THIS_IS_DESTRUCTIVE=true
    DATABASE_URL (or DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD)
"""

import argparse
import sys
import os
from uuid import uuid4, UUID

# Add parent directories to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

from scripts.ops.utils import (
    require_confirmation,
    get_db_session,
    log_ops_action,
    get_user_by_email,
    get_role_by_key,
    get_organization_by_name,
    get_organization_by_id,
    logger,
)
from app.models import OrganizationMembership, Organization, Role


# Derived, not hardcoded. This list was five role keys that no longer exist
# (org_admin, data_engineer, data_analyst, data_publisher), and because it is
# used as argparse `choices` the script accepted only nonexistent roles and
# rejected every real one — get_role_by_key would then find nothing.
#
# platform_admin is deliberately excluded: it is cross-organization and is
# granted by seeds/bootstrap_admin.py --platform-admin, so there is one path
# for it rather than two.
from app.permissions import ROLE_INHERITANCE_MAP  # noqa: E402

AVAILABLE_ROLES = sorted(k for k in ROLE_INHERITANCE_MAP if k != 'platform_admin')


def list_roles(db):
    """List all available roles."""
    roles = db.query(Role).all()
    print("\nAvailable roles:")
    for role in roles:
        print(f"  {role.role_key}: {role.description or 'No description'}")


def list_organizations(db):
    """List all organizations."""
    orgs = db.query(Organization).filter_by(status='active').all()
    print("\nAvailable organizations:")
    for org in orgs:
        print(f"  {org.organization_id}: {org.name}")


def main():
    parser = argparse.ArgumentParser(
        description='Assign or update a user\'s role in an organization',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument(
        '--email', '-e',
        help='Email address of the user'
    )
    parser.add_argument(
        '--org-name',
        help='Organization name (partial match supported)'
    )
    parser.add_argument(
        '--org-id',
        help='Organization ID (UUID)'
    )
    parser.add_argument(
        '--role', '-r',
        choices=AVAILABLE_ROLES,
        help='Role to assign'
    )
    parser.add_argument(
        '--operator', '-o',
        help='Email of the operator performing this action (for audit)'
    )
    parser.add_argument(
        '--list-roles',
        action='store_true',
        help='List available roles and exit'
    )
    parser.add_argument(
        '--list-orgs',
        action='store_true',
        help='List available organizations and exit'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would be done without making changes'
    )

    args = parser.parse_args()

    db = get_db_session()

    try:
        # Handle list commands
        if args.list_roles:
            list_roles(db)
            return

        if args.list_orgs:
            list_organizations(db)
            return

        # Validate required args for assignment
        if not args.email:
            parser.error("--email is required")
        if not args.org_name and not args.org_id:
            parser.error("--org-name or --org-id is required")
        if not args.role:
            parser.error("--role is required")
        if not args.operator:
            parser.error("--operator is required")

        # Require confirmation for destructive operations
        if not args.dry_run:
            require_confirmation('assign_role')

        email = args.email.lower().strip()

        # Find user
        user = get_user_by_email(db, email)
        if not user:
            logger.error(f"User {email} not found in database")
            logger.info("Create the user first with create_user.py")
            sys.exit(1)

        # Find organization
        if args.org_id:
            organization = get_organization_by_id(db, UUID(args.org_id))
        else:
            organization = get_organization_by_name(db, args.org_name)

        if not organization:
            logger.error(f"Organization not found: {args.org_name or args.org_id}")
            list_organizations(db)
            sys.exit(1)

        # Find role
        role = get_role_by_key(db, args.role)
        if not role:
            logger.error(f"Role not found: {args.role}")
            list_roles(db)
            sys.exit(1)

        logger.info(f"Assigning role '{args.role}' to {email} in '{organization.name}'")

        # Dry run mode
        if args.dry_run:
            # Check existing membership
            existing = db.query(OrganizationMembership).filter_by(
                user_id=user.user_id,
                organization_id=organization.organization_id,
            ).first()

            if existing:
                old_role = db.query(Role).filter_by(role_id=existing.role_id).first()
                logger.info(f"[DRY RUN] Would update existing membership from '{old_role.role_key if old_role else existing.role}' to '{args.role}'")
            else:
                logger.info(f"[DRY RUN] Would create new membership with role '{args.role}'")
            return

        # Check for existing membership
        existing_membership = db.query(OrganizationMembership).filter_by(
            user_id=user.user_id,
            organization_id=organization.organization_id,
        ).first()

        old_role_key = None

        if existing_membership:
            # Update existing membership
            old_role = db.query(Role).filter_by(role_id=existing_membership.role_id).first()
            old_role_key = old_role.role_key if old_role else existing_membership.role

            existing_membership.role_id = role.role_id
            existing_membership.role = args.role.replace('org_', '') if args.role.startswith('org_') else args.role
            existing_membership.status = 'active'

            logger.info(f"Updated membership: {old_role_key} -> {args.role}")
        else:
            # Create new membership
            membership = OrganizationMembership(
                membership_id=uuid4(),
                user_id=user.user_id,
                organization_id=organization.organization_id,
                role_id=role.role_id,
                role=args.role.replace('org_', '') if args.role.startswith('org_') else args.role,
                status='active',
            )
            db.add(membership)
            logger.info(f"Created new membership with role: {args.role}")

        # Log audit entry
        log_ops_action(
            db=db,
            action='role_assigned',
            operator_email=args.operator,
            target_email=email,
            organization_id=organization.organization_id,
            details={
                'new_role': args.role,
                'old_role': old_role_key,
                'organization_name': organization.name,
                'action_type': 'update' if existing_membership else 'create',
            }
        )

        db.commit()
        logger.info("Changes committed")

        # Print summary
        print(f"\nRole assignment successful:")
        print(f"  User: {email}")
        print(f"  Organization: {organization.name}")
        print(f"  Role: {args.role}")
        if old_role_key:
            print(f"  Previous role: {old_role_key}")

    except Exception as e:
        logger.error(f"Error: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == '__main__':
    main()

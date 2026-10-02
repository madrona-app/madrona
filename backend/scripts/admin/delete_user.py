#!/usr/bin/env python3
"""
Delete a user and all related data for testing invitation flows.
Usage: python3 delete_user.py <email>
       python3 delete_user.py <email> --force  (skip confirmation)
"""
import sys
sys.path.insert(0, '.')

from app.database import get_session
from app.models import (
    User,
    OrganizationMembership,
    OrganizationInvitation,
    RefreshToken,
    AuditLog,
)

def delete_user(email: str, force: bool = False):
    """
    Delete a user and all related data.
    
    Deletes:
    - User record
    - Organization memberships
    - Organization invitations
    - Refresh tokens
    
    Args:
        email: User email address
        force: Skip confirmation prompt
    """
    with get_session() as session:
        user = session.query(User).filter_by(email=email.lower().strip()).first()
        
        if not user:
            print(f"❌ User {email} not found")
            return False
        
        # Count related records
        memberships = session.query(OrganizationMembership).filter_by(user_id=user.user_id).all()
        invitations = session.query(OrganizationInvitation).filter_by(user_id=user.user_id).all()
        refresh_tokens = session.query(RefreshToken).filter_by(user_id=user.user_id).all()
        
        # Find audit logs where user is the actor or target
        audit_logs_actor = session.query(AuditLog).filter_by(acting_user_id=user.user_id).all()
        audit_logs_target = session.query(AuditLog).filter_by(target_user_id=user.user_id).all()
        audit_logs = set(audit_logs_actor + audit_logs_target)  # Remove duplicates
        
        print(f"\n🔍 Found user: {user.email}")
        print(f"   User ID: {user.user_id}")
        print(f"   Status: {user.status}")
        print(f"   Email Status: {user.email_status}")
        print(f"\n📊 Related records:")
        print(f"   - {len(memberships)} organization membership(s)")
        print(f"   - {len(invitations)} invitation(s)")
        print(f"   - {len(refresh_tokens)} refresh token(s)")
        print(f"   - {len(audit_logs)} audit log(s)")
        
        if not force:
            print(f"\n⚠️  This will DELETE the user and all related data.")
            confirm = input(f"   Type '{email}' to confirm deletion: ")
            
            if confirm.strip() != email:
                print("❌ Deletion cancelled (email didn't match)")
                return False
        
        # Delete related records first (foreign key constraints)
        for audit_log in audit_logs:
            session.delete(audit_log)
        for membership in memberships:
            session.delete(membership)
        for invitation in invitations:
            session.delete(invitation)
        for token in refresh_tokens:
            session.delete(token)
        
        # Delete user
        session.delete(user)
        session.commit()
        
        print(f"\n✅ User {email} and all related data deleted successfully")
        print(f"   - Deleted {len(audit_logs)} audit log(s)")
        print(f"   - Deleted {len(memberships)} membership(s)")
        print(f"   - Deleted {len(invitations)} invitation(s)")
        print(f"   - Deleted {len(refresh_tokens)} refresh token(s)")
        print(f"   - Deleted user record")
        
        return True

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 delete_user.py <email> [--force]")
        print("\nExample:")
        print("  python3 delete_user.py you@example.org")
        print("  python3 delete_user.py test@example.com --force  # Skip confirmation")
        print("\n⚠️  WARNING: This will permanently delete the user and all related data!")
        sys.exit(1)
    
    email = sys.argv[1]
    force = '--force' in sys.argv or '-f' in sys.argv
    
    delete_user(email, force)

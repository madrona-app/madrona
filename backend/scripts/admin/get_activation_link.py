#!/usr/bin/env python3
"""
Get the activation link for a user invitation.
Usage: python3 get_activation_link.py <email>
"""
import sys
sys.path.insert(0, '.')

from app.database import get_session
from app.models import OrganizationInvitation, User
from app.config import get_settings

def get_activation_link(email: str):
    """Get the activation link for a user."""
    settings = get_settings()

    with get_session() as session:
        user = session.query(User).filter_by(email=email.lower().strip()).first()
        
        if not user:
            print(f"❌ User {email} not found")
            return False
        
        # Get the most recent unexpired invitation for this user
        invitation = (
            session.query(OrganizationInvitation)
            .filter_by(user_id=user.user_id, used_at=None)
            .order_by(OrganizationInvitation.created_at.desc())
            .first()
        )
        
        if not invitation:
            print(f"❌ No pending invitation found for {email}")
            print(f"   User status: {user.status}")
            return False
        
        print(f"\n📧 User: {user.email}")
        print(f"   User ID: {user.user_id}")
        print(f"   Status: {user.status}")
        print(f"   Organization ID: {invitation.organization_id}")
        print(f"   Invitation expires: {invitation.expires_at}")
        print(f"\n🔗 Activation link:")
        
        # Note: The actual token is not stored in the database (only the hash)
        # In development with EMAIL_ENABLED=false, check application logs for the token
        print(f"   {settings.app_base_url}/activate?token=<TOKEN_FROM_LOGS>")
        print(f"\n💡 Since EMAIL_ENABLED=false, check the application logs after creating")
        print(f"   the user to find the full activation link with token.")
        
        return True

if __name__ == '__main__':
    if len(sys.argv) != 2:
        print("Usage: python3 get_activation_link.py <email>")
        print("\nExample:")
        print("  python3 get_activation_link.py test@example.com")
        sys.exit(1)
    
    email = sys.argv[1]
    get_activation_link(email)

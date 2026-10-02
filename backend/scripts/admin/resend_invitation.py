#!/usr/bin/env python3
"""
Resend invitation email or get activation link for a user.
Useful for testing when SES is in sandbox mode.
"""

import sys
import os
from datetime import datetime, timezone

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.config import get_settings
from app.models import User, OrganizationInvitation

def get_invitation_link(email: str):
    """Get the activation link for a user's invitation."""
    settings = get_settings()
    
    # Create database connection
    engine = create_engine(settings.database_url)
    Session = sessionmaker(bind=engine)
    session = Session()
    
    try:
        # Find user
        user = session.query(User).filter(User.email == email).first()
        
        if not user:
            print(f"❌ User not found: {email}")
            return
        
        print(f"✅ Found user: {email}")
        print(f"   User ID: {user.user_id}")
        print(f"   Status: {user.status}")
        print(f"   Display Name: {user.display_name or '(none)'}")
        print()
        
        if user.status != 'invited':
            print(f"⚠️  User status is '{user.status}', not 'invited'")
            print(f"   This user may have already activated their account.")
            print()
        
        # Find active invitation
        invitation = session.query(OrganizationInvitation).filter(
            OrganizationInvitation.user_id == user.user_id,
            OrganizationInvitation.used_at.is_(None),
            OrganizationInvitation.expires_at > datetime.now(timezone.utc)
        ).order_by(OrganizationInvitation.created_at.desc()).first()
        
        if not invitation:
            print(f"❌ No active invitation found for {email}")
            print(f"   The invitation may have expired or been used.")
            return
        
        # Extract token from hash (we need the original token, not the hash)
        # Since we can't reverse the hash, we need to tell them to create a new user
        print(f"📧 Invitation Details:")
        print(f"   Invited by: {invitation.invited_by}")
        print(f"   Role: {invitation.role}")
        print(f"   Created: {invitation.created_at}")
        print(f"   Expires: {invitation.expires_at}")
        print(f"   Token hash: {invitation.token_hash[:16]}...")
        print()
        print(f"⚠️  Cannot retrieve activation link - token is hashed in database")
        print(f"   To get the link, you need to:")
        print(f"   1. Set EMAIL_ENABLED=false in .env")
        print(f"   2. Restart backend")
        print(f"   3. Delete and recreate the user")
        print(f"   4. Check Flask logs for the activation URL")
        print()
        print(f"Or use the manual activation script:")
        print(f"   python3 activate_user.py {email} demo123")
        
    finally:
        session.close()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 resend_invitation.py <email>")
        sys.exit(1)
    
    email = sys.argv[1]
    get_invitation_link(email)

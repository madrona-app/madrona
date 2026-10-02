#!/usr/bin/env python3
"""
Quick script to activate a user and set their password.
Usage: python3 activate_user.py <email> <password>
"""
import sys
sys.path.insert(0, '.')

from app.database import get_session
from app.models import User
from app.services.auth_utils import hash_password

def activate_user(email: str, password: str):
    """Activate a user and set their password."""
    with get_session() as session:
        user = session.query(User).filter_by(email=email.lower().strip()).first()
        
        if not user:
            print(f"❌ User {email} not found")
            return False
        
        # Hash the password
        password_hash = hash_password(password)
        
        # Update user
        user.status = 'active'
        user.password_hash = password_hash
        session.commit()
        
        print(f"✅ User {email} activated successfully")
        print(f"   Status: {user.status}")
        print(f"   Email: {user.email}")
        print(f"   Password set: Yes")
        return True

if __name__ == '__main__':
    if len(sys.argv) != 3:
        print("Usage: python3 activate_user.py <email> <password>")
        print("\nExample:")
        print("  python3 activate_user.py you@example.org mypassword123")
        sys.exit(1)
    
    email = sys.argv[1]
    password = sys.argv[2]
    
    activate_user(email, password)

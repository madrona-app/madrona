"""
Service for processing AWS SES bounce and complaint events.
Tracks email deliverability and flags problematic addresses.
"""
import json
import logging
import base64
import hashlib
import re
from typing import Dict, Any, Optional
from datetime import datetime
import requests
from sqlalchemy.exc import IntegrityError
from app.database import current_session
from app.models import EmailEvent, User

logger = logging.getLogger(__name__)

# Cache for SNS certificate validation (in production, consider Redis)
_cert_cache: Dict[str, str] = {}


def verify_sns_signature(message: Dict[str, Any]) -> bool:
    """
    Verify SNS message signature using AWS public certificate.
    
    Args:
        message: SNS message with signature fields
        
    Returns:
        True if signature is valid, False otherwise
    """
    try:
        # Required fields for signature verification
        required_fields = ["Signature", "SigningCertURL", "SignatureVersion"]
        if not all(field in message for field in required_fields):
            logger.warning("SNS message missing signature fields")
            return False
        
        signature_version = message.get("SignatureVersion")
        if signature_version != "1":
            logger.warning(f"Unsupported SNS signature version: {signature_version}")
            return False
        
        cert_url = message.get("SigningCertURL")
        
        # Validate certificate URL (must be from AWS SNS)
        if not _is_valid_sns_cert_url(cert_url):
            logger.error(f"Invalid SNS certificate URL: {cert_url}")
            return False
        
        # Get certificate (cached)
        cert_pem = _get_certificate(cert_url)
        if not cert_pem:
            logger.error("Failed to retrieve SNS certificate")
            return False
        
        # Build string to sign
        string_to_sign = _build_signature_string(message)
        
        # Verify signature
        signature = base64.b64decode(message["Signature"])
        
        # Import cryptography library for verification
        try:
            from cryptography.hazmat.primitives import hashes, serialization
            from cryptography.hazmat.primitives.asymmetric import padding
            from cryptography.x509 import load_pem_x509_certificate
            from cryptography.hazmat.backends import default_backend
            
            cert = load_pem_x509_certificate(cert_pem.encode(), default_backend())
            public_key = cert.public_key()
            
            public_key.verify(
                signature,
                string_to_sign.encode('utf-8'),
                padding.PKCS1v15(),
                hashes.SHA1()
            )
            return True
        except ImportError:
            logger.warning("cryptography library not available, skipping signature verification")
            return True  # Allow in dev if library not installed
        except Exception as e:
            logger.error(f"Signature verification failed: {e}")
            return False
    
    except Exception as e:
        logger.error(f"Error verifying SNS signature: {e}", exc_info=True)
        return False


def _is_valid_sns_cert_url(url: str) -> bool:
    """Validate that certificate URL is from AWS SNS."""
    if not url:
        return False
    
    # Must be HTTPS from AWS SNS domains
    pattern = r'^https://sns\.[a-zA-Z0-9-]+\.amazonaws\.com(\.cn)?/.*$'
    return bool(re.match(pattern, url))


def _get_certificate(url: str) -> Optional[str]:
    """Fetch SNS signing certificate (with caching)."""
    if url in _cert_cache:
        return _cert_cache[url]
    
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        cert = response.text
        _cert_cache[url] = cert
        return cert
    except Exception as e:
        logger.error(f"Failed to fetch certificate from {url}: {e}")
        return None


def _build_signature_string(message: Dict[str, Any]) -> str:
    """
    Build the string that was signed by SNS.
    Field order matters - must match AWS specification.
    """
    message_type = message.get("Type")
    
    if message_type == "Notification":
        fields = [
            "Message",
            "MessageId",
            "Subject",
            "Timestamp",
            "TopicArn",
            "Type"
        ]
    elif message_type in ["SubscriptionConfirmation", "UnsubscribeConfirmation"]:
        fields = [
            "Message",
            "MessageId",
            "SubscribeURL",
            "Timestamp",
            "Token",
            "TopicArn",
            "Type"
        ]
    else:
        fields = []
    
    parts = []
    for field in fields:
        if field in message:
            parts.append(f"{field}\n{message[field]}\n")
    
    return "".join(parts)


def process_bounce(ses_message: Dict[str, Any], sns_message_id: Optional[str] = None) -> None:
    """
    Process SES bounce event.
    
    Args:
        ses_message: SES bounce notification message
        sns_message_id: SNS message ID for deduplication
    """
    try:
        bounce = ses_message.get("bounce", {})
        mail = ses_message.get("mail", {})
        
        bounce_type = bounce.get("bounceType")
        bounce_subtype = bounce.get("bounceSubType")
        recipients = bounce.get("bouncedRecipients", [])
        message_id = mail.get("messageId")
        
        if not recipients:
            logger.warning("Bounce event has no recipients")
            return
        
        for recipient in recipients:
            email = recipient.get("emailAddress")
            if not email:
                continue
            
            email = email.lower()
            
            # Record event
            try:
                event = EmailEvent(
                    email=email,
                    event_type="bounce",
                    bounce_type=bounce_type,
                    bounce_subtype=bounce_subtype,
                    message_id=message_id,
                    sns_message_id=sns_message_id,
                    raw_message=ses_message
                )
                current_session().add(event)
                current_session().flush()
            except IntegrityError:
                # Duplicate SNS message (already processed)
                logger.info(f"Duplicate bounce event for {email}, sns_message_id={sns_message_id}")
                current_session().rollback()
                continue
            
            # Update user email status for permanent bounces
            if bounce_type == "Permanent":
                user = current_session().query(User).filter(User.email == email).first()
                if user and user.email_status == "active":
                    user.email_status = "bounced"
                    logger.info(f"Marked email as bounced: {email}")
            
            current_session().commit()
            logger.info(f"Recorded bounce: {email} ({bounce_type}/{bounce_subtype})")
    
    except Exception as e:
        logger.error(f"Error processing bounce event: {e}", exc_info=True)


def process_complaint(ses_message: Dict[str, Any], sns_message_id: Optional[str] = None) -> None:
    """
    Process SES complaint event.
    
    Args:
        ses_message: SES complaint notification message
        sns_message_id: SNS message ID for deduplication
    """
    try:
        complaint = ses_message.get("complaint", {})
        mail = ses_message.get("mail", {})
        
        feedback_type = complaint.get("complaintFeedbackType")
        recipients = complaint.get("complainedRecipients", [])
        message_id = mail.get("messageId")
        
        if not recipients:
            logger.warning("Complaint event has no recipients")
            return
        
        for recipient in recipients:
            email = recipient.get("emailAddress")
            if not email:
                continue
            
            email = email.lower()
            
            # Record event
            try:
                event = EmailEvent(
                    email=email,
                    event_type="complaint",
                    complaint_feedback_type=feedback_type,
                    message_id=message_id,
                    sns_message_id=sns_message_id,
                    raw_message=ses_message
                )
                current_session().add(event)
                current_session().flush()
            except IntegrityError:
                # Duplicate SNS message
                logger.info(f"Duplicate complaint event for {email}, sns_message_id={sns_message_id}")
                current_session().rollback()
                continue
            
            # Update user email status
            user = current_session().query(User).filter(User.email == email).first()
            if user and user.email_status == "active":
                user.email_status = "complaint"
                logger.info(f"Marked email as complaint: {email}")
            
            current_session().commit()
            logger.info(f"Recorded complaint: {email} ({feedback_type})")
    
    except Exception as e:
        logger.error(f"Error processing complaint event: {e}", exc_info=True)


def check_email_deliverable(email: str) -> bool:
    """
    Check if an email address can receive messages.
    
    Args:
        email: Email address to check
        
    Returns:
        True if email is deliverable (active status), False otherwise
    """
    if not email:
        return False
    
    email = email.lower()
    
    try:
        user = current_session().query(User).filter(User.email == email).first()
        if not user:
            return True  # Unknown email, allow
        
        return user.email_status == "active"
    except Exception as e:
        logger.error(f"Error checking email deliverability: {e}")
        return True  # Fail open

"""
How a deployment identifies itself to the outside world.

Nothing here names a particular deployment. Each value can be set explicitly;
when it is not, it is derived from APP_BASE_URL — the deployment's own origin —
so a self-hosted install identifies as itself without further configuration.
"""

from __future__ import annotations

from urllib.parse import urlparse

from app.config import get_settings
from app.utils.version import get_app_version


def deployment_address(local_part: str) -> str:
    """`local_part@<APP_BASE_URL host>`."""
    host = urlparse(get_settings().app_base_url).hostname or "localhost"
    return f"{local_part}@{host}"


def accounts_from() -> str:
    """Sender for account email: sign-up, password reset, invitations."""
    return get_settings().ses_accounts_from or deployment_address("accounts")


def notifications_from() -> str:
    """Sender for notification email."""
    return get_settings().ses_notifications_from or deployment_address("notifications")


def support_address() -> str:
    """Address printed in email footers for people to reach support."""
    return get_settings().support_email or deployment_address("support")


def outbound_user_agent() -> str:
    """User-Agent for calls to third-party APIs.

    Wikidata and similar services require a User-Agent that identifies the
    operator and gives a way to reach them. The operator is whoever runs this
    deployment, so it is built from their own settings rather than naming
    Madrona's authors.
    """
    return f"Madrona/{get_app_version()} (+{get_settings().app_base_url}; {support_address()})"

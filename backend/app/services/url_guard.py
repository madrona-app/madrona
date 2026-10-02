"""SSRF guard for server-side URL fetches.

Any code path that fetches a user- or model-supplied URL server-side (media
"upload from URL", the agent's ``fetch_webpage`` tool, remote image enrichment,
etc.) must route through :func:`safe_get` so that requests to cloud metadata
(``169.254.169.254``), loopback, and RFC1918/link-local/reserved ranges are
rejected — including via DNS names that resolve inward and via redirects.
"""

import ipaddress
import logging
import socket
from urllib.parse import urljoin, urlparse

import requests

logger = logging.getLogger(__name__)

_ALLOWED_SCHEMES = ("http", "https")
_DEFAULT_MAX_REDIRECTS = 5


class UnsafeURLError(ValueError):
    """Raised when a URL is disallowed or resolves to a non-public address."""


def _ip_is_public(ip: ipaddress._BaseAddress) -> bool:
    return not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def validate_public_url(url: str) -> None:
    """Raise :class:`UnsafeURLError` unless ``url`` is http(s) and every address
    its host resolves to is a public IP.

    Both literal-IP hosts and DNS names are checked; every A/AAAA record must be
    public, so a name that points at an internal address is rejected.
    """
    parsed = urlparse(url)
    if parsed.scheme not in _ALLOWED_SCHEMES:
        raise UnsafeURLError(f"URL scheme not allowed: {parsed.scheme!r}")
    host = parsed.hostname
    if not host:
        raise UnsafeURLError("URL has no host")

    # Literal IP host — check directly.
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        ip = None
    if ip is not None:
        if not _ip_is_public(ip):
            raise UnsafeURLError(f"URL host is a non-public address: {host}")
        return

    # DNS name — resolve and check every returned address.
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise UnsafeURLError(f"Could not resolve host {host!r}: {exc}") from exc

    addresses = {info[4][0] for info in infos}
    if not addresses:
        raise UnsafeURLError(f"Host {host!r} did not resolve to any address")
    for addr in addresses:
        if not _ip_is_public(ipaddress.ip_address(addr)):
            raise UnsafeURLError(
                f"URL host {host} resolves to a non-public address: {addr}"
            )


def safe_get(url: str, *, max_redirects: int = _DEFAULT_MAX_REDIRECTS, **kwargs) -> requests.Response:
    """``requests.get`` that validates the target (and every redirect hop) is a
    public host, closing the SSRF-via-redirect bypass.

    Any ``allow_redirects`` value in ``kwargs`` is ignored; redirects are
    followed manually so each hop can be re-validated. Raises
    :class:`UnsafeURLError` on a disallowed target or too many redirects, and
    propagates ``requests`` errors otherwise.
    """
    kwargs.pop("allow_redirects", None)
    current = url
    for _ in range(max_redirects + 1):
        validate_public_url(current)
        resp = requests.get(current, allow_redirects=False, **kwargs)
        if resp.is_redirect or resp.is_permanent_redirect:
            location = resp.headers.get("Location")
            if not location:
                return resp
            resp.close()
            current = urljoin(current, location)
            continue
        return resp
    raise UnsafeURLError(f"Too many redirects while fetching {url!r}")

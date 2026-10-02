"""
QR code generation service.

Generates QR codes for museum object labels that link to the public discover
pages. Supports SVG and PNG output via the segno library.
"""

import io
import logging
from uuid import UUID

import segno

logger = logging.getLogger(__name__)


class QRService:
    """Generates QR codes for objects, exhibitions, and generic URLs."""

    def generate_object_qr(
        self,
        org_slug: str,
        object_id: UUID,
        fmt: str = "svg",
        scale: int = 4,
        border: int = 2,
    ) -> tuple[bytes, str]:
        """Generate a QR code for a collection object's discover page.

        Returns (data_bytes, content_type).
        """
        url = self._public_url(f"/c/{org_slug}/objects/{object_id}?src=qr")
        return self.generate_generic_qr(url, fmt=fmt, scale=scale, border=border)

    def generate_site_qr(
        self,
        org_slug: str,
        fmt: str = "svg",
        scale: int = 4,
        border: int = 2,
    ) -> tuple[bytes, str]:
        """Generate a museum-level QR code for the collection's public site.

        Encodes the standalone full-page guide (/c/{slug}/guide) so a single
        printed code opens a WonderWay-style conversation directly — the
        collection site is one tap away via the header back link.

        Returns (data_bytes, content_type).
        """
        url = self._public_url(f"/c/{org_slug}/guide?src=qr")
        return self.generate_generic_qr(url, fmt=fmt, scale=scale, border=border)

    def generate_exhibition_qr(
        self,
        org_slug: str,
        exhibition_id: UUID,
        fmt: str = "svg",
        scale: int = 4,
        border: int = 2,
    ) -> tuple[bytes, str]:
        """Generate a QR code for an exhibition page."""
        url = self._public_url(f"/c/{org_slug}/exhibitions/{exhibition_id}?src=qr")
        return self.generate_generic_qr(url, fmt=fmt, scale=scale, border=border)

    @staticmethod
    def _public_url(path: str) -> str:
        """Absolute public URL for a QR payload.

        QR codes are scanned by phone cameras — a relative path is not a
        link. Prepend the deployment's public base (APP_BASE_URL). This was
        a long-standing bug: every QR previously encoded a bare path.
        """
        from app.config import get_settings
        base = (get_settings().app_base_url or "").rstrip("/")
        return f"{base}{path}"

    def generate_generic_qr(
        self,
        data: str,
        fmt: str = "svg",
        scale: int = 4,
        border: int = 2,
    ) -> tuple[bytes, str]:
        """Generate a QR code for arbitrary data.

        Args:
            data: The string to encode.
            fmt: Output format — 'svg' or 'png'.
            scale: Scale factor for the QR modules.
            border: Quiet zone border width in modules.

        Returns:
            Tuple of (binary data, MIME content type).
        """
        qr = segno.make(data, error="m")
        buf = io.BytesIO()

        if fmt == "png":
            qr.save(buf, kind="png", scale=scale, border=border)
            content_type = "image/png"
        else:
            qr.save(buf, kind="svg", scale=scale, border=border, xmldecl=False)
            content_type = "image/svg+xml"

        buf.seek(0)
        return buf.getvalue(), content_type


# Singleton
_qr_service: QRService | None = None


def get_qr_service() -> QRService:
    global _qr_service
    if _qr_service is None:
        _qr_service = QRService()
    return _qr_service

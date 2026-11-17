"""Braille-ready (.brf) and HTML uploads.

NFB holds braille files and HTML finding aids. Both must be accepted, and HTML
must never be served for inline rendering: it is stored with
``Content-Disposition: attachment`` on every storage backend.
"""
import io
from unittest.mock import MagicMock, patch

import pytest

from app.services import uploads
from app.services.uploads import (
    ALLOWED_TYPES,
    MediaType,
    content_disposition_for,
    detect_media_type,
    normalize_upload_content_type,
    validate_file_magic_bytes,
)

BRF_SAMPLE = b",! ,NATIONAL ,FEDERATION OF ,! ,BL9D\r\n\x0c,PAGE #B\r\n"
HTML_SAMPLE = b"<!doctype html><html><body><h1>Finding aid</h1><script>alert(1)</script></body></html>"


class TestNormalizeContentType:
    @pytest.mark.parametrize("reported", ["", None, "application/octet-stream", "text/plain"])
    def test_brf_from_generic_type(self, reported):
        assert normalize_upload_content_type(reported, "Kernel Book.BRF") == "application/x-brf"

    def test_html_from_text_plain(self):
        assert normalize_upload_content_type("text/plain", "guide.htm") == "text/html"

    def test_specific_type_is_kept(self):
        # A browser-reported specific type is never overridden by the extension.
        assert normalize_upload_content_type("image/png", "photo.html") == "image/png"

    def test_parameters_stripped(self):
        assert normalize_upload_content_type("text/html; charset=utf-8", "a.html") == "text/html"

    def test_plain_text_unchanged(self):
        assert normalize_upload_content_type("text/plain", "notes.txt") == "text/plain"


class TestAllowlist:
    def test_brf_and_html_are_documents(self):
        assert ALLOWED_TYPES[MediaType.DOCUMENT]["application/x-brf"] == "brf"
        assert ALLOWED_TYPES[MediaType.DOCUMENT]["text/html"] == "html"
        assert detect_media_type("application/x-brf") == MediaType.DOCUMENT
        assert detect_media_type("text/html") == MediaType.DOCUMENT

    def test_rfp_formats_all_allowed(self):
        # Every format in NFB's attachment requirement.
        types = {t for allowed in ALLOWED_TYPES.values() for t in allowed}
        for t in [
            "application/pdf", "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "image/jpeg", "image/png", "image/tiff", "video/quicktime", "audio/mpeg",
            "video/mp4", "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "text/plain", "audio/wav", "application/x-brf", "text/html",
        ]:
            assert t in types, t


class TestContentValidation:
    def test_brf_text_accepted(self):
        validate_file_magic_bytes(BRF_SAMPLE, "application/x-brf")

    def test_unicode_braille_accepted(self):
        validate_file_magic_bytes("⠠⠝⠁⠞⠊⠕⠝⠁⠇".encode(), "application/x-brf")

    def test_binary_rejected_as_brf(self):
        with pytest.raises(ValueError):
            validate_file_magic_bytes(b"\x89PNG\r\n\x1a\n\x00\x00", "application/x-brf")

    def test_html_accepted(self):
        validate_file_magic_bytes(HTML_SAMPLE, "text/html")

    def test_binary_rejected_as_html(self):
        with pytest.raises(ValueError):
            validate_file_magic_bytes(b"PK\x03\x04\x00\x00", "text/html")


class TestAttachmentOnly:
    def test_html_disposition(self):
        assert content_disposition_for("text/html", 'a"b<c>.html') == 'attachment; filename="a_b_c_.html"'
        assert content_disposition_for("text/html") == "attachment"

    @pytest.mark.parametrize("ct", ["application/pdf", "image/png", "application/x-brf", "text/plain"])
    def test_inline_types_have_none(self, ct):
        assert content_disposition_for(ct, "x") is None

    def test_upload_org_media_stores_html_as_attachment(self):
        s3 = MagicMock()
        with patch.object(uploads, "get_s3_client", return_value=s3), \
                patch.object(uploads, "get_media_bucket", return_value="bucket"):
            key, size = uploads.upload_org_media(
                organization_id="00000000-0000-0000-0000-000000000001",
                file_data=io.BytesIO(HTML_SAMPLE),
                content_type="text/plain",
                filename="finding-aid.html",
            )
        kwargs = s3.put_object.call_args.kwargs
        assert kwargs["ContentType"] == "text/html"
        assert kwargs["ContentDisposition"] == 'attachment; filename="finding-aid.html"'
        assert key.endswith(".html") and "/documents/" in key
        assert size == len(HTML_SAMPLE)

    def test_upload_org_media_brf_from_octet_stream(self):
        s3 = MagicMock()
        with patch.object(uploads, "get_s3_client", return_value=s3), \
                patch.object(uploads, "get_media_bucket", return_value="bucket"):
            key, _ = uploads.upload_org_media(
                organization_id="00000000-0000-0000-0000-000000000001",
                file_data=io.BytesIO(BRF_SAMPLE),
                content_type="application/octet-stream",
                filename="kernel.brf",
            )
        kwargs = s3.put_object.call_args.kwargs
        assert kwargs["ContentType"] == "application/x-brf"
        assert "ContentDisposition" not in kwargs
        assert key.endswith(".brf")

    def test_backend_path_passes_disposition(self):
        storage = MagicMock()
        storage.provider_name = "s3"
        with patch("app.services.storage.get_storage_backend", return_value=storage):
            uploads._upload_org_media_via_backend(
                organization_id="00000000-0000-0000-0000-000000000001",
                file_data=io.BytesIO(HTML_SAMPLE),
                content_type="text/html",
                filename="x.html",
            )
        assert storage.put_object_sync.call_args.kwargs["content_disposition"] == 'attachment; filename="x.html"'

    def test_s3_backend_sets_content_disposition(self):
        from app.services.storage.s3 import S3StorageBackend

        backend = S3StorageBackend.__new__(S3StorageBackend)
        backend._bucket = "b"
        backend._client = MagicMock()
        backend._client.put_object.return_value = {"ETag": '"e"'}
        backend.put_object_sync("k", b"x", content_type="text/html", content_disposition="attachment")
        assert backend._client.put_object.call_args.kwargs["ContentDisposition"] == "attachment"

"""Extracted and OCR text is saved even when media already has metadata.

Both services used to mutate media.extra_metadata in place and reassign the
same dict, which a plain JSONB column does not see as a change: the text was
dropped for any file that already carried metadata.
"""
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.models import Media, Organization


def _media(db_session, mime):
    org = Organization(name="Text Museum", slug=f"text-{uuid.uuid4().hex[:8]}", status="active", timezone="UTC")
    db_session.add(org)
    db_session.flush()
    m = Media(
        organization_id=org.organization_id, filename="letter.pdf" if "pdf" in mime else "letter.txt",
        s3_key=f"orgs/{org.organization_id}/media/x", media_type="document", mime_type=mime,
        file_size=10, extra_metadata={"source": "donor scan"},
    )
    db_session.add(m)
    db_session.commit()
    return m


def _reloaded(db_session, media_id):
    db_session.expire_all()
    return db_session.get(Media, media_id).extra_metadata


def test_extracted_text_saved_alongside_existing_metadata(db_session):
    from app.services import text_extraction

    m = _media(db_session, "text/plain")
    storage = MagicMock()
    storage.get_object_sync.return_value = (b"Dear Dr. Jernigan", None)
    with patch.object(text_extraction, "current_session", return_value=db_session), \
            patch("app.services.storage.get_storage_backend", return_value=storage):
        text_extraction.process_text_extraction(m.media_id, m.organization_id)
    meta = _reloaded(db_session, m.media_id)
    assert meta["extracted_text"] == "Dear Dr. Jernigan"
    assert meta["source"] == "donor scan"


def test_ocr_text_saved_alongside_existing_metadata(db_session):
    from app.services import ocr_service

    m = _media(db_session, "application/pdf")
    s3 = MagicMock()
    s3.download_file.side_effect = lambda bucket, key, path: open(path, "wb").write(b"%PDF")
    with patch.object(ocr_service, "current_session", return_value=db_session), \
            patch.object(ocr_service, "get_settings", return_value=SimpleNamespace(ocr_languages="eng")), \
            patch("app.services.uploads.get_s3_client", return_value=s3), \
            patch("app.services.uploads.get_media_bucket", return_value="bucket"), \
            patch("app.services.uploads.get_org_storage_region", return_value="us-east-1"), \
            patch.object(ocr_service, "extract_text_from_pdf", return_value="Minutes of the 1940 convention"):
        ocr_service.process_media_ocr(m.media_id, m.organization_id)
    meta = _reloaded(db_session, m.media_id)
    assert meta["ocr_text"] == "Minutes of the 1940 convention"
    assert meta["source"] == "donor scan"

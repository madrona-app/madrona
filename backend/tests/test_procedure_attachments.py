"""General file attachments on procedure records (acquisitions).

Attachments reuse the polymorphic signed_documents table with
document_type='attachment'. These tests drive the real upload path
(content-type normalisation, magic-byte validation, storage write) with only
the S3 client stubbed, so a spoofed or unsupported file is rejected the same
way it would be in deployment.
"""
import io
import uuid

import pytest


PDF_BYTES = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
BRF_BYTES = b"  ,purchase invoice\n\x0c"


class _RecordingS3:
    def __init__(self):
        self.puts: list[dict] = []
        self.download_urls: list[dict] = []

    def put_object(self, **kwargs):
        self.puts.append(kwargs)
        return {}

    def generate_presigned_url(self, *_a, **kwargs):
        key = (kwargs.get("Params") or {}).get("Key")
        return f"https://test-bucket.s3.amazonaws.com/{key}?sig=fake"

    def delete_object(self, **_kw):
        return {}


@pytest.fixture
def s3(monkeypatch):
    rec = _RecordingS3()
    monkeypatch.setattr("app.services.uploads.get_s3_client", lambda *a, **k: rec)

    # Downloads are signed by the org's storage backend, not the upload client.
    # Unstubbed, it signs with whatever AWS credentials the machine has: CI has
    # none, so the route answered 502 there while passing on a laptop.
    def _media_url(key, *, organization_id, db_session, expiry_seconds, filename=None, **_kw):
        rec.download_urls.append({"key": key, "organization_id": organization_id,
                                  "expiry_seconds": expiry_seconds, "filename": filename})
        return f"https://test-bucket.s3.amazonaws.com/{key}?sig=fake"

    monkeypatch.setattr(
        "app.fastapi_app.routers.signed_documents.get_org_media_url_byob", _media_url
    )
    return rec


def _make_acquisition(db_session, org_id, number="ACQ-ATT-1"):
    from app.models import Acquisition

    acq = Acquisition(
        organization_id=org_id,
        acquisition_number=number,
        acquisition_method="purchase",
        status="proposed",
    )
    db_session.add(acq)
    db_session.commit()
    return acq.acquisition_id


def _base(org_id):
    return f"/api/organizations/{org_id}/signed-documents"


def _upload(client, org_id, acq_id, *, title="Purchase invoice", description=None,
            content=PDF_BYTES, filename="invoice.pdf", mime="application/pdf"):
    data = {
        "procedure_type": "acquisition",
        "procedure_id": str(acq_id),
        "document_type": "attachment",
        "file": (io.BytesIO(content), filename, mime),
    }
    if title is not None:
        data["label"] = title
    if description is not None:
        data["description"] = description
    return client.post(_base(org_id), data=data, content_type="multipart/form-data")


def _post_fields(client, org_id, fields):
    """Multipart POST with form fields only (as the browser's FormData sends).

    The unused part forces a multipart body; the endpoint ignores it.
    """
    return client.post(_base(org_id), data=fields, files={"_unused": ("", b"")})


def _list(client, org_id, acq_id):
    return client.get(
        f"{_base(org_id)}?procedure_type=acquisition&procedure_id={acq_id}&document_type=attachment"
    )


class TestAttachmentUpload:
    def test_upload_list_round_trip(self, auth_setup, db_session, s3):
        client, org, _ = auth_setup
        acq = _make_acquisition(db_session, org.organization_id)

        resp = _upload(client, org.organization_id, acq, description="Dealer invoice, March 2026")
        assert resp.status_code == 201, resp.get_json()
        body = resp.get_json()
        assert body["document_type"] == "attachment"
        assert body["label"] == "Purchase invoice"
        assert body["description"] == "Dealer invoice, March 2026"
        assert body["media_filename"] == "invoice.pdf"
        assert body["media_mime_type"] == "application/pdf"
        assert body["media_file_size"] == len(PDF_BYTES)
        assert body["download_url"] == (
            f"/api/organizations/{org.organization_id}/signed-documents/"
            f"{body['signed_document_id']}/download"
        )
        # The bytes went to storage under the org's prefix.
        assert len(s3.puts) == 1
        assert s3.puts[0]["Key"].startswith(f"orgs/{org.organization_id}/media/documents/")
        assert s3.puts[0]["Body"] == PDF_BYTES

        listed = _list(client, org.organization_id, acq).get_json()
        assert listed["count"] == 1
        assert listed["signed_documents"][0]["signed_document_id"] == body["signed_document_id"]

    def test_multiple_attachments_and_type_filter(self, auth_setup, db_session, s3):
        client, org, _ = auth_setup
        acq = _make_acquisition(db_session, org.organization_id)
        assert _upload(client, org.organization_id, acq, title="Invoice").status_code == 201
        assert _upload(client, org.organization_id, acq, title="Braille copy", content=BRF_BYTES,
                       filename="invoice.brf", mime="application/octet-stream").status_code == 201
        # A signed deed of gift on the same record is not an attachment.
        deed = _post_fields(client, org.organization_id, {
            "procedure_type": "acquisition", "procedure_id": str(acq),
            "document_type": "deed_of_gift", "reference": "Paper file F-1",
        })
        assert deed.status_code == 201

        listed = _list(client, org.organization_id, acq).get_json()
        assert listed["count"] == 2
        titles = {d["label"] for d in listed["signed_documents"]}
        assert titles == {"Invoice", "Braille copy"}
        brf = next(d for d in listed["signed_documents"] if d["label"] == "Braille copy")
        # .brf arrives as octet-stream from browsers; it is normalised, not rejected.
        assert brf["media_mime_type"] == "application/x-brf"

    def test_title_required(self, auth_setup, db_session, s3):
        client, org, _ = auth_setup
        acq = _make_acquisition(db_session, org.organization_id)
        resp = _upload(client, org.organization_id, acq, title="   ")
        assert resp.status_code == 422
        assert "title" in resp.get_json()["error"]["message"].lower()
        assert s3.puts == []

    def test_file_required(self, auth_setup, db_session, s3):
        client, org, _ = auth_setup
        acq = _make_acquisition(db_session, org.organization_id)
        resp = _post_fields(client, org.organization_id, {
            "procedure_type": "acquisition", "procedure_id": str(acq),
            "document_type": "attachment", "label": "Invoice", "reference": "somewhere",
        })
        assert resp.status_code == 422

    def test_spoofed_content_rejected(self, auth_setup, db_session, s3):
        client, org, _ = auth_setup
        acq = _make_acquisition(db_session, org.organization_id)
        resp = _upload(client, org.organization_id, acq, content=b"MZ\x90\x00 not a pdf")
        assert resp.status_code == 400
        assert s3.puts == []
        assert _list(client, org.organization_id, acq).get_json()["count"] == 0

    def test_unsupported_type_rejected(self, auth_setup, db_session, s3):
        client, org, _ = auth_setup
        acq = _make_acquisition(db_session, org.organization_id)
        resp = _upload(client, org.organization_id, acq, content=b"\x7fELF",
                       filename="tool.exe", mime="application/x-msdownload")
        assert resp.status_code == 400
        assert s3.puts == []

    def test_unknown_procedure_404(self, auth_setup, s3):
        client, org, _ = auth_setup
        resp = _upload(client, org.organization_id, uuid.uuid4())
        assert resp.status_code == 404


class TestAttachmentDownloadAndDelete:
    def test_download_redirects_to_storage(self, auth_setup, db_session, s3):
        client, org, _ = auth_setup
        acq = _make_acquisition(db_session, org.organization_id)
        doc = _upload(client, org.organization_id, acq, filename='inv"oice.pdf').get_json()

        resp = client.get(doc["download_url"], follow_redirects=False)
        assert resp.status_code == 307
        location = resp.headers["location"]
        assert location.startswith("https://")
        assert f"orgs/{org.organization_id}/media/documents/" in location
        # The quote cannot break out of the Content-Disposition header.
        assert '"' not in s3.download_urls[-1]["filename"]
        assert s3.download_urls[-1]["filename"].endswith(".pdf")
        assert s3.download_urls[-1]["organization_id"] == str(org.organization_id)

    def test_download_without_file_404(self, auth_setup, db_session, s3):
        client, org, _ = auth_setup
        acq = _make_acquisition(db_session, org.organization_id)
        ref = _post_fields(client, org.organization_id, {
            "procedure_type": "acquisition", "procedure_id": str(acq),
            "document_type": "deed_of_gift", "reference": "Paper file F-2",
        }).get_json()
        assert ref["download_url"] is None
        resp = client.get(f"{_base(org.organization_id)}/{ref['signed_document_id']}/download")
        assert resp.status_code == 404

    def test_update_title_and_description(self, auth_setup, db_session, s3):
        client, org, _ = auth_setup
        acq = _make_acquisition(db_session, org.organization_id)
        doc = _upload(client, org.organization_id, acq).get_json()
        url = f"{_base(org.organization_id)}/{doc['signed_document_id']}"
        resp = client.patch(url, json={"label": "Final invoice", "description": "Paid in full"})
        assert resp.status_code == 200
        assert resp.get_json()["label"] == "Final invoice"
        assert resp.get_json()["description"] == "Paid in full"
        # An attachment cannot lose its title.
        assert client.patch(url, json={"label": ""}).status_code == 422

    def test_delete_removes_from_list(self, auth_setup, db_session, s3):
        client, org, _ = auth_setup
        acq = _make_acquisition(db_session, org.organization_id)
        doc = _upload(client, org.organization_id, acq).get_json()
        resp = client.delete(f"{_base(org.organization_id)}/{doc['signed_document_id']}")
        assert resp.status_code == 200
        assert _list(client, org.organization_id, acq).get_json()["count"] == 0
        assert client.get(doc["download_url"]).status_code == 404


class TestAttachmentPermissionsAndIsolation:
    def test_viewer_can_list_and_download_but_not_write(self, viewer_auth_setup, db_session, s3):
        from app.models import Media, SignedDocument

        client, org, _ = viewer_auth_setup
        acq = _make_acquisition(db_session, org.organization_id, "ACQ-VIEW-1")
        media = Media(
            organization_id=org.organization_id, s3_key=f"orgs/{org.organization_id}/media/documents/x.pdf",
            filename="x.pdf", file_size=10, mime_type="application/pdf", media_type="document",
            title="x.pdf", processing_status="completed",
        )
        db_session.add(media)
        db_session.flush()
        doc = SignedDocument(
            organization_id=org.organization_id, procedure_type="acquisition", procedure_id=acq,
            document_type="attachment", label="Invoice", media_id=media.media_id,
        )
        db_session.add(doc)
        db_session.commit()

        assert _list(client, org.organization_id, acq).get_json()["count"] == 1
        dl = client.get(f"{_base(org.organization_id)}/{doc.signed_document_id}/download",
                        follow_redirects=False)
        assert dl.status_code == 307

        assert _upload(client, org.organization_id, acq).status_code == 403
        assert client.delete(f"{_base(org.organization_id)}/{doc.signed_document_id}").status_code == 403
        assert s3.puts == []

    def test_other_org_cannot_see_or_touch(self, auth_setup, viewer_auth_setup, db_session, s3):
        client_a, org_a, _ = auth_setup
        client_b, org_b, _ = viewer_auth_setup
        acq = _make_acquisition(db_session, org_a.organization_id, "ACQ-ISO-1")
        doc = _upload(client_a, org_a.organization_id, acq).get_json()
        doc_id = doc["signed_document_id"]

        # Org B is not a member of org A: every route on A's path is refused.
        assert _list(client_b, org_a.organization_id, acq).status_code == 403
        assert client_b.get(doc["download_url"]).status_code == 403
        assert client_b.delete(f"{_base(org_a.organization_id)}/{doc_id}").status_code == 403

        # Through its own org path, org B cannot reach A's record or document.
        assert _list(client_b, org_b.organization_id, acq).status_code == 404
        assert client_b.get(f"{_base(org_b.organization_id)}/{doc_id}/download").status_code == 404

        # And A's attachment is untouched.
        assert _list(client_a, org_a.organization_id, acq).get_json()["count"] == 1

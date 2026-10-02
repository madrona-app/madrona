"""
Tests for Phase 3: SIP/AIP/DIP Information Packages.
"""

import uuid

import pytest

from app.models.media import Media
from app.models.preservation import InformationPackage, PreservationEvent


def _make_media(org_id, filename="test.tif", mime_type="image/tiff", **kwargs):
    defaults = dict(
        organization_id=org_id,
        s3_key=f"orgs/{org_id}/{uuid.uuid4()}/{filename}",
        filename=filename,
        file_size=5000,
        mime_type=mime_type,
        media_type="image",
        processing_status="completed",
        checksum_sha256="abc123def456" * 4,
    )
    defaults.update(kwargs)
    return Media(**defaults)


class TestSIPCreation:
    def test_create_sip_accepted(self, db_session, demo_tenant):
        org_id = demo_tenant.organization_id
        media = _make_media(org_id)
        db_session.add(media)
        db_session.flush()

        from app.services.information_package import create_sip

        sip = create_sip(media, db_session)
        db_session.commit()

        assert sip.package_type == "SIP"
        assert sip.status == "accepted"
        assert sip.structure["submission"]["filename"] == "test.tif"
        assert sip.structure["submission"]["mime_type"] == "image/tiff"

    def test_sip_idempotent(self, db_session, demo_tenant):
        org_id = demo_tenant.organization_id
        media = _make_media(org_id)
        db_session.add(media)
        db_session.flush()

        from app.services.information_package import create_sip

        sip1 = create_sip(media, db_session)
        db_session.commit()
        sip2 = create_sip(media, db_session)
        db_session.commit()

        assert sip1.package_id == sip2.package_id


class TestAIPCreation:
    def test_create_aip(self, db_session, demo_tenant):
        org_id = demo_tenant.organization_id
        media = _make_media(org_id, title="Archival Image", description="Test")
        db_session.add(media)
        db_session.flush()

        from app.services.information_package import create_aip

        aip = create_aip(media, db_session)
        db_session.commit()

        assert aip.package_type == "AIP"
        assert aip.status == "active"
        assert aip.structure["content"]["archival_master"]["s3_key"] == media.s3_key
        assert aip.structure["metadata"]["descriptive"]["title"] == "Archival Image"

    def test_aip_supersedes_previous(self, db_session, demo_tenant):
        org_id = demo_tenant.organization_id
        media = _make_media(org_id)
        db_session.add(media)
        db_session.flush()

        from app.services.information_package import create_aip

        aip1 = create_aip(media, db_session)
        db_session.commit()
        assert aip1.status == "active"

        aip2 = create_aip(media, db_session)
        db_session.commit()

        db_session.refresh(aip1)
        assert aip1.status == "superseded"
        assert aip2.status == "active"

    def test_aip_captures_provenance_events(self, db_session, demo_tenant):
        org_id = demo_tenant.organization_id
        media = _make_media(org_id)
        db_session.add(media)
        db_session.flush()

        event = PreservationEvent(
            organization_id=org_id,
            event_type="ingestion",
            media_id=media.media_id,
            outcome="success",
            agent_type="software",
            agent_name="test",
        )
        db_session.add(event)
        db_session.flush()

        from app.services.information_package import create_aip

        aip = create_aip(media, db_session)
        db_session.commit()

        assert len(aip.provenance_event_ids) >= 1


class TestDIPGeneration:
    def test_generate_dip(self, db_session, demo_tenant):
        org_id = demo_tenant.organization_id
        media = _make_media(org_id)
        db_session.add(media)
        db_session.flush()

        from app.services.information_package import generate_dip

        dip = generate_dip(
            media,
            export_profile_id="research",
            session=db_session,
            included_derivatives=[{"type": "access_master", "format": "jpeg"}],
        )
        db_session.commit()

        assert dip.package_type == "DIP"
        assert dip.status == "generated"
        assert dip.export_profile_id == "research"
        assert dip.expires_at is not None

    def test_multiple_dips_allowed(self, db_session, demo_tenant):
        org_id = demo_tenant.organization_id
        media = _make_media(org_id)
        db_session.add(media)
        db_session.flush()

        from app.services.information_package import generate_dip

        dip1 = generate_dip(media, "research", db_session)
        dip2 = generate_dip(media, "public", db_session)
        db_session.commit()

        assert dip1.package_id != dip2.package_id
        dips = db_session.query(InformationPackage).filter_by(
            media_id=media.media_id, package_type="DIP"
        ).all()
        assert len(dips) == 2


class TestAIPRefresh:
    def test_refresh_rebuilds_aip(self, db_session, demo_tenant):
        org_id = demo_tenant.organization_id
        media = _make_media(org_id, title="V1")
        db_session.add(media)
        db_session.flush()

        from app.services.information_package import create_aip, refresh_aip

        aip1 = create_aip(media, db_session)
        db_session.commit()

        media.title = "V2"
        db_session.commit()

        aip2 = refresh_aip(media.media_id, db_session)
        db_session.commit()

        db_session.refresh(aip1)
        assert aip1.status == "superseded"
        assert aip2.status == "active"
        assert aip2.structure["metadata"]["descriptive"]["title"] == "V2"


class TestAIPManifest:
    def test_get_manifest(self, db_session, demo_tenant):
        org_id = demo_tenant.organization_id
        media = _make_media(org_id)
        db_session.add(media)
        db_session.flush()

        from app.services.information_package import create_aip, get_aip_manifest

        create_aip(media, db_session)
        db_session.commit()

        manifest = get_aip_manifest(media.media_id, db_session)
        assert manifest is not None
        assert manifest["package_type"] == "AIP"
        assert manifest["status"] == "active"
        assert "structure" in manifest

    def test_no_manifest_returns_none(self, db_session):
        from app.services.information_package import get_aip_manifest

        result = get_aip_manifest(uuid.uuid4(), db_session)
        assert result is None

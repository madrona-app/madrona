"""
Tests for Phase 4: Multi-Algorithm Fixity & Replication.
"""

import hashlib
import uuid

import pytest

from app.models.media import Media
from app.models.preservation import ReplicationRecord


class TestMultiAlgorithmFixity:
    def test_sha256_and_md5_single_pass(self):
        """Both hashes can be computed in a single pass over the data."""
        data = b"This is test data for checksum verification"

        sha256_hasher = hashlib.sha256()
        md5_hasher = hashlib.md5()
        sha256_hasher.update(data)
        md5_hasher.update(data)

        sha256_result = sha256_hasher.hexdigest()
        md5_result = md5_hasher.hexdigest()

        assert len(sha256_result) == 64
        assert len(md5_result) == 32
        assert sha256_result == hashlib.sha256(data).hexdigest()
        assert md5_result == hashlib.md5(data).hexdigest()

    def test_media_checksum_fields(self, db_session, demo_tenant):
        org_id = demo_tenant.organization_id
        media = Media(
            organization_id=org_id,
            s3_key=f"orgs/{org_id}/test.jpg",
            filename="test.jpg",
            file_size=1024,
            mime_type="image/jpeg",
            media_type="image",
            processing_status="completed",
            checksum_sha256="a" * 64,
            checksum_md5="b" * 32,
            checksums={"sha256": "a" * 64, "md5": "b" * 32},
        )
        db_session.add(media)
        db_session.commit()

        fetched = db_session.query(Media).filter_by(media_id=media.media_id).first()
        assert fetched.checksum_sha256 == "a" * 64
        assert fetched.checksum_md5 == "b" * 32
        assert fetched.checksums["sha256"] == "a" * 64
        assert fetched.checksums["md5"] == "b" * 32


class TestReplicationRecord:
    def test_create_record(self, db_session, demo_tenant):
        org_id = demo_tenant.organization_id
        media = Media(
            organization_id=org_id,
            s3_key=f"orgs/{org_id}/master.tif",
            filename="master.tif",
            file_size=50000,
            mime_type="image/tiff",
            media_type="image",
            processing_status="completed",
        )
        db_session.add(media)
        db_session.flush()

        record = ReplicationRecord(
            organization_id=org_id,
            media_id=media.media_id,
            storage_location="s3://backup-bucket-us-west-2",
            storage_provider="s3",
            storage_region="us-west-2",
            storage_key="backup/orgs/master.tif",
            copy_type="backup",
            checksum_sha256="c" * 64,
            verification_status="verified",
        )
        db_session.add(record)
        db_session.commit()

        fetched = db_session.query(ReplicationRecord).filter_by(
            record_id=record.record_id
        ).first()
        assert fetched is not None
        assert fetched.storage_provider == "s3"
        assert fetched.copy_type == "backup"
        assert fetched.verification_status == "verified"

    def test_unique_media_location(self, db_session, demo_tenant):
        org_id = demo_tenant.organization_id
        media = Media(
            organization_id=org_id,
            s3_key=f"orgs/{org_id}/unique_test.tif",
            filename="unique_test.tif",
            file_size=50000,
            mime_type="image/tiff",
            media_type="image",
            processing_status="completed",
        )
        db_session.add(media)
        db_session.flush()

        record1 = ReplicationRecord(
            organization_id=org_id,
            media_id=media.media_id,
            storage_location="s3://backup-bucket",
            storage_provider="s3",
            storage_region="us-east-1",
            storage_key="backup/test1.tif",
            copy_type="backup",
        )
        db_session.add(record1)
        db_session.commit()

        record2 = ReplicationRecord(
            organization_id=org_id,
            media_id=media.media_id,
            storage_location="s3://backup-bucket",
            storage_provider="s3",
            storage_region="us-east-1",
            storage_key="backup/test2.tif",
            copy_type="backup",
        )
        db_session.add(record2)
        with pytest.raises(Exception):
            db_session.commit()
        db_session.rollback()

    def test_verification_status_transitions(self, db_session, demo_tenant):
        org_id = demo_tenant.organization_id
        media = Media(
            organization_id=org_id,
            s3_key=f"orgs/{org_id}/status_test.tif",
            filename="status_test.tif",
            file_size=50000,
            mime_type="image/tiff",
            media_type="image",
            processing_status="completed",
        )
        db_session.add(media)
        db_session.flush()

        record = ReplicationRecord(
            organization_id=org_id,
            media_id=media.media_id,
            storage_location="s3://status-test-bucket",
            storage_provider="s3",
            storage_region="us-east-1",
            storage_key="test.tif",
            copy_type="backup",
            verification_status="unverified",
        )
        db_session.add(record)
        db_session.commit()

        record.verification_status = "verified"
        db_session.commit()
        assert record.verification_status == "verified"

        record.verification_status = "mismatch"
        db_session.commit()
        assert record.verification_status == "mismatch"

        record.verification_status = "missing"
        db_session.commit()
        assert record.verification_status == "missing"

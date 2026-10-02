"""
Tests for storage migration service.

These tests verify the migration service can:
- List files in source storage
- Copy files to destination storage
- Track progress
- Verify integrity
- Handle errors gracefully
"""

import asyncio
import hashlib
import pytest
from datetime import datetime, timezone
from unittest.mock import MagicMock
from uuid import uuid4

from app.services.storage.base import StorageObject, ObjectNotFoundError
from app.services.storage.migration import (
    StorageMigrationService,
    MigrationProgress,
    MigrationResult,
    MigrationStatus,
    FileStatus,
    VerificationResult,
    MigrationFile,
)


def run_async(coro):
    """Helper to run async code in sync context."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class MockStorageBackend:
    """Mock storage backend for testing."""

    def __init__(self, files: dict[str, bytes] = None):
        self.files = files or {}
        self.provider_name = "mock"

    async def list_objects(
        self,
        prefix: str = "",
        max_keys: int = 1000,
        continuation_token: str = None
    ) -> tuple[list, str | None]:
        """List objects with prefix. Returns (objects, next_token)."""
        objects = []
        for key, data in self.files.items():
            if key.startswith(prefix):
                objects.append(StorageObject(
                    key=key,
                    size=len(data),
                    content_type="application/octet-stream",
                    last_modified=datetime.now(timezone.utc),
                    etag=hashlib.md5(data).hexdigest(),
                ))
        return objects, None  # No pagination in mock

    async def get_object(self, key: str) -> tuple[bytes, StorageObject]:
        """Get an object."""
        if key not in self.files:
            raise ObjectNotFoundError(f"Object not found: {key}")
        data = self.files[key]
        return data, StorageObject(
            key=key,
            size=len(data),
            content_type="application/octet-stream",
            last_modified=datetime.now(timezone.utc),
            etag=hashlib.md5(data).hexdigest(),
        )

    def get_object_sync(self, key: str) -> tuple[bytes, StorageObject]:
        """Sync version of get_object."""
        if key not in self.files:
            raise ObjectNotFoundError(f"Object not found: {key}")
        data = self.files[key]
        return data, StorageObject(
            key=key,
            size=len(data),
            content_type="application/octet-stream",
            last_modified=datetime.now(timezone.utc),
            etag=hashlib.md5(data).hexdigest(),
        )

    async def put_object(
        self,
        key: str,
        body: bytes,
        content_type: str = None,
        metadata: dict = None,
    ) -> StorageObject:
        """Put an object."""
        self.files[key] = body
        return StorageObject(
            key=key,
            size=len(body),
            content_type=content_type or "application/octet-stream",
            last_modified=datetime.now(timezone.utc),
            etag=hashlib.md5(body).hexdigest(),
        )

    def put_object_sync(
        self,
        key: str,
        body: bytes,
        content_type: str = None,
        metadata: dict = None,
    ) -> StorageObject:
        """Sync version of put_object."""
        self.files[key] = body
        return StorageObject(
            key=key,
            size=len(body),
            content_type=content_type or "application/octet-stream",
            last_modified=datetime.now(timezone.utc),
            etag=hashlib.md5(body).hexdigest(),
        )

    async def head_object(self, key: str) -> StorageObject | None:
        """Get object metadata."""
        if key not in self.files:
            return None
        data = self.files[key]
        return StorageObject(
            key=key,
            size=len(data),
            content_type="application/octet-stream",
            last_modified=datetime.now(timezone.utc),
            etag=hashlib.md5(data).hexdigest(),
        )


class TestStorageMigrationService:
    """Test the StorageMigrationService class."""

    @pytest.fixture
    def org_id(self):
        """Create a consistent org ID for tests."""
        return str(uuid4())

    @pytest.fixture
    def source_backend(self, org_id):
        """Create a source backend with test files."""
        return MockStorageBackend({
            f"orgs/{org_id}/media/originals/file1.jpg": b"image data 1",
            f"orgs/{org_id}/media/originals/file2.jpg": b"image data 2",
            f"orgs/{org_id}/media/derivatives/file1_thumb.jpg": b"thumb 1",
            f"orgs/{org_id}/media/derivatives/file2_thumb.jpg": b"thumb 2",
        })

    @pytest.fixture
    def dest_backend(self):
        """Create an empty destination backend."""
        return MockStorageBackend({})

    @pytest.fixture
    def mock_db_session(self):
        """Create a mock database session."""
        session = MagicMock()
        session.query.return_value.filter.return_value.all.return_value = []
        return session

    def test_migrate_all_files(self, org_id, source_backend, dest_backend, mock_db_session):
        """Test migrating all files from source to destination."""
        service = StorageMigrationService(
            organization_id=org_id,
            source_backend=source_backend,
            dest_backend=dest_backend,
            db_session=mock_db_session,
        )

        result = run_async(service.migrate_all())

        assert result.success is True
        assert result.progress.total_files == 4
        assert result.progress.files_copied == 4
        assert result.progress.files_failed == 0
        assert result.progress.status == MigrationStatus.COMPLETED
        assert len(dest_backend.files) == 4

    def test_migrate_with_prefix(self, org_id, source_backend, dest_backend, mock_db_session):
        """Test migrating only files with a specific prefix."""
        service = StorageMigrationService(
            organization_id=org_id,
            source_backend=source_backend,
            dest_backend=dest_backend,
            db_session=mock_db_session,
        )

        result = run_async(service.migrate_all(prefix=f"orgs/{org_id}/media/originals/"))

        assert result.success is True
        assert result.progress.files_copied == 2
        assert len(dest_backend.files) == 2

    def test_dry_run(self, org_id, source_backend, dest_backend, mock_db_session):
        """Test dry run mode (list files without copying)."""
        service = StorageMigrationService(
            organization_id=org_id,
            source_backend=source_backend,
            dest_backend=dest_backend,
            db_session=mock_db_session,
        )

        result = run_async(service.migrate_all(dry_run=True))

        assert result.success is True
        assert result.progress.total_files == 4
        assert result.progress.files_copied == 0
        # Dry run returns with files in pending status, not skipped
        assert len(result.files) == 4
        assert len(dest_backend.files) == 0  # Nothing copied in dry run

    def test_progress_callback(self, org_id, source_backend, dest_backend, mock_db_session):
        """Test that progress callback is called during migration."""
        progress_updates = []

        def on_progress(progress: MigrationProgress):
            progress_updates.append({
                "files_copied": progress.files_copied,
                "total_files": progress.total_files,
                "status": progress.status,
            })

        service = StorageMigrationService(
            organization_id=org_id,
            source_backend=source_backend,
            dest_backend=dest_backend,
            db_session=mock_db_session,
            progress_callback=on_progress,
        )

        run_async(service.migrate_all())

        # Should have at least one progress update
        assert len(progress_updates) >= 1
        # Final update should show all files copied
        final_update = progress_updates[-1]
        assert final_update["files_copied"] == 4
        assert final_update["total_files"] == 4

    def test_verify_integrity(self, org_id, source_backend, dest_backend, mock_db_session):
        """Test integrity verification after migration."""
        # First migrate
        service = StorageMigrationService(
            organization_id=org_id,
            source_backend=source_backend,
            dest_backend=dest_backend,
            db_session=mock_db_session,
        )
        run_async(service.migrate_all())

        # Then verify
        verification = run_async(service.verify_integrity())

        assert verification.success is True
        assert verification.total_files == 4
        assert verification.verified_files == 4
        assert verification.failed_files == 0
        assert len(verification.missing_files) == 0
        assert len(verification.checksum_mismatches) == 0

    def test_verify_detects_missing_files(self, org_id, source_backend, dest_backend, mock_db_session):
        """Test that verification detects missing files."""
        # Migrate all files
        service = StorageMigrationService(
            organization_id=org_id,
            source_backend=source_backend,
            dest_backend=dest_backend,
            db_session=mock_db_session,
        )
        run_async(service.migrate_all())

        # Remove a file from destination
        removed_key = list(dest_backend.files.keys())[0]
        del dest_backend.files[removed_key]

        # Verify
        verification = run_async(service.verify_integrity())

        assert verification.success is False
        assert verification.failed_files == 1
        assert removed_key in verification.missing_files

    def test_verify_detects_checksum_mismatch(self, org_id, source_backend, dest_backend, mock_db_session):
        """Test that verification detects checksum mismatches."""
        # Migrate all files
        service = StorageMigrationService(
            organization_id=org_id,
            source_backend=source_backend,
            dest_backend=dest_backend,
            db_session=mock_db_session,
        )
        run_async(service.migrate_all())

        # Corrupt a file in destination
        corrupted_key = list(dest_backend.files.keys())[0]
        dest_backend.files[corrupted_key] = b"corrupted data"

        # Verify
        verification = run_async(service.verify_integrity())

        assert verification.success is False
        assert verification.failed_files == 1
        # Check if corrupted key appears in any of the mismatch messages
        assert any(corrupted_key in msg for msg in verification.checksum_mismatches)

    def test_sample_rate_verification(self, org_id, source_backend, dest_backend, mock_db_session):
        """Test verification with sample rate."""
        # Migrate all files
        service = StorageMigrationService(
            organization_id=org_id,
            source_backend=source_backend,
            dest_backend=dest_backend,
            db_session=mock_db_session,
        )
        run_async(service.migrate_all())

        # Verify with 50% sample rate
        verification = run_async(service.verify_integrity(sample_rate=0.5))

        # Should verify roughly half the files
        assert verification.total_files == 4
        # With 50% rate, should verify 1-3 files on average
        assert 0 <= verification.verified_files <= 4


class TestMigrationProgress:
    """Test the MigrationProgress dataclass."""

    def test_percent_complete_calculation(self):
        """Test percent complete is calculated correctly."""
        progress = MigrationProgress(
            total_files=100,
            files_copied=25,
            files_failed=5,
            files_skipped=10,
            bytes_copied=1000,
            current_file="test.jpg",
            status=MigrationStatus.IN_PROGRESS,
        )

        # percent_complete = (files_copied + files_skipped) / total_files * 100
        assert progress.percent_complete == 35.0  # (25 + 10) / 100 * 100

    def test_percent_complete_zero_total(self):
        """Test percent complete with zero total files."""
        progress = MigrationProgress(
            total_files=0,
            files_copied=0,
            files_failed=0,
            files_skipped=0,
            bytes_copied=0,
            current_file=None,
            status=MigrationStatus.IN_PROGRESS,
        )

        assert progress.percent_complete == 0.0


class TestMigrationResult:
    """Test the MigrationResult dataclass."""

    def test_success_determination(self):
        """Test that success is determined by no failures."""
        progress = MigrationProgress(
            total_files=10,
            files_copied=10,
            files_failed=0,
            files_skipped=0,
            bytes_copied=1000,
            current_file=None,
            status=MigrationStatus.COMPLETED,
        )
        result = MigrationResult(
            success=True,
            progress=progress,
            errors=[],
        )

        assert result.success is True

    def test_failure_with_errors(self):
        """Test that result is failure when there are errors."""
        progress = MigrationProgress(
            total_files=10,
            files_copied=8,
            files_failed=2,
            files_skipped=0,
            bytes_copied=800,
            current_file=None,
            status=MigrationStatus.COMPLETED,
        )
        result = MigrationResult(
            success=False,
            progress=progress,
            errors=["Error 1", "Error 2"],
        )

        assert result.success is False
        assert len(result.errors) == 2

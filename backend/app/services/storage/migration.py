"""
Storage Migration Service.

Provides tools for migrating organization media from managed storage to BYOB
(Bring Your Own Bucket) storage, with support for:
- Incremental migration (resume capability)
- Parallel file transfers
- Integrity verification
- Progress tracking
- Rollback support

Usage:
    from app.services.storage.migration import StorageMigrationService

    service = StorageMigrationService(
        organization_id="org-uuid",
        source_backend=managed_backend,
        dest_backend=byob_backend,
        db_session=session,
    )

    # Start migration
    result = await service.migrate_all()

    # Verify integrity
    verification = await service.verify_integrity()
"""

import asyncio
import hashlib
import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Optional, Callable
from uuid import UUID

from app.services.storage.base import StorageBackend, StorageObject, ObjectNotFoundError

logger = logging.getLogger(__name__)

# Thread pool for parallel operations
_migration_executor = ThreadPoolExecutor(max_workers=5, thread_name_prefix="storage-migration")


class MigrationStatus(str, Enum):
    """Status of a migration job."""
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    VERIFYING = "verifying"


class FileStatus(str, Enum):
    """Status of a single file in migration."""
    PENDING = "pending"
    COPYING = "copying"
    COPIED = "copied"
    VERIFIED = "verified"
    FAILED = "failed"
    SKIPPED = "skipped"  # Already exists at destination


@dataclass
class MigrationFile:
    """Represents a file being migrated."""
    key: str
    size: int
    source_etag: Optional[str] = None
    dest_etag: Optional[str] = None
    status: FileStatus = FileStatus.PENDING
    error: Optional[str] = None
    copied_at: Optional[datetime] = None
    verified_at: Optional[datetime] = None


@dataclass
class MigrationProgress:
    """Progress tracking for migration."""
    total_files: int = 0
    total_bytes: int = 0
    files_copied: int = 0
    bytes_copied: int = 0
    files_failed: int = 0
    files_skipped: int = 0
    files_verified: int = 0
    current_file: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    status: MigrationStatus = MigrationStatus.PENDING

    @property
    def percent_complete(self) -> float:
        if self.total_files == 0:
            return 0.0
        return (self.files_copied + self.files_skipped) / self.total_files * 100

    @property
    def bytes_percent_complete(self) -> float:
        if self.total_bytes == 0:
            return 0.0
        return self.bytes_copied / self.total_bytes * 100


@dataclass
class MigrationResult:
    """Result of a migration operation."""
    success: bool
    progress: MigrationProgress
    files: list[MigrationFile] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


@dataclass
class VerificationResult:
    """Result of integrity verification."""
    success: bool
    total_files: int
    verified_files: int
    failed_files: int
    missing_files: list[str] = field(default_factory=list)
    checksum_mismatches: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


class StorageMigrationService:
    """
    Service for migrating media files between storage backends.

    Supports incremental migration with resume capability, parallel transfers,
    and integrity verification.
    """

    def __init__(
        self,
        organization_id: str,
        source_backend: StorageBackend,
        dest_backend: StorageBackend,
        db_session=None,
        batch_size: int = 100,
        parallel_transfers: int = 5,
        verify_after_copy: bool = True,
        skip_existing: bool = True,
        progress_callback: Optional[Callable[[MigrationProgress], None]] = None,
    ):
        """
        Initialize the migration service.

        Args:
            organization_id: Organization UUID
            source_backend: Source storage backend (usually managed S3)
            dest_backend: Destination storage backend (BYOB)
            db_session: SQLAlchemy session for updating media records
            batch_size: Number of files to process in each batch
            parallel_transfers: Number of concurrent file transfers
            verify_after_copy: Verify checksums after copying each file
            skip_existing: Skip files that already exist at destination
            progress_callback: Optional callback for progress updates
        """
        self.organization_id = organization_id
        self.source = source_backend
        self.dest = dest_backend
        self.db_session = db_session
        self.batch_size = batch_size
        self.parallel_transfers = parallel_transfers
        self.verify_after_copy = verify_after_copy
        self.skip_existing = skip_existing
        self.progress_callback = progress_callback

        self._cancelled = False
        self._progress = MigrationProgress()
        self._files: list[MigrationFile] = []

    @property
    def progress(self) -> MigrationProgress:
        """Get current migration progress."""
        return self._progress

    def cancel(self):
        """Cancel the migration (gracefully stops after current file)."""
        self._cancelled = True
        self._progress.status = MigrationStatus.CANCELLED

    async def list_source_files(self, prefix: Optional[str] = None) -> list[MigrationFile]:
        """
        List all files to migrate from source.

        Args:
            prefix: Optional prefix to filter files (defaults to org prefix)

        Returns:
            List of MigrationFile objects
        """
        if prefix is None:
            prefix = f"orgs/{self.organization_id}/"

        files = []
        continuation_token = None

        while True:
            objects, next_token = await self.source.list_objects(
                prefix=prefix,
                max_keys=1000,
                continuation_token=continuation_token,
            )

            for obj in objects:
                files.append(MigrationFile(
                    key=obj.key,
                    size=obj.size,
                    source_etag=obj.etag,
                ))

            if next_token is None:
                break
            continuation_token = next_token

        logger.info(
            "Found %d files to migrate for org %s (%.2f GB)",
            len(files),
            self.organization_id,
            sum(f.size for f in files) / (1024 ** 3),
        )

        return files

    async def migrate_all(
        self,
        prefix: Optional[str] = None,
        dry_run: bool = False,
    ) -> MigrationResult:
        """
        Migrate all files from source to destination.

        Args:
            prefix: Optional prefix to filter files
            dry_run: If True, only list files without copying

        Returns:
            MigrationResult with details
        """
        self._cancelled = False
        self._progress = MigrationProgress(
            status=MigrationStatus.IN_PROGRESS,
            started_at=datetime.now(timezone.utc),
        )

        try:
            # List source files
            self._files = await self.list_source_files(prefix)
            self._progress.total_files = len(self._files)
            self._progress.total_bytes = sum(f.size for f in self._files)

            if dry_run:
                logger.info("Dry run - would migrate %d files", len(self._files))
                self._progress.status = MigrationStatus.COMPLETED
                return MigrationResult(
                    success=True,
                    progress=self._progress,
                    files=self._files,
                )

            # Process files in batches with parallelism
            for i in range(0, len(self._files), self.batch_size):
                if self._cancelled:
                    break

                batch = self._files[i:i + self.batch_size]
                await self._process_batch(batch)

                # Report progress
                if self.progress_callback:
                    self.progress_callback(self._progress)

            # Final status
            if self._cancelled:
                self._progress.status = MigrationStatus.CANCELLED
            elif self._progress.files_failed > 0:
                self._progress.status = MigrationStatus.FAILED
            else:
                self._progress.status = MigrationStatus.COMPLETED

            self._progress.completed_at = datetime.now(timezone.utc)

            return MigrationResult(
                success=self._progress.files_failed == 0 and not self._cancelled,
                progress=self._progress,
                files=self._files,
                errors=[f.error for f in self._files if f.error],
            )

        except Exception as e:
            logger.error("Migration failed: %s", e)
            self._progress.status = MigrationStatus.FAILED
            self._progress.completed_at = datetime.now(timezone.utc)
            return MigrationResult(
                success=False,
                progress=self._progress,
                files=self._files,
                errors=[str(e)],
            )

    async def _process_batch(self, batch: list[MigrationFile]):
        """Process a batch of files with parallelism."""
        semaphore = asyncio.Semaphore(self.parallel_transfers)

        async def copy_with_semaphore(file: MigrationFile):
            async with semaphore:
                await self._copy_file(file)

        tasks = [copy_with_semaphore(f) for f in batch]
        await asyncio.gather(*tasks, return_exceptions=True)

    async def _copy_file(self, file: MigrationFile):
        """Copy a single file from source to destination."""
        if self._cancelled:
            return

        self._progress.current_file = file.key
        file.status = FileStatus.COPYING

        try:
            # Check if file exists at destination
            if self.skip_existing:
                existing = await self.dest.head_object(file.key)
                if existing:
                    # Check if sizes match
                    if existing.size == file.size:
                        file.status = FileStatus.SKIPPED
                        file.dest_etag = existing.etag
                        self._progress.files_skipped += 1
                        logger.debug("Skipping existing file: %s", file.key)
                        return

            # Download from source
            data, source_obj = await self.source.get_object(file.key)

            # Upload to destination
            dest_obj = await self.dest.put_object(
                key=file.key,
                body=data,
                content_type=source_obj.content_type,
                metadata=source_obj.metadata,
            )

            file.status = FileStatus.COPIED
            file.dest_etag = dest_obj.etag
            file.copied_at = datetime.now(timezone.utc)
            self._progress.files_copied += 1
            self._progress.bytes_copied += file.size

            # Verify if requested
            if self.verify_after_copy:
                await self._verify_file(file, data)

            logger.debug("Copied file: %s (%d bytes)", file.key, file.size)

        except Exception as e:
            file.status = FileStatus.FAILED
            file.error = str(e)
            self._progress.files_failed += 1
            logger.error("Failed to copy file %s: %s", file.key, e)

    async def _verify_file(self, file: MigrationFile, source_data: bytes):
        """Verify a copied file matches the source."""
        try:
            # Download from destination
            dest_data, _ = await self.dest.get_object(file.key)

            # Compare checksums
            source_hash = hashlib.sha256(source_data).hexdigest()
            dest_hash = hashlib.sha256(dest_data).hexdigest()

            if source_hash == dest_hash:
                file.status = FileStatus.VERIFIED
                file.verified_at = datetime.now(timezone.utc)
                self._progress.files_verified += 1
            else:
                file.status = FileStatus.FAILED
                file.error = f"Checksum mismatch: source={source_hash[:16]}... dest={dest_hash[:16]}..."
                self._progress.files_failed += 1
                logger.error("Checksum mismatch for %s", file.key)

        except Exception as e:
            file.status = FileStatus.FAILED
            file.error = f"Verification failed: {e}"
            self._progress.files_failed += 1
            logger.error("Verification failed for %s: %s", file.key, e)

    async def verify_integrity(
        self,
        prefix: Optional[str] = None,
        sample_rate: float = 1.0,
    ) -> VerificationResult:
        """
        Verify integrity of migrated files.

        Args:
            prefix: Optional prefix to filter files
            sample_rate: Fraction of files to verify (0.0 to 1.0)

        Returns:
            VerificationResult with details
        """
        self._progress.status = MigrationStatus.VERIFYING

        if prefix is None:
            prefix = f"orgs/{self.organization_id}/"

        result = VerificationResult(
            success=True,
            total_files=0,
            verified_files=0,
            failed_files=0,
        )

        try:
            # List files at destination
            dest_files = {}
            continuation_token = None

            while True:
                objects, next_token = await self.dest.list_objects(
                    prefix=prefix,
                    max_keys=1000,
                    continuation_token=continuation_token,
                )

                for obj in objects:
                    dest_files[obj.key] = obj

                if next_token is None:
                    break
                continuation_token = next_token

            # List files at source and verify
            continuation_token = None
            import random

            while True:
                objects, next_token = await self.source.list_objects(
                    prefix=prefix,
                    max_keys=1000,
                    continuation_token=continuation_token,
                )

                for obj in objects:
                    result.total_files += 1

                    # Sample rate check
                    if sample_rate < 1.0 and random.random() > sample_rate:
                        continue

                    if obj.key not in dest_files:
                        result.missing_files.append(obj.key)
                        result.failed_files += 1
                        continue

                    dest_obj = dest_files[obj.key]

                    # Size check
                    if obj.size != dest_obj.size:
                        result.checksum_mismatches.append(
                            f"{obj.key}: size mismatch (source={obj.size}, dest={dest_obj.size})"
                        )
                        result.failed_files += 1
                        continue

                    result.verified_files += 1

                if next_token is None:
                    break
                continuation_token = next_token

            result.success = result.failed_files == 0
            return result

        except Exception as e:
            logger.error("Verification failed: %s", e)
            result.success = False
            result.errors.append(str(e))
            return result

    async def rollback(self, files: Optional[list[MigrationFile]] = None) -> int:
        """
        Rollback migration by deleting copied files from destination.

        Args:
            files: Optional list of files to rollback (defaults to all copied)

        Returns:
            Number of files deleted
        """
        if files is None:
            files = [f for f in self._files if f.status in (FileStatus.COPIED, FileStatus.VERIFIED)]

        deleted = 0
        for file in files:
            try:
                await self.dest.delete_object(file.key)
                deleted += 1
                logger.debug("Rolled back: %s", file.key)
            except Exception as e:
                logger.warning("Failed to rollback %s: %s", file.key, e)

        logger.info("Rolled back %d files", deleted)
        return deleted


# ============================================================================
# Convenience functions
# ============================================================================

async def migrate_organization_storage(
    organization_id: str,
    dest_provider: str,
    dest_config: dict,
    db_session,
    dry_run: bool = False,
    progress_callback: Optional[Callable[[MigrationProgress], None]] = None,
) -> MigrationResult:
    """
    Convenience function to migrate an organization's storage.

    Args:
        organization_id: Organization UUID
        dest_provider: Destination provider ('s3', 'azure', 'gcs', 's3_compatible')
        dest_config: Destination configuration dict
        db_session: SQLAlchemy session
        dry_run: If True, only list files without copying
        progress_callback: Optional callback for progress updates

    Returns:
        MigrationResult
    """
    from app.services.storage.factory import (
        get_managed_storage_backend,
        _create_s3_backend,
        _create_s3_compatible_backend,
        _create_azure_backend,
        _create_gcs_backend,
        encrypt_storage_config,
    )
    from app.models import Organization, OrganizationStorageConfig

    # Get organization's current storage region
    org = db_session.query(Organization).filter(
        Organization.organization_id == organization_id
    ).first()

    if not org:
        raise ValueError(f"Organization not found: {organization_id}")

    # Create source backend (managed storage)
    source_region = org.storage_region or "us-west-2"
    source_backend = get_managed_storage_backend(source_region)

    # Create destination backend
    # Create a temporary config object for the factory
    class TempConfig:
        def __init__(self, provider, config_encrypted):
            self.provider = provider
            self.config_encrypted = config_encrypted

    encrypted_config = encrypt_storage_config(dest_config)
    temp_config = TempConfig(dest_provider, encrypted_config)

    if dest_provider == "s3":
        dest_backend = _create_s3_backend(temp_config)
    elif dest_provider == "s3_compatible":
        dest_backend = _create_s3_compatible_backend(temp_config)
    elif dest_provider == "azure":
        dest_backend = _create_azure_backend(temp_config)
    elif dest_provider == "gcs":
        dest_backend = _create_gcs_backend(temp_config)
    else:
        raise ValueError(f"Unsupported destination provider: {dest_provider}")

    # Create migration service
    service = StorageMigrationService(
        organization_id=organization_id,
        source_backend=source_backend,
        dest_backend=dest_backend,
        db_session=db_session,
        progress_callback=progress_callback,
    )

    # Run migration
    result = await service.migrate_all(dry_run=dry_run)

    # If successful, update organization's storage config
    if result.success and not dry_run:
        # Create or update storage config
        storage_config = db_session.query(OrganizationStorageConfig).filter(
            OrganizationStorageConfig.organization_id == organization_id
        ).first()

        if not storage_config:
            storage_config = OrganizationStorageConfig(
                organization_id=organization_id,
            )
            db_session.add(storage_config)

        storage_config.provider = dest_provider
        storage_config.config_encrypted = encrypted_config
        storage_config.is_verified = True
        storage_config.verified_at = datetime.now(timezone.utc)

        db_session.commit()
        logger.info("Updated storage config for org %s to %s", organization_id, dest_provider)

    return result

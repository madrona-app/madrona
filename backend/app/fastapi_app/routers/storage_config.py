"""
Storage Configuration API endpoints (FastAPI) for BYOB (Bring Your Own Bucket) support.

Allows organization admins to configure custom storage backends
instead of using Madrona's managed S3 storage.

Migrated from app/api/storage_config.py.
"""

import logging
from datetime import datetime, timezone
from uuid import UUID

from celery.result import AsyncResult

from app.celery_app import celery_app
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.fastapi_app.schemas.storage_config import (
    CancelMigrationResponse,
    CdnConfigResponse,
    MigrationStartResponse,
    MigrationStatusResponse,
    StorageConfigDeleteResponse,
    StorageConfigOut,
    StorageConfigUpdateResponse,
    StorageTestResponse,
    VerificationStatusResponse,
    VerifyMigrationResponse,
)
from app.models import Organization, OrganizationStorageConfig
from app.permissions import Permission
from app.services.storage.factory import (
    decrypt_storage_config,
    encrypt_storage_config,
    test_storage_connection,
)
from app.tasks.storage_migration import (
    migrate_storage_task,
    verify_storage_migration_task,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["storage-config"])

SUPPORTED_PROVIDERS = ["managed", "s3", "s3_compatible", "azure", "gcs"]


# ============================================================================
# STORAGE CONFIG CRUD
# ============================================================================


@router.get("/api/organizations/{org_id}/storage-config", response_model=StorageConfigOut, summary="Get storage config")
def get_storage_config(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Get the storage configuration for an organization."""
    org = db.query(Organization).filter_by(organization_id=org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    config = db.query(OrganizationStorageConfig).filter_by(
        organization_id=org_id,
    ).first()

    if not config:
        return {
            "provider": "managed",
            "is_verified": True,
            "verified_at": None,
            "storage_region": org.storage_region or "us-west-2",
            "cdn_domain": None,
            "has_cdn_signing_key": False,
            "created_at": None,
            "updated_at": None,
        }

    provider_info = {}
    if config.config_encrypted and config.provider != "managed":
        try:
            decrypted = decrypt_storage_config(config.config_encrypted)
            if config.provider in ("s3", "s3_compatible"):
                provider_info = {
                    "bucket": decrypted.get("bucket"),
                    "region": decrypted.get("region"),
                    "endpoint_url": decrypted.get("endpoint_url"),
                }
            elif config.provider == "azure":
                provider_info = {
                    "container": decrypted.get("container"),
                    "account_name": decrypted.get("account_name"),
                }
            elif config.provider == "gcs":
                provider_info = {
                    "bucket": decrypted.get("bucket"),
                    "project_id": decrypted.get("project_id"),
                }
        except Exception as e:
            logger.warning("Failed to decrypt storage config for org %s: %s", org_id, e)

    return {
        "provider": config.provider,
        "is_verified": config.is_verified,
        "verified_at": config.verified_at.isoformat() if config.verified_at else None,
        "verification_error": config.verification_error,
        "cdn_domain": config.cdn_domain,
        "has_cdn_signing_key": config.cdn_signing_key_encrypted is not None,
        "created_at": config.created_at.isoformat() if config.created_at else None,
        "updated_at": config.updated_at.isoformat() if config.updated_at else None,
        **provider_info,
    }


@router.put("/api/organizations/{org_id}/storage-config", response_model=StorageConfigUpdateResponse, summary="Update storage config")
async def update_storage_config(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Create or update the storage configuration for an organization."""
    org = db.query(Organization).filter_by(organization_id=org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    provider = body.get("provider", "managed")
    if provider not in SUPPORTED_PROVIDERS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported provider: {provider}. Supported: {SUPPORTED_PROVIDERS}",
        )

    config = db.query(OrganizationStorageConfig).filter_by(
        organization_id=org_id,
    ).first()

    if not config:
        config = OrganizationStorageConfig(
            organization_id=org_id,
            provider=provider,
        )
        db.add(config)

    if provider == "managed":
        config.provider = "managed"
        config.config_encrypted = None
        config.is_verified = True
        config.verified_at = datetime.now(timezone.utc)
        config.verification_error = None
        db.commit()
        return {"provider": "managed", "is_verified": True, "message": "Switched to managed storage"}

    # Validate required fields for BYOB
    if provider in ("s3", "s3_compatible"):
        required = ["bucket", "access_key_id", "secret_access_key"]
        if provider == "s3_compatible":
            required.append("endpoint_url")

        missing = [f for f in required if not body.get(f)]
        if missing:
            raise HTTPException(status_code=422, detail=f"Missing required fields: {', '.join(missing)}")

        storage_config = {
            "bucket": body["bucket"],
            "region": body.get("region", "us-east-1"),
            "access_key_id": body["access_key_id"],
            "secret_access_key": body["secret_access_key"],
        }
        if provider == "s3_compatible":
            storage_config["endpoint_url"] = body["endpoint_url"]
            storage_config["use_path_style"] = body.get("use_path_style", True)

    elif provider == "azure":
        required = ["container", "account_name"]
        missing = [f for f in required if not body.get(f)]
        if missing:
            raise HTTPException(status_code=422, detail=f"Missing required fields: {', '.join(missing)}")

        if not any(body.get(k) for k in ["account_key", "sas_token", "connection_string"]):
            raise HTTPException(
                status_code=422,
                detail="Must provide account_key, sas_token, or connection_string",
            )

        storage_config = {
            "container": body["container"],
            "account_name": body["account_name"],
            "account_key": body.get("account_key"),
            "sas_token": body.get("sas_token"),
            "connection_string": body.get("connection_string"),
        }

    elif provider == "gcs":
        required = ["bucket", "project_id", "service_account_json"]
        missing = [f for f in required if not body.get(f)]
        if missing:
            raise HTTPException(status_code=422, detail=f"Missing required fields: {', '.join(missing)}")

        storage_config = {
            "bucket": body["bucket"],
            "project_id": body["project_id"],
            "service_account_json": body["service_account_json"],
        }
    else:
        raise HTTPException(status_code=400, detail=f"Provider {provider} not yet supported")

    # Test the connection
    success, error = await test_storage_connection(provider, storage_config)
    if not success:
        raise HTTPException(status_code=400, detail=f"Connection test failed: {error}")

    try:
        config.provider = provider
        config.config_encrypted = encrypt_storage_config(storage_config)
        config.is_verified = True
        config.verified_at = datetime.now(timezone.utc)
        config.verification_error = None
        db.commit()
    except Exception as e:
        logger.error("Failed to save storage config for org %s: %s", org_id, e)
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to save configuration")

    return {
        "provider": provider,
        "bucket": storage_config.get("bucket") or storage_config.get("container"),
        "region": storage_config.get("region"),
        "is_verified": True,
        "verified_at": config.verified_at.isoformat(),
        "message": "Storage configuration saved and verified",
    }


@router.delete("/api/organizations/{org_id}/storage-config", response_model=StorageConfigDeleteResponse, summary="Delete storage config")
def delete_storage_config(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Delete the custom storage configuration and revert to managed storage."""
    config = db.query(OrganizationStorageConfig).filter_by(
        organization_id=org_id,
    ).first()

    if not config:
        return {"message": "Already using managed storage"}

    db.delete(config)
    db.commit()
    return {"message": "Storage configuration deleted. Now using managed storage.", "provider": "managed"}


@router.post("/api/organizations/{org_id}/storage-config/test", response_model=StorageTestResponse, summary="Test storage config endpoint")
async def test_storage_config_endpoint(
    org_id: UUID,
    body: dict = None,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Test the current storage configuration without saving."""
    if body:
        provider = body.get("provider")
        if not provider or provider == "managed":
            return {"success": True, "message": "Managed storage is always available"}

        if provider in ("s3", "s3_compatible"):
            storage_config = {
                "bucket": body.get("bucket"),
                "region": body.get("region", "us-east-1"),
                "access_key_id": body.get("access_key_id"),
                "secret_access_key": body.get("secret_access_key"),
                "endpoint_url": body.get("endpoint_url"),
                "use_path_style": body.get("use_path_style", provider == "s3_compatible"),
            }
        else:
            raise HTTPException(status_code=400, detail=f"Provider {provider} not yet supported for testing")
    else:
        config = db.query(OrganizationStorageConfig).filter_by(
            organization_id=org_id,
        ).first()

        if not config or config.provider == "managed":
            return {"success": True, "message": "Managed storage is always available"}

        try:
            storage_config = decrypt_storage_config(config.config_encrypted)
            provider = config.provider
        except Exception as e:
            logger.error("Failed to decrypt stored configuration for org %s: %s", org_id, e)
            raise HTTPException(status_code=500, detail="Failed to decrypt stored configuration")

    success, error = await test_storage_connection(provider, storage_config)

    if success:
        return {"success": True, "message": "Connection successful. Read and write permissions verified."}
    else:
        raise HTTPException(status_code=400, detail=error)


@router.put("/api/organizations/{org_id}/storage-config/cdn", response_model=CdnConfigResponse, summary="Update cdn config")
def update_cdn_config(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Update CDN configuration for BYOB storage."""
    org = db.query(Organization).filter_by(organization_id=org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    config = db.query(OrganizationStorageConfig).filter_by(
        organization_id=org_id,
    ).first()

    if not config:
        config = OrganizationStorageConfig(
            organization_id=org_id,
            provider="managed",
            is_verified=True,
        )
        db.add(config)

    cdn_domain = body.get("cdn_domain")
    config.cdn_domain = cdn_domain.strip() if cdn_domain else None

    if "signing_key_id" in body:
        config.cdn_signing_key_id = body.get("signing_key_id")

    if "signing_key" in body:
        signing_key = body.get("signing_key")
        if signing_key:
            try:
                config.cdn_signing_key_encrypted = encrypt_storage_config({"key": signing_key})
            except Exception as e:
                logger.error("Failed to encrypt CDN signing key: %s", e)
                raise HTTPException(status_code=500, detail="Failed to encrypt signing key")
        else:
            config.cdn_signing_key_encrypted = None

    db.commit()

    return {
        "cdn_domain": config.cdn_domain,
        "has_signing_key": config.cdn_signing_key_encrypted is not None,
        "message": "CDN configuration updated",
    }


# ============================================================================
# STORAGE MIGRATION ENDPOINTS
# ============================================================================


@router.post("/api/organizations/{org_id}/storage-config/migrate", response_model=MigrationStartResponse, summary="Start storage migration")
def start_storage_migration(
    org_id: UUID,
    body: dict = None,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Start a storage migration from managed storage to BYOB."""
    org = db.query(Organization).filter_by(organization_id=org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    config = db.query(OrganizationStorageConfig).filter_by(
        organization_id=org_id,
    ).first()

    if not config or config.provider == "managed":
        raise HTTPException(
            status_code=400,
            detail="No BYOB storage configured. Configure BYOB storage before migrating.",
        )

    if not config.is_verified:
        raise HTTPException(status_code=400, detail="Storage configuration not verified. Test the connection first.")

    if config.migration_task_id:
        result = AsyncResult(config.migration_task_id, app=celery_app)
        if result.state in ("PENDING", "STARTED", "PROGRESS"):
            raise HTTPException(
                status_code=409,
                detail="A migration is already in progress",
            )

    data = body or {}
    dry_run = data.get("dry_run", False)
    notify_on_complete = data.get("notify_on_complete", True)

    try:
        dest_config = decrypt_storage_config(config.config_encrypted)
    except Exception as e:
        logger.error("Failed to decrypt storage config for migration: %s", e)
        raise HTTPException(status_code=500, detail="Failed to decrypt storage configuration")

    task = migrate_storage_task.delay(
        organization_id=str(org_id),
        dest_provider=config.provider,
        dest_config=dest_config,
        dry_run=dry_run,
        notify_on_complete=notify_on_complete,
    )

    config.migration_task_id = task.id
    config.migration_started_at = datetime.now(timezone.utc)
    db.commit()

    return {
        "task_id": task.id,
        "message": "Storage migration started" if not dry_run else "Dry run started",
        "status": "PENDING",
        "dry_run": dry_run,
    }


@router.get("/api/organizations/{org_id}/storage-config/migration-status", response_model=MigrationStatusResponse, summary="Get migration status")
def get_migration_status(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Get the status of the current or most recent storage migration."""
    config = db.query(OrganizationStorageConfig).filter_by(
        organization_id=org_id,
    ).first()

    if not config or not config.migration_task_id:
        return {"message": "No migration has been started for this organization", "status": None}

    result = AsyncResult(config.migration_task_id, app=celery_app)

    response = {
        "task_id": config.migration_task_id,
        "status": result.state,
        "started_at": config.migration_started_at.isoformat() if config.migration_started_at else None,
    }

    if result.state == "PROGRESS":
        response["progress"] = result.info or {}
    elif result.state == "SUCCESS":
        response["result"] = result.result
        if result.result and result.result.get("completed_at"):
            response["completed_at"] = result.result["completed_at"]
    elif result.state == "FAILURE":
        response["error"] = str(result.result) if result.result else "Unknown error"

    return response


@router.post("/api/organizations/{org_id}/storage-config/verify-migration", response_model=VerifyMigrationResponse, summary="Verify storage migration")
def verify_storage_migration(
    org_id: UUID,
    body: dict = None,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Verify the integrity of a completed storage migration."""
    org = db.query(Organization).filter_by(organization_id=org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    config = db.query(OrganizationStorageConfig).filter_by(
        organization_id=org_id,
    ).first()

    if not config or config.provider == "managed":
        raise HTTPException(status_code=400, detail="No BYOB storage configured")

    data = body or {}
    sample_rate = min(1.0, max(0.0, data.get("sample_rate", 1.0)))

    task = verify_storage_migration_task.delay(
        organization_id=str(org_id),
        sample_rate=sample_rate,
    )

    return {
        "task_id": task.id,
        "message": "Verification started",
        "status": "PENDING",
        "sample_rate": sample_rate,
    }


@router.get("/api/organizations/{org_id}/storage-config/verification-status/{task_id}", response_model=VerificationStatusResponse, summary="Get verification status")
def get_verification_status(
    org_id: UUID,
    task_id: str,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Get the status of a storage verification task."""
    # app=celery_app, or Celery's default app answers with a
    # DisabledBackend and .state raises AttributeError.
    result = AsyncResult(task_id, app=celery_app)

    response = {"task_id": task_id, "status": result.state}

    if result.state == "SUCCESS":
        response["result"] = result.result
    elif result.state == "FAILURE":
        response["error"] = str(result.result) if result.result else "Unknown error"

    return response


@router.post("/api/organizations/{org_id}/storage-config/cancel-migration", response_model=CancelMigrationResponse, summary="Cancel storage migration")
def cancel_storage_migration(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Cancel an in-progress storage migration."""
    config = db.query(OrganizationStorageConfig).filter_by(
        organization_id=org_id,
    ).first()

    if not config or not config.migration_task_id:
        raise HTTPException(status_code=400, detail="No active migration to cancel")

    result = AsyncResult(config.migration_task_id, app=celery_app)

    if result.state not in ("PENDING", "STARTED", "PROGRESS"):
        raise HTTPException(status_code=400, detail=f"Cannot cancel migration in state: {result.state}")

    result.revoke(terminate=True)

    progress_info = result.info or {}
    files_copied = progress_info.get("files_copied", 0)

    config.migration_task_id = None
    db.commit()

    return {"message": "Migration cancelled", "files_copied_before_cancel": files_copied}

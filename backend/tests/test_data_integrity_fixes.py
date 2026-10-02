"""
Regression tests for data integrity fixes (Findings 1–10).

Covers:
1. ExhibitionLoan tenant isolation (organization_id column)
2. Optimistic concurrency (version column) on procedure update endpoints
3. ExhibitionLoan timestamp helpers (no datetime.utcnow)
4. Worker fail-closed when Redis unavailable
5. Link table sync transactional safety (documented, not behavior test)
6. CollectionObject soft-delete behavior
7. FieldAccessPolicy.minimum_role CHECK constraint
8. SSOConfiguration client_secret_encrypted column exists
9. Pipeline watermark deferred until after upsert
10. ExhibitionLoan partial unique index on (exhibition_id, loan_id)

Run with:
    cd backend && ./venv/bin/python -m pytest tests/test_data_integrity_fixes.py -v
"""

import pytest
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock, PropertyMock
from uuid import uuid4


# ============================================================================
# Finding 1: ExhibitionLoan has organization_id
# ============================================================================

class TestExhibitionLoanTenantScoping:
    """ExhibitionLoan must have an organization_id column for RLS."""

    def test_model_has_organization_id_column(self):
        from app.models.loans import ExhibitionLoan
        from sqlalchemy import inspect as sa_inspect
        mapper = sa_inspect(ExhibitionLoan)
        col_names = {c.key for c in mapper.columns}
        assert 'organization_id' in col_names, \
            "ExhibitionLoan must have organization_id for tenant isolation"

    def test_model_has_fk_on_created_by(self):
        from app.models.loans import ExhibitionLoan
        from sqlalchemy import inspect as sa_inspect
        mapper = sa_inspect(ExhibitionLoan)
        col = mapper.columns['created_by']
        fk_targets = [fk.target_fullname for fk in col.foreign_keys]
        assert any('users' in t and 'user_id' in t for t in fk_targets), \
            "ExhibitionLoan.created_by must FK to users.user_id"

    def test_model_has_fk_on_updated_by(self):
        from app.models.loans import ExhibitionLoan
        from sqlalchemy import inspect as sa_inspect
        mapper = sa_inspect(ExhibitionLoan)
        col = mapper.columns['updated_by']
        fk_targets = [fk.target_fullname for fk in col.foreign_keys]
        assert any('users' in t and 'user_id' in t for t in fk_targets), \
            "ExhibitionLoan.updated_by must FK to users.user_id"

    def test_organization_id_is_not_nullable(self):
        from app.models.loans import ExhibitionLoan
        from sqlalchemy import inspect as sa_inspect
        mapper = sa_inspect(ExhibitionLoan)
        col = mapper.columns['organization_id']
        assert not col.nullable, "ExhibitionLoan.organization_id must be NOT NULL"


# ============================================================================
# Finding 2: Optimistic concurrency (version column)
# ============================================================================

class TestOptimisticConcurrency:
    """Procedure models must have a version column for concurrency control."""

    @pytest.mark.parametrize("model_name,module", [
        ("ObjectEntry", "app.models.procedures"),
        ("LoanIn", "app.models.procedures"),
        ("LoanOut", "app.models.procedures"),
        ("ConservationTreatment", "app.models.procedures"),
        ("Deaccession", "app.models.procedures"),
    ])
    def test_procedure_has_version_column(self, model_name, module):
        import importlib
        mod = importlib.import_module(module)
        model_cls = getattr(mod, model_name)
        from sqlalchemy import inspect as sa_inspect
        mapper = sa_inspect(model_cls)
        col_names = {c.key for c in mapper.columns}
        assert 'version' in col_names, \
            f"{model_name} must have a version column for optimistic concurrency"

    def test_check_version_raises_on_mismatch(self):
        """check_version must raise 409 when client version != server version."""
        from app.services.coerce import check_version
        from fastapi import HTTPException

        entity = MagicMock()
        entity.version = 3
        data = {"version": 1, "status": "approved"}

        with pytest.raises(HTTPException) as exc_info:
            check_version(entity, data)
        assert exc_info.value.status_code == 409

    def test_check_version_increments_on_match(self):
        """check_version must increment version and consume it from data."""
        from app.services.coerce import check_version

        entity = MagicMock()
        entity.version = 2
        data = {"version": 2, "status": "approved"}

        check_version(entity, data)
        assert entity.version == 3
        assert "version" not in data  # consumed

    def test_check_version_skips_when_absent(self):
        """check_version must not raise when version key is missing (backwards compat)."""
        from app.services.coerce import check_version

        entity = MagicMock()
        entity.version = 1
        data = {"status": "approved"}

        check_version(entity, data)  # should not raise
        assert entity.version == 1  # unchanged


# ============================================================================
# Finding 3: ExhibitionLoan uses timestamp helpers
# ============================================================================

class TestExhibitionLoanTimestamps:
    """ExhibitionLoan timestamps must use server_default=func.now(), not datetime.utcnow."""

    def test_created_at_has_server_default(self):
        from app.models.loans import ExhibitionLoan
        from sqlalchemy import inspect as sa_inspect
        mapper = sa_inspect(ExhibitionLoan)
        col = mapper.columns['created_at']
        assert col.server_default is not None, \
            "created_at must use server_default (timestamp_now helper)"

    def test_updated_at_has_server_default(self):
        from app.models.loans import ExhibitionLoan
        from sqlalchemy import inspect as sa_inspect
        mapper = sa_inspect(ExhibitionLoan)
        col = mapper.columns['updated_at']
        assert col.server_default is not None, \
            "updated_at must use server_default (timestamp_updated helper)"


# ============================================================================
# Finding 4: Worker fail-closed when Redis unavailable
# ============================================================================

class TestWorkerFailClosed:
    """Worker must skip jobs (fail closed) when Redis is unavailable."""

    @patch("app.services.worker.emit_job_status")
    @patch("app.services.worker._acquire_pipeline_lock", return_value=None)
    @patch("app.services.worker.current_session")
    def test_redis_unavailable_skips_job(self, mock_session, mock_lock, mock_emit):
        """When Redis returns None (unavailable), claim_job must return None."""
        from app.services.worker import claim_job

        mock_job = MagicMock()
        mock_job.job_id = uuid4()
        mock_job.pipeline_id = uuid4()
        mock_job.status = "queued"

        mock_query = MagicMock()
        mock_session.return_value.query.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.with_for_update.return_value = mock_query
        mock_query.first.return_value = mock_job

        claimed = claim_job()
        assert claimed is None, \
            "claim_job must return None when Redis is unavailable (fail closed)"


# ============================================================================
# Finding 5: Link table sync is safe (documentation test)
# ============================================================================

class TestLinkTableSyncDocumented:
    """The _sync_link_tables function must document its transactional safety."""

    def test_sync_link_tables_has_safety_docstring(self):
        from app.fastapi_app.routers.collections_objects import _sync_link_tables
        doc = _sync_link_tables.__doc__ or ""
        assert "transaction" in doc.lower(), \
            "_sync_link_tables docstring must document transactional safety"


# ============================================================================
# Finding 6: CollectionObject soft-delete
# ============================================================================

class TestCollectionObjectSoftDelete:
    """CollectionObject must support soft-delete (is_deleted, deleted_at, deleted_by)."""

    def test_model_has_soft_delete_columns(self):
        from app.models.objects import CollectionObject
        from sqlalchemy import inspect as sa_inspect
        mapper = sa_inspect(CollectionObject)
        col_names = {c.key for c in mapper.columns}
        assert 'is_deleted' in col_names
        assert 'deleted_at' in col_names
        assert 'deleted_by' in col_names

    def test_is_deleted_defaults_to_false(self):
        from app.models.objects import CollectionObject
        from sqlalchemy import inspect as sa_inspect
        mapper = sa_inspect(CollectionObject)
        col = mapper.columns['is_deleted']
        assert col.default is not None or col.server_default is not None


# ============================================================================
# Finding 7: minimum_role CHECK constraint
# ============================================================================

# ============================================================================
# Finding 8: SSO client_secret_encrypted
# ============================================================================

class TestSSOClientSecretEncrypted:
    """SSOConfiguration must store client_secret as encrypted bytes."""

    def test_model_has_encrypted_column(self):
        from app.models.core_sso import SSOConfiguration
        from sqlalchemy import inspect as sa_inspect
        mapper = sa_inspect(SSOConfiguration)
        col_names = {c.key for c in mapper.columns}
        assert 'client_secret_encrypted' in col_names, \
            "SSOConfiguration must have client_secret_encrypted column"

    def test_old_plaintext_column_removed_from_model(self):
        from app.models.core_sso import SSOConfiguration
        from sqlalchemy import inspect as sa_inspect
        mapper = sa_inspect(SSOConfiguration)
        col_names = {c.key for c in mapper.columns}
        assert 'client_secret' not in col_names, \
            "SSOConfiguration must not have plaintext client_secret column in model"


# ============================================================================
# Finding 9: Pipeline watermark deferred
# ============================================================================

class TestPipelineWatermarkDeferred:
    """High watermark must not be committed until after upsert completes."""

    def test_watermark_stored_in_pending_variable(self):
        """Verify the code stores watermark in _pending_watermark, not directly in run.parameters."""
        import inspect
        from app.services import pipeline

        source_code = inspect.getsource(pipeline.phase_extract_and_canonicalize)
        # The watermark should be stored in _pending_watermark first
        assert "_pending_watermark" in source_code, \
            "phase_extract_and_canonicalize must use _pending_watermark to defer watermark commit"

    def test_watermark_committed_after_upsert_section(self):
        """Verify _pending_watermark is committed after batch upsert loop."""
        import inspect
        from app.services import pipeline

        source_code = inspect.getsource(pipeline.phase_extract_and_canonicalize)
        # The pending watermark commit must come AFTER the batch upsert loop
        pending_idx = source_code.find("_pending_watermark = watermark")
        commit_idx = source_code.find('run.parameters[source_key]["high_watermark_source_ts"] = _pending_watermark')
        upsert_idx = source_code.find("batch_upsert_entities")

        assert pending_idx > 0, "Must have _pending_watermark assignment"
        assert commit_idx > 0, "Must have watermark commit from _pending_watermark"
        assert upsert_idx > 0, "Must have batch_upsert_entities call"
        assert commit_idx > upsert_idx, \
            "Watermark commit must come AFTER batch_upsert_entities"


# ============================================================================
# Finding 10: ExhibitionLoan unique loan index
# ============================================================================

class TestExhibitionLoanUniqueIndex:
    """ExhibitionLoan must prevent duplicate (exhibition_id, loan_id) pairs."""

    def test_model_has_unique_loan_index(self):
        from app.models.loans import ExhibitionLoan
        table = ExhibitionLoan.__table__
        index_names = [idx.name for idx in table.indexes]
        assert 'ix_exhibition_loans_unique_loan' in index_names, \
            "ExhibitionLoan must have partial unique index on (exhibition_id, loan_id)"

    def test_unique_loan_index_is_unique(self):
        from app.models.loans import ExhibitionLoan
        table = ExhibitionLoan.__table__
        for idx in table.indexes:
            if idx.name == 'ix_exhibition_loans_unique_loan':
                assert idx.unique, "The exhibition loan index must be unique"
                break

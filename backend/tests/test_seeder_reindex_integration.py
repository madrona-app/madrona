"""Integration: real create-path objects through the real reindex.

The original fault was that index_search reported success even when every doc
failed (per-doc errors swallowed). SLICE 2 made index_search raise on a
partial/empty index; this test exercises the REAL reindex pipeline — the actual
CollectionObjectTransformer and bulk_index logic — against objects created
through the real create service, and asserts indexed == created / failed == 0.

A fake OpenSearch client stands in for a live cluster (none runs in the test
env), but the document-building and the bulk request assembly are the real code
paths: a malformed/unindexable seeded object surfaces here as a transform error
or a missing-key failure, exactly as it would in production.
"""
from __future__ import annotations

import uuid

import pytest

from app.models import Organization, User
from app.search.collections.index_manager import CollectionsIndexManager
from app.services.collections.creation.collection_object import (
    create_collection_object,
)


class _FakeIndices:
    """The indices namespace reindex_all now touches before it writes.

    reindex_all calls setup() first, deliberately: writing to the write alias
    before it exists lets OpenSearch auto-create a concrete index under the
    alias name, which permanently breaks alias creation and every later search.
    This double reports a cluster where nothing is provisioned yet, so setup()
    takes its create path — the same path a fresh deployment takes.
    """

    def __init__(self):
        self.created_indices: list[str] = []
        self.aliases: set[str] = set()

    def exists(self, index):
        return index in self.created_indices

    def exists_alias(self, name):
        return name in self.aliases

    def put_index_template(self, name, body):
        return {"acknowledged": True}

    def create(self, index):
        self.created_indices.append(index)
        return {"acknowledged": True}

    def update_aliases(self, body):
        for action in body["actions"]:
            self.aliases.add(action["add"]["alias"])
        return {"acknowledged": True}


class _FakeOpenSearch:
    """Minimal stand-in exercising the real bulk_index request shape."""

    def __init__(self, fail_ids: set[str] | None = None):
        self.fail_ids = fail_ids or set()
        self.indexed_ids: list[str] = []
        self.indices = _FakeIndices()

    def bulk(self, body, refresh=False):
        # body alternates {action}, {doc}; the docs are the odd indices.
        docs = body[1::2]
        items = []
        any_error = False
        for doc in docs:
            # bulk_index must have populated routing/_id from these — a doc
            # missing them is a real indexing failure, not a silent pass.
            assert "object_id" in doc and "organization_id" in doc
            if doc["object_id"] in self.fail_ids:
                any_error = True
                items.append({"index": {"error": {"type": "mapper_parsing_exception"}}})
            else:
                self.indexed_ids.append(doc["object_id"])
                items.append({"index": {"status": 201}})
        return {"errors": any_error, "items": items}


@pytest.fixture
def org_and_user(db_session):
    org = Organization(
        name="Reindex Integration Org",
        slug=f"reindex-it-{uuid.uuid4().hex[:8]}",
        is_demo=True,
        status="pending",
    )
    db_session.add(org)
    user = User(
        email=f"admin-{uuid.uuid4().hex[:6]}@example.org",
        display_name="Admin",
        status="active",
    )
    db_session.add(user)
    db_session.commit()
    return org.organization_id, user.user_id


def _seed_objects(db_session, org_id, user_id, n):
    objs = []
    for i in range(n):
        obj = create_collection_object(
            db_session,
            org_id,
            {
                "object_number": f"MET-IT-{i:03d}",
                "object_name": f"Integration Object {i}",
                "is_discoverable": True,
            },
            user_id,
        )
        objs.append(obj)
    db_session.commit()
    return objs


class TestSeederReindexIntegration:
    def test_every_created_object_is_indexed(self, db_session, org_and_user):
        org_id, user_id = org_and_user
        objs = _seed_objects(db_session, org_id, user_id, 7)

        fake = _FakeOpenSearch()
        result = CollectionsIndexManager(fake).reindex_all(db_session, str(org_id))

        # The spec's assertion: indexed == created, zero failures.
        assert result["total"] == len(objs)
        assert result["indexed"] == len(objs)
        assert result["errors"] == []
        assert len(fake.indexed_ids) == len(objs)
        assert set(fake.indexed_ids) == {str(o.object_id) for o in objs}

    def test_per_doc_failure_is_surfaced_not_swallowed(self, db_session, org_and_user):
        """The regression guard: a single failing doc must show up in errors
        (so index_search would raise indexed<total), not be silently counted
        as indexed."""
        org_id, user_id = org_and_user
        objs = _seed_objects(db_session, org_id, user_id, 4)
        doomed = str(objs[0].object_id)

        fake = _FakeOpenSearch(fail_ids={doomed})
        result = CollectionsIndexManager(fake).reindex_all(db_session, str(org_id))

        assert result["total"] == 4
        assert result["indexed"] == 3
        assert len(result["errors"]) == 1
        assert doomed not in fake.indexed_ids

    def test_empty_org_indexes_nothing(self, db_session, org_and_user):
        org_id, _ = org_and_user
        fake = _FakeOpenSearch()
        result = CollectionsIndexManager(fake).reindex_all(db_session, str(org_id))
        assert result["total"] == 0
        assert result["indexed"] == 0
        assert result["errors"] == []

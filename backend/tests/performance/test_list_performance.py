"""
Performance benchmark tests for list API endpoints.

These tests verify that list endpoints respond within acceptable time limits
even with large datasets. Run with pytest -m performance.

Performance targets:
- List endpoints with 1000 records: < 500ms
- List endpoints with 10000 records: < 2000ms
- Search endpoints: < 1000ms

NOTE: These tests require PostgreSQL with test data.
Run with: TEST_DATABASE_URL=postgresql://... pytest -m performance tests/performance/
"""

import pytest
import time
from datetime import date, timedelta
from uuid import uuid4

# Mark all tests in this module as performance tests requiring postgres
pytestmark = [pytest.mark.performance, pytest.mark.postgres]


class TestListPerformance:
    """Performance tests for list endpoints."""

    @pytest.fixture
    def large_dataset(self, auth_setup, db_session):
        """
        Create a large dataset for performance testing.

        Creates:
        - 1000 collection objects
        - 500 object entries
        - 200 loans

        Uses the org created by `auth_setup` so requests through the
        authenticated client (which carries COLLECTIONS_VIEW) target the
        same tenant the dataset lives in.
        """
        from app.models import (
            CollectionObject,
            ObjectEntry,
            LoanIn,
            Constituent,
        )

        auth_client, org, _user = auth_setup
        org_id = org.organization_id

        # Create constituent (formerly Contact — kept as backwards-compat alias,
        # but the current PK is `constituent_id`).
        constituent = Constituent(
            organization_id=org_id,
            name="Test Contact",
            constituent_type="organization",
        )
        db_session.add(constituent)
        db_session.commit()

        # Create 1000 collection objects in batches
        batch_size = 100
        for batch in range(10):
            objects = []
            for i in range(batch_size):
                idx = batch * batch_size + i
                obj = CollectionObject(
                    organization_id=org_id,
                    object_number=f"OBJ-{idx:06d}",
                    object_name=f"Test Object {idx}",
                    object_status="accessioned",
                    object_type="artifact",
                )
                objects.append(obj)
            db_session.add_all(objects)
            db_session.commit()

        # Create 500 object entries in batches
        for batch in range(5):
            entries = []
            for i in range(batch_size):
                idx = batch * batch_size + i
                entry = ObjectEntry(
                    organization_id=org_id,
                    entry_number=f"E-{idx:06d}",
                    entry_date=date.today() - timedelta(days=idx % 365),
                    # `entry_reason` now constrained to a specific enum —
                    # `loan` alone is no longer valid, must be
                    # `loan_consideration`.
                    entry_reason="loan_consideration",
                    depositor_id=constituent.constituent_id,
                    objects_description=f"Test entry {idx}",
                    status="pending",
                )
                entries.append(entry)
            db_session.add_all(entries)
            db_session.commit()

        # Create 200 loans
        for batch in range(2):
            loans = []
            for i in range(batch_size):
                idx = batch * batch_size + i
                loan = LoanIn(
                    organization_id=org_id,
                    loan_number=f"LI-{idx:06d}",
                    lender_id=constituent.constituent_id,
                    loan_purpose="exhibition",
                    loan_start_date=date.today(),
                    loan_end_date=date.today() + timedelta(days=180),
                    status="requested",
                )
                loans.append(loan)
            db_session.add_all(loans)
            db_session.commit()

        return auth_client, org

    def test_list_objects_performance(self, large_dataset):
        """List collection objects should respond in under 2 seconds."""
        auth_client, org = large_dataset

        url = f"/api/organizations/{org.organization_id}/collections/objects"
        # Warm-up request: this is the first endpoint hit in the perf suite, so
        # a single cold call also pays one-time costs (SQLAlchemy mapper
        # configuration, connection-pool fill, route warm-up) that aren't part
        # of steady-state list latency. On a loaded CI runner that cold start
        # alone can exceed the threshold and flake the gate. Measure the second
        # call so the assertion reflects real per-request performance.
        warmup = auth_client.get(url, query_string={"limit": 50})
        assert warmup.status_code == 200

        start = time.perf_counter()
        response = auth_client.get(url, query_string={"limit": 50})
        elapsed = time.perf_counter() - start

        assert response.status_code == 200
        assert elapsed < 2.0, f"List objects took {elapsed:.2f}s (limit: 2.0s)"

    def test_list_objects_with_pagination(self, large_dataset):
        """Paginated list should maintain performance."""
        auth_client, org = large_dataset

        # Test multiple pages
        times = []
        for offset in [0, 100, 500, 900]:
            start = time.perf_counter()
            response = auth_client.get(
                f"/api/organizations/{org.organization_id}/collections/objects",
                query_string={"limit": 50, "offset": offset}
            )
            elapsed = time.perf_counter() - start
            times.append(elapsed)

            assert response.status_code == 200
            assert elapsed < 2.0, f"Offset {offset} took {elapsed:.2f}s"

        # Average time should be consistent
        avg_time = sum(times) / len(times)
        max_time = max(times)
        assert max_time < avg_time * 2, "Pagination performance varies too much"

    def test_list_entries_performance(self, large_dataset):
        """List object entries should respond in under 2 seconds."""
        auth_client, org = large_dataset

        start = time.perf_counter()
        response = auth_client.get(
            f"/api/organizations/{org.organization_id}/collections/entries",
            query_string={"limit": 50}
        )
        elapsed = time.perf_counter() - start

        assert response.status_code == 200
        assert elapsed < 2.0, f"List entries took {elapsed:.2f}s (limit: 2.0s)"

    def test_list_loans_performance(self, large_dataset):
        """List loans should respond in under 2 seconds."""
        auth_client, org = large_dataset

        start = time.perf_counter()
        response = auth_client.get(
            f"/api/organizations/{org.organization_id}/collections/loans-in",
            query_string={"limit": 50}
        )
        elapsed = time.perf_counter() - start

        assert response.status_code == 200
        assert elapsed < 2.0, f"List loans took {elapsed:.2f}s (limit: 2.0s)"


class TestSearchPerformance:
    """Performance tests for search endpoints."""

    @pytest.fixture
    def searchable_dataset(self, auth_setup, db_session):
        """Create dataset with varied content for search testing.

        Seeds into the org created by `auth_setup` so the authenticated
        client (carrying COLLECTIONS_VIEW) can read it back.
        """
        from app.models import CollectionObject

        auth_client, org, _user = auth_setup
        org_id = org.organization_id

        # Create objects with varied titles for searching
        titles = [
            "Ancient Greek Vase",
            "Roman Bronze Sculpture",
            "Medieval Manuscript",
            "Renaissance Painting",
            "Impressionist Landscape",
            "Modern Abstract Art",
            "Contemporary Installation",
            "Egyptian Artifact",
            "Chinese Porcelain",
            "Japanese Screen",
        ]

        for i in range(100):
            title = titles[i % len(titles)]
            obj = CollectionObject(
                organization_id=org_id,
                object_number=f"SEARCH-{i:04d}",
                object_name=f"{title} #{i}",
                object_status="accessioned",
                object_type="artifact",
            )
            db_session.add(obj)

        db_session.commit()
        return auth_client, org

    def test_search_objects_performance(self, searchable_dataset):
        """Search should respond in under 1 second."""
        auth_client, org = searchable_dataset

        start = time.perf_counter()
        response = auth_client.get(
            f"/api/organizations/{org.organization_id}/collections/objects",
            query_string={"q": "Greek", "limit": 50}
        )
        elapsed = time.perf_counter() - start

        assert response.status_code == 200
        assert elapsed < 1.0, f"Search took {elapsed:.2f}s (limit: 1.0s)"


class TestConcurrencyPerformance:
    """Test performance under concurrent load."""

    def test_concurrent_reads_performance(self, app, client):
        """
        Test that concurrent reads don't cause performance degradation.

        Note: This is a simplified test. Full load testing should use
        tools like locust or k6.
        """
        import threading
        from collections import defaultdict

        # Simple org for testing
        from app.models import Organization
        from app.database import current_session

        session = current_session()
        org = Organization(
            name="Concurrent Test Org",
            slug=f"concurrent-{uuid4().hex[:8]}",
            status="active",
        )
        session.add(org)
        session.commit()
        org_id = org.organization_id

        results = defaultdict(list)
        errors = []

        def make_request(thread_id):
            try:
                start = time.perf_counter()
                response = client.get(
                    f"/api/organizations/{org_id}/collections/objects",
                    query_string={"limit": 10}
                )
                elapsed = time.perf_counter() - start
                results[thread_id].append((response.status_code, elapsed))
            except Exception as e:
                errors.append((thread_id, str(e)))

        # Spawn 10 concurrent threads
        threads = []
        for i in range(10):
            t = threading.Thread(target=make_request, args=(i,))
            threads.append(t)
            t.start()

        # Wait for all threads
        for t in threads:
            t.join(timeout=30)

        # Check results
        assert len(errors) == 0, f"Errors occurred: {errors}"

        all_times = [r[1] for thread_results in results.values() for r in thread_results]
        avg_time = sum(all_times) / len(all_times) if all_times else 0
        max_time = max(all_times) if all_times else 0

        assert max_time < 5.0, f"Max request time was {max_time:.2f}s"
        assert avg_time < 2.0, f"Average request time was {avg_time:.2f}s"

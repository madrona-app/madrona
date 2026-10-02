"""The TUS quota hook.

Before this existed, tusd ran with `-hooks-enabled-events post-finish` only:
it accepted and wrote the whole file, then told the application. So
check_storage_limit() — which every other upload route calls — had nowhere to
run on this path, and the frontend sends every file over 10 MB through it
(uploadStore.ts). The quota held for small files and lapsed for exactly the
large ones it exists to catch.
"""

import json
from unittest.mock import MagicMock, patch

import pytest

TEST_HOOK_SECRET = "test-tus-hook-secret"


def _post(client, url, body, secret=TEST_HOOK_SECRET, headers=None):
    h = {"X-Hook-Secret": secret} if secret is not None else {}
    h.update(headers or {})
    return client.post(url, data=json.dumps(body), content_type="application/json", headers=h)


def _v2(org_id, size, deferred=False):
    """tusd v2 shape: the Upload nested under Event."""
    return {
        "Type": "pre-create",
        "Event": {
            "Upload": {
                "Size": size,
                "SizeIsDeferred": deferred,
                "MetaData": {"organization_id": str(org_id), "filename": "big.tif"},
            }
        },
    }


def _v1(org_id, size):
    """tusd v1 shape: Upload at the top level."""
    return {
        "Upload": {
            "Size": size,
            "MetaData": {"organization_id": str(org_id), "filename": "big.tif"},
        }
    }


@pytest.fixture(autouse=True)
def _tus_on():
    with patch("app.fastapi_app.routers.media_tus_webhook.get_settings") as s:
        s.return_value = MagicMock(
            tus_enabled=True, tus_webhook_secret=TEST_HOOK_SECRET
        )
        yield


class TestQuotaEnforcement:
    def test_an_upload_within_quota_is_allowed(self, client, auth_setup):
        _, org, _ = auth_setup
        resp = _post(client, "/hooks/tus/pre-create", _v2(org.organization_id, 1024))
        assert resp.status_code == 200

    def test_an_upload_over_quota_is_refused_before_any_bytes(self, client, auth_setup):
        """413, the same code the non-TUS routes return for this condition."""
        _, org, _ = auth_setup
        with patch(
            "app.services.uploads.check_storage_limit",
            side_effect=__import__(
                "app.services.uploads", fromlist=["StorageLimitExceeded"]
            ).StorageLimitExceeded("over", used_bytes=10, limit_bytes=10, file_size=5),
        ):
            resp = _post(client, "/hooks/tus/pre-create", _v2(org.organization_id, 5))

        assert resp.status_code == 413
        assert resp.get_json()["code"] == "STORAGE_LIMIT_EXCEEDED"

    def test_a_deferred_size_is_allowed_but_warned_about(self, client, auth_setup):
        """Nothing to check against, so allowing it is the honest outcome.

        Refusing every streaming upload to enforce a limit we cannot evaluate
        would be worse. tusd's -max-size is what closes this.
        """
        _, org, _ = auth_setup
        resp = _post(client, "/hooks/tus/pre-create", _v2(org.organization_id, 0, deferred=True))
        assert resp.status_code == 200


class TestPayloadShapes:
    def test_reads_the_tusd_v1_shape(self, client, auth_setup):
        """A tusd upgrade must not silently turn the check into a no-op.

        v1 puts Upload at the top level, v2 nests it under Event. A hook that
        read only one shape would find no size in the other and allow
        everything.
        """
        _, org, _ = auth_setup
        resp = _post(client, "/hooks/tus/pre-create", _v1(org.organization_id, 1024))
        assert resp.status_code == 200

    def test_missing_organization_is_refused(self, client):
        body = {"Type": "pre-create", "Event": {"Upload": {"Size": 1, "MetaData": {}}}}
        resp = _post(client, "/hooks/tus/pre-create", body)
        assert resp.status_code == 400


class TestAuth:
    def test_a_wrong_secret_is_refused(self, client, auth_setup):
        _, org, _ = auth_setup
        resp = _post(client, "/hooks/tus/pre-create", _v2(org.organization_id, 1), secret="nope")
        assert resp.status_code == 403

    def test_a_missing_secret_is_refused(self, client, auth_setup):
        _, org, _ = auth_setup
        resp = _post(client, "/hooks/tus/pre-create", _v2(org.organization_id, 1), secret=None)
        assert resp.status_code == 403


class TestDispatcher:
    def test_the_single_hook_url_routes_pre_create(self, client, auth_setup):
        """tusd posts every event to one URL and names the type in the body.

        Pointing -hooks-http at a per-event path would send post-finish there
        too; the dispatcher is what makes one configured URL correct.
        """
        _, org, _ = auth_setup
        resp = _post(client, "/hooks/tus", _v2(org.organization_id, 1024))
        assert resp.status_code == 200

    def test_an_unknown_hook_type_is_ignored(self, client, auth_setup):
        _, org, _ = auth_setup
        body = _v2(org.organization_id, 1024)
        body["Type"] = "post-terminate"
        resp = _post(client, "/hooks/tus", body)
        assert resp.status_code == 200

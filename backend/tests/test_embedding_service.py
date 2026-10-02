"""Unit tests for app/services/embedding_service.py.

The service hits Ollama via HTTP. Tests mock `requests.post`/`requests.get`
and `get_settings` to verify retry/truncation logic, dimension validation,
graceful fallback to None, and the availability cache.
"""

from unittest.mock import MagicMock, patch

import pytest

from app.services import embedding_service as svc


@pytest.fixture(autouse=True)
def _reset_availability_cache():
    """Clear the module-level availability cache between tests."""
    svc._available = None
    svc._available_checked_at = 0
    yield
    svc._available = None
    svc._available_checked_at = 0


def _settings(enabled=True, model="nomic-embed-text", dims=768, base_url="http://ollama:11434"):
    s = MagicMock()
    s.semantic_search_enabled = enabled
    s.embedding_provider = "ollama"
    s.semantic_search_model = model
    s.semantic_search_dimensions = dims
    s.ollama_base_url = base_url
    return s


def _voyage_settings(enabled=True, dims=1024, key="vk-test", model="voyage-3.5"):
    s = MagicMock()
    s.semantic_search_enabled = enabled
    s.embedding_provider = "voyage"
    s.voyage_api_key = key
    s.voyage_model = model
    s.semantic_search_dimensions = dims
    return s


def _voyage_response(vectors_by_index):
    """Build a mock Voyage API response. vectors_by_index: list of (index, vec)."""
    resp = MagicMock(status_code=200)
    resp.json.return_value = {
        "data": [{"embedding": v, "index": i} for i, v in vectors_by_index]
    }
    resp.raise_for_status = MagicMock()
    return resp


class TestGetEmbedding:
    def test_returns_none_when_disabled(self):
        with patch.object(svc, "get_settings", return_value=_settings(enabled=False)):
            assert svc.get_embedding("hello") is None

    def test_returns_none_for_empty_string(self):
        with patch.object(svc, "get_settings", return_value=_settings()):
            assert svc.get_embedding("") is None
            assert svc.get_embedding("   ") is None

    def test_returns_embedding_on_success(self):
        embedding = [0.1] * 768
        response = MagicMock(status_code=200)
        response.json.return_value = {"embedding": embedding}
        response.raise_for_status = MagicMock()
        with patch.object(svc, "get_settings", return_value=_settings()):
            with patch.object(svc.requests, "post", return_value=response) as mock_post:
                result = svc.get_embedding("hello")
        assert result == embedding
        mock_post.assert_called_once()

    def test_uses_search_document_task_prefix_by_default(self):
        embedding = [0.0] * 768
        response = MagicMock(status_code=200)
        response.json.return_value = {"embedding": embedding}
        response.raise_for_status = MagicMock()
        with patch.object(svc, "get_settings", return_value=_settings()):
            with patch.object(svc.requests, "post", return_value=response) as mock_post:
                svc.get_embedding("the text")
        body = mock_post.call_args.kwargs["json"]
        assert body["prompt"].startswith("search_document:")

    def test_passes_explicit_task_prefix(self):
        embedding = [0.0] * 768
        response = MagicMock(status_code=200)
        response.json.return_value = {"embedding": embedding}
        response.raise_for_status = MagicMock()
        with patch.object(svc, "get_settings", return_value=_settings()):
            with patch.object(svc.requests, "post", return_value=response) as mock_post:
                svc.get_embedding("the text", task="search_query")
        body = mock_post.call_args.kwargs["json"]
        assert body["prompt"].startswith("search_query:")

    def test_retries_with_smaller_truncation_when_context_length_error(self):
        # First call returns 500 with context length error, second returns success.
        too_long = MagicMock(status_code=500)
        too_long.text = "this exceeds the context length, sorry"
        too_long.raise_for_status = MagicMock()
        success = MagicMock(status_code=200)
        success.json.return_value = {"embedding": [0.1] * 768}
        success.raise_for_status = MagicMock()
        with patch.object(svc, "get_settings", return_value=_settings()):
            with patch.object(svc.requests, "post", side_effect=[too_long, success]) as mock_post:
                result = svc.get_embedding("x" * 2000)
        assert result == [0.1] * 768
        assert mock_post.call_count == 2
        # First call uses 1200 char limit, second uses 800
        assert "x" * 1200 in mock_post.call_args_list[0].kwargs["json"]["prompt"]
        assert "x" * 800 in mock_post.call_args_list[1].kwargs["json"]["prompt"]

    def test_returns_none_when_dimensions_mismatch(self):
        response = MagicMock(status_code=200)
        response.json.return_value = {"embedding": [0.1] * 100}  # wrong size
        response.raise_for_status = MagicMock()
        with patch.object(svc, "get_settings", return_value=_settings()):
            with patch.object(svc.requests, "post", return_value=response):
                assert svc.get_embedding("hello") is None

    def test_returns_none_when_no_embedding_in_response(self):
        response = MagicMock(status_code=200)
        response.json.return_value = {}
        response.raise_for_status = MagicMock()
        with patch.object(svc, "get_settings", return_value=_settings()):
            with patch.object(svc.requests, "post", return_value=response):
                assert svc.get_embedding("hello") is None

    def test_returns_none_on_request_exception(self):
        with patch.object(svc, "get_settings", return_value=_settings()):
            with patch.object(
                svc.requests, "post", side_effect=svc.requests.exceptions.ConnectionError("down")
            ):
                assert svc.get_embedding("hello") is None


class TestIsEmbeddingServiceAvailable:
    def test_returns_false_when_disabled(self):
        with patch.object(svc, "get_settings", return_value=_settings(enabled=False)):
            assert svc.is_embedding_service_available() is False

    def test_returns_true_when_model_present(self):
        response = MagicMock()
        response.json.return_value = {
            "models": [
                {"name": "nomic-embed-text:latest"},
                {"name": "other:latest"},
            ]
        }
        response.raise_for_status = MagicMock()
        with patch.object(svc, "get_settings", return_value=_settings()):
            with patch.object(svc.requests, "get", return_value=response):
                assert svc.is_embedding_service_available() is True

    def test_returns_false_when_model_absent(self):
        response = MagicMock()
        response.json.return_value = {"models": [{"name": "other:latest"}]}
        response.raise_for_status = MagicMock()
        with patch.object(svc, "get_settings", return_value=_settings()):
            with patch.object(svc.requests, "get", return_value=response):
                assert svc.is_embedding_service_available() is False

    def test_returns_false_on_connection_error(self):
        with patch.object(svc, "get_settings", return_value=_settings()):
            with patch.object(
                svc.requests, "get", side_effect=svc.requests.exceptions.ConnectionError("down")
            ):
                assert svc.is_embedding_service_available() is False

    def test_caches_result_for_30_seconds(self):
        response = MagicMock()
        response.json.return_value = {"models": [{"name": "nomic-embed-text:v2"}]}
        response.raise_for_status = MagicMock()
        with patch.object(svc, "get_settings", return_value=_settings()):
            with patch.object(svc.requests, "get", return_value=response) as mock_get:
                # First call hits the network
                assert svc.is_embedding_service_available() is True
                # Second call within 30s reuses the cache
                assert svc.is_embedding_service_available() is True
                assert mock_get.call_count == 1

    def test_recomputes_after_cache_window_expires(self):
        response = MagicMock()
        response.json.return_value = {"models": [{"name": "nomic-embed-text"}]}
        response.raise_for_status = MagicMock()
        with patch.object(svc, "get_settings", return_value=_settings()):
            with patch.object(svc.requests, "get", return_value=response) as mock_get:
                svc.is_embedding_service_available()
                # Force the cache to expire
                svc._available_checked_at = 0
                svc.is_embedding_service_available()
                assert mock_get.call_count == 2


class TestVoyageProvider:
    def test_returns_embedding_on_success(self):
        vec = [0.1] * 1024
        resp = _voyage_response([(0, vec)])
        with patch.object(svc, "get_settings", return_value=_voyage_settings()):
            with patch.object(svc.requests, "post", return_value=resp) as mock_post:
                result = svc.get_embedding("hello")
        assert result == vec
        # Hits the Voyage endpoint with auth + correct body
        assert mock_post.call_args.args[0] == svc.VOYAGE_API_URL
        assert mock_post.call_args.kwargs["headers"]["Authorization"] == "Bearer vk-test"
        body = mock_post.call_args.kwargs["json"]
        assert body["model"] == "voyage-3.5"
        assert body["output_dimension"] == 1024
        assert body["input_type"] == "document"

    def test_query_uses_query_input_type(self):
        resp = _voyage_response([(0, [0.0] * 1024)])
        with patch.object(svc, "get_settings", return_value=_voyage_settings()):
            with patch.object(svc.requests, "post", return_value=resp) as mock_post:
                svc.get_embedding("q", task="search_query")
        assert mock_post.call_args.kwargs["json"]["input_type"] == "query"

    def test_no_key_returns_none_without_calling_api(self):
        with patch.object(svc, "get_settings", return_value=_voyage_settings(key="")):
            with patch.object(svc.requests, "post") as mock_post:
                assert svc.get_embedding("hello") is None
            mock_post.assert_not_called()

    def test_dimension_mismatch_returns_none(self):
        resp = _voyage_response([(0, [0.1] * 256)])  # wrong width for 1024 settings
        with patch.object(svc, "get_settings", return_value=_voyage_settings()):
            with patch.object(svc.requests, "post", return_value=resp):
                assert svc.get_embedding("hello") is None

    def test_returns_none_on_request_exception(self):
        with patch.object(svc, "get_settings", return_value=_voyage_settings()):
            with patch.object(
                svc.requests, "post",
                side_effect=svc.requests.exceptions.ConnectionError("down"),
            ):
                assert svc.get_embedding("hello") is None

    def test_batch_aligns_by_index_even_when_unordered(self):
        # API returns results out of order; service must realign to inputs.
        va, vb = [0.1] * 1024, [0.2] * 1024
        resp = _voyage_response([(1, vb), (0, va)])
        with patch.object(svc, "get_settings", return_value=_voyage_settings()):
            with patch.object(svc.requests, "post", return_value=resp) as mock_post:
                out = svc.get_embeddings_batch(["a", "b"])
        assert out == [va, vb]
        # Whole batch sent in a single request
        assert mock_post.call_count == 1
        assert mock_post.call_args.kwargs["json"]["input"] == ["a", "b"]

    def test_batch_disabled_returns_none_list(self):
        with patch.object(svc, "get_settings", return_value=_voyage_settings(enabled=False)):
            assert svc.get_embeddings_batch(["a", "b"]) == [None, None]

    def test_available_true_with_key_false_without(self):
        with patch.object(svc, "get_settings", return_value=_voyage_settings(key="vk")):
            assert svc.is_embedding_service_available() is True
        svc._available = None
        svc._available_checked_at = 0
        with patch.object(svc, "get_settings", return_value=_voyage_settings(key="")):
            assert svc.is_embedding_service_available() is False

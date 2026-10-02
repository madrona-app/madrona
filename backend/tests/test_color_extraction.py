"""Tests for color extraction service."""

import sys
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from app.services.color_extraction import (
    _closest_color_name,
    _generate_color_key,
    _rgb_to_hex,
)


class TestClosestColorName:
    """Tests for _closest_color_name()."""

    def test_exact_red(self):
        assert _closest_color_name((255, 0, 0)) == "red"

    def test_exact_blue(self):
        assert _closest_color_name((0, 0, 255)) == "blue"

    def test_exact_black(self):
        assert _closest_color_name((0, 0, 0)) == "black"

    def test_exact_white(self):
        assert _closest_color_name((255, 255, 255)) == "white"

    def test_exact_gray(self):
        assert _closest_color_name((128, 128, 128)) == "gray"

    def test_near_red(self):
        result = _closest_color_name((240, 10, 10))
        assert result == "red"

    def test_near_blue(self):
        result = _closest_color_name((10, 10, 240))
        assert result == "blue"

    def test_dark_gray_closer_to_black(self):
        result = _closest_color_name((20, 20, 20))
        assert result == "black"

    def test_light_gray_closer_to_gray(self):
        result = _closest_color_name((140, 140, 140))
        assert result == "gray"


class TestRgbToHex:
    """Tests for _rgb_to_hex()."""

    def test_black(self):
        assert _rgb_to_hex((0, 0, 0)) == "#000000"

    def test_white(self):
        assert _rgb_to_hex((255, 255, 255)) == "#ffffff"

    def test_red(self):
        assert _rgb_to_hex((255, 0, 0)) == "#ff0000"

    def test_arbitrary(self):
        assert _rgb_to_hex((18, 52, 86)) == "#123456"


class TestGenerateColorKey:
    """Tests for _generate_color_key()."""

    def test_full_5_colors(self):
        colors = [
            {"name": "blue"},
            {"name": "red"},
            {"name": "green"},
            {"name": "white"},
            {"name": "black"},
        ]
        assert _generate_color_key(colors) == "brgwk"

    def test_partial_colors_padded(self):
        colors = [{"name": "red"}, {"name": "green"}]
        assert _generate_color_key(colors) == "rgxxx"

    def test_empty_colors(self):
        assert _generate_color_key([]) == "xxxxx"

    def test_more_than_5_truncated(self):
        colors = [{"name": n} for n in ["red", "blue", "green", "white", "black", "orange"]]
        key = _generate_color_key(colors)
        assert len(key) == 5
        assert key == "rbgwk"

    def test_single_color(self):
        colors = [{"name": "purple"}]
        assert _generate_color_key(colors) == "pxxxx"


class TestExtractDominantColors:
    """Tests for extract_dominant_colors() with mocked sklearn."""

    def _make_image_bytes(self):
        """Create a simple 10x10 red PNG image."""
        from PIL import Image
        import io

        img = Image.new("RGB", (10, 10), (255, 0, 0))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()

    def _setup_sklearn_mock(self, centers, labels):
        """Set up mock sklearn.cluster.KMeans in sys.modules."""
        mock_kmeans_instance = MagicMock()
        mock_kmeans_instance.cluster_centers_ = np.array(centers, dtype=float)
        mock_kmeans_instance.labels_ = np.array(labels)
        mock_kmeans_instance.fit.return_value = mock_kmeans_instance

        mock_kmeans_class = MagicMock(return_value=mock_kmeans_instance)

        mock_cluster = MagicMock()
        mock_cluster.KMeans = mock_kmeans_class

        mock_sklearn = MagicMock()
        mock_sklearn.cluster = mock_cluster

        return mock_sklearn, mock_cluster, mock_kmeans_class

    def test_returns_list_of_color_dicts(self):
        mock_sklearn, mock_cluster, _ = self._setup_sklearn_mock(
            [[255, 0, 0], [0, 0, 255]], [0, 0, 0, 1]
        )
        with patch.dict(sys.modules, {"sklearn": mock_sklearn, "sklearn.cluster": mock_cluster}):
            from app.services.color_extraction import extract_dominant_colors
            result = extract_dominant_colors(self._make_image_bytes(), n_colors=2)
        assert isinstance(result, list)
        assert len(result) > 0
        for c in result:
            assert "hex" in c
            assert "rgb" in c
            assert "percentage" in c
            assert "name" in c

    def test_hex_format(self):
        mock_sklearn, mock_cluster, _ = self._setup_sklearn_mock(
            [[255, 0, 0]], [0, 0, 0]
        )
        with patch.dict(sys.modules, {"sklearn": mock_sklearn, "sklearn.cluster": mock_cluster}):
            from app.services.color_extraction import extract_dominant_colors
            result = extract_dominant_colors(self._make_image_bytes(), n_colors=1)
        assert result[0]["hex"].startswith("#")
        assert len(result[0]["hex"]) == 7

    def test_percentages_sum_to_100(self):
        mock_sklearn, mock_cluster, _ = self._setup_sklearn_mock(
            [[128, 128, 128]], [0, 0, 0]
        )
        with patch.dict(sys.modules, {"sklearn": mock_sklearn, "sklearn.cluster": mock_cluster}):
            from app.services.color_extraction import extract_dominant_colors
            result = extract_dominant_colors(self._make_image_bytes(), n_colors=1)
        total = sum(c["percentage"] for c in result)
        assert abs(total - 100.0) < 0.5

    def test_solid_red_image_detects_red(self):
        mock_sklearn, mock_cluster, _ = self._setup_sklearn_mock(
            [[255, 0, 0]], [0, 0, 0]
        )
        with patch.dict(sys.modules, {"sklearn": mock_sklearn, "sklearn.cluster": mock_cluster}):
            from app.services.color_extraction import extract_dominant_colors
            result = extract_dominant_colors(self._make_image_bytes(), n_colors=1)
        assert result[0]["name"] == "red"

    def test_multiple_colors_returned(self):
        mock_sklearn, mock_cluster, _ = self._setup_sklearn_mock(
            [[255, 0, 0], [0, 255, 0], [0, 0, 255]],
            [0, 0, 1, 1, 2],
        )
        with patch.dict(sys.modules, {"sklearn": mock_sklearn, "sklearn.cluster": mock_cluster}):
            from app.services.color_extraction import extract_dominant_colors
            result = extract_dominant_colors(self._make_image_bytes(), n_colors=3)
        assert len(result) == 3

    def test_rgb_values_are_ints(self):
        mock_sklearn, mock_cluster, _ = self._setup_sklearn_mock(
            [[255, 0, 0]], [0, 0, 0]
        )
        with patch.dict(sys.modules, {"sklearn": mock_sklearn, "sklearn.cluster": mock_cluster}):
            from app.services.color_extraction import extract_dominant_colors
            result = extract_dominant_colors(self._make_image_bytes(), n_colors=1)
        for val in result[0]["rgb"]:
            assert isinstance(val, int)

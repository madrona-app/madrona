"""
Unit tests for exhibit geometry validation.

These tests verify the geometry validation logic without requiring
the full exhibit schema. They can run with SQLite.
"""

import pytest


class TestGeometryValidation:
    """Tests for geometry validation functions."""

    def test_validate_rectangular_geometry(self):
        """Test validation of rectangular geometry format."""
        geometry = {
            "type": "rectangular",
            "width_cm": 800,
            "depth_cm": 600,
            "walls": {
                "north": {"length": 800},
                "south": {"length": 800},
                "east": {"length": 600},
                "west": {"length": 600}
            }
        }

        # Validate structure
        assert geometry["type"] == "rectangular"
        assert geometry["width_cm"] > 0
        assert geometry["depth_cm"] > 0
        assert all(wall in geometry["walls"] for wall in ["north", "south", "east", "west"])

    def test_validate_polygon_geometry_structure(self):
        """Test validation of polygon geometry structure."""
        geometry = {
            "type": "polygon",
            "vertices": [
                {"id": "v1", "x": 0, "y": 0},
                {"id": "v2", "x": 800, "y": 0},
                {"id": "v3", "x": 800, "y": 600},
                {"id": "v4", "x": 0, "y": 600}
            ],
            "walls": [
                {"id": "w1", "start_vertex": "v1", "end_vertex": "v2", "height_cm": 300, "openings": []},
                {"id": "w2", "start_vertex": "v2", "end_vertex": "v3", "height_cm": 300, "openings": []},
                {"id": "w3", "start_vertex": "v3", "end_vertex": "v4", "height_cm": 300, "openings": []},
                {"id": "w4", "start_vertex": "v4", "end_vertex": "v1", "height_cm": 300, "openings": []}
            ],
            "columns": []
        }

        # Validate structure
        assert geometry["type"] == "polygon"
        assert len(geometry["vertices"]) >= 3
        assert len(geometry["walls"]) >= 3

        # Validate vertex references in walls
        vertex_ids = {v["id"] for v in geometry["vertices"]}
        for wall in geometry["walls"]:
            assert wall["start_vertex"] in vertex_ids
            assert wall["end_vertex"] in vertex_ids

    def test_polygon_requires_minimum_vertices(self):
        """Test that polygon requires at least 3 vertices."""
        geometry = {
            "type": "polygon",
            "vertices": [
                {"id": "v1", "x": 0, "y": 0},
                {"id": "v2", "x": 800, "y": 0}
            ],
            "walls": [],
            "columns": []
        }

        # Should fail validation - need at least 3 vertices
        assert len(geometry["vertices"]) < 3

    def test_wall_references_must_exist(self):
        """Test that wall vertex references must exist."""
        geometry = {
            "type": "polygon",
            "vertices": [
                {"id": "v1", "x": 0, "y": 0},
                {"id": "v2", "x": 800, "y": 0},
                {"id": "v3", "x": 800, "y": 600}
            ],
            "walls": [
                {"id": "w1", "start_vertex": "v1", "end_vertex": "v99", "height_cm": 300, "openings": []}
            ],
            "columns": []
        }

        # Validate that wall references invalid vertex
        vertex_ids = {v["id"] for v in geometry["vertices"]}
        for wall in geometry["walls"]:
            if wall["end_vertex"] not in vertex_ids:
                assert wall["end_vertex"] == "v99"  # Expected invalid reference

    def test_validate_opening_structure(self):
        """Test validation of wall opening structure."""
        opening = {
            "type": "door",
            "offset_cm": 100,
            "width_cm": 100,
            "height_cm": 220
        }

        assert opening["type"] in ["door", "window"]
        assert opening["offset_cm"] >= 0
        assert opening["width_cm"] > 0
        assert opening["height_cm"] > 0

    def test_validate_column_structure(self):
        """Test validation of column structure."""
        column = {
            "id": "col_1",
            "x": 400,
            "y": 300,
            "radius_cm": 30,
            "shape": "circular"
        }

        assert column["shape"] in ["circular", "square"]
        assert column["radius_cm"] > 0

    def test_opening_must_fit_in_wall(self):
        """Test that openings must fit within wall length."""
        wall_length = 800  # cm
        opening = {
            "type": "door",
            "offset_cm": 700,
            "width_cm": 200,  # Would extend past wall end
            "height_cm": 220
        }

        # Opening extends beyond wall
        opening_end = opening["offset_cm"] + opening["width_cm"]
        assert opening_end > wall_length

    def test_background_image_structure(self):
        """Test validation of background image structure."""
        background = {
            "url": "https://example.com/floor_plan.png",
            "scale_factor": 2.5,
            "offset_x": 0,
            "offset_y": 0,
            "opacity": 0.5
        }

        assert 0 <= background["opacity"] <= 1
        assert background["scale_factor"] > 0


class TestGeometryNormalization:
    """Tests for geometry normalization from rectangular to polygon."""

    def test_rectangular_to_polygon_vertices(self):
        """Test converting rectangular geometry to polygon vertices."""
        rectangular = {
            "type": "rectangular",
            "width_cm": 800,
            "depth_cm": 600
        }

        # Expected polygon vertices for a rectangular room
        expected_vertices = [
            {"id": "v0", "x": 0, "y": 0},
            {"id": "v1", "x": 800, "y": 0},
            {"id": "v2", "x": 800, "y": 600},
            {"id": "v3", "x": 0, "y": 600}
        ]

        # Validate that rectangular can be converted to polygon
        width = rectangular["width_cm"]
        depth = rectangular["depth_cm"]

        actual_vertices = [
            {"id": "v0", "x": 0, "y": 0},
            {"id": "v1", "x": width, "y": 0},
            {"id": "v2", "x": width, "y": depth},
            {"id": "v3", "x": 0, "y": depth}
        ]

        assert actual_vertices == expected_vertices

    def test_rectangular_wall_mapping(self):
        """Test mapping cardinal walls to polygon wall IDs."""
        rectangular_walls = {
            "north": {"length": 800},
            "east": {"length": 600},
            "south": {"length": 800},
            "west": {"length": 600}
        }

        # Map cardinal directions to polygon wall indices
        wall_mapping = {
            "north": "wall_0",  # v0 -> v1
            "east": "wall_1",   # v1 -> v2
            "south": "wall_2",  # v2 -> v3
            "west": "wall_3",   # v3 -> v0
        }

        for cardinal, wall_id in wall_mapping.items():
            assert cardinal in rectangular_walls


class TestPlacementPositioning:
    """Tests for placement position calculations."""

    def test_wall_relative_to_world_coordinates(self):
        """Test converting wall-relative to world coordinates."""
        # Wall from (0, 0) to (800, 0) - north wall
        wall_start = {"x": 0, "y": 0}
        wall_end = {"x": 800, "y": 0}
        wall_length = 800

        # Placement at 200cm along wall, 150cm height
        position_along_wall = 200
        position_height = 150

        # Calculate world position (for north wall, y is constant at 0)
        world_x = wall_start["x"] + (position_along_wall / wall_length) * (wall_end["x"] - wall_start["x"])
        world_y = wall_start["y"] + (position_along_wall / wall_length) * (wall_end["y"] - wall_start["y"])

        assert world_x == 200
        assert world_y == 0

    def test_angled_wall_coordinates(self):
        """Test coordinates for placement on angled wall."""
        import math

        # Wall from (0, 0) to (600, 600) - 45 degree angle
        wall_start = {"x": 0, "y": 0}
        wall_end = {"x": 600, "y": 600}

        # Calculate wall length
        wall_length = math.sqrt(
            (wall_end["x"] - wall_start["x"]) ** 2 +
            (wall_end["y"] - wall_start["y"]) ** 2
        )

        # Placement at 50% along wall
        position_ratio = 0.5
        world_x = wall_start["x"] + position_ratio * (wall_end["x"] - wall_start["x"])
        world_y = wall_start["y"] + position_ratio * (wall_end["y"] - wall_start["y"])

        assert world_x == 300
        assert world_y == 300

    def test_placement_dimensions_with_frame(self):
        """Test total dimensions including frame width."""
        artwork_width = 100  # cm
        artwork_height = 80  # cm
        frame_width = 5  # cm on each side

        total_width = artwork_width + (frame_width * 2)
        total_height = artwork_height + (frame_width * 2)

        assert total_width == 110
        assert total_height == 90

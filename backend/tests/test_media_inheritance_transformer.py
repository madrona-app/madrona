"""Unit tests for FieldTransformer in app/services/media_inheritance.py.

Pure function transformer — covers all four transform types and edge cases.
The full MediaInheritanceService needs DB fixtures and is tested separately.
"""

import pytest

from app.services.media_inheritance import FieldTransformer


class TestNoTransform:
    def test_none_value_returns_none(self):
        assert FieldTransformer.transform(None, None, None) is None
        assert FieldTransformer.transform(None, "array_first", None) is None

    def test_no_transform_type_returns_value_unchanged(self):
        assert FieldTransformer.transform("hello", None, None) == "hello"
        assert FieldTransformer.transform([1, 2, 3], None, None) == [1, 2, 3]
        assert FieldTransformer.transform(42, None, None) == 42

    def test_unknown_transform_returns_value_unchanged(self):
        assert FieldTransformer.transform("x", "made_up_transform", None) == "x"


class TestArrayFirst:
    def test_returns_first_primitive(self):
        assert FieldTransformer.transform([1, 2, 3], "array_first", None) == 1
        assert FieldTransformer.transform(["a", "b"], "array_first", None) == "a"

    def test_returns_value_when_not_list(self):
        # Not a list → return as-is
        assert FieldTransformer.transform("nope", "array_first", None) == "nope"
        assert FieldTransformer.transform(42, "array_first", None) == 42

    def test_returns_value_when_list_empty(self):
        assert FieldTransformer.transform([], "array_first", None) == []

    def test_extracts_named_field_from_first_dict(self):
        items = [{"name": "Picasso", "id": "1"}, {"name": "Monet", "id": "2"}]
        assert (
            FieldTransformer.transform(items, "array_first", {"field": "name"})
            == "Picasso"
        )

    def test_returns_first_dict_unchanged_when_no_field_config(self):
        items = [{"name": "Picasso"}]
        assert FieldTransformer.transform(items, "array_first", None) == {
            "name": "Picasso"
        }

    def test_returns_first_when_config_field_missing(self):
        items = [{"other_key": "value"}]
        assert (
            FieldTransformer.transform(items, "array_first", {"field": "name"})
            is None
        )


class TestArrayJoin:
    def test_joins_strings_with_default_separator(self):
        assert (
            FieldTransformer.transform(["a", "b", "c"], "array_join", None)
            == "a, b, c"
        )

    def test_uses_explicit_separator(self):
        assert (
            FieldTransformer.transform(
                ["a", "b", "c"], "array_join", {"separator": " | "}
            )
            == "a | b | c"
        )

    def test_joins_dict_field_values(self):
        items = [{"name": "Alice"}, {"name": "Bob"}, {"name": "Carol"}]
        assert (
            FieldTransformer.transform(
                items, "array_join", {"field": "name", "separator": "; "}
            )
            == "Alice; Bob; Carol"
        )

    def test_skips_dicts_missing_the_field(self):
        items = [{"name": "Alice"}, {"other": "x"}, {"name": "Bob"}]
        assert (
            FieldTransformer.transform(
                items, "array_join", {"field": "name", "separator": ", "}
            )
            == "Alice, Bob"
        )

    def test_skips_falsy_values_in_simple_lists(self):
        # The implementation skips falsy items (`if v`)
        assert (
            FieldTransformer.transform(["a", "", "b", None, "c"], "array_join", None)
            == "a, b, c"
        )

    def test_coerces_numbers_to_strings(self):
        assert (
            FieldTransformer.transform([1, 2, 3], "array_join", {"separator": "-"})
            == "1-2-3"
        )

    def test_returns_str_of_value_when_not_list(self):
        assert FieldTransformer.transform(42, "array_join", None) == "42"


class TestArrayConcatField:
    def test_concatenates_named_field_from_dicts(self):
        items = [{"name": "Picasso"}, {"name": "Monet"}]
        assert (
            FieldTransformer.transform(
                items, "array_concat_field", {"field": "name", "separator": " & "}
            )
            == "Picasso & Monet"
        )

    def test_default_field_is_name(self):
        items = [{"name": "Alice"}, {"name": "Bob"}]
        assert (
            FieldTransformer.transform(items, "array_concat_field", None)
            == "Alice, Bob"
        )

    def test_uses_default_separator_comma_space(self):
        items = [{"name": "Alice"}, {"name": "Bob"}]
        assert (
            FieldTransformer.transform(
                items, "array_concat_field", {"field": "name"}
            )
            == "Alice, Bob"
        )

    def test_skips_dicts_missing_the_field(self):
        items = [{"name": "Alice"}, {"other": "x"}, {"name": "Bob"}]
        assert (
            FieldTransformer.transform(
                items, "array_concat_field", {"field": "name"}
            )
            == "Alice, Bob"
        )

    def test_falls_back_to_str_for_non_dict_items(self):
        # The implementation uses str(item) for non-dict entries.
        items = ["raw-string", {"name": "Alice"}, 42]
        assert (
            FieldTransformer.transform(
                items, "array_concat_field", {"field": "name"}
            )
            == "raw-string, Alice, 42"
        )

    def test_returns_value_when_not_list(self):
        assert (
            FieldTransformer.transform("nope", "array_concat_field", None) == "nope"
        )


@pytest.mark.parametrize(
    "transform_type",
    ["array_first", "array_join", "array_concat_field"],
)
def test_none_value_short_circuits_for_every_transform(transform_type):
    assert FieldTransformer.transform(None, transform_type, None) is None

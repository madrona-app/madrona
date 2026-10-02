#!/usr/bin/env python3
"""Generate Zod schemas from Pydantic BaseModel classes.

Usage:
    cd backend && ./venv/bin/python ../scripts/generate-zod-schemas.py \
        > ../frontend/src/lib/schemas/generated.ts

    # Or write to a specific file:
    cd backend && ./venv/bin/python ../scripts/generate-zod-schemas.py \
        ../frontend/src/lib/schemas/generated.ts

    # Dry-run (prints model count, no output):
    cd backend && ./venv/bin/python ../scripts/generate-zod-schemas.py --dry-run

    # Only Response/Out models:
    cd backend && ./venv/bin/python ../scripts/generate-zod-schemas.py --responses-only
"""

from __future__ import annotations

import argparse
import importlib
import pkgutil
import sys
import types
from pathlib import Path
from typing import Any, get_args, get_origin

# Ensure the backend app is importable
backend_root = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(backend_root))

from pydantic import BaseModel  # noqa: E402


# ── Discover all Pydantic models in the schemas package ────────────────────

def discover_models() -> list[tuple[str, type[BaseModel]]]:
    """Import all schema modules and collect BaseModel subclasses."""
    import app.fastapi_app.schemas as schemas_pkg

    models: dict[str, type[BaseModel]] = {}

    package_path = schemas_pkg.__path__
    for importer, modname, _ispkg in pkgutil.walk_packages(
        package_path, prefix=schemas_pkg.__name__ + "."
    ):
        try:
            mod = importlib.import_module(modname)
        except Exception as exc:
            print(f"// WARNING: could not import {modname}: {exc}", file=sys.stderr)
            continue

        for attr_name in dir(mod):
            obj = getattr(mod, attr_name)
            if (
                isinstance(obj, type)
                and issubclass(obj, BaseModel)
                and obj is not BaseModel
                and obj.__module__ == mod.__name__  # defined here, not re-exported
            ):
                models[f"{mod.__name__}.{attr_name}"] = obj

    # Deduplicate by class identity (same class imported in multiple places)
    seen_ids: set[int] = set()
    unique: list[tuple[str, type[BaseModel]]] = []
    for fqn, cls in sorted(models.items()):
        if id(cls) not in seen_ids:
            seen_ids.add(id(cls))
            unique.append((cls.__name__, cls))

    # Sort alphabetically by class name
    unique.sort(key=lambda t: t[0])
    return unique


# ── Type conversion ────────────────────────────────────────────────────────

_SENTINEL = object()  # used to avoid `None is None` false matches


def _is_none_type(tp: Any) -> bool:
    """Check if a type is NoneType."""
    return tp is type(None)


def _ts_name(cls: type) -> str:
    """Return the Zod schema variable name for a Pydantic model class."""
    return f"{cls.__name__}Schema"


def pydantic_type_to_zod(
    annotation: Any,
    known_models: dict[str, type[BaseModel]],
) -> str:
    """Convert a Python/Pydantic type annotation to a Zod expression string.

    Returns a tuple of (zod_expr, is_nullable).
    """
    # Handle None / NoneType
    if annotation is type(None):
        return "z.null()"

    # Handle Any
    if annotation is Any:
        return "z.any()"

    origin = get_origin(annotation)
    args = get_args(annotation)

    # Handle Union types (X | None, Optional[X], Union[X, Y])
    # In Python 3.10+ `str | None` has origin types.UnionType
    if origin is types.UnionType or (origin is not None and _is_union(origin)):
        non_none = [a for a in args if not _is_none_type(a)]
        has_none = any(_is_none_type(a) for a in args)

        if len(non_none) == 1:
            inner = pydantic_type_to_zod(non_none[0], known_models)
            if has_none:
                # KEY RULE: nullable always implies optional
                return f"{inner}.nullable().optional()"
            return inner
        elif len(non_none) > 1:
            # Union of multiple non-None types -> z.union([...])
            parts = [pydantic_type_to_zod(a, known_models) for a in non_none]
            base = f"z.union([{', '.join(parts)}])"
            if has_none:
                return f"{base}.nullable().optional()"
            return base
        else:
            return "z.null()"

    # Handle Literal
    if origin is not None and _is_literal(origin):
        values = [repr(a) for a in args]
        # Convert Python repr to JS: 'foo' -> 'foo'
        js_values = ", ".join(
            f"'{a}'" if isinstance(a, str) else str(a) for a in args
        )
        if all(isinstance(a, str) for a in args):
            return f"z.enum([{js_values}])"
        else:
            # Mixed literal types — use z.union of z.literal
            parts = []
            for a in args:
                if isinstance(a, str):
                    parts.append(f"z.literal('{a}')")
                elif isinstance(a, bool):
                    parts.append(f"z.literal({'true' if a else 'false'})")
                elif isinstance(a, (int, float)):
                    parts.append(f"z.literal({a})")
                else:
                    parts.append(f"z.literal({repr(a)})")
            return f"z.union([{', '.join(parts)}])"

    # Handle list / List
    _list_type = getattr(types, "ListType", _SENTINEL)
    if origin is list or origin is _list_type:
        if args:
            inner = pydantic_type_to_zod(args[0], known_models)
            return f"z.array({inner})"
        return "z.array(z.any())"

    # Handle dict / Dict
    if origin is dict:
        if args and len(args) == 2:
            key_z = pydantic_type_to_zod(args[0], known_models)
            val_z = pydantic_type_to_zod(args[1], known_models)
            return f"z.record({key_z}, {val_z})"
        return "z.record(z.string(), z.any())"

    # Handle tuple
    if origin is tuple:
        if args:
            parts = [pydantic_type_to_zod(a, known_models) for a in args]
            return f"z.tuple([{', '.join(parts)}])"
        return "z.array(z.any())"

    # Handle set / frozenset -> array
    if origin is set or origin is frozenset:
        if args:
            inner = pydantic_type_to_zod(args[0], known_models)
            return f"z.array({inner})"
        return "z.array(z.any())"

    # Handle known Pydantic model references
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        name = annotation.__name__
        if name in known_models:
            schema_name = _ts_name(annotation)
            # Check if this is a self-reference (recursive type)
            # The caller passes _current_model via known_models sentinel
            if name == known_models.get("__current__"):
                return f"z.lazy(() => {schema_name})"
            return schema_name
        # Unknown model — fall back to z.any()
        return "z.any()"

    # Handle primitive types
    if annotation is str:
        return "z.string()"
    if annotation is int:
        return "z.number()"
    if annotation is float:
        return "z.number()"
    if annotation is bool:
        return "z.boolean()"

    # UUID, datetime, date -> z.string()
    type_name = getattr(annotation, "__name__", "") or str(annotation)
    if type_name in ("UUID", "uuid", "UUID4"):
        return "z.string()"
    if type_name in ("datetime", "date", "time", "timedelta"):
        return "z.string()"

    # Check module for known stdlib types
    mod = getattr(annotation, "__module__", "")
    if mod in ("uuid", "datetime"):
        return "z.string()"

    # Fallback
    return "z.any()"


def _is_union(origin: Any) -> bool:
    """Check if an origin type is Union."""
    import typing
    return origin is getattr(typing, "Union", None)


def _is_literal(origin: Any) -> bool:
    """Check if an origin type is Literal."""
    import typing
    return origin is getattr(typing, "Literal", None)


# ── Code generation ────────────────────────────────────────────────────────

HEADER = """\
// Auto-generated from Pydantic models. Do not edit manually.
// Regenerate: cd backend && ./venv/bin/python ../scripts/generate-zod-schemas.py > ../frontend/src/lib/schemas/generated.ts

import { z } from 'zod';
"""


def _collect_model_refs(annotation: Any, known_models: dict[str, type[BaseModel]]) -> list[str]:
    """Collect names of known Pydantic models referenced in a type annotation."""
    refs: list[str] = []

    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        if annotation.__name__ in known_models:
            refs.append(annotation.__name__)
        return refs

    origin = get_origin(annotation)
    args = get_args(annotation)
    for arg in args:
        refs.extend(_collect_model_refs(arg, known_models))

    return refs


def generate_schema(
    name: str,
    model: type[BaseModel],
    known_models: dict[str, type[BaseModel]],
    generated_set: set[str],
) -> list[str]:
    """Generate Zod schema + type for a single Pydantic model.

    Returns lines of TypeScript.  Handles inheritance by inlining parent
    fields (Zod doesn't have a native extends for .passthrough objects).
    Dependencies (parent classes and field references) are emitted first.
    """
    if name in generated_set:
        return []
    generated_set.add(name)

    lines: list[str] = []

    # Resolve parent models first so references exist
    for base in model.__mro__[1:]:
        if (
            base is not BaseModel
            and base is not model
            and isinstance(base, type)
            and issubclass(base, BaseModel)
            and base.__name__ in known_models
            and base.__name__ not in generated_set
        ):
            lines.extend(
                generate_schema(base.__name__, base, known_models, generated_set)
            )

    # Resolve field-level model references so they are emitted before this schema
    for field_info in model.model_fields.values():
        if field_info.annotation is None:
            continue
        for ref_name in _collect_model_refs(field_info.annotation, known_models):
            if ref_name not in generated_set and ref_name != name:
                ref_cls = known_models[ref_name]
                lines.extend(
                    generate_schema(ref_name, ref_cls, known_models, generated_set)
                )

    # Collect all fields (including inherited)
    fields = model.model_fields
    field_lines: list[str] = []

    # Set current model name so recursive self-references use z.lazy()
    known_models["__current__"] = name

    # Fields that reference this same model are held back: a schema that
    # mentions itself inside its own initializer gives TypeScript nothing to
    # infer from, which it reports as TS7022/TS7024 ("implicitly has type
    # 'any' because it is referenced directly or indirectly in its own
    # initializer"). Zod's documented answer is to split the definition —
    # build the non-recursive part first, state the recursive type explicitly,
    # then extend. See the emission below.
    recursive_fields: list[tuple[str, str]] = []

    for field_name, field_info in fields.items():
        annotation = field_info.annotation
        if annotation is None:
            zod_type = "z.any()"
        else:
            zod_type = pydantic_type_to_zod(annotation, known_models)

        # If the field has a default value and is NOT already optional from
        # nullable handling, make it optional.
        is_required = field_info.is_required()
        already_optional = ".optional()" in zod_type

        if not is_required and not already_optional:
            zod_type = f"{zod_type}.optional()"

        if "z.lazy(() =>" in zod_type:
            recursive_fields.append((field_name, zod_type))
        else:
            field_lines.append(f"  {field_name}: {zod_type},")

    known_models.pop("__current__", None)

    schema_var = _ts_name(model)

    if not recursive_fields:
        lines.append(f"export const {schema_var} = z.object({{")
        lines.extend(field_lines)
        lines.append("}).passthrough();")
        lines.append("")
        lines.append(f"export type {name} = z.infer<typeof {schema_var}>;")
        lines.append("")
        return lines

    # Recursive model: base shape -> explicit type -> annotated extend.
    base_var = f"{schema_var.removesuffix('Schema')}BaseSchema"
    lines.append(f"const {base_var} = z.object({{")
    lines.extend(field_lines)
    lines.append("}).passthrough();")
    lines.append("")
    lines.append(f"export type {name} = z.infer<typeof {base_var}> & {{")
    for field_name, zod_type in recursive_fields:
        is_array = zod_type.startswith("z.array(")
        ts_type = f"{name}[]" if is_array else name
        if ".nullable()" in zod_type:
            ts_type += " | null"
        optional = "?" if ".optional()" in zod_type else ""
        lines.append(f"  {field_name}{optional}: {ts_type};")
    lines.append("};")
    lines.append("")
    lines.append(f"export const {schema_var}: z.ZodType<{name}> = {base_var}.extend({{")
    for field_name, zod_type in recursive_fields:
        lines.append(f"  {field_name}: {zod_type},")
    lines.append("});")
    lines.append("")

    return lines


def generate_all(
    models: list[tuple[str, type[BaseModel]]],
    responses_only: bool = False,
) -> str:
    """Generate the full TypeScript output."""
    known_models: dict[str, type[BaseModel]] = {name: cls for name, cls in models}

    if responses_only:
        models = [
            (name, cls)
            for name, cls in models
            if any(
                kw in name
                for kw in ("Response", "Out", "Item", "Detail", "List", "Summary")
            )
        ]

    generated_set: set[str] = set()
    all_lines: list[str] = [HEADER]

    for name, model in models:
        schema_lines = generate_schema(name, model, known_models, generated_set)
        if schema_lines:
            all_lines.extend(schema_lines)

    return "\n".join(all_lines) + "\n"


# ── CLI ────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate Zod schemas from Pydantic BaseModel classes."
    )
    parser.add_argument(
        "output",
        nargs="?",
        default=None,
        help="Output file path (default: stdout)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print model count without generating output",
    )
    parser.add_argument(
        "--responses-only",
        action="store_true",
        help="Only generate schemas for response/output models",
    )
    args = parser.parse_args()

    models = discover_models()

    if args.dry_run:
        print(f"Discovered {len(models)} Pydantic models:")
        for name, cls in models:
            fields = cls.model_fields
            print(f"  {name} ({len(fields)} fields)")
        return

    output = generate_all(models, responses_only=args.responses_only)

    if args.output:
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(output)
        print(f"Wrote {len(models)} schemas to {out_path}", file=sys.stderr)
    else:
        sys.stdout.write(output)
        print(f"Generated {len(models)} schemas", file=sys.stderr)


if __name__ == "__main__":
    main()

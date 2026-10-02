#!/usr/bin/env python3
"""Call every endpoint in the OpenAPI schema and report the ones that 5xx.

Why this exists
---------------
The unit suite is large and green, and it still missed a guaranteed 500 on the
object detail page, a report download that redirected every browser to an
unresolvable host, and a barcode scan endpoint that failed on every call. All
three were reachable by asking the running application for its own route list
and calling it. That is what this does.

It is a smoke test, not an assertion suite. It tells you which endpoints break
on ordinary input; it does not check that the answers are correct.

How it reads results
--------------------
  5xx  a defect, unless the body explains a deliberate gate (a 501 for a
       feature this deployment does not run, a 503 for one that is switched
       off). Those are printed separately.
  4xx  usually information. The sweep does not know an endpoint's required
       query parameters or its cross-field rules, so a 400/422 is often the
       app correctly rejecting a synthetic request. A 403 from a foreign-tenant
       id is the isolation working.
  429  the run is throttled and therefore incomplete. It is reported loudly:
       an early version of this script had most of its requests answered by
       the rate limiter and looked clean.

Usage
-----
    cd backend
    ./venv/bin/python scripts/api_sweep.py                 # GET only
    ./venv/bin/python scripts/api_sweep.py --mode write    # POST/PUT/PATCH/DELETE
    ./venv/bin/python scripts/api_sweep.py --mode all --json /tmp/sweep.json

Writes really write. Point it at a disposable database.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from typing import Any

try:
    import psycopg
except ImportError:  # pragma: no cover - the venv always has it
    sys.exit("psycopg is required: run this from backend/venv")

DEFAULT_BASE = "http://localhost:18080"
DEFAULT_DB = "postgresql://madrona:madrona@localhost:15432/madrona"
DEFAULT_EMAIL = "e2e-test@example.com"
DEFAULT_PASSWORD = "E2E-Test-Password-123!"

# The global limiter allows 600 reads and 200 writes per 60s per client IP.
# Pace under the tighter of the two when writing.
READ_INTERVAL = 0.11
WRITE_INTERVAL = 0.32

REAL_METHODS = ("post", "put", "patch", "delete")


class Client:
    """Minimal HTTP client that carries auth, CSRF and its own rate limiting."""

    def __init__(self, base: str, interval: float):
        self.base = base.rstrip("/")
        self.interval = interval
        self.token: str | None = None
        self.csrf: str | None = None
        self._last = 0.0

    def request(self, method: str, path: str, body: Any = None, retries: int = 3,
                limit: int = 200_000):
        url = path if path.startswith("http") else self.base + path
        req = urllib.request.Request(url, method=method)
        req.add_header("Content-Type", "application/json")
        if self.token:
            req.add_header("Authorization", f"Bearer {self.token}")
        if self.csrf:
            # Both halves: the middleware compares header against cookie.
            req.add_header("X-CSRF-Token", self.csrf)
            req.add_header("Cookie", f"csrf_token={self.csrf}")
        data = json.dumps(body).encode() if body is not None else None

        wait = self.interval - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        self._last = time.monotonic()

        try:
            with urllib.request.urlopen(req, data, timeout=30) as resp:
                return resp.status, resp.read() if limit is None else resp.read(limit)
        except urllib.error.HTTPError as exc:
            if exc.code == 429 and retries > 0:
                time.sleep(float(exc.headers.get("Retry-After") or 20))
                return self.request(method, path, body, retries - 1, limit)
            return exc.code, exc.read(4000)
        except Exception as exc:  # noqa: BLE001 - transport failures are data
            return 0, str(exc).encode()

    def sign_in(self, email: str, password: str) -> str:
        status, raw = self.request("GET", "/api/auth/csrf")
        if status == 200:
            self.csrf = json.loads(raw)["csrf_token"]
        status, raw = self.request("POST", "/api/auth/login",
                                   {"email": email, "password": password})
        if status != 200:
            sys.exit(f"login failed ({status}): {raw[:300]!r}")
        auth = json.loads(raw)
        self.token = auth["access_token"]
        return auth["active_organization_id"]


# Parameters whose backing column cannot be derived from the name.
#
# A "post" is a row in content.pages with page_type = 'post' — there is no posts
# table — so no amount of noun matching gets from post_slug to pages.slug.
ALIASES: dict[str, tuple[str, str]] = {
    "post_slug": ("content.pages", "slug"),
}


class Resolver:
    """Finds a real value for a path parameter, from the database.

    Deliberately tries every table that declares the column rather than
    guessing one. Guessing picked empty join tables and silently dropped whole
    areas of the surface from the run.
    """

    def __init__(self, dsn: str, org_id: str):
        self.conn = psycopg.connect(dsn)
        self.org_id = org_id
        self.cache: dict[str, str | None] = {}

    def _one(self, sql: str, *args):
        with self.conn.cursor() as cur:
            try:
                cur.execute(sql, args)
                row = cur.fetchone()
                return row[0] if row else None
            except Exception:  # noqa: BLE001 - a bad guess is not fatal
                self.conn.rollback()
                return None

    def _all(self, sql: str, *args):
        with self.conn.cursor() as cur:
            try:
                cur.execute(sql, args)
                return [r[0] for r in cur.fetchall()]
            except Exception:  # noqa: BLE001
                self.conn.rollback()
                return []

    def _has_column(self, table: str, column: str) -> bool:
        return bool(self._one(
            """SELECT 1 FROM information_schema.columns
               WHERE table_schema = split_part(%s, '.', 1)
                 AND table_name = split_part(%s, '.', 2)
                 AND column_name = %s""",
            table, table, column,
        ))

    def resolve(self, name: str) -> str | None:
        if name in self.cache:
            return self.cache[name]
        self.cache[name] = value = self._resolve(name)
        return value

    def _resolve(self, name: str) -> str | None:
        if name in ("org_id", "organization_id"):
            return self.org_id
        if name in ("org_slug", "slug"):
            return self._one("SELECT slug FROM organizations WHERE organization_id = %s",
                             self.org_id)
        candidates = self._candidate_tables(name)
        if not candidates:
            return None

        # Prefer a live row in our own tenant: a foreign tenant's id gives a
        # correct 403/404 that tells us nothing, and a soft-deleted row gives a
        # correct 404 that looks like a fault.
        for table, column in candidates:
            if not self._has_column(table, "organization_id"):
                continue
            live = " AND NOT is_deleted" if self._has_column(table, "is_deleted") else ""
            value = self._one(
                f"SELECT {column} FROM {table} "
                f"WHERE organization_id = %s AND {column} IS NOT NULL{live} LIMIT 1",
                self.org_id,
            )
            if value is not None:
                return str(value)

        for table, column in candidates:
            value = self._one(
                f"SELECT {column} FROM {table} WHERE {column} IS NOT NULL LIMIT 1")
            if value is not None:
                return str(value)
        return None

    # Parameter names do not always match a column name. {dept_id} is
    # department_id, {venue_slug} is slug on venues, {app_key} is key on
    # applications. Exact match first, then these shapes, so a rename does not
    # silently drop a whole area of the surface from the run.
    def _candidate_tables(self, name: str) -> list[tuple[str, str]]:
        found: list[tuple[str, str]] = []
        seen: set[tuple[str, str]] = set()

        def add(rows, column):
            for table in rows:
                key = (table, column)
                if key not in seen:
                    seen.add(key)
                    found.append(key)

        def tables_with(column: str, prefer: str = "") -> list[str]:
            return self._all(
                """SELECT table_schema || '.' || table_name
                   FROM information_schema.columns
                   WHERE column_name = %s
                     AND table_schema NOT IN ('pg_catalog', 'information_schema')
                   ORDER BY (table_name = %s) DESC, (table_name = %s) DESC,
                            length(table_name), table_name""",
                column, prefer, prefer + "s",
            )

        base = name[:-3] if name.endswith("_id") else name
        add(tables_with(name, base), name)

        # <noun>_<rest> -> a column named <rest> on a table named after <noun>.
        if "_" in name:
            noun, rest = name.split("_", 1)
            for table in tables_with(rest, noun):
                short = table.rsplit(".", 1)[-1]
                if short.startswith(noun) or noun.rstrip("s") in short:
                    add([table], rest)

        # A qualified name: {instance_id} against connector_instance_id. Matched
        # on the suffix, never a prefix — prefix matching picked instructor_id
        # for instance_id, which is a different thing entirely and resolved to a
        # plausible-looking wrong answer.
        if name.endswith("_id"):
            with self.conn.cursor() as cur:
                try:
                    cur.execute(
                        """SELECT table_schema || '.' || table_name, column_name
                           FROM information_schema.columns
                           WHERE column_name LIKE %s
                             AND table_schema NOT IN ('pg_catalog','information_schema')
                           ORDER BY length(column_name), 1 LIMIT 40""",
                        ("%\\_" + name,),
                    )
                    for table, column in cur.fetchall():
                        add([table], column)
                except Exception:  # noqa: BLE001
                    self.conn.rollback()

        # Two names no rule can infer, because the mapping is domain knowledge
        # rather than spelling. Kept short and explicit on purpose.
        for alias_param, (alias_table, alias_column) in ALIASES.items():
            if name == alias_param:
                add([alias_table], alias_column)
        return found


class BodyFactory:
    """Synthesises a request body from an operation's OpenAPI schema."""

    def __init__(self, spec: dict, resolver: Resolver):
        self.schemas = spec.get("components", {}).get("schemas", {})
        self.resolver = resolver

    def _deref(self, schema: dict, depth: int = 0) -> dict:
        if depth > 6 or not isinstance(schema, dict):
            return {}
        if "$ref" in schema:
            name = schema["$ref"].rsplit("/", 1)[-1]
            return self._deref(self.schemas.get(name, {}), depth + 1)
        for key in ("allOf", "anyOf", "oneOf"):
            if schema.get(key):
                merged: dict = {}
                for part in schema[key]:
                    resolved = self._deref(part, depth + 1)
                    if resolved.get("type") == "null":
                        continue
                    merged = {**resolved, **{k: v for k, v in merged.items() if v}}
                if merged:
                    return merged
        return schema

    def sample(self, schema: dict, name: str = "", depth: int = 0):
        node = self._deref(schema)
        if depth > 4:
            return None
        if node.get("enum"):
            return node["enum"][0]
        if "default" in node:
            return node["default"]

        kind = node.get("type")
        if isinstance(kind, list):
            kind = next((k for k in kind if k != "null"), "string")
        if kind == "array":
            return []
        if kind == "object" or (kind is None and node.get("properties")):
            return {
                key: self.sample(node.get("properties", {}).get(key, {}), key, depth + 1)
                for key in node.get("required", [])
            }
        if kind == "boolean":
            return False
        if kind in ("integer", "number"):
            return 1

        fmt, lowered = node.get("format"), name.lower()
        if fmt == "uuid" or lowered.endswith("_id"):
            return self.resolver.resolve(name) or "00000000-0000-0000-0000-000000000000"
        if fmt == "date":
            return "2026-01-01"
        if fmt == "date-time":
            return "2026-01-01T00:00:00Z"
        if fmt == "email" or "email" in lowered:
            return "sweep@example.com"
        if fmt == "uri" or "url" in lowered:
            return "https://example.org/sweep"
        return "sweep-probe"

    def for_operation(self, operation: dict):
        request_body = operation.get("requestBody")
        if not request_body:
            return None
        content = (request_body.get("content") or {}).get("application/json")
        if not content:
            return None
        return self.sample(content.get("schema", {}))


def repair(body: dict, detail: list) -> dict | None:
    """Patch a body from FastAPI's own validation errors, for one retry.

    A synthesised body satisfies a schema's shape, not its constraints. An
    endpoint that stops at 422 has told us nothing about its handler, and the
    error names the offending field, so use it.
    """
    if not isinstance(body, dict) or not isinstance(detail, list):
        return None
    patched, changed = dict(body), False
    for error in detail:
        location = [p for p in error.get("loc", []) if p != "body"]
        if len(location) != 1 or not isinstance(location[0], str):
            continue
        field, kind, ctx = location[0], error.get("type", ""), error.get("ctx") or {}
        if kind == "missing":
            patched[field] = "sweep-probe"
        elif kind in ("string_too_long", "too_long") and ctx.get("max_length"):
            patched[field] = "s" * int(ctx["max_length"])
        elif kind in ("string_too_short", "too_short") and ctx.get("min_length"):
            patched[field] = "s" * int(ctx["min_length"])
        elif kind == "enum" and ctx.get("expected"):
            patched[field] = str(ctx["expected"]).split(" or ")[0].strip().strip("'\"")
        elif kind in ("uuid_parsing", "uuid_type"):
            patched[field] = "00000000-0000-0000-0000-000000000000"
        elif kind in ("int_parsing", "int_type"):
            patched[field] = 1
        elif kind in ("bool_parsing", "bool_type"):
            patched[field] = False
        elif kind == "list_type":
            patched[field] = []
        elif kind in ("dict_type", "model_attributes_type"):
            patched[field] = {}
        else:
            continue
        changed = True
    return patched if changed else None


def enum_for(spec: dict, path: str, method: str, param: str) -> str | None:
    """First allowed value for a non-id path parameter, per the schema."""
    operations = spec["paths"].get(path, {})
    sources = [operations.get(method, {}).get("parameters", []), operations.get("parameters", [])]
    for source in sources:
        for parameter in source or []:
            if parameter.get("name") != param or parameter.get("in") != "path":
                continue
            schema = parameter.get("schema", {}) or {}
            for candidate in (schema, *(schema.get("anyOf") or []), *(schema.get("allOf") or [])):
                if candidate.get("enum"):
                    return str(candidate["enum"][0])
                ref = candidate.get("$ref")
                if ref:
                    target = spec.get("components", {}).get("schemas", {}).get(ref.rsplit("/", 1)[-1], {})
                    if target.get("enum"):
                        return str(target["enum"][0])
    return None


def run(args) -> int:
    interval = WRITE_INTERVAL if args.mode in ("write", "all") else READ_INTERVAL
    client = Client(args.base, interval)
    org_id = client.sign_in(args.email, args.password)

    status, raw = client.request("GET", "/api/openapi.json", limit=None)
    if status != 200:
        sys.exit(f"could not read the OpenAPI schema ({status})")
    spec = json.loads(raw)

    resolver = Resolver(args.db, org_id)
    bodies = BodyFactory(spec, resolver)

    wanted = {"get"} if args.mode == "get" else set(REAL_METHODS)
    if args.mode == "all":
        wanted |= {"get"}

    # Creates first, then updates, then deletes, so a delete does not remove a
    # row a later update needs. GETs run first of all, against untouched data.
    order = {"get": 0, "post": 1, "put": 2, "patch": 3, "delete": 4}
    operations = sorted(
        ((path, method, op) for path, item in spec["paths"].items()
         for method, op in item.items() if method in wanted),
        key=lambda entry: (order[entry[1]], entry[0]),
    )

    results, skipped = [], []
    for path, method, operation in operations:
        url_path, resolved = path, True
        for token in re.findall(r"\{[^}]+\}", path):
            name = token.strip("{}")
            value = enum_for(spec, path, method, name) or resolver.resolve(name)
            if value is None:
                skipped.append({"method": method.upper(), "path": path, "param": name})
                resolved = False
                break
            url_path = url_path.replace(token, str(value))
        if not resolved:
            continue

        body = bodies.for_operation(operation)
        code, raw = client.request(method.upper(), url_path, body)
        if code == 422 and body is not None:
            try:
                patched = repair(body, json.loads(raw).get("detail"))
            except Exception:  # noqa: BLE001
                patched = None
            if patched is not None:
                code, raw = client.request(method.upper(), url_path, patched)
        results.append({
            "code": code, "method": method.upper(), "path": path,
            "url": url_path, "body": raw[:600].decode("utf-8", "replace"),
        })

    return report(results, skipped, args)


def report(results: list[dict], skipped: list[dict], args) -> int:
    families: dict[int, list[dict]] = {}
    for result in results:
        families.setdefault(result["code"] // 100, []).append(result)

    throttled = [r for r in results if r["code"] == 429]
    if throttled:
        print(f"!! {len(throttled)} request(s) still rate-limited after retries — "
              "this run is INCOMPLETE and its silence means nothing")

    print(f"called {len(results)} operations; skipped {len(skipped)} (no id available)")
    for family in sorted(families):
        print(f"  {family}xx: {len(families[family])}")

    # A deliberate gate answers with a reason. A defect answers with a shrug.
    gates, defects = [], []
    for result in families.get(5, []):
        text = result["body"].lower()
        if any(mark in text for mark in ("not_implemented", "feature_disabled",
                                         "service_unavailable", "not enabled",
                                         "not configured", "bad_gateway")):
            gates.append(result)
        else:
            defects.append(result)

    if defects:
        print(f"\n=== {len(defects)} unexplained 5xx (defects) ===")
        for result in sorted(defects, key=lambda r: r["path"]):
            print(f"{result['code']}  {result['method']} {result['path']}")
            print(f"      {result['body'][:160]}")
    else:
        print("\nno unexplained 5xx")

    if gates:
        print(f"\n=== {len(gates)} deliberate 5xx (disabled or unconfigured features) ===")
        for result in sorted(gates, key=lambda r: r["path"]):
            print(f"{result['code']}  {result['method']} {result['path']}")

    if args.json:
        with open(args.json, "w") as handle:
            json.dump({"results": results, "skipped": skipped}, handle, indent=1)
        print(f"\nfull output: {args.json}")

    return 1 if (defects or throttled) else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--mode", choices=("get", "write", "all"), default="get",
                        help="which methods to call (default: get)")
    parser.add_argument("--base", default=os.environ.get("SWEEP_BASE", DEFAULT_BASE))
    parser.add_argument("--db", default=os.environ.get("SWEEP_DB_URL", DEFAULT_DB))
    parser.add_argument("--email", default=os.environ.get("SWEEP_EMAIL", DEFAULT_EMAIL))
    parser.add_argument("--password", default=os.environ.get("SWEEP_PASSWORD", DEFAULT_PASSWORD))
    parser.add_argument("--json", help="write the full result set here")
    return run(parser.parse_args())


if __name__ == "__main__":
    raise SystemExit(main())

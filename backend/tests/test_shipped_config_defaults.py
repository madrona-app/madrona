"""
The shipped example configuration is a security surface.

`.env.example` is what the install docs tell a self-hoster to copy. Two of its
values were wrong in ways that no test could see, because nothing tests a
config file:

  DATABASE_URL pointed at `madrona`, the owner role, which
  docker/postgres/init-db.sh grants BYPASSRLS. Row-level security is the
  mechanism that stops one organization reading another's rows, so the shipped
  default silently disabled tenant isolation for everyone who followed the
  documentation. Compose already defaulted to the correct NOBYPASSRLS role;
  the example overrode it.

  S3_PUBLIC_ENDPOINT_URL pointed at the object store's own port. That URL is cross-origin
  plain HTTP, which the page's img-src CSP blocks, so every thumbnail failed.

Both are one-line mistakes with no runtime signal — the app starts happily
either way. This pins them.

The same shape of bug applies to the frontend's build-time configuration.
Vite inlines VITE_* names into the bundle when it compiles, frontend/.dockerignore
keeps .env out of the image, and the Dockerfile originally declared no build
args — so VITE_API_BASE_URL and VITE_CARTO_API_KEY were documented knobs that
reached nothing in a docker-compose deployment, with no error to say so. The
chain has three links (source reads it, Dockerfile declares and exports it,
compose passes it) and breaking any one of them fails silently, so each link is
asserted below.
"""

from __future__ import annotations

import pathlib
import re

import pytest

_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
_EXAMPLE = _ROOT / ".env.example"
_COMPOSE = _ROOT / "docker-compose.yml"
_INIT_DB = _ROOT / "docker" / "postgres" / "init-db.sh"
_FRONTEND = _ROOT / "frontend"
_FRONTEND_DOCKERFILE = _FRONTEND / "Dockerfile"


def _env_values() -> dict[str, str]:
    if not _EXAMPLE.exists():
        pytest.skip(f"{_EXAMPLE} not found")
    out = {}
    for raw in _EXAMPLE.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip()
    return out


def _bypassrls_roles() -> set[str]:
    """Roles the database provisioning script grants BYPASSRLS."""
    if not _INIT_DB.exists():
        pytest.skip(f"{_INIT_DB} not found")
    text = _INIT_DB.read_text()
    roles = set()
    for m in re.finditer(r"ALTER ROLE \$?\{?(\w+)\}? BYPASSRLS", text):
        roles.add(m.group(1))
    # The script uses ${POSTGRES_USER}; the example names that role directly.
    if "POSTGRES_USER" in roles:
        roles.discard("POSTGRES_USER")
        roles.add(_env_values().get("POSTGRES_USER", "madrona"))
    return roles


def _user_of(url: str) -> str | None:
    m = re.match(r"^[a-z+]+://([^:]+):", url)
    return m.group(1) if m else None


class TestDatabaseUrlDoesNotBypassRLS:
    def test_the_app_role_is_not_a_bypassrls_role(self):
        env = _env_values()
        url = env.get("DATABASE_URL", "")
        assert url, "DATABASE_URL missing from .env.example"

        user = _user_of(url)
        assert user, f"could not parse a role out of DATABASE_URL: {url!r}"

        bypass = _bypassrls_roles()
        assert user not in bypass, (
            f"DATABASE_URL runs the application as {user!r}, which init-db.sh "
            f"grants BYPASSRLS. Every organization would be able to read every "
            f"other organization's rows. Use the NOBYPASSRLS application role."
        )

    def test_migrations_still_use_the_owner_role(self):
        """The two-role split only works if the owner role is also present."""
        env = _env_values()
        alembic = env.get("ALEMBIC_DATABASE_URL", "")
        assert alembic, (
            "ALEMBIC_DATABASE_URL missing — migrations and admin tasks need "
            "the owner role, and seeds fail without it"
        )
        assert _user_of(alembic) in _bypassrls_roles()

    def test_the_two_urls_are_different_roles(self):
        env = _env_values()
        assert _user_of(env.get("DATABASE_URL", "")) != _user_of(env.get("ALEMBIC_DATABASE_URL", "")), (
            "the whole point of the split is two distinct roles"
        )


class TestPublicObjectStoreUrlPassesCSP:
    def test_it_is_not_the_object_stores_own_port(self):
        """
        A direct object-store URL is cross-origin plain HTTP and is blocked by
        img-src, which breaks every thumbnail. It must be the app's public
        URL, which proxies object storage same-origin.
        """
        value = _env_values().get("S3_PUBLIC_ENDPOINT_URL", "")
        assert value, "S3_PUBLIC_ENDPOINT_URL missing from .env.example"

        internal = _env_values().get("S3_ENDPOINT_URL", "")
        port = re.search(r":(\d+)", internal)
        if port:
            assert not value.rstrip("/").endswith(f":{port.group(1)}"), (
                f"S3_PUBLIC_ENDPOINT_URL points at the object store's own port "
                f"({value}); presigned URLs would be cross-origin plain HTTP "
                f"and blocked by the page CSP"
            )

    def test_it_agrees_with_the_compose_default(self):
        if not _COMPOSE.exists():
            pytest.skip("docker-compose.yml not found")
        compose = _COMPOSE.read_text()
        m = re.search(r"S3_PUBLIC_ENDPOINT_URL:\s*\$\{S3_PUBLIC_ENDPOINT_URL:-\$\{PUBLIC_APP_URL:-([^}]+)\}\}", compose)
        if not m:
            pytest.skip("compose default not in the expected form")
        assert _env_values().get("S3_PUBLIC_ENDPOINT_URL", "").rstrip("/") == m.group(1).rstrip("/"), (
            "the example and the compose default disagree; one of them is wrong "
            "and whichever a user ends up with decides whether images load"
        )


# ---------------------------------------------------------------------------
# Frontend build-time configuration
# ---------------------------------------------------------------------------

_VITE_READ = re.compile(r"import\.meta\.env\.(VITE_[A-Z0-9_]+)")


def _vite_names_read_by_the_frontend() -> set[str]:
    """
    Every VITE_* name the frontend actually reads.

    Matched on `import.meta.env.NAME` rather than on the bare name, so a
    variable that survives only in a comment explaining why it is not used
    (VITE_MAIN_APP_URL) is correctly left out.
    """
    src = _FRONTEND / "src"
    if not src.exists():
        pytest.skip(f"{src} not found")
    names: set[str] = set()
    for path in src.rglob("*.ts*"):
        names.update(_VITE_READ.findall(path.read_text()))
    return names


def _dockerfile_args() -> set[str]:
    if not _FRONTEND_DOCKERFILE.exists():
        pytest.skip(f"{_FRONTEND_DOCKERFILE} not found")
    return set(re.findall(r"^ARG (VITE_[A-Z0-9_]+)", _FRONTEND_DOCKERFILE.read_text(), re.MULTILINE))


def _dockerfile_env() -> set[str]:
    """Names the Dockerfile assigns in an ENV instruction, ARG-expanded."""
    if not _FRONTEND_DOCKERFILE.exists():
        pytest.skip(f"{_FRONTEND_DOCKERFILE} not found")
    return set(
        re.findall(
            r"(VITE_[A-Z0-9_]+)=\$(?:\{)?\1", _FRONTEND_DOCKERFILE.read_text()
        )
    )


def _compose_frontend_build_args() -> set[str]:
    if not _COMPOSE.exists():
        pytest.skip("docker-compose.yml not found")
    text = _COMPOSE.read_text()
    m = re.search(r"^  frontend:$(.*?)(?=^  \S|\Z)", text, re.MULTILINE | re.DOTALL)
    if not m:
        pytest.skip("no frontend service in docker-compose.yml")
    args = re.search(r"^      args:$(.*?)(?=^      \S|^    \S|\Z)", m.group(1), re.MULTILINE | re.DOTALL)
    if not args:
        return set()
    return set(re.findall(r"^        (VITE_[A-Z0-9_]+):", args.group(1), re.MULTILINE))


class TestFrontendBuildArgsAreActuallyWired:
    """
    A VITE_* variable only reaches the browser if all three links hold. Any
    one of them missing leaves a documented setting that does nothing, and
    nothing at build or run time complains.
    """

    def test_every_name_the_frontend_reads_is_declared_as_a_build_arg(self):
        missing = _vite_names_read_by_the_frontend() - _dockerfile_args()
        assert not missing, (
            f"the frontend reads {sorted(missing)} but frontend/Dockerfile "
            f"declares no ARG for them. .dockerignore keeps .env out of the "
            f"image, so in a container build these can only ever hold their "
            f"compiled-in default — setting them in .env does nothing."
        )

    def test_every_declared_arg_is_exported_to_the_build_environment(self):
        """
        ARG alone is a substitution variable. The ENV line is what guarantees
        `pnpm run build` sees it as an environment variable, which is what Vite
        reads.
        """
        missing = _dockerfile_args() - _dockerfile_env()
        assert not missing, (
            f"frontend/Dockerfile declares ARG {sorted(missing)} without a "
            f"matching ENV assignment, so the build may not see them"
        )

    def test_every_declared_arg_is_passed_by_compose(self):
        missing = _dockerfile_args() - _compose_frontend_build_args()
        assert not missing, (
            f"frontend/Dockerfile accepts {sorted(missing)} but the compose "
            f"frontend service does not pass them, so a value in .env never "
            f"reaches the build"
        )

    def test_compose_passes_nothing_the_frontend_does_not_read(self):
        """The reverse direction: a build arg for a name nothing reads is dead
        configuration that reads as supported."""
        extra = _compose_frontend_build_args() - _vite_names_read_by_the_frontend()
        assert not extra, (
            f"compose passes {sorted(extra)} to the frontend build but no "
            f"frontend source reads them"
        )


# ---------------------------------------------------------------------------
# Backend runtime configuration
# ---------------------------------------------------------------------------

# Settings a worker needs and the API does not. Everything else that the
# backend code reads and .env.example documents has to reach the API container.
_WORKER_ONLY = {"WORKER_POLL_INTERVAL_SECONDS"}


def _documented_keys() -> set[str]:
    """Keys an operator can set by copying .env.example, commented ones included."""
    keys = set()
    for raw in _EXAMPLE.read_text().splitlines():
        line = raw.strip().lstrip("#").strip()
        m = re.match(r"^([A-Z][A-Z0-9_]*)=", line)
        if m:
            keys.add(m.group(1))
    return keys


def _names_the_backend_reads(candidates: set[str]) -> set[str]:
    """
    Which of `candidates` appear anywhere in backend/app.

    Deliberately broader than the pydantic Settings fields: plenty of these are
    read with os.getenv (MEDIACONVERT_ROLE_ARN, MEDIA_CDN_URL) and would not be
    found by looking at config.py alone — which is how those two came to be
    documented and passed to nothing.
    """
    app = _ROOT / "backend" / "app"
    if not app.exists():
        pytest.skip(f"{app} not found")
    blob = "\n".join(f.read_text() for f in app.rglob("*.py"))
    return {k for k in candidates if re.search(rf"\b{k}\b", blob)}


def _backend_service_env() -> set[str]:
    if not _COMPOSE.exists():
        pytest.skip("docker-compose.yml not found")
    text = _COMPOSE.read_text()
    svc = re.search(r"^  backend:$(.*?)(?=^  \S|\Z)", text, re.MULTILINE | re.DOTALL)
    if not svc:
        pytest.skip("no backend service in docker-compose.yml")
    env = re.search(r"^    environment:$(.*?)(?=^    \S|\Z)", svc.group(1), re.MULTILINE | re.DOTALL)
    if not env:
        return set()
    return set(re.findall(r"^      ([A-Z][A-Z0-9_]*):", env.group(1), re.MULTILINE))


def _config_aliases() -> dict[str, str]:
    """{env alias: settings field name} from config.py."""
    cfg = (_ROOT / "backend" / "app" / "config.py").read_text()
    parts = re.split(r"^(    [a-z][a-z0-9_]*\s*:)", cfg, flags=re.MULTILINE)
    out = {}
    for i in range(1, len(parts), 2):
        name = parts[i].strip().rstrip(":")
        m = re.search(r'alias="([A-Z0-9_]+)"', parts[i + 1].split("\n\n")[0])
        if m:
            out[m.group(1)] = name
    return out


class TestDocumentedBackendSettingsReachTheBackend:
    """
    compose has no env_file, so every setting is listed per service. A value in
    .env.example that no service passes is inert in a container deployment, and
    nothing says so — the app starts and quietly uses the code default.
    """

    def test_everything_documented_and_read_reaches_the_api_container(self):
        documented = _documented_keys()
        read = _names_the_backend_reads(documented)
        missing = sorted(read - _WORKER_ONLY - _backend_service_env())
        assert not missing, (
            f"{missing} are documented in .env.example and read by backend/app, "
            f"but the compose backend service does not pass them. Setting them "
            f"changes nothing and reports nothing."
        )

    def test_no_documented_setting_is_read_by_nobody(self):
        """
        The other direction: a knob in .env.example that no code reads. Two of
        these shipped — WORKER_POLL_INTERVAL and WORKER_MAX_RETRIES were
        declared in config.py, documented, and consulted nowhere, so an
        operator could tune them and watch nothing happen.
        """
        aliases = _config_aliases()
        app = _ROOT / "backend" / "app"
        blob = "\n".join(
            f.read_text() for f in app.rglob("*.py") if f.name != "config.py"
        )
        dead = sorted(
            alias
            for alias, field in aliases.items()
            if alias in _documented_keys()
            and not re.search(rf"\b{field}\b", blob)
            and not re.search(rf"\b{alias}\b", blob)
        )
        assert not dead, (
            f"{dead} are declared in config.py and documented in .env.example, "
            f"but nothing outside config.py reads them"
        )

"""
Madrona backend application package.

FastAPI, created by the factory in app.asgi and served by uvicorn (see
entrypoint.sh). Configuration is environment-driven and logs go to
stdout/stderr.

__version__ below is the single source of the product version. Read it through
app.utils.version.get_app_version() rather than repeating the literal: the
FastAPI app metadata, the published OpenAPI document and GET / all derive from
it, and a second copy drifts without anything failing. The other two places the
version appears are pyproject.toml and frontend/package.json, which cannot
import this; tests/test_version_consistency.py asserts all three agree.
"""

__version__ = "1.0.0"

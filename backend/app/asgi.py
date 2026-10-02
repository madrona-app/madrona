"""
ASGI entry point for Madrona.

FastAPI is the sole ASGI host. All routes are served by FastAPI routers.
Socket.IO is mounted via ASGIApp wrapper, handling /socket.io/ requests.
"""

import os

os.environ["_MADRONA_ASGI"] = "1"

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware


def create_app() -> FastAPI:
    """Create the FastAPI application."""
    # Configure structured logging (must happen before any logger usage)
    from app.logging import configure_logging
    configure_logging()

    # One version, one source. app.__version__ is the canonical value; a
    # literal here drifts from it silently, and this one is what the published
    # OpenAPI document reports to anyone building against the API.
    from app.utils.version import get_app_version

    app = FastAPI(
        title="Madrona API",
        version=get_app_version(),
        # Swagger UI is under /api/_docs to avoid shadowing the page-docs
        # router which owns /api/docs* for user-facing page documentation.
        docs_url="/api/_docs",
        openapi_url="/api/openapi.json",
    )

    # CORS middleware — same origins as Flask config
    from app.config import get_settings
    settings = get_settings()

    # =========================================================================
    # Middleware (registered in reverse execution order:
    # last add_middleware = outermost = runs first)
    # =========================================================================
    from app.fastapi_app.middleware.csrf import CSRFMiddleware
    from app.fastapi_app.middleware.content_type import ContentTypeMiddleware
    from app.fastapi_app.middleware.rate_limit import RateLimitMiddleware
    from app.fastapi_app.middleware.security_headers import SecurityHeadersMiddleware
    from app.fastapi_app.middleware.request_logging import RequestLoggingMiddleware
    from app.fastapi_app.middleware.request_context import RequestContextMiddleware

    app.add_middleware(CSRFMiddleware)              # 6th (innermost before CORS)
    app.add_middleware(ContentTypeMiddleware)        # 5th
    app.add_middleware(RequestContextMiddleware)     # 4th (populates context vars)
    app.add_middleware(RateLimitMiddleware)          # 3rd
    app.add_middleware(SecurityHeadersMiddleware)    # 2nd

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_headers=["Content-Type", "X-CSRF-Token", "Authorization", "X-API-Key", "X-Request-ID"],
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        expose_headers=["Content-Type", "X-CSRF-Token", "X-Request-ID", "Retry-After"],
    )

    app.add_middleware(RequestLoggingMiddleware)     # 1st (outermost)

    # TrustedHostMiddleware runs before any of the above (last add = outermost).
    # Defaults to ["*"] (no-op) so existing deploys keep working; production sets
    # ALLOWED_HOSTS to the real public hostnames + ALB health-check host.
    if settings.allowed_hosts:
        app.add_middleware(
            TrustedHostMiddleware,
            allowed_hosts=settings.allowed_hosts,
        )

    # =========================================================================
    # Entity audit listeners (SQLAlchemy session events)
    # =========================================================================
    from app.services.entity_audit import register_audit_listeners
    register_audit_listeners()

    # =========================================================================
    # Sentry initialization
    # =========================================================================
    from app.sentry import init_sentry
    init_sentry(settings)

    # =========================================================================
    # Exception handlers
    # =========================================================================
    from app.fastapi_app.exception_handlers import register_exception_handlers
    register_exception_handlers(app)

    # =========================================================================
    # Routers
    # =========================================================================
    from app.fastapi_app.routers.dam_public import router as dam_public_router
    from app.fastapi_app.routers.auth import router as auth_router
    from app.fastapi_app.routers.test_support import (
        router as test_support_router,
        test_support_enabled,
    )
    from app.fastapi_app.routers.organizations import router as organizations_router
    from app.fastapi_app.routers.connectors import router as connectors_router
    from app.fastapi_app.routers.pipelines import router as pipelines_router
    from app.fastapi_app.routers.runs import router as runs_router
    from app.fastapi_app.routers.health import router as health_router
    from app.fastapi_app.routers.install import router as install_router
    from app.fastapi_app.routers.layout_overrides import router as layout_overrides_router
    from app.fastapi_app.routers.notifications import router as notifications_router
    from app.fastapi_app.routers.dashboard import router as dashboard_router
    from app.fastapi_app.routers.discussions import router as discussions_router
    from app.fastapi_app.routers.misc import router as misc_router
    from app.fastapi_app.routers.search import router as search_router
    from app.fastapi_app.routers.autocomplete import router as autocomplete_router
    from app.fastapi_app.routers.tasks_work import router as tasks_work_router
    from app.fastapi_app.routers.entities import router as entities_router
    from app.fastapi_app.routers.entities_current import router as entities_current_router
    from app.fastapi_app.routers.classification import router as classification_router
    from app.fastapi_app.routers.collections_export import router as collections_export_router
    from app.fastapi_app.routers.collections_authorities import router as collections_authorities_router
    from app.fastapi_app.routers.collections_taxonomy import router as collections_taxonomy_router
    from app.fastapi_app.routers.object_parts import router as object_parts_router
    from app.fastapi_app.routers.collections_relations import router as collections_relations_router
    from app.fastapi_app.routers.collections_descriptive import router as collections_descriptive_router
    from app.fastapi_app.routers.collections_procedure_plans import router as procedure_plans_router
    from app.fastapi_app.routers.collections_procedure_incidents import router as procedure_incidents_router
    from app.fastapi_app.routers.collections_procedure_compliance import router as procedure_compliance_router
    from app.fastapi_app.routers.collections_procedure_rights import router as procedure_rights_router
    from app.fastapi_app.routers.collections_procedure_value import router as procedure_value_router
    from app.fastapi_app.routers.media_collections import router as media_collections_router
    from app.fastapi_app.routers.media_tags import router as media_tags_router
    from app.fastapi_app.routers.media_folders import router as media_folders_router
    from app.fastapi_app.routers.media_rights_publishing import router as media_rights_publishing_router
    from app.fastapi_app.routers.media_templates_config import router as media_templates_config_router
    from app.fastapi_app.routers.media_downloads import router as media_downloads_router
    from app.fastapi_app.routers.media_library import router as media_library_router
    from app.fastapi_app.routers.media_dam import router as media_dam_router
    from app.fastapi_app.routers.media_ai import router as media_ai_router
    from app.fastapi_app.routers.workspaces import router as workspaces_router
    from app.fastapi_app.routers.media_workspaces import router as media_workspaces_router
    from app.fastapi_app.routers.media_iiif import router as media_iiif_router
    from app.fastapi_app.routers.media_tus_webhook import router as media_tus_webhook_router
    from app.fastapi_app.routers.agent_admin import router as agent_admin_router
    from app.fastapi_app.routers.system_prompts import router as system_prompts_router
    from app.fastapi_app.routers.content_admin import router as content_admin_router
    from app.fastapi_app.routers.content_public import router as content_public_router
    from app.fastapi_app.routers.agent import router as agent_router
    from app.fastapi_app.routers.drafts import router as drafts_router
    from app.fastapi_app.routers.platform_admin import router as platform_admin_router
    from app.fastapi_app.routers.departments import router as departments_router
    from app.fastapi_app.routers.exhibit_venues import router as exhibit_venues_router
    from app.fastapi_app.routers.exhibit_exhibitions import router as exhibit_exhibitions_router
    from app.fastapi_app.routers.collections_exhibitions import router as collections_exhibitions_router
    from app.fastapi_app.routers.exhibition_loans import router as exhibition_loans_router
    from app.fastapi_app.routers.exhibit_exports import router as exhibit_exports_router
    from app.fastapi_app.routers.collections_nagpra import router as collections_nagpra_router
    from app.fastapi_app.routers.collections_search import router as collections_search_router
    from app.fastapi_app.routers.collections_vocabulary import router as collections_vocabulary_router
    from app.fastapi_app.routers.collections_locations import router as collections_locations_router
    from app.fastapi_app.routers.collections_discover import router as collections_discover_router
    from app.fastapi_app.routers.collections_objects import router as collections_objects_router
    from app.fastapi_app.routers.collections_media import router as collections_media_router
    from app.fastapi_app.routers.collections_constituents import router as collections_constituents_router
    from app.fastapi_app.routers.collections_procedures import router as collections_procedures_router
    from app.fastapi_app.routers.collections_loans import router as collections_loans_router
    from app.fastapi_app.routers.collections_conservation import router as collections_conservation_router
    from app.fastapi_app.routers.collections_contacts import router as collections_contacts_router
    from app.fastapi_app.routers.signed_documents import router as signed_documents_router
    from app.fastapi_app.routers.insurance import router as insurance_router
    from app.fastapi_app.routers.shipments import router as shipments_router
    from app.fastapi_app.routers.checklists import router as checklists_router
    from app.fastapi_app.routers.budget import router as budget_router
    from app.fastapi_app.routers.sla import router as sla_router
    from app.fastapi_app.routers.preservation import router as preservation_router
    from app.fastapi_app.routers.info_requests import router as info_requests_router
    from app.fastapi_app.routers.events import router as events_router
    from app.fastapi_app.routers.geo import router as geo_router
    from app.fastapi_app.routers.branding import router as branding_router
    from app.fastapi_app.routers.collection_profile import router as collection_profile_router
    from app.fastapi_app.routers.storage_config import router as storage_config_router
    from app.fastapi_app.routers.barcodes import router as barcodes_router
    from app.fastapi_app.routers.discover_ssr import router as discover_ssr_router

    from app.fastapi_app.routers.reports_misc import router as reports_misc_router
    from app.fastapi_app.routers.data_tools import router as data_tools_router
    from app.fastapi_app.routers.relationships import router as relationships_router
    from app.fastapi_app.routers.lod_exports import router as lod_exports_router
    from app.fastapi_app.routers.crm import router as crm_router
    from app.fastapi_app.routers.email_webhooks import router as email_webhooks_router
    from app.fastapi_app.routers.user_settings import router as user_settings_router
    from app.fastapi_app.routers.discover_public import router as discover_public_router
    from app.fastapi_app.routers.guide_documents import router as guide_documents_router
    from app.fastapi_app.routers.guide_insights import router as guide_insights_router
    from app.fastapi_app.routers.guide_preferences import router as guide_preferences_router
    from app.fastapi_app.routers.guide_attachments import router as guide_attachments_router
    from app.fastapi_app.routers.guide_chat import router as guide_chat_router
    from app.fastapi_app.routers.guide_widget import router as guide_widget_router
    from app.fastapi_app.routers.server_management import router as server_management_router
    from app.fastapi_app.routers.procedure_requirements import router as procedure_requirements_router
    from app.fastapi_app.routers.roles import router as roles_router
    from app.fastapi_app.routers.approvals import router as approvals_router

    app.include_router(dam_public_router, prefix="/public/v1")
    app.include_router(auth_router)
    # Registered only under APP_ENV=testing (#37). The handlers also gate
    # themselves, but a route that is never mounted cannot be reached at all
    # if that gate is ever loosened.
    if test_support_enabled():
        app.include_router(test_support_router)
    app.include_router(organizations_router)
    app.include_router(connectors_router)
    app.include_router(pipelines_router)
    app.include_router(runs_router)
    app.include_router(health_router)
    # Unauthenticated by necessity — it runs before any account exists.
    # Guarded by refusing once an organization is present.
    app.include_router(install_router)
    app.include_router(notifications_router)
    app.include_router(dashboard_router)
    app.include_router(discussions_router)
    app.include_router(misc_router)
    app.include_router(search_router)
    app.include_router(autocomplete_router)
    app.include_router(tasks_work_router)
    # relationships_router declares GET /api/entities/{key}/relationships and
    # must be registered before entities_router, whose GET /api/entities/{key:path}
    # would otherwise greedily match `{key}/relationships` and return 404.
    app.include_router(relationships_router)
    app.include_router(entities_router)
    app.include_router(entities_current_router)
    app.include_router(classification_router)
    app.include_router(collections_export_router)
    app.include_router(collections_authorities_router)
    app.include_router(collections_taxonomy_router)
    app.include_router(object_parts_router)
    app.include_router(collections_relations_router)
    app.include_router(collections_descriptive_router)
    app.include_router(procedure_plans_router)
    app.include_router(procedure_incidents_router)
    app.include_router(procedure_compliance_router)
    app.include_router(procedure_requirements_router)
    app.include_router(roles_router)
    app.include_router(approvals_router)
    app.include_router(procedure_rights_router)
    app.include_router(procedure_value_router)
    app.include_router(media_collections_router)
    app.include_router(media_tags_router)
    app.include_router(media_folders_router)
    app.include_router(media_rights_publishing_router)
    app.include_router(media_templates_config_router)
    app.include_router(media_downloads_router)
    app.include_router(media_dam_router)       # Must be before media_library (has /media/{media_id} catch-all)
    app.include_router(media_ai_router)
    app.include_router(workspaces_router)
    app.include_router(media_workspaces_router)  # /media/workspaces — must register BEFORE the /media/{media_id} catch-all
    app.include_router(media_iiif_router)
    app.include_router(media_library_router)   # /media/{media_id} catch-all — must be last
    app.include_router(media_tus_webhook_router)
    app.include_router(agent_admin_router)
    app.include_router(system_prompts_router)
    app.include_router(content_admin_router)
    app.include_router(content_public_router)
    app.include_router(agent_router)
    app.include_router(drafts_router)
    app.include_router(platform_admin_router)
    app.include_router(departments_router)
    app.include_router(exhibit_venues_router)
    app.include_router(exhibit_exhibitions_router)
    app.include_router(collections_exhibitions_router)
    app.include_router(exhibition_loans_router)
    app.include_router(exhibit_exports_router)
    app.include_router(collections_nagpra_router)
    app.include_router(collections_search_router)
    app.include_router(collections_vocabulary_router)
    app.include_router(collections_locations_router)
    app.include_router(collections_discover_router)
    app.include_router(collections_objects_router)
    app.include_router(collections_media_router)
    app.include_router(collections_constituents_router)
    app.include_router(collections_procedures_router)
    app.include_router(collections_loans_router)
    app.include_router(collections_conservation_router)
    app.include_router(signed_documents_router)
    app.include_router(collections_contacts_router)
    app.include_router(insurance_router)
    app.include_router(shipments_router)
    app.include_router(checklists_router)
    app.include_router(budget_router)
    app.include_router(sla_router)
    app.include_router(preservation_router)
    app.include_router(info_requests_router)
    app.include_router(events_router)
    app.include_router(geo_router)
    app.include_router(branding_router)
    app.include_router(collection_profile_router)
    app.include_router(storage_config_router)
    app.include_router(barcodes_router)
    app.include_router(discover_ssr_router)

    app.include_router(reports_misc_router)
    app.include_router(data_tools_router)
    app.include_router(lod_exports_router)
    app.include_router(crm_router)
    app.include_router(email_webhooks_router)
    app.include_router(user_settings_router)
    app.include_router(discover_public_router)
    app.include_router(guide_documents_router)
    app.include_router(guide_insights_router)
    app.include_router(guide_preferences_router)
    app.include_router(guide_attachments_router)
    app.include_router(guide_chat_router)
    app.include_router(guide_widget_router)
    app.include_router(server_management_router)
    app.include_router(layout_overrides_router)

    # MCP (Model Context Protocol) server — exposes collection data to AI clients.
    #
    # Guarded deliberately: MCP is an optional integration mounted at the very
    # end of app construction, but this import runs at module scope (create_app()
    # is called on import), so anything raising here takes the WHOLE API down —
    # every collection, media and Guide route with it. That is not hypothetical:
    # mcp 2.0.0 removed `mcp.server.fastmcp` and the unpinned requirement made
    # the API unbootable on any fresh install (CI + rebuilt boxes both).
    #
    # requirements.txt now pins <2.0.0, so this is defense in depth: losing /mcp
    # should cost us /mcp, not the platform. The traceback is logged at ERROR so
    # this degrades loudly and never passes for healthy.
    try:
        from app.fastapi_app.routers.mcp_server import mcp_app
    except Exception:
        import logging

        logging.getLogger(__name__).exception(
            "MCP server failed to load — /mcp will NOT be mounted. "
            "The rest of the API is unaffected. This usually means the mcp "
            "SDK is missing or incompatible (see requirements.txt pin)."
        )
    else:
        app.mount("/mcp", mcp_app)

    return app


_fastapi_app = create_app()

# Wrap FastAPI with Socket.IO ASGI adapter
# Socket.IO handles /socket.io/ requests, everything else passes to FastAPI
from app.fastapi_app.websocket import sio
import socketio as socketio_lib

application = socketio_lib.ASGIApp(sio, other_asgi_app=_fastapi_app)

# Alias so both `app.asgi:app` and `app.asgi:application` work with uvicorn
app = application

"""
Report Registry - Central registry for on-demand report definitions.

Each report definition specifies:
- What contexts it supports (search results, workspace, individual record)
- What record types it applies to
- What formats it can generate
- How to resolve data and render output
"""
import logging
from dataclasses import dataclass, field
from typing import Any, Callable

logger = logging.getLogger(__name__)


@dataclass
class ReportDefinition:
    """A registered on-demand report type."""

    report_key: str
    name: str
    description: str
    category: str  # e.g., "Tabular Export", "Document Report"
    style: str  # "tabular" or "document"
    context_types: list[str]  # ["search", "workspace", "record"]
    record_types: list[str]  # e.g., ["collection_objects", "loans_in"]
    supported_formats: list[str]  # ["csv", "excel", "pdf"]
    resolver: Callable[..., Any]  # (context_type, context_params, org_id) -> data
    renderer: Callable[..., Any]  # (data, format, report_name) -> (bytes, content_type, ext)
    organization_ids: list[str] | None = None  # None = all orgs, list = customer-specific
    default_format: str = "excel"
    icon: str | None = None  # Frontend icon hint


class ReportRegistry:
    """Singleton registry of all available on-demand report definitions."""

    _instance: "ReportRegistry | None" = None
    _definitions: dict[str, ReportDefinition]

    def __init__(self) -> None:
        self._definitions = {}

    @classmethod
    def get_instance(cls) -> "ReportRegistry":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def register(self, definition: ReportDefinition) -> None:
        """Register a report definition."""
        if definition.report_key in self._definitions:
            logger.warning("Overwriting report definition: %s", definition.report_key)
        self._definitions[definition.report_key] = definition
        logger.debug("Registered report: %s", definition.report_key)

    def get(self, report_key: str) -> ReportDefinition | None:
        """Get a report definition by key."""
        return self._definitions.get(report_key)

    def list_for_context(
        self,
        context_type: str,
        record_type: str | None = None,
        organization_id: str | None = None,
    ) -> list[ReportDefinition]:
        """
        List available reports for a given context.

        Args:
            context_type: "search", "workspace", or "record"
            record_type: Optional record type filter (e.g., "collection_objects")
            organization_id: Optional org filter for customer-specific reports
        """
        results = []
        for defn in self._definitions.values():
            # Must support the context type
            if context_type not in defn.context_types:
                continue
            # Must support the record type (if specified)
            if record_type and record_type not in defn.record_types:
                continue
            # Must be available for this org (if org-specific)
            if defn.organization_ids is not None:
                if organization_id and organization_id not in defn.organization_ids:
                    continue
            results.append(defn)
        return results

    def list_all(self) -> list[ReportDefinition]:
        """List all registered report definitions."""
        return list(self._definitions.values())


def get_registry() -> ReportRegistry:
    """Get the global report registry instance."""
    return ReportRegistry.get_instance()

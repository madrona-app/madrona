"""Common Pydantic schemas used across FastAPI endpoints."""

from typing import Any

from pydantic import BaseModel


class PaginationOut(BaseModel):
    """Pagination metadata."""
    page: int
    page_size: int
    total: int
    total_pages: int


class PaginatedResponse(BaseModel):
    """Standardized paginated list response.

    All new list endpoints should use this shape::

        {"items": [...], "total": 123, "limit": 50, "offset": 0}

    Existing endpoints are being migrated to this pattern incrementally.
    """
    items: list[Any]
    total: int
    limit: int
    offset: int


class ErrorDetail(BaseModel):
    """Error detail."""
    code: str
    message: str


class ErrorResponse(BaseModel):
    """Standardized error response."""
    error: ErrorDetail


class SuccessResponse(BaseModel):
    """Generic success response — {"success": true}."""
    success: bool = True


class MessageResponse(BaseModel):
    """Generic message response — {"message": "..."}."""
    message: str


class DeletedResponse(BaseModel):
    """Generic deletion response — {"deleted": true}."""
    deleted: bool = True


class StatusOkResponse(BaseModel):
    """Generic status response — {"status": "ok"}."""
    status: str = "ok"

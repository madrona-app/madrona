"""Pydantic response models for user settings endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class SettingValueResponse(BaseModel):
    key: str
    value: Any

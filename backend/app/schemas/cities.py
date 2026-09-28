"""City catalogue schema — IMPLEMENTATION_PLAN.md §5.1."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class DateRange(BaseModel):
    model_config = ConfigDict(frozen=True)
    start: str
    end: str


class CityInfo(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    name: str
    lat: float
    lon: float
    tz: str
    zone_count: int
    date_range: DateRange

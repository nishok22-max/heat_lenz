"""GET /forecast/{city_id} — IMPLEMENTATION_PLAN.md §5.4."""
from __future__ import annotations

from fastapi import APIRouter, Query

from app.schemas.forecast import ForecastResponse, HourlyResponse
from app.services import hourly
from app.services.forecast import DEFAULT_FORECAST_DAYS, get_forecast

router = APIRouter(prefix="/forecast", tags=["forecast"])


@router.get("/{city_id}", response_model=ForecastResponse)
async def get_city_forecast(
    city_id: str,
    zone_id: str | None = Query(None),
    days: int = Query(DEFAULT_FORECAST_DAYS, ge=1, le=7),
) -> ForecastResponse:
    return await get_forecast(city_id, zone_id, days)


@router.get("/{city_id}/hourly", response_model=HourlyResponse)
async def get_city_hourly(city_id: str, date: str = Query(..., description="YYYY-MM-DD")) -> HourlyResponse:
    """One day hour by hour, for the dashboard's exposure chart and peak danger period."""
    return await hourly.hourly_for_date(city_id, date)

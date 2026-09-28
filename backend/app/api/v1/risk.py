"""GET /risk/zones, GET /risk/zones/{zone_id} — IMPLEMENTATION_PLAN.md §5.2, §5.3.

``date`` may be a historical date (March-June 2010-2024) or a date in the live
forecast window (services/frames.py picks the source), so the same map and zone
panel serve both the 2010 replay and tomorrow's forecast.

Phase 1 scope: one city (Ahmedabad), so ``city`` defaults from settings rather
than being a hard requirement. Multi-city support (Open Decision #3) extends
this without changing the shape.
"""
from __future__ import annotations

from fastapi import APIRouter, Query
from fastapi.concurrency import run_in_threadpool

from app.core.config import settings
from app.core.errors import NotFoundError
from app.data import registry
from app.schemas.risk import RiskZonesResponse, ZoneDetailResponse
from app.services import frames, spatial

router = APIRouter(prefix="/risk", tags=["risk"])


def _check_city(city_id: str) -> None:
    if registry.get_city(city_id) is None:
        raise NotFoundError(f"city {city_id!r} not found")


@router.get("/zones", response_model=RiskZonesResponse)
async def get_risk_zones(
    date: str = Query(..., description="YYYY-MM-DD: a historical date, or one in the live forecast window"),
    city: str = Query(settings.default_city_id),
) -> RiskZonesResponse:
    _check_city(city)
    ctx = await frames.resolve(city, date)
    # 48 wards scored: CPU work, kept off the event loop so other requests (and chat) stay responsive.
    return await run_in_threadpool(spatial.map_payload, city, date, ctx)


@router.get("/zones/{zone_id}", response_model=ZoneDetailResponse)
async def get_zone_detail(
    zone_id: str,
    date: str = Query(..., description="YYYY-MM-DD"),
    history_days: int = Query(30, ge=1, le=365),
    city: str = Query(settings.default_city_id),
) -> ZoneDetailResponse:
    _check_city(city)
    ctx = await frames.resolve(city, date)
    # history_days predictions in a loop: keep it off the event loop.
    return await run_in_threadpool(spatial.zone_detail, city, zone_id, date, history_days, ctx)

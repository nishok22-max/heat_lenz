"""GET /advisory/{zone_id}, POST /dispatch/preview — IMPLEMENTATION_PLAN.md §5.5, §5.6.

Both accept a historical date or one in the live forecast window.
"""
from __future__ import annotations

import pandas as pd
from fastapi import APIRouter, Query

from app.core.config import settings
from app.core.errors import NotFoundError
from app.data import registry
from app.schemas.advisory import AdvisoryResponse, DispatchRequest, DispatchResponse
from app.services import advisory, frames

router = APIRouter(tags=["advisory"])


@router.get("/advisory/{zone_id}", response_model=AdvisoryResponse)
async def get_zone_advisory(
    zone_id: str,
    date: str = Query(...),
    persona: str = Query("general", pattern="^(construction|elderly|general)$"),
    city: str = Query(settings.default_city_id),
) -> AdvisoryResponse:
    if registry.get_city(city) is None:
        raise NotFoundError(f"city {city!r} not found")
    ctx = await frames.resolve(city, date)
    return advisory.get_advisory(city, zone_id, date, persona, ctx)


@router.post("/dispatch/preview", response_model=DispatchResponse)
async def post_dispatch_preview(req: DispatchRequest) -> DispatchResponse:
    city_id = settings.default_city_id
    city = registry.get_city(city_id)
    if city is None:
        raise NotFoundError(f"city {city_id!r} not found")
    date = req.date or pd.Timestamp.now(tz=city.tz).strftime("%Y-%m-%d")
    ctx = await frames.resolve(city_id, date)  # NotFoundError (404) for a date no source covers
    return advisory.dispatch_preview(req.model_copy(update={"date": date}), ctx)

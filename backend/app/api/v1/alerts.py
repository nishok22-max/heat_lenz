"""Heat Action Plan triggers, CAP feed and webhook preview — SIH PS 26083 requirement R6.

All dry runs: nothing here transmits anything (services/alerts.py).
"""
from __future__ import annotations

from fastapi import APIRouter, Query, Response
from fastapi.concurrency import run_in_threadpool

from app.core.config import settings
from app.core.errors import NotFoundError
from app.data import registry
from app.schemas.alerts import HapLevel, TriggersResponse, WebhookPreview, WebhookRequest
from app.services import alerts, frames

router = APIRouter(prefix="/alerts", tags=["alerts"])


def _check_city(city_id: str) -> None:
    if registry.get_city(city_id) is None:
        raise NotFoundError(f"city {city_id!r} not found")


@router.get("/triggers", response_model=TriggersResponse)
async def get_triggers(
    date: str = Query(..., description="YYYY-MM-DD: historical or in the live forecast window"),
    city: str = Query(settings.default_city_id),
) -> TriggersResponse:
    _check_city(city)
    ctx = await frames.resolve(city, date)
    return await run_in_threadpool(alerts.triggers, city, date, ctx)  # CPU work, off the event loop


@router.get(
    "/cap",
    response_class=Response,
    responses={
        200: {"content": {"application/cap+xml": {}}, "description": "CAP 1.2 alert (status Draft)"},
        204: {"description": "No zone at or above min_level on this date"},
    },
)
async def get_cap_feed(
    date: str = Query(...),
    city: str = Query(settings.default_city_id),
    min_level: HapLevel = Query("Yellow"),
) -> Response:
    _check_city(city)
    ctx = await frames.resolve(city, date)
    xml = alerts.cap_xml(city, date, ctx, min_level)
    if xml is None:
        return Response(status_code=204)
    return Response(content=xml, media_type="application/cap+xml")


@router.post("/webhook-preview", response_model=WebhookPreview)
async def post_webhook_preview(req: WebhookRequest) -> WebhookPreview:
    _check_city(req.city)
    ctx = await frames.resolve(req.city, req.date)
    return alerts.webhook_preview(req, ctx)

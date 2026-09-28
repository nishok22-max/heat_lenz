"""GET /meta — IMPLEMENTATION_PLAN.md §5.1."""
from __future__ import annotations

from fastapi import APIRouter

from app.data import registry, store
from app.schemas.common import VersionInfo
from app.core.config import settings

router = APIRouter(tags=["meta"])


@router.get("/meta", response_model=VersionInfo)
def get_meta() -> VersionInfo:
    daily = store.daily_frame()
    zone_count = 0
    if settings.zones_geojson.exists():
        import json

        fc = json.loads(settings.zones_geojson.read_text(encoding="utf-8"))
        zone_count = len(fc.get("features", []))

    data_as_of = str(daily["date"].max()) if len(daily) else "unknown"

    return VersionInfo(
        version=settings.version,
        data_as_of=data_as_of,
        calibration_status="not_validated_locally",
        cities=len(registry.list_cities()),
        zones=zone_count,
    )

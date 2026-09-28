"""GET /cities, GET /cities/{id}/zones — IMPLEMENTATION_PLAN.md §5.1."""
from __future__ import annotations

from fastapi import APIRouter

from app.core.errors import NotFoundError
from app.data import registry, store
from app.schemas.cities import CityInfo, DateRange
from app.services import spatial

router = APIRouter(tags=["cities"])


@router.get("/cities", response_model=list[CityInfo])
def list_cities() -> list[CityInfo]:
    daily = store.daily_frame()
    zone_count = len(spatial.list_zones())
    out = []
    for c in registry.list_cities():
        out.append(
            CityInfo(
                id=c.id,
                name=c.name,
                lat=c.lat,
                lon=c.lon,
                tz=c.tz,
                zone_count=zone_count,
                date_range=DateRange(start=str(daily["date"].min()), end=str(daily["date"].max())),
            )
        )
    return out


@router.get("/cities/{city_id}/zones")
def get_city_zones(city_id: str) -> dict:
    if registry.get_city(city_id) is None:
        raise NotFoundError(f"city {city_id!r} not found")
    # Raw GeoJSON FeatureCollection, not a Pydantic model — a plain dict return
    # is FastAPI's own recommended replacement for ORJSONResponse (deprecated
    # on this version; see app/main.py).
    return spatial.zones_geojson()

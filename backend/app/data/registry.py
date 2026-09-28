"""Static city catalogue.

Only Ahmedabad has data behind it today (Open Decision #3 in IMPLEMENTATION_PLAN.md).
Adding a second city means adding an entry here plus a weather source in
data/openmeteo.py — the rest of the stack is already city-parameterised.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class City:
    id: str
    name: str
    lat: float
    lon: float
    tz: str
    has_precomputed_history: bool


CITIES: dict[str, City] = {
    "ahmedabad": City(
        id="ahmedabad",
        name="Ahmedabad",
        lat=23.03,
        lon=72.58,
        tz="Asia/Kolkata",
        has_precomputed_history=True,
    ),
}


def get_city(city_id: str) -> City | None:
    return CITIES.get(city_id)


def list_cities() -> list[City]:
    return list(CITIES.values())

"""Resolve a date to the daily frame that can serve it — historical or live.

Before this module the map, zone panel and advisory only worked for dates in the
precomputed 2010-2024 record, so the product could replay 2010 but could not
say anything about *tomorrow* — the thing the problem statement is about (R3,
R5: "3-5 days ahead"). Now every ``date`` parameter accepts either:

* a date in the precomputed March-June 2010-2024 record ("history"), or
* a date in the live Open-Meteo window: the last few real days, today, and up
  to MAX_FORECAST_DAYS ahead ("forecast").

The two are told apart by membership, not by comparing against "today": the
record ends in 2024 and the live window is around the server's current date,
so they can never overlap.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date as _date

import pandas as pd

from app.core.errors import NotFoundError, ValidationError
from app.data import registry, store
from app.schemas.risk import DataSource
from app.services import forecast, health

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class DayContext:
    """Everything services/spatial.py and services/advisory.py need to score a date."""

    frame: pd.DataFrame  # API-safe daily rows (None, not NaN) with a string ``date`` column
    daily_means: pd.Series  # daily mean temperature by date, for the health layer
    source: DataSource
    issued_at: str | None = None  # forecast pull time; None for history
    # Live dates only: each ward's own weather context (the forecast at its centre's model grid
    # cell) and a plain description of where it came from. None -> every ward uses ``frame``.
    zone_contexts: dict[str, "DayContext"] | None = None
    zone_basis: dict[str, str] | None = None


def history_context() -> DayContext:
    return DayContext(
        frame=store.daily_frame(),
        daily_means=health.historical_daily_means(),
        source="history",
    )


def _parse(date: str) -> _date:
    try:
        return _date.fromisoformat(date)
    except (TypeError, ValueError) as exc:
        raise ValidationError(f"date {date!r} is not a valid YYYY-MM-DD date") from exc


def _has_date(frame: pd.DataFrame, date: str) -> bool:
    return bool((frame["date"] == date).any())


async def _ward_contexts(city_id: str, days: int, date: str):
    """Per-ward contexts from the forecast at each ward's centre. If that request fails the
    wards fall back to the city-level forecast - the app keeps working and each ward says so."""
    try:
        ww = await forecast.get_ward_weather(city_id, days)
    except Exception as exc:  # network/upstream trouble must not take the map down
        log.warning("per-ward forecast unavailable, using the city point: %s", exc)
        return None, None
    contexts: dict[str, DayContext] = {}
    basis: dict[str, str] = {}
    cell_ctx: dict[str, DayContext] = {}
    for zone_id, key in ww.zone_cell.items():
        b = ww.bundles[key]
        if not _has_date(b.frame, date):
            continue
        if key not in cell_ctx:
            cell_ctx[key] = DayContext(
                frame=b.frame, daily_means=b.daily_means, source="forecast", issued_at=b.response.issued_at
            )
        contexts[zone_id] = cell_ctx[key]
        n = ww.wards_in_cell[key]
        lat, lon = key.split(",")
        basis[zone_id] = (
            f"Open-Meteo forecast for this ward's own part of the city (model grid cell centred at {lat} N, {lon} E"
            + (f", shared with {n - 1} other ward{'s' if n > 2 else ''}" if n > 1 else "")
            + f"; the city has {len(ww.bundles)} such cells)."
        )
    return (contexts or None), (basis or None)


async def resolve(city_id: str, date: str) -> DayContext:
    """Return the context whose frame contains ``date``.

    Raises ValidationError (422) for a malformed date and NotFoundError (404),
    with the coverage windows spelled out, for a well-formed date neither source
    holds — including the March-June-only gaps inside the historical range.
    """
    day = _parse(date)
    city = registry.get_city(city_id)
    if city is None:
        raise NotFoundError(f"city {city_id!r} not found")

    history = history_context()
    if _has_date(history.frame, date):
        return history

    # Only pay for a live pull when the date could plausibly be in the live window.
    today = pd.Timestamp.now(tz=city.tz).date()
    lead = (day - today).days
    if -forecast.DEFAULT_PAST_DAYS <= lead <= forecast.MAX_FORECAST_DAYS:
        days = max(forecast.DEFAULT_FORECAST_DAYS, min(lead, forecast.MAX_FORECAST_DAYS))
        bundle = await forecast.get_bundle(city_id, days)
        if _has_date(bundle.frame, date):
            zone_contexts, zone_basis = await _ward_contexts(city_id, days, date)
            return DayContext(
                frame=bundle.frame,
                daily_means=bundle.daily_means,
                source="forecast",
                issued_at=bundle.response.issued_at,
                zone_contexts=zone_contexts,
                zone_basis=zone_basis,
            )

    dates = history.frame["date"]
    raise NotFoundError(
        f"no data for {date!r}. History covers {dates.min()} to {dates.max()} "
        f"(March-June only); the live window covers the last {forecast.DEFAULT_PAST_DAYS} days, "
        f"today and the next {forecast.MAX_FORECAST_DAYS}."
    )

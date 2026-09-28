"""Stage 6 orchestrator, Path B (live forecast) — IMPLEMENTATION_PLAN.md §2.2, §4.2.

Sequence: openmeteo.fetch_forecast_hourly -> thermal.hourly_metrics ->
thermal.to_daily -> (dry-heat X vs historical_thresholds) -> debt.compute_debt
-> ensemble.predict_for_date + health.assess per day -> LiveBundle.

The whole computation is cached as one ``LiveBundle``: the JSON forecast, the
daily frame behind it, and the daily-mean-temperature series the health layer
needs. Sharing the bundle is what lets the map, the zone panel and the advisory
all resolve a *forecast* date through the same code that serves a historical
one (services/frames.py), without a second Open-Meteo pull or a second run of
the physics.

Design decisions that the original sketch didn't quite fit:

1. NOT calling plan_b.align_forecasts(). That function selects among MULTIPLE
   forecast issues at different lead times for the same target date — built
   for backtesting an archive of past NCUM/NEPS forecasts against outcomes.
   A single live Open-Meteo pull has exactly one issue date, so lead_day is
   just (valid_date - issue_date).days, computed directly.
2. Requesting ``past_days`` of real recent history and DROPPING lead_day <= 0
   from the response. Not padding: plan_c's heat-debt carry and
   consecutive_hot_days both need real preceding days to be genuine on D+1.
3. Requesting ``days + 2`` forecast days (today + N + one extra) and dropping
   the extra from the frame. Two reasons, both real bugs before this change:
   ``night_min_ta`` is the night FOLLOWING a date, so the last requested day
   had too few night hours, came out NaN, and predict_for_date silently scored
   it as 0.0 C (D+5 looked cooler at night than it was). And the health layer
   decides whether a hot day is part of a >= 2-day heatwave from its
   neighbours, so the last displayed day needs a next day to look at.
"""
from __future__ import annotations

import asyncio

from dataclasses import dataclass

import numpy as np
import pandas as pd

from app.core.cache import TTLCache
from app.core.config import settings
from app.core.errors import NotFoundError
from app.core.htsi_path import ensure_htsi_importable
from app.core.labels import EvidenceLabel
from app.data import openmeteo, registry
from app.schemas.forecast import ForecastDay, ForecastResponse
from app.services import debt as debt_service
from app.services import ensemble, hap, health, index, score_calibration, thermal

ensure_htsi_importable()

from htsi.plan_a_standard_metrics import utci_heat_category  # noqa: E402

DEFAULT_FORECAST_DAYS = 5
MAX_FORECAST_DAYS = 7
DEFAULT_PAST_DAYS = 3  # real recent days, for debt/consecutive-day continuity — not shown in output
_LOOKAHEAD_DAYS = 1  # extra forecast day fetched then dropped — see module docstring, point 3

# The same plan_c columns the precomputed history frame carries, so the zone
# panel's debt card is populated for a forecast date, not just a historical one.
_DEBT_COLUMNS = (
    "phd",
    "debt_worker",
    "debt_elderly",
    "carry",
    "worker_hours_rectal_ge_limit",
    "iso7933_in_range_frac",
)

# §2.2: "cached with a 30-minute TTL". Keyed on (city_id, days): a new
# Open-Meteo pull only happens after the TTL expires, so issue time is
# implicitly the entry's own age.
_cache = TTLCache(ttl_seconds=settings.forecast_cache_ttl_minutes * 60)


@dataclass(frozen=True)
class LiveBundle:
    response: ForecastResponse
    frame: pd.DataFrame  # API-safe (None, not NaN): past days, today, lead 1..days
    hourly: pd.DataFrame  # the hourly physics frame the daily values were built from (services/hourly.py)
    daily_means: pd.Series  # includes the lookahead day, for the health layer's neighbour check


def _is_missing(x) -> bool:
    return x is None or (isinstance(x, float) and pd.isna(x))


async def get_bundle(city_id: str, days: int = DEFAULT_FORECAST_DAYS) -> LiveBundle:
    """Cached entry point. A cache hit skips the Open-Meteo call and the whole
    physics chain — the ~2s cold-request cost (network + ISO 7933 PHS / Gagge-Ji
    two-node simulation) happens once per (city, days) per TTL window.
    """
    return await _cache.get_or_set_async((city_id, days), lambda: _fetch_and_compute(city_id, days))


async def get_forecast(city_id: str, zone_id: str | None, days: int = DEFAULT_FORECAST_DAYS) -> ForecastResponse:
    bundle = await get_bundle(city_id, days)
    if zone_id is None:
        return bundle.response
    # zone_id is echoed, not yet used to differentiate the forecast: every zone
    # shares one city-level weather point (services/spatial.py COVERAGE_NOTE).
    return bundle.response.model_copy(update={"zone_id": zone_id})


def clear_cache() -> None:
    _cache.clear()
    _ward_cache.clear()


async def _fetch_and_compute(city_id: str, days: int) -> LiveBundle:
    city = registry.get_city(city_id)
    if city is None:
        raise NotFoundError(f"city {city_id!r} not found")

    raw = await openmeteo.fetch_forecast_hourly(
        city.lat,
        city.lon,
        city.tz,
        forecast_days=days + 1 + _LOOKAHEAD_DAYS,  # today (lead 0) + N future days + lookahead
        past_days=DEFAULT_PAST_DAYS,
    )
    # CPU-heavy physics (ISO 7933 PHS etc.): in a worker thread so the event loop keeps serving.
    return await asyncio.to_thread(_compute_bundle, city_id, raw, days, city.lat, city.lon, city.tz)


def _compute_bundle(city_id: str, raw: pd.DataFrame, days: int, lat: float, lon: float, tz: str) -> LiveBundle:
    """The whole physics chain for one point's hourly forecast (the city point, or one ward cell)."""
    city = registry.get_city(city_id)
    hourly = thermal.hourly_metrics(raw, lat, lon, tz)
    daily = thermal.to_daily(hourly)
    daily["date"] = daily["date"].astype(str)

    _, debt_daily = debt_service.compute_debt(hourly)
    debt_daily = debt_daily.copy()
    debt_daily["date"] = pd.to_datetime(debt_daily["date"]).dt.strftime("%Y-%m-%d")

    debt_cols = [c for c in _DEBT_COLUMNS if c in debt_daily.columns]
    merged = daily.merge(debt_daily[["date", *debt_cols]], on="date", how="left")

    thresholds = index.historical_thresholds()
    ta_max_p = float(thresholds["ta_max_p"].iloc[0]) if "ta_max_p" in thresholds.columns else None
    merged["X"] = (
        np.maximum(0.0, merged["ta_max"].to_numpy(dtype=float) - ta_max_p) if ta_max_p is not None else 0.0
    )

    merged = merged.sort_values("date").reset_index(drop=True)
    dates_sorted = pd.to_datetime(merged["date"])
    issue_date = dates_sorted.iloc[0] + pd.Timedelta(days=DEFAULT_PAST_DAYS)  # today, local
    merged["lead_day"] = (dates_sorted - issue_date).dt.days

    # The lookahead day has an incomplete following night, so it is unfit to
    # score — it stays only in daily_means, where its temperature is all the
    # health layer needs.
    merged = merged[merged["lead_day"] <= days].reset_index(drop=True)
    frame = merged.astype(object).where(pd.notnull(merged), None)  # NaN -> None, as store.load() does

    daily_means = health.daily_means_from_hourly(raw)

    out_days: list[ForecastDay] = []
    for _, row in frame.iterrows():
        lead = int(row["lead_day"])
        if lead < 1:
            continue  # past-history rows exist only to seed debt/consecutive-day state

        pred = ensemble.predict_for_date(frame, row["date"])
        utci = row.get("utci_max")
        day_health = health.assess(row["date"], daily_means, ta_max=row.get("ta_max"), hi_max=row.get("hi_max"))
        ta_max = row.get("ta_max")
        hap_decision = (
            None if _is_missing(ta_max)
            else hap.decide(float(ta_max), pred.risk_band, day_health, "Open-Meteo forecast")
        )
        out_days.append(
            ForecastDay(
                lead_day=lead,
                date=row["date"],
                ta_max_c=row.get("ta_max"),
                wbgt_max_c=row.get("wbgt_max"),
                utci_max_c=utci,
                night_min_ta_c=row.get("night_min_ta"),
                thermal_stress=None if _is_missing(utci) else utci_heat_category(utci),
                calibrated_score=pred.calibrated_score,
                risk_band=pred.risk_band,
                regime=pred.regime.value,
                dominant_driver=pred.dominant_driver,
                component_breakdown=pred.component_breakdown,
                health=day_health,
                hap_level=hap_decision.level if hap_decision else None,
                hap_basis=hap_decision.basis if hap_decision else None,
                score_mortality=score_calibration.for_score(pred.calibrated_score),
            )
        )

    issued_at = pd.Timestamp.now(tz=city.tz)
    response = ForecastResponse(
        evidence=EvidenceLabel.MEASURED_FORECAST,
        city=city_id,
        zone_id=None,
        issued_at=issued_at.isoformat(),
        issue_date=issue_date.strftime("%Y-%m-%d"),
        source="Open-Meteo forecast API",
        days=out_days,
    )
    return LiveBundle(response=response, frame=frame, daily_means=daily_means, hourly=hourly)


# ---------------------------------------------------------------- per-ward weather
#
# Open-Meteo is queried at every ward's centre in one request. Wards that fall in the same model
# grid cell get the same series (that is what the model says); each distinct cell is run through
# the same physics chain as the city point. Built on demand for live dates and cached like the
# city bundle.


@dataclass(frozen=True)
class WardWeather:
    bundles: dict[str, LiveBundle]  # cell key "lat,lon" -> bundle
    zone_cell: dict[str, str]  # zone_id -> cell key
    wards_in_cell: dict[str, int]


_ward_cache = TTLCache(ttl_seconds=settings.forecast_cache_ttl_minutes * 60)


def _ward_centres() -> list[tuple[str, float, float]]:
    import json

    fc = json.loads(settings.zones_geojson.read_text(encoding="utf-8"))
    return [
        (f["properties"]["zone_id"], float(f["properties"]["center_lat"]), float(f["properties"]["center_lon"]))
        for f in fc["features"]
    ]


async def get_ward_weather(city_id: str, days: int = DEFAULT_FORECAST_DAYS) -> WardWeather:
    return await _ward_cache.get_or_set_async((city_id, days), lambda: _fetch_ward_weather(city_id, days))


async def _fetch_ward_weather(city_id: str, days: int) -> WardWeather:
    city = registry.get_city(city_id)
    if city is None:
        raise NotFoundError(f"city {city_id!r} not found")
    centres = _ward_centres()
    results = await openmeteo.fetch_forecast_hourly_multi(
        [(lat, lon) for _, lat, lon in centres],
        city.tz,
        forecast_days=days + 1 + _LOOKAHEAD_DAYS,
        past_days=DEFAULT_PAST_DAYS,
    )
    bundles: dict[str, LiveBundle] = {}
    zone_cell: dict[str, str] = {}
    for (zone_id, _, _), (clat, clon, raw) in zip(centres, results):
        key = f"{clat},{clon}"
        if key not in bundles:
            bundles[key] = await asyncio.to_thread(_compute_bundle, city_id, raw, days, clat, clon, city.tz)
        zone_cell[zone_id] = key
    counts: dict[str, int] = {}
    for key in zone_cell.values():
        counts[key] = counts.get(key, 0) + 1
    return WardWeather(bundles=bundles, zone_cell=zone_cell, wards_in_cell=counts)


def clear_ward_cache() -> None:
    _ward_cache.clear()

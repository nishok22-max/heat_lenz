"""Open-Meteo forecast client — Stage 1, Path B (IMPLEMENTATION_PLAN.md §2.2, §4.2).

No API key. Live-tested shape (18 Sep 2026):
    GET https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..
        &hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,
                surface_pressure,shortwave_radiation,direct_radiation
        &wind_speed_unit=ms&timezone=Asia/Kolkata
        &forecast_days=7&past_days=3
    -> 200, hourly.time/temperature_2m/... arrays, 240 hourly rows for 3+7 days.

``past_days`` matters beyond padding the response: htsi.plan_c.compute_phd chains
heat debt hour-to-hour and day-to-day, so a forecast-only window starts debt at 0
on day 1 regardless of how hot the last few real nights were. Including a few
real recent days lets the debt carry-over be genuine for the forecast days shown,
at the cost of a few days the caller must trim from the output (forecast.py does
this — see its ``past_days`` handling). This is *not* the same as the multi-year
historical carry-over Phase 1 demos on 2010-2024 data; it is disclosed as such in
ForecastResponse.
"""
from __future__ import annotations

import asyncio

import httpx
import pandas as pd

from app.core.errors import UpstreamError

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
HOURLY_VARS = (
    "temperature_2m,relative_humidity_2m,wind_speed_10m,"
    "surface_pressure,shortwave_radiation,direct_radiation,cloud_cover"
)

# Column rename to match htsi.plan_a_standard_metrics.HOURLY_COLUMNS exactly.
_RENAME = {
    "temperature_2m": "ta",
    "relative_humidity_2m": "rh",
    "wind_speed_10m": "wind10",
    "surface_pressure": "pressure",
    "shortwave_radiation": "ghi",
    "direct_radiation": "direct",
    # Optional, display-only (the dashboard's weather icon); never used by the physics.
    "cloud_cover": "cloud_cover",
}

_MAX_ATTEMPTS = 3
_RETRY_BACKOFF_SECONDS = 1.0
_TIMEOUT_SECONDS = 10.0


async def _get_json(params: dict) -> dict | list:
    last_exc: Exception | None = None
    async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
        for attempt in range(1, _MAX_ATTEMPTS + 1):
            try:
                resp = await client.get(FORECAST_URL, params=params)
                resp.raise_for_status()
                return resp.json()
            except (httpx.HTTPError, ValueError) as exc:
                last_exc = exc
                if attempt < _MAX_ATTEMPTS:
                    await asyncio.sleep(_RETRY_BACKOFF_SECONDS * attempt)
    raise UpstreamError(f"Open-Meteo forecast failed after {_MAX_ATTEMPTS} attempts: {last_exc}")


def _to_frame(body: dict) -> pd.DataFrame:
    hourly = body.get("hourly")
    if not hourly or "time" not in hourly:
        raise UpstreamError("Open-Meteo forecast response missing 'hourly' data")

    df = pd.DataFrame(hourly).rename(columns=_RENAME)
    missing = [c for c in ("ta", "rh", "wind10", "pressure", "ghi", "direct") if c not in df.columns]
    if missing:
        raise UpstreamError(f"Open-Meteo forecast response missing columns: {missing}")

    df["time"] = pd.to_datetime(df["time"])  # local-naive, tz applied via the `timezone` param
    return df


async def fetch_forecast_hourly(
    lat: float,
    lon: float,
    tz: str,
    forecast_days: int = 7,
    past_days: int = 3,
) -> pd.DataFrame:
    """Live hourly weather, ``past_days`` real + ``forecast_days`` forecast.

    Returns a DataFrame with exactly htsi.plan_a's HOURLY_COLUMNS
    (time, ta, rh, wind10, pressure, ghi, direct), local-naive time — ready to
    pass straight into ``plan_a.compute_hourly``.
    """
    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": HOURLY_VARS,
        "wind_speed_unit": "ms",
        "timezone": tz,
        "forecast_days": forecast_days,
        "past_days": past_days,
    }
    body = await _get_json(params)
    if isinstance(body, list):
        body = body[0]
    return _to_frame(body)


async def fetch_forecast_hourly_multi(
    points: list[tuple[float, float]],
    tz: str,
    forecast_days: int = 7,
    past_days: int = 3,
) -> list[tuple[float, float, pd.DataFrame]]:
    """The same forecast at several points in ONE request (Open-Meteo accepts comma-separated
    latitude/longitude lists and returns one result per point). Each result carries the
    coordinates of the model grid cell the point was snapped to, so points in the same cell can
    be recognised as sharing one series. A single-object reply (one location) is applied to every
    point.
    """
    params = {
        "latitude": ",".join(f"{lat:.5f}" for lat, _ in points),
        "longitude": ",".join(f"{lon:.5f}" for _, lon in points),
        "hourly": HOURLY_VARS,
        "wind_speed_unit": "ms",
        "timezone": tz,
        "forecast_days": forecast_days,
        "past_days": past_days,
    }
    body = await _get_json(params)
    if not isinstance(body, list):
        # One location came back: every point shares it (one cell, one frame).
        lat = round(float(body.get("latitude", points[0][0])), 4)
        lon = round(float(body.get("longitude", points[0][1])), 4)
        frame = _to_frame(body)
        return [(lat, lon, frame) for _ in points]
    if len(body) != len(points):
        raise UpstreamError(f"Open-Meteo returned {len(body)} locations for {len(points)} points")
    return [
        (round(float(b.get("latitude", p[0])), 4), round(float(b.get("longitude", p[1])), 4), _to_frame(b))
        for b, p in zip(body, points)
    ]

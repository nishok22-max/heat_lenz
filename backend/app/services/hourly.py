"""Hour-by-hour heat for one day — the dashboard's exposure chart and "peak danger period".

No new physics: the same htsi.plan_a chain (Liljegren WBGT, UTCI, NWS Heat Index) the rest of
the app uses, applied to the same inputs:
- a live date (today .. D+5): the hourly frame from the cached Open-Meteo forecast pull
  (services/forecast.py LiveBundle.hourly);
- a historical date (2010-2024): the hourly Open-Meteo archive file the precomputed record was
  built from (datasets/open_meteo/ahmedabad_hourly_full_2010_2024_clean.csv).

The peak danger period is the span of hours with UTCI >= 38 C — "very strong heat stress" or
worse on the published UTCI assessment scale (Broede et al.; htsi.plan_a UTCI_HEAT_BANDS). If no
hour reaches it, there is no peak period and the response says so.
"""
from __future__ import annotations

from functools import lru_cache

import pandas as pd

from app.core.config import settings
from app.core.errors import NotFoundError
from app.core.labels import EvidenceLabel
from app.data import registry
from app.schemas.forecast import HourlyPoint, HourlyResponse
from app.services import forecast, thermal

PEAK_UTCI_C = 38.0
PEAK_RULE = "Hours with UTCI of 38 °C or more — 'very strong heat stress' or worse on the published UTCI scale."
_HISTORY_CSV = settings.datasets_dir / "open_meteo" / "ahmedabad_hourly_full_2010_2024_clean.csv"


@lru_cache(maxsize=1)
def _history_raw() -> pd.DataFrame:
    df = pd.read_csv(_HISTORY_CSV)
    df["date"] = df["time"].str[:10]
    return df


def _history_hourly(date: str, lat: float, lon: float, tz: str) -> pd.DataFrame | None:
    raw = _history_raw()
    day = raw[raw["date"] == date].drop(columns="date")
    if day.empty:
        return None
    return thermal.hourly_metrics(day.reset_index(drop=True), lat, lon, tz)


def _none(v):
    return None if v is None or pd.isna(v) else round(float(v), 1)


async def hourly_for_date(city_id: str, date: str) -> HourlyResponse:
    city = registry.get_city(city_id)
    if city is None:
        raise NotFoundError(f"city {city_id!r} not found")

    # History first: it is local, so the 2010 replay works offline and never waits on the network.
    hourly, source = _history_hourly(date, city.lat, city.lon, city.tz), "history"
    if hourly is None:
        live = (await forecast.get_bundle(city_id)).hourly
        live_dates = pd.to_datetime(live["time"]).dt.strftime("%Y-%m-%d")
        hourly, source = live[live_dates == date], "forecast"
    if hourly is None or hourly.empty:
        raise NotFoundError(f"no hourly data for {date!r}")

    t = pd.to_datetime(hourly["time"])
    points = [
        HourlyPoint(
            hour=int(ts.hour),
            ta_c=_none(r["ta"]),
            heat_index_c=_none(r["heat_index"]),
            wbgt_c=_none(r["wbgt"]),
            utci_c=_none(r["utci"]),
            utci_category=r["utci_category"] if isinstance(r["utci_category"], str) else None,
        )
        for ts, (_, r) in zip(t, hourly.iterrows())
    ]
    # The continuous run of qualifying hours around the day's hottest hour, so a brief dip is never
    # papered over by quoting first-to-last qualifying hour.
    hot: list[int] = []
    rated = [p for p in points if p.utci_c is not None]
    if rated and max(p.utci_c for p in rated) >= PEAK_UTCI_C:
        by_hour = {p.hour: p.utci_c for p in rated}
        top = max(rated, key=lambda p: p.utci_c).hour
        lo = hi = top
        while by_hour.get(lo - 1, -1) >= PEAK_UTCI_C:
            lo -= 1
        while by_hour.get(hi + 1, -1) >= PEAK_UTCI_C:
            hi += 1
        hot = list(range(lo, hi + 1))
    utci = [p.utci_c for p in points if p.utci_c is not None]
    ta = [p.ta_c for p in points if p.ta_c is not None]
    hi = [p.heat_index_c for p in points if p.heat_index_c is not None]
    cloud = None
    if "cloud_cover" in hourly.columns:
        day_hours = hourly[(t.dt.hour >= 6) & (t.dt.hour <= 18)]["cloud_cover"].dropna()
        cloud = round(float(day_hours.mean()), 0) if not day_hours.empty else None
    return HourlyResponse(
        evidence=EvidenceLabel.MODELLED_PUBLISHED,
        city=city_id,
        date=date,
        source=source,
        points=points,
        peak_start_hour=min(hot) if hot else None,
        peak_end_hour=max(hot) + 1 if hot else None,  # end of the last peak hour
        peak_rule=PEAK_RULE,
        max_utci_c=max(utci) if utci else None,
        max_ta_c=max(ta) if ta else None,
        min_ta_c=min(ta) if ta else None,
        max_heat_index_c=max(hi) if hi else None,
        daytime_cloud_cover_pct=cloud,
        basis=(
            "Open-Meteo hourly weather (forecast for live dates, archive reanalysis for 2010-2024) run "
            "through htsi.plan_a: Liljegren WBGT, UTCI (Broede 2012), NWS Heat Index. City-level: the same "
            "for every ward."
        ),
    )

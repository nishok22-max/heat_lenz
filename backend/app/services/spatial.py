"""Stage 3/4/5 orchestration — IMPLEMENTATION_PLAN.md §4.2, §5.2, §5.3.

Owns the zone concept and produces the map/detail payloads. Zone GEOMETRY is real: 48 AMC
ward boundaries (backend/scripts/build_wards.py; datasets/geo/README.md).

What differs between wards, and what does not:

* Weather, thermal indices and the HeatLens score: on live and forecast dates, the Open-Meteo
  forecast at each ward's centre (services/forecast.py get_ward_weather) - the 48 wards fall in
  8 model grid cells, so wards in one cell share values (ZoneRisk.weather_basis says which).
  On historical dates (the 2010-2024 record) there is one city-level point, identical for
  every ward.
* Surface temperature does differ, and is measured: every ward carries its own MODIS
  land-surface-temperature anomaly, day and night (backend/scripts/build_lst_offsets.py),
  in ``ZoneRisk.surface_temperature`` with evidence MEASURED_SATELLITE.
* Population differs too (services/exposure.py, JRC GHS-POP).

Earlier versions turned the surface anomaly into ward air temperature, WBGT, UTCI and score
changes with hand-set ratios (x0.65, x1.25, x6.5, an intensity scale) and filled wards
without satellite coverage from a made-up distance formula. None of those ratios had a
source, so all of them were removed: surface temperature (skin) and air temperature are
different quantities, and converting one into the other needs a locally fitted
relationship that does not exist yet.

Every function takes an optional ``ctx`` (services/frames.py). Left out, it means "the
precomputed 2010-2024 record". Routers pass the context ``frames.resolve`` found.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache

import pandas as pd

from app.core.config import settings
from app.core.errors import NotFoundError
from app.core.labels import EvidenceLabel
from app.schemas.health import HealthRisk
from app.schemas.risk import (
    DebtSnapshot,
    RiskZonesResponse,
    SurfaceTemperature,
    ZoneDetailResponse,
    ZoneHistoryPoint,
    ZoneRisk,
)
from app.schemas.thermal import ThermalSnapshot
from app.services import ensemble, explain, exposure, health, score_calibration
from app.services.frames import DayContext, history_context

COVERAGE_NOTE_LIVE = (
    "Zones are the 48 real AMC ward boundaries. On live and forecast dates each ward's weather, "
    "thermal indices and score come from the Open-Meteo forecast at that ward's centre: wards in the "
    "same model grid cell share values (see weather_basis on each ward). Each ward's MODIS ground "
    "temperature and ESA WorldCover land cover are measured separately."
)

COVERAGE_NOTE = (
    "Zones are the 48 real AMC ward boundaries (datasets/geo/README.md). Weather, thermal "
    "indices and the HeatLens score come from one city-level weather input, so they are the same "
    "for every ward: 48 ward centroids fall in 8 Open-Meteo model cells with a Tmax spread of "
    "0.3-1.3 C (measured 2026-09-22), and no measured source says how air temperature differs "
    "between wards. What does differ, and is measured, is each ward's MODIS land-surface "
    "temperature anomaly (surface_temperature, evidence MEASURED_SATELLITE) and its population "
    "(exposure.population_count). Surface temperature is not air temperature and is not "
    "converted into one."
)


@dataclass(frozen=True)
class Zone:
    zone_id: str
    name: str
    center_lat: float
    center_lon: float
    area_km2: float


@lru_cache(maxsize=1)
def _zones_geojson() -> dict:
    if not settings.zones_geojson.exists():
        raise NotFoundError(
            f"No zone geometry at {settings.zones_geojson}. "
            "Run backend/scripts/build_zones.py."
        )
    return json.loads(settings.zones_geojson.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def list_zones() -> tuple[Zone, ...]:
    fc = _zones_geojson()
    out = []
    for feat in fc["features"]:
        p = feat["properties"]
        out.append(
            Zone(
                zone_id=p["zone_id"],
                name=p["name"],
                center_lat=p["center_lat"],
                center_lon=p["center_lon"],
                area_km2=p["area_km2"],
            )
        )
    return tuple(out)


def get_zone(zone_id: str) -> Zone:
    for z in list_zones():
        if z.zone_id == zone_id:
            return z
    raise NotFoundError(f"zone {zone_id!r} not found")


def zones_geojson() -> dict:
    """Raw FeatureCollection, passed straight through for the map layer."""
    return _zones_geojson()


def zone_polygon_latlon(zone_id: str) -> list[tuple[float, float]]:
    """Outer ring of a zone as (lat, lon) pairs — GeoJSON stores (lon, lat), CAP wants (lat, lon)."""
    for feat in _zones_geojson()["features"]:
        if feat["properties"]["zone_id"] == zone_id:
            return [(lat, lon) for lon, lat in feat["geometry"]["coordinates"][0]]
    raise NotFoundError(f"zone {zone_id!r} not found")


LST_BASIS_TEMPLATE = (
    "MODIS land-surface temperature (MOD11A2/MYD11A2, 8-day, ~1 km), March-June {period}: "
    "{scenes_day} day and {scenes_night} night composites averaged, Microsoft Planetary Computer, "
    "anonymous access (backend/app/data/lst_offsets.json). City mean {day_mean:.1f} C day / "
    "{night_mean:.1f} C night. {support} This is surface skin temperature - how hot the ground "
    "and roofs get - not the 2 m air temperature the forecast uses, and it is not converted into one."
)
_SUPPORT = {
    "centre_inside": "This ward's value averages the pixels whose centre falls inside it.",
    "all_touched": (
        "This ward is smaller than one ~1 km pixel, so its value averages every pixel it overlaps - "
        "measured, but over a slightly larger area than the ward itself."
    ),
}


@lru_cache(maxsize=1)
def _lst_data() -> dict | None:
    """Real per-ward MODIS LST (backend/scripts/build_lst_offsets.py). None if the script has
    never been run (a fresh clone) - zones then carry no surface_temperature at all."""
    if not settings.lst_offsets_json.exists():
        return None
    return json.loads(settings.lst_offsets_json.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _all_anomalies() -> tuple[list[float], list[float]]:
    """Every ward's measured day and night ground anomaly, for "Nth hottest of 48" phrasing."""
    lst = _lst_data()
    if not lst:
        return [], []
    wards = [w for w in lst["wards"].values() if w.get("day") and w.get("night")]
    return [w["day"]["anomaly_c"] for w in wards], [w["night"]["anomaly_c"] for w in wards]


def surface_temperature(zone_id: str) -> SurfaceTemperature | None:
    """This ward's measured day and night LST, or None where either pass has no value -
    never a filled-in guess."""
    lst = _lst_data()
    ward = lst["wards"].get(zone_id) if lst else None
    if not ward or not ward.get("day") or not ward.get("night"):
        return None
    day, night = ward["day"], ward["night"]
    rules = {day.get("pixel_rule", "centre_inside"), night.get("pixel_rule", "centre_inside")}
    support = " ".join(_SUPPORT[r] for r in sorted(rules))
    return SurfaceTemperature(
        evidence=EvidenceLabel.MEASURED_SATELLITE,
        lst_day_c=day["lst_c"],
        lst_day_anomaly_c=day["anomaly_c"],
        lst_night_c=night["lst_c"],
        lst_night_anomaly_c=night["anomaly_c"],
        pixel_rule="all_touched" if "all_touched" in rules else "centre_inside",
        basis=LST_BASIS_TEMPLATE.format(
            period=lst["period"].split(" ")[0],
            scenes_day=lst["scenes_used_day"], scenes_night=lst["scenes_used_night"],
            day_mean=lst["city_mean_lst_day_c"], night_mean=lst["city_mean_lst_night_c"],
            support=support,
        ),
    )


def _score_to_band(score: float) -> str:
    if score >= 70.0:
        return "Extreme"
    if score >= 50.0:
        return "High"
    if score >= 30.0:
        return "Moderate"
    return "Low"


def _thermal_snapshot(row: pd.Series) -> ThermalSnapshot:
    def r(v):
        return round(v, 1) if v is not None else None

    return ThermalSnapshot(
        ta_max_c=r(row.get("ta_max")),
        wbgt_max_c=r(row.get("wbgt_max")),
        utci_max_c=r(row.get("utci_max")),
        night_min_ta_c=r(row.get("night_min_ta")),
    )


def _debt_snapshot(row: pd.Series) -> DebtSnapshot:
    dw = row.get("debt_worker")
    de = row.get("debt_elderly")
    carry = row.get("carry")
    return DebtSnapshot(
        evidence=EvidenceLabel.MODELLED_UNCALIBRATED,
        debt_worker=round(dw, 1) if dw is not None else None,
        debt_elderly=round(de, 1) if de is not None else None,
        carry=carry,
        worker_hours_rectal_ge_limit=row.get("worker_hours_rectal_ge_limit"),
        iso7933_in_range_frac=row.get("iso7933_in_range_frac"),
    )


def _daily_row(daily: pd.DataFrame, date: str) -> pd.Series:
    matches = daily.loc[daily["date"] == date]
    if matches.empty:
        raise NotFoundError(f"date {date!r} not found for this city")
    return matches.iloc[0]


def _health_for(row: pd.Series, date: str, ctx: DayContext) -> HealthRisk:
    return health.assess(date, ctx.daily_means, ta_max=row.get("ta_max"), hi_max=row.get("hi_max"))


HISTORY_WEATHER_BASIS = (
    "City-level weather record (one point, 23.03 N 72.58 E): on historical dates every ward shares "
    "these values. Per-ward forecasts are available for live dates."
)
CITY_FALLBACK_BASIS = "City-level Open-Meteo forecast (the per-ward forecast request was unavailable)."


def _zone_ctx(zone_id: str, ctx: DayContext) -> tuple[DayContext, str]:
    """The weather context for one ward: its own forecast cell on live dates, else the city's."""
    if ctx.zone_contexts and zone_id in ctx.zone_contexts:
        return ctx.zone_contexts[zone_id], (ctx.zone_basis or {}).get(zone_id, "")
    return ctx, HISTORY_WEATHER_BASIS if ctx.source == "history" else CITY_FALLBACK_BASIS


def _score_zone(zone: Zone, date: str, ctx: DayContext, _memo: dict | None = None) -> ZoneRisk:
    zctx, basis = _zone_ctx(zone.zone_id, ctx)
    key = id(zctx.frame)
    if _memo is not None and key in _memo:
        row, pred, health_risk = _memo[key]
    else:
        row = _daily_row(zctx.frame, date)
        pred = ensemble.predict_for_date(zctx.frame, date)
        health_risk = _health_for(row, date, zctx)
        if _memo is not None:
            _memo[key] = (row, pred, health_risk)
    risk = _zone_risk(zone, row, pred, health_risk)
    return risk.model_copy(update={"weather_basis": basis})


def _zone_risk(zone: Zone, row: pd.Series, pred, health_risk: HealthRisk) -> ZoneRisk:
    """Shared by map_payload, zone_detail and services/advisory.py — one place that knows how a
    HeatLensPrediction plus a daily row becomes a ZoneRisk. The thermal and score fields are the
    city's own; the ward's measured surface temperature and population ride alongside."""
    st = surface_temperature(zone.zone_id)
    lc = explain.land_cover(zone.zone_id)
    return ZoneRisk(
        evidence=EvidenceLabel.MODELLED_UNCALIBRATED,
        zone_id=zone.zone_id,
        name=zone.name,
        calibrated_score=round(pred.calibrated_score, 1),
        risk_band=_score_to_band(pred.calibrated_score),
        regime=pred.regime.value,
        dominant_driver=pred.dominant_driver,
        component_breakdown=dict(pred.component_breakdown),
        thermal=_thermal_snapshot(row),
        exposure=exposure.zone_exposure(zone.zone_id),
        health=health_risk,
        surface_temperature=st,
        land_cover=lc,
        why_hot=explain.why_hot(
            pred.dominant_driver,
            st.lst_day_anomaly_c if st else None,
            st.lst_night_anomaly_c if st else None,
            *_all_anomalies(),
            lc,
        ),
        score_mortality=score_calibration.for_score(round(pred.calibrated_score, 1)),
    )


@dataclass(frozen=True)
class CityTmax:
    value_c: float
    source: str


@lru_cache(maxsize=1)
def _station_tmax() -> dict[str, float]:
    if not settings.station_tmax_csv.exists():
        return {}
    df = pd.read_csv(settings.station_tmax_csv, dtype={"date": str})
    return dict(zip(df["date"], df["station_tmax_c"].astype(float)))


def city_ta_max(date: str, ctx: DayContext | None = None) -> CityTmax:
    """The city's daily max temperature for ``date``, which is what AMC's Heat Action Plan
    thresholds apply to — never a satellite-adjusted ward value.

    Historical date: the Ahmedabad airport station's measured max (NOAA GSOD) when it has a
    reading. backend/scripts/build_station_verification.py found the reanalysis runs ~1.6 C
    cool against this station and misses about half its alert days, so the thermometer is
    used wherever it exists. Live date: the Open-Meteo forecast, which scored close to
    unbiased against the same station at 1-5 days ahead.
    """
    ctx = ctx or history_context()
    if ctx.source == "history":
        observed = _station_tmax().get(date)
        if observed is not None:
            return CityTmax(round(observed, 1), "measured at Ahmedabad airport station, WMO 42647 (NOAA GSOD)")
        return CityTmax(
            float(_daily_row(ctx.frame, date)["ta_max"]),
            "Open-Meteo reanalysis - no station reading for this date; reads ~1.6 C below the station on average",
        )
    return CityTmax(float(_daily_row(ctx.frame, date)["ta_max"]), "Open-Meteo forecast")


def zone_risk_for_date(city_id: str, zone_id: str, date: str, ctx: DayContext | None = None) -> ZoneRisk:
    """Single zone, single date — the piece services/advisory.py needs without
    paying for zone_detail's history loop.
    """
    ctx = ctx or history_context()
    zone = get_zone(zone_id)  # raises NotFoundError if unknown
    return _score_zone(zone, date, ctx)


def map_payload(city_id: str, date: str, ctx: DayContext | None = None) -> RiskZonesResponse:
    ctx = ctx or history_context()
    _daily_row(ctx.frame, date)  # 404 early for an unknown date
    memo: dict = {}  # wards sharing a forecast cell share one scoring run
    zone_risks = [_score_zone(z, date, ctx, memo) for z in list_zones()]

    return RiskZonesResponse(
        evidence=EvidenceLabel.MODELLED_UNCALIBRATED,
        city=city_id,
        date=date,
        source=ctx.source,
        issued_at=ctx.issued_at,
        zone_count=len(zone_risks),
        coverage_note=COVERAGE_NOTE if not ctx.zone_contexts else COVERAGE_NOTE_LIVE,
        zones=zone_risks,
    )


def zone_detail(
    city_id: str, zone_id: str, date: str, history_days: int = 30, ctx: DayContext | None = None
) -> ZoneDetailResponse:
    ctx = ctx or history_context()
    zone = get_zone(zone_id)  # raises NotFoundError if unknown
    zctx, _ = _zone_ctx(zone_id, ctx)
    daily = zctx.frame.sort_values("date").reset_index(drop=True)
    row = _daily_row(daily, date)

    zone_risk = _score_zone(zone, date, ctx)

    dates = daily["date"].tolist()
    idx = dates.index(date)
    start = max(0, idx - history_days + 1)
    history: list[ZoneHistoryPoint] = []
    for i in range(start, idx + 1):
        d = dates[i]
        hrow = daily.iloc[i]
        hpred = ensemble.predict_for_date(daily, d)
        h_wbgt = hrow.get("wbgt_max")
        h_night = hrow.get("night_min_ta")
        history.append(
            ZoneHistoryPoint(
                date=d,
                calibrated_score=round(hpred.calibrated_score, 1),
                risk_band=_score_to_band(hpred.calibrated_score),
                phd=hrow.get("phd"),
                night_min_ta_c=round(h_night, 1) if h_night is not None else None,
                wbgt_max_c=round(h_wbgt, 1) if h_wbgt is not None else None,
            )
        )

    return ZoneDetailResponse(
        source=zctx.source,
        zone=zone_risk,
        history=history,
        debt=_debt_snapshot(row),
    )

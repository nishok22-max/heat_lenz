"""Risk / exposure / debt schemas — Stages 3, 4, 5. IMPLEMENTATION_PLAN.md §5.2, §5.3.

Every field that could mislead if taken at face value carries an EvidenceLabel
(§7.2) on the model it belongs to, not just on the response envelope, so a
consumer can distinguish "measured input" from "HeatLens's own uncalibrated
composite" field by field.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.core.labels import EvidenceLabel
from app.schemas.common import CALIBRATED_SCORE_NOTE, EvidencedModel
from app.schemas.health import HealthRisk
from app.schemas.thermal import ThermalSnapshot

# Where a date's inputs came from: the precomputed 2010-2024 record, or the live
# Open-Meteo pull (services/frames.py resolves which one a date belongs to).
DataSource = Literal["history", "forecast"]


class ZoneExposure(EvidencedModel):
    """Stage 4. ``evidence`` covers the elderly share (Census 2011 C-13, Ahmedabad
    district urban — real, but one figure for every ward). Population is a different
    kind of number (a published gridded model, JRC GHS-POP), so it carries its own
    ``population_evidence``; both are None only if the ward file hasn't been built.
    See services/exposure.py.
    """
    population_count: int | None
    population_density_per_km2: int | None = None
    population_evidence: EvidenceLabel | None = None
    population_status: str
    elderly_share_pct: float
    elderly_share_geography: str  # "district_urban": C-13 has no ward-level age table
    elderly_share_basis: str = ""


class ZoneGeometry(BaseModel):
    model_config = ConfigDict(frozen=True)

    zone_id: str
    name: str
    center_lat: float
    center_lon: float
    area_km2: float


class SurfaceTemperature(EvidencedModel):
    """This ward's own measured MODIS land-surface temperature (backend/scripts/
    build_lst_offsets.py), day and night, as a seasonal March-June mean and as an anomaly
    against the city mean. Surface skin temperature, not 2 m air temperature: it is shown as
    what it is and is not converted into air temperature, WBGT, UTCI or score.
    ``pixel_rule`` says whether the value averages pixels centred inside the ward
    ("centre_inside") or, for a ward smaller than a pixel, every pixel it overlaps
    ("all_touched")."""
    lst_day_c: float
    lst_day_anomaly_c: float
    lst_night_c: float
    lst_night_anomaly_c: float
    pixel_rule: Literal["centre_inside", "all_touched"]
    basis: str


class LandCover(EvidencedModel):
    """What the ward's ground is made of (ESA WorldCover 2021, 10 m), with the city average and
    how strongly each land type goes with ground temperature across the 48 wards (Pearson r).
    services/explain.py uses this to say, in plain words, why a ward runs hot or cool."""
    built_up_pct: float
    trees_pct: float
    grass_shrub_pct: float
    cropland_pct: float
    bare_pct: float
    water_pct: float
    city_built_up_pct: float
    city_trees_pct: float
    city_cropland_pct: float
    city_water_pct: float
    r_built_up_night: float
    r_trees_day: float
    r_trees_night: float
    r_cropland_night: float
    r_water_day: float
    basis: str


class ScoreMortality(EvidencedModel):
    """What a HeatLens score meant in deaths in May 2010 (services/score_calibration.py): deaths as a
    multiple of a normal May day, with a 95 % bootstrap interval. Only inside the range of scores seen
    that month; outside it the ratio fields are None and ``in_calibrated_range`` is False."""
    in_calibrated_range: bool
    death_ratio: float | None
    ci_low: float | None
    ci_high: float | None
    calibrated_range: tuple[float, float]
    basis: str


class ZoneRisk(EvidencedModel):
    """One zone, one date. The Stage 6 ensemble output plus its Stage 2/4 inputs.

    ``thermal``, ``calibrated_score``, ``risk_band`` and ``component_breakdown`` are the
    city's own values, the same for every ward (services/spatial.py). What is specific to
    the ward is ``surface_temperature`` (measured) and ``exposure`` (population).
    """
    zone_id: str
    name: str
    calibrated_score: float = Field(
        description=CALIBRATED_SCORE_NOTE
    )
    risk_band: str
    regime: str
    dominant_driver: str
    component_breakdown: dict[str, float]
    thermal: ThermalSnapshot
    exposure: ZoneExposure
    health: HealthRisk
    surface_temperature: SurfaceTemperature | None = None
    land_cover: LandCover | None = None
    # Plain-English reasons this ward is hot today (services/explain.py) - built only from the
    # measured values above and today's weather; empty if none apply.
    why_hot: list[str] = Field(default_factory=list)
    # Where this ward's weather, thermal indices and score come from (services/spatial.py): its own
    # forecast grid cell on live dates, the city-level record on historical dates.
    weather_basis: str = ""
    score_mortality: ScoreMortality | None = None


class RiskZonesResponse(EvidencedModel):
    """GET /risk/zones — IMPLEMENTATION_PLAN.md §5.2.

    The weather input is one city-level point (measured 2026-09-22: 48 ward centroids
    resolve to 8 Open-Meteo model cells, Tmax spread 0.3-1.3 C — services/spatial.py's
    COVERAGE_NOTE), so thermal fields and scores are the same for every ward. What differs
    between wards is measured: ``surface_temperature`` (MODIS) and ``exposure``
    (population).

    ``source`` says whether ``date`` was served from the 2010-2024 record or the
    live forecast; ``issued_at`` is set only for the latter.
    """
    city: str
    date: str
    source: DataSource
    issued_at: str | None
    zone_count: int
    coverage_note: str
    zones: list[ZoneRisk]


class DebtSnapshot(EvidencedModel):
    """Stage 5, Plan C. Already computed in results/ahmedabad_daily_2010_2024.csv —
    this schema is a pass-through, not new science.
    """
    debt_worker: float | None
    debt_elderly: float | None
    carry: float | None
    worker_hours_rectal_ge_limit: float | None
    iso7933_in_range_frac: float | None


class ZoneHistoryPoint(BaseModel):
    """One day of the city-level trend shown on a zone's page (the same series for every
    ward - services/spatial.py). No evidence field of its own: the zone's ``ZoneRisk``
    carries the labels for the fields it shares with this point.
    """
    model_config = ConfigDict(frozen=True)

    date: str
    calibrated_score: float
    risk_band: str
    phd: float | None
    night_min_ta_c: float | None
    wbgt_max_c: float | None


class ZoneDetailResponse(BaseModel):
    """GET /risk/zones/{zone_id} — IMPLEMENTATION_PLAN.md §5.3."""
    model_config = ConfigDict(frozen=True)

    source: DataSource
    zone: ZoneRisk
    history: list[ZoneHistoryPoint]
    debt: DebtSnapshot

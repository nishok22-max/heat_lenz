"""Stage 6 forecast schemas — IMPLEMENTATION_PLAN.md §5.4.

``thermal_stress`` is real UTCI category output
(htsi.plan_a.utci_heat_category), not a value duplicating ``risk_band`` under a
second name. ``health`` is the Stage 5 mortality risk for that day (R3): a
published relative risk with its confidence interval — never a death count
(schemas/health.py explains why).
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import CALIBRATED_SCORE_NOTE, EvidencedModel
from app.schemas.alerts import HapLevel
from app.schemas.health import HealthRisk
from app.schemas.risk import ScoreMortality


class ForecastDay(BaseModel):
    model_config = ConfigDict(frozen=True)

    lead_day: int
    date: str
    ta_max_c: float | None
    wbgt_max_c: float | None
    utci_max_c: float | None
    night_min_ta_c: float | None
    thermal_stress: str | None  # UTCI category — a Stage 2 signal, distinct from risk_band
    calibrated_score: float = Field(
        description=CALIBRATED_SCORE_NOTE
    )
    risk_band: str
    regime: str
    dominant_driver: str
    component_breakdown: dict[str, float]
    health: HealthRisk
    # AMC Heat Action Plan colour level for this day's city max temperature (services/hap.py).
    hap_level: HapLevel | None = None
    hap_basis: str | None = None
    score_mortality: ScoreMortality | None = None


class HourlyPoint(BaseModel):
    model_config = ConfigDict(frozen=True)

    hour: int  # local hour of day, 0-23
    ta_c: float | None
    heat_index_c: float | None
    wbgt_c: float | None
    utci_c: float | None
    utci_category: str | None


class HourlyResponse(EvidencedModel):
    """One day hour by hour (services/hourly.py). City-level: the same for every ward."""

    city: str
    date: str
    source: str  # "forecast" or "history"
    points: list[HourlyPoint]
    peak_start_hour: int | None
    peak_end_hour: int | None
    peak_rule: str
    max_utci_c: float | None
    max_ta_c: float | None
    min_ta_c: float | None
    max_heat_index_c: float | None
    # Mean cloud cover 06:00-18:00, % (Open-Meteo forecast). None for historical dates: the
    # 2010-2024 archive file has no cloud column, and nothing is filled in for it.
    daytime_cloud_cover_pct: float | None
    basis: str


class ForecastResponse(EvidencedModel):
    city: str
    zone_id: str | None
    issued_at: str
    issue_date: str  # local calendar date of lead_day 0 ("today") — what /risk/zones accepts for the live map
    source: str
    days: list[ForecastDay]

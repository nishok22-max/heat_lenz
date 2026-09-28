"""Methods-page schemas — IMPLEMENTATION_PLAN.md §5.7.

The point of this endpoint is that "is this validated?" has a URL for an answer
instead of a scramble. ``index_calibrated_against_health_outcomes`` is False
until ``scripts/run_validation.py`` has been run on REAL outcome data; a run on
synthetic data is refused persistence, so it can never flip this flag.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.schemas.health import HealthModelInfo

LedgerStatus = Literal[
    "MEASURED_POINT",
    "MEASURED_CENSUS",
    "MEASURED_FORECAST",
    "MEASURED_GEODATA",  # real third-party open geographic data (e.g. ward boundaries) - not
                         # weather, not census counts, not modelled; its own ledger-only category
    "MEASURED_SATELLITE",  # real remote-sensing observation (e.g. MODIS land-surface temperature)
    "MODELLED_PUBLISHED",
    "MODELLED_UNCALIBRATED",
    "MODELLED_CALIBRATED",  # fitted to real local health outcomes (limited: see the row's note)
    "ILLUSTRATIVE",  # demo-only pattern, disclosed as such, never presented as measured/modelled
    "NOT_AVAILABLE",
]


class LedgerEntry(BaseModel):
    model_config = ConfigDict(frozen=True)

    component: str
    status: LedgerStatus
    basis: str
    note: str
    # Plain-language name for the Methods page; ``component`` stays the stable identifier.
    title: str | None = None
    # Repository files that produce or hold this item, listed apart from the prose.
    code: list[str] = []


class EvidenceLedger(BaseModel):
    model_config = ConfigDict(frozen=True)

    entries: list[LedgerEntry]


class BenchmarkTable(BaseModel):
    model_config = ConfigDict(frozen=True)

    key: str
    title: str
    columns: list[str]
    rows: list[dict[str, float | str]]


class Benchmark(BaseModel):
    """Parsed from results/benchmark_report.md, the repo's own structural benchmark."""

    model_config = ConfigDict(frozen=True)

    scope: str
    tables: list[BenchmarkTable]
    limitations: list[str]


class OutcomeValidation(BaseModel):
    model_config = ConfigDict(frozen=True)

    status: Literal["not_run", "completed"]
    data_source: str | None
    evidence_status: str | None
    report: dict | None
    how_to_run: str


class VerificationScore(BaseModel):
    """Model daily max temperature minus the station's, over March-June days both have."""

    model_config = ConfigDict(frozen=True)

    n_days: int
    bias_c: float
    mae_c: float
    rmse_c: float
    pearson_r: float
    amc_level_agreement_pct: float
    station_alert_days: int
    station_alert_days_model_missed: int


class StationVerification(BaseModel):
    """backend/scripts/build_station_verification.py: HeatLens's temperature inputs against the
    Ahmedabad airport station (NOAA GSOD)."""

    model_config = ConfigDict(frozen=True)

    station_name: str
    source: str
    season: str
    retrieved: str
    caveats: list[str]
    history_model: str
    history: VerificationScore
    forecast_model: str
    forecast_leads: dict[str, VerificationScore]


class ValidationStatus(BaseModel):
    model_config = ConfigDict(frozen=True)

    index_calibrated_against_health_outcomes: bool
    reason: str
    what_was_tested: list[str]
    what_was_not_tested: list[str]
    benchmark: Benchmark
    health_model: HealthModelInfo
    outcome_validation: OutcomeValidation
    station_verification: StationVerification | None
    # results/score_calibration.json (backend/scripts/calibrate_score.py), served as written.
    score_calibration: dict | None = None

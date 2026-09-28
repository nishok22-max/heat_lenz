"""In-memory warm store, loaded once at app startup (see app/main.py's lifespan).

Holds the precomputed daily frame (results/ahmedabad_daily_2010_2024.csv, or its
parquet cache) and a single fitted CalibratedHeatLensEnsemble. Fitting the
ensemble is a LogisticRegression over the whole daily frame — doing it per
request would be the first performance bug, per IMPLEMENTATION_PLAN.md §4.1.
"""
from __future__ import annotations

import json
import warnings

import pandas as pd

from app.core.config import settings
from app.core.htsi_path import ensure_htsi_importable

ensure_htsi_importable()


_daily: pd.DataFrame | None = None  # API-safe: NaN -> None (§4.3, §9)
_daily_numeric: pd.DataFrame | None = None  # real floats/NaN, for sklearn/quantile math
_ensemble = None  # type: ignore[var-annotated]
_health_coefficients: dict | None = None


def _read_daily_raw() -> pd.DataFrame:
    if settings.daily_parquet.exists():
        return pd.read_parquet(settings.daily_parquet)
    if settings.daily_csv.exists():
        return pd.read_csv(settings.daily_csv)
    raise FileNotFoundError(
        f"No daily data found at {settings.daily_parquet} or {settings.daily_csv}. "
        "Run backend/scripts/precompute.py or check datasets are present."
    )


def load() -> None:
    """Load the daily frame from parquet if present, else the source CSV.

    Falls back to the CSV transparently — the parquet cache (built by
    scripts/precompute.py) is a startup-time optimisation, not a hard
    dependency, so a fresh checkout still works before precompute has run.

    Keeps two copies: ``_daily_numeric`` (real NaN, for pandas/sklearn math —
    quantiles, model fitting) and ``_daily`` (NaN converted to Python None, so
    it can never serialise as a bare `NaN` in a JSON response — §4.3, §9).
    Phase 0/1 code only needed the latter; Phase 2's index.py threshold
    computation needs the former, which is why this split now exists as a
    named accessor instead of being reloaded ad hoc (as fit_ensemble() did
    before this refactor).
    """
    global _daily, _daily_numeric
    raw = _read_daily_raw()
    _daily_numeric = raw

    safe = raw.astype(object).where(pd.notnull(raw), None)
    # Re-parse date as a plain string column (comparisons in services use string
    # dates from the API, matching the CSV's own "YYYY-MM-DD" format).
    if "date" in safe.columns:
        safe["date"] = safe["date"].astype(str)
    _daily = safe

    if settings.health_coefficients_json.exists():
        global _health_coefficients
        _health_coefficients = json.loads(
            settings.health_coefficients_json.read_text(encoding="utf-8")
        )


def daily_frame() -> pd.DataFrame:
    if _daily is None:
        raise RuntimeError("Warm store not loaded — call store.load() at startup.")
    return _daily


def numeric_daily_frame() -> pd.DataFrame:
    """Real NaN, not None — for quantiles/model fitting, never for API responses."""
    if _daily_numeric is None:
        raise RuntimeError("Warm store not loaded — call store.load() at startup.")
    return _daily_numeric


def health_coefficients() -> dict:
    if _health_coefficients is None:
        raise RuntimeError(
            "Health coefficients not loaded — check datasets/health/exposure_response_india.json exists."
        )
    return _health_coefficients


def fit_ensemble():
    """Fit the Plan D ensemble once, on the full precomputed daily frame."""
    global _ensemble
    from htsi.plan_d_ensemble import CalibratedHeatLensEnsemble

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        ensemble = CalibratedHeatLensEnsemble()
        ensemble.fit(numeric_daily_frame(), label_col="imd_heatwave")
    _ensemble = ensemble
    return _ensemble


def ensemble():
    if _ensemble is None:
        raise RuntimeError("Ensemble not fitted — call store.fit_ensemble() at startup.")
    return _ensemble


def clear() -> None:
    global _daily, _daily_numeric, _ensemble, _health_coefficients
    _daily = None
    _daily_numeric = None
    _ensemble = None
    _health_coefficients = None

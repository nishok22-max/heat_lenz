"""Run plan_b.compare_indices() on REAL daily outcomes — IMPLEMENTATION_PLAN.md §8 Phase 4.

This is the one thing that would move HeatLens from "uncalibrated model" to a
tested claim, and it cannot be done today because no daily mortality or
admissions series for Ahmedabad is held. It is wired now so that the day one
arrives the result is a single command, published win or lose:

    python backend/scripts/run_validation.py --outcomes daily_deaths.csv --source "<who, period>"

Two rules are enforced here rather than left to the operator:

* A ``data_source`` containing "synthetic" is run (plan_b stamps it NOT EVIDENCE)
  but REFUSED persistence, so a plumbing test can never reach the Methods page.
* The result is written whether or not HTSI beat the baselines. Reporting only
  favourable runs is the failure mode this hook exists to prevent.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from app.core.htsi_path import ensure_htsi_importable

ensure_htsi_importable()

from htsi.plan_b_htsi import compare_indices, local_thresholds  # noqa: E402

MIN_OVERLAP_DAYS = 200  # below this the leave-one-year-out fits are not meaningful


class SyntheticSourceError(ValueError):
    """Raised when asked to persist a result whose data_source says it is synthetic."""


def build_panel(outcomes: pd.DataFrame, daily: pd.DataFrame, population: float | None = None) -> pd.DataFrame:
    """Join daily outcomes onto the daily weather/index frame.

    ``outcomes`` needs ``date`` and ``deaths``; ``population`` may be a column or
    the argument. Only dates present in BOTH frames are kept — the daily frame is
    March-June, so outcomes outside that window simply drop out.
    """
    missing = [c for c in ("date", "deaths") if c not in outcomes.columns]
    if missing:
        raise ValueError(f"outcomes file is missing columns: {missing}")
    if "population" not in outcomes.columns and population is None:
        raise ValueError("population is required: add a 'population' column or pass population=")

    o = outcomes.copy()
    o["date"] = pd.to_datetime(o["date"])
    if "population" not in o.columns:
        o["population"] = float(population)  # type: ignore[arg-type]

    d = daily.copy()
    d["date"] = pd.to_datetime(d["date"])
    panel = d.merge(o[["date", "deaths", "population"]], on="date", how="inner")
    if len(panel) < MIN_OVERLAP_DAYS:
        raise ValueError(
            f"only {len(panel)} days overlap between outcomes and the daily frame "
            f"(need >= {MIN_OVERLAP_DAYS}); the frame covers March-June 2010-2024."
        )
    return panel


def run_comparison(
    outcomes: pd.DataFrame,
    daily: pd.DataFrame,
    data_source: str,
    population: float | None = None,
    n_boot: int = 200,
) -> dict:
    """Run compare_indices and return a JSON-safe summary."""
    panel = build_panel(outcomes, daily, population)
    thresholds = local_thresholds(daily.assign(date=pd.to_datetime(daily["date"])))
    report = compare_indices(panel, thresholds, data_source=data_source, n_boot=n_boot)

    return {
        "data_source": report.data_source,
        "evidence_status": report.evidence_status,
        "best_baseline": report.best_baseline,
        "any_htsi_beats_best_baseline": report.any_htsi_beats_best_baseline,
        "n_days": int(len(panel)),
        "period": [str(panel["date"].min().date()), str(panel["date"].max().date())],
        "table": _records(report.table),
        "htsi_vs_best": _records(report.htsi_vs_best),
        "notes": [str(n) for n in report.notes],
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def persist(result: dict, path: Path) -> None:
    """Write a result for the Methods page. Refuses anything not from real data."""
    if "synthetic" in str(result.get("data_source", "")).lower():
        raise SyntheticSourceError(
            "Refusing to persist a result whose data_source is synthetic: it is not evidence "
            "and must never reach the Methods page."
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, indent=2), encoding="utf-8")


def _records(df: pd.DataFrame) -> list[dict]:
    """DataFrame -> list of dicts with numpy scalars as Python numbers and NaN as None."""
    out = []
    for rec in df.to_dict("records"):
        clean = {}
        for k, v in rec.items():
            if isinstance(v, (np.floating, float)):
                clean[k] = None if not np.isfinite(v) else float(v)
            elif isinstance(v, np.integer):
                clean[k] = int(v)
            elif isinstance(v, np.bool_):
                clean[k] = bool(v)
            else:
                clean[k] = v
        out.append(clean)
    return out

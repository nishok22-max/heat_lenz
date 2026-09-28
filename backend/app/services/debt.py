"""Stage 5 wrapper (Plan C) — IMPLEMENTATION_PLAN.md §4.2.

Wraps plan_c.compute_phd for the daily debt frame, plus a ``night_recovery``
helper so the UI can show *why* debt accumulated: a hot indoor night raises
the carry-forward fraction, so the next day's debt starts from most of
yesterday's rather than zero (htsi/plan_c_heat_debt.py::carry_from_night).
"""
from __future__ import annotations

import pandas as pd

from app.core.htsi_path import ensure_htsi_importable

ensure_htsi_importable()

from htsi.plan_c_heat_debt import (  # noqa: E402
    carry_from_night,
    compute_phd,
    indoor_climate,
    night_min_by_date,
)

__all__ = ["compute_debt", "night_recovery"]


def compute_debt(hourly: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Returns (hourly frame with indoor/body-state columns, daily frame with PHD)."""
    return compute_phd(hourly)


def night_recovery(hourly: pd.DataFrame) -> pd.DataFrame:
    """Per-date indoor night minimum and the resulting carry-forward fraction.

    ``carry_fraction`` of 0 means a fully cool night (no debt carried into the
    next day); ``carry_max`` (plan_c's DebtParams default) means the night
    never cooled enough for any recovery credit.
    """
    indoor = indoor_climate(hourly)
    night_min = night_min_by_date(indoor["time"], indoor["ta_in"])
    carry = carry_from_night(night_min.to_numpy())
    return pd.DataFrame(
        {
            "date": night_min.index.astype(str),
            "night_min_indoor_ta_c": night_min.to_numpy(),
            "carry_fraction": carry,
        }
    )

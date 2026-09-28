"""Stage 2 wrapper — IMPLEMENTATION_PLAN.md §4.2.

Translation layer only: validates input shape and turns plan_a's bare
ValueError into a domain ValidationError the router maps to 422. No physics
is re-implemented here.
"""
from __future__ import annotations

import pandas as pd

from app.core.errors import ValidationError
from app.core.htsi_path import ensure_htsi_importable

ensure_htsi_importable()

from htsi.plan_a_standard_metrics import HOURLY_COLUMNS, compute_hourly, daily_summary  # noqa: E402


def hourly_metrics(df: pd.DataFrame, lat: float, lon: float, tz: str) -> pd.DataFrame:
    missing = [c for c in HOURLY_COLUMNS if c not in df.columns]
    if missing:
        raise ValidationError(f"hourly weather missing columns: {missing}")
    return compute_hourly(df, lat=lat, lon=lon, tz=tz)


def to_daily(hourly: pd.DataFrame) -> pd.DataFrame:
    return daily_summary(hourly)

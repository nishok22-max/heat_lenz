"""Stage 6 wrapper — IMPLEMENTATION_PLAN.md §4.2.

Phase 2 only needs the local percentile thresholds (``local_thresholds``), used
to compute the dry-heat correction ``X`` for forecast days — see forecast.py.
The full HTSI composite (compute_components/compute_htsi) isn't consumed by
plan_d.predict_row and isn't wired into any response yet; the functions are
imported and exposed for Phase 4's compare_indices() work, not called here.
"""
from __future__ import annotations

from functools import lru_cache

import pandas as pd

from app.core.htsi_path import ensure_htsi_importable
from app.data import store

ensure_htsi_importable()

from htsi.plan_b_htsi import compute_components, compute_htsi, local_thresholds  # noqa: E402

__all__ = ["compute_components", "compute_htsi", "local_thresholds", "historical_thresholds"]

DEFAULT_PERCENTILE = 90.0  # matches local_thresholds' own default and scripts/run_on_datasets.py's usage


@lru_cache(maxsize=8)
def historical_thresholds(percentile: float = DEFAULT_PERCENTILE) -> pd.DataFrame:
    """Local WBGT/night/Tmax/UTCI percentile thresholds from the precomputed
    15-year (2010-2024, Mar-Jun) daily frame — a baseline climatology, never
    the forecast itself, per local_thresholds' own docstring.
    """
    return local_thresholds(store.numeric_daily_frame(), percentile=percentile)

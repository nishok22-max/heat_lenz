"""Stage 6/7 ensemble wrapper — IMPLEMENTATION_PLAN.md §4.2.

Thin by design: the only real logic here is ``consecutive_hot_days``, which
``classify_regime`` needs to detect the CUMULATIVE_DEBT regime (the project's
differentiator). Everything else delegates straight to
``plan_d.CalibratedHeatLensEnsemble.predict_row``.
"""
from __future__ import annotations

import pandas as pd

from app.core.errors import NotFoundError
from app.data import store

DRY_HEAT_TA_MAX_THRESHOLD_C = 40.0  # matches plan_d.classify_regime's default


def consecutive_hot_days(daily: pd.DataFrame, date: str, threshold: float = DRY_HEAT_TA_MAX_THRESHOLD_C) -> int:
    """Count consecutive PRIOR calendar days (not including ``date``) with ta_max >= threshold.

    Mirrors classify_regime's own parameter doc: "Number of preceding
    consecutive days with ta_max >= 40 C." Walks backward by actual calendar
    date (Timedelta(days=1)), not by row position — the precomputed Ahmedabad
    frame has a real gap between seasons (30 June -> 1 March next year), and
    an earlier version of this function walked positionally, which happened
    to give the right answer only because ta_max is empirically never >=40C
    on the last day of June or the first days of March in this dataset (see
    IMPLEMENTATION_PLAN.md's Phase 2 notes) — a coincidence of the data, not
    a guarantee, and the wrong thing to rely on. Matches plan_c's own
    accumulate_debt, which makes the same date-adjacency check explicitly.
    """
    d = daily.sort_values("date").reset_index(drop=True)
    dates = pd.to_datetime(d["date"])
    try:
        idx = int(d.index[d["date"] == date][0])
    except IndexError:
        raise NotFoundError(f"date {date!r} not found in daily frame")

    ta_max = d["ta_max"].tolist()
    count = 0
    i = idx - 1
    while i >= 0:
        if dates.iloc[i + 1] - dates.iloc[i] != pd.Timedelta(days=1):
            break
        val = ta_max[i]
        if val is None or (isinstance(val, float) and pd.isna(val)) or val < threshold:
            break
        count += 1
        i -= 1
    return count


def predict_for_date(daily: pd.DataFrame, date: str):
    """Run the fitted ensemble for a single date. Returns a
    ``htsi.plan_d_ensemble.HeatLensPrediction``.
    """
    row = daily.loc[daily["date"] == date]
    if row.empty:
        raise NotFoundError(f"date {date!r} not found in daily frame")
    r = row.iloc[0]

    def _num(x, default=0.0):
        return default if x is None or (isinstance(x, float) and pd.isna(x)) else float(x)

    chd = consecutive_hot_days(daily, date)

    return store.ensemble().predict_row(
        ta_max=_num(r["ta_max"]),
        tw_max=_num(r["tw_max"]),
        night_min_ta=_num(r["night_min_ta"]),
        utci_max=_num(r["utci_max"]),
        wbgt_max=_num(r["wbgt_max"]),
        htsi_x=_num(r.get("X")),
        phd_debt=_num(r.get("phd")),
        consecutive_hot_days=chd,
        date_str=date,
    )

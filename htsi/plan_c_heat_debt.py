"""Plan C - Physiological Heat Debt (PHD).

STATUS: DESIGN, UNCALIBRATED. Every threshold marked "assumption" below is a placeholder to be
calibrated or replaced with measurements. No claim of superiority is allowed until
``plan_b_htsi.compare_indices`` on real daily health outcomes shows a held-out improvement.

Why a body simulation: in hot-dry air heat balance is limited by sustaining high sweat rates, and the
resulting dehydration and plasma-volume loss raise cardiovascular strain; older adults sweat less and
store more heat (reviews: https://pmc.ncbi.nlm.nih.gov/articles/PMC12481594/ ,
https://www.thelancet.com/journals/lancet/article/PIIS0140-6736(21)01208-3/fulltext). WBGT-based scores
missed the dry May 2010 Ahmedabad heatwave, so Plan C tracks water loss and core temperature directly.

Pipeline (hourly input = output of ``plan_a_standard_metrics.compute_hourly``)
1. Indoor exposure - first-order thermal lag plus roof solar gain. Assumption anchored to reports that
   Indian informal-housing indoor temperatures run about 4-6 degC above outdoor in summer
   (https://india.mongabay.com/2025/01/when-heat-rises-incomes-fall-for-the-informal-workforce/).
   Vapour pressure is conserved indoors.
2. Body simulation, chained hour to hour so the body state carries forward:
   * outdoor worker - ISO 7933:2023 Predicted Heat Strain (``pythermalcomfort.models.phs``) during work
     hours: rectal temperature and sweat loss.
   * older adult at home - Ji et al. (2022) two-node model for older people
     (``pythermalcomfort.models.two_nodes_gagge_ji``, https://doi.org/10.1007/s12273-022-0890-3) for core
     temperature, run continuously day and night; sweat loss from ISO 7933 PHS at rest (approximation:
     PHS is validated for healthy workers, not older adults).
3. Daily load per persona, normalised by ISO 7933 limits as implemented in pythermalcomfort:
   rectal temperature 38 degC; water loss 5 % of body mass when drinking is allowed (2023 edition).
4. Heat debt - debt_t = load_t + carry_t * debt_(t-1); carry grows when the indoor night stays hot
   (assumption: no recovery credit above ``night_hot_c``, full recovery below ``night_cool_c``).
5. Population score - persona weights (replace with ward Census shares) -> PHD 0-100.

Validation: pass ``phd_raw`` as a candidate column to ``plan_b_htsi.compare_indices``.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from pythermalcomfort.models import phs, two_nodes_gagge_ji

__all__ = [
    "IndoorParams",
    "WorkerParams",
    "ElderlyParams",
    "DebtParams",
    "PHDParams",
    "indoor_climate",
    "night_min_by_date",
    "carry_from_night",
    "accumulate_debt",
    "score_from_raw",
    "compute_phd",
]

HPA_TO_TORR = 0.750062
ISO7933_RECTAL_LIMIT_C = 38.0        # d_lim_t_re trigger in pythermalcomfort phs (ISO 7933)
ISO7933_WATER_LIMIT_FRAC = 0.05      # ISO 7933:2023, drink = 1 (pythermalcomfort phs source)
JI_INITIAL_CORE_C = 36.49            # two_nodes_gagge_ji defaults
JI_INITIAL_SKIN_C = 36.8
PHS_STATE = ("t_sk", "t_cr", "t_re", "t_cr_eq", "t_sk_t_cr_wg", "sweat_rate_watt", "evap_load_wm2_min")


# --------------------------------------------------------------------------- parameters
@dataclass(frozen=True)
class IndoorParams:
    tau_hours: float = 3.0              # assumption: indoor air response time
    roof_gain_c_per_kw: float = 6.0     # assumption: degC added per 1000 W/m2 of sunshine (reported 4-6 degC excess)
    radiant_excess_c: float = 2.0       # assumption: hot-roof radiant temperature above indoor air at full sun
    air_speed: float = 0.2              # m/s, still indoor air (no fan)

    def __post_init__(self):
        if self.tau_hours <= 0 or self.roof_gain_c_per_kw < 0 or self.radiant_excess_c < 0 or self.air_speed <= 0:
            raise ValueError("invalid IndoorParams")


@dataclass(frozen=True)
class WorkerParams:
    work_start: int = 8                 # local hour, inclusive
    work_end: int = 17                  # local hour, exclusive
    met: float = 2.5                    # moderate work
    clo: float = 0.5
    weight: float = 65.0                # assumption
    height: float = 1.65                # assumption
    sun_exposure: float = 0.5           # assumption: share of (Tmrt - Ta) the worker receives (partial shade)
    acclimatized: int = 100
    drink: int = 1

    def __post_init__(self):
        if not 0 <= self.work_start < self.work_end <= 24:
            raise ValueError("work hours must satisfy 0 <= start < end <= 24")
        if not 0.0 <= self.sun_exposure <= 1.0:
            raise ValueError("sun_exposure must be in [0, 1]")


@dataclass(frozen=True)
class ElderlyParams:
    met: float = 1.0
    clo: float = 0.5
    weight: float = 60.0                # assumption
    height: float = 1.60                # assumption
    acclimatized: bool = True           # residents of a hot city
    acclimatized_phs: int = 100
    drink: int = 1


@dataclass(frozen=True)
class DebtParams:
    core_ref_c: float = 37.5            # assumption: strain counted above this core/rectal temperature (below ISO 38)
    water_limit_frac: float = ISO7933_WATER_LIMIT_FRAC
    rectal_limit_c: float = ISO7933_RECTAL_LIMIT_C
    w_core: float = 1.0                 # per degC-hour above core_ref_c
    w_water: float = 1.0                # per ISO water-loss limit
    night_cool_c: float = 26.0          # assumption: full overnight recovery at or below this indoor minimum
    night_hot_c: float = 32.0           # assumption: no recovery credit at or above this indoor minimum
    carry_max: float = 0.7              # assumption: share of debt kept after a hot night
    weight_worker: float = 0.3          # assumption: replace with ward Census shares
    weight_elderly: float = 0.7
    scale: float = 3.0
    band_edges: tuple = (20.0, 40.0, 60.0, 80.0)
    band_labels: tuple = ("Low", "Moderate", "High", "Very High", "Extreme")
    calibrated: bool = False

    def __post_init__(self):
        if min(self.w_core, self.w_water, self.weight_worker, self.weight_elderly) < 0:
            raise ValueError("weights must be >= 0")
        if self.weight_worker + self.weight_elderly <= 0:
            raise ValueError("persona weights must not all be zero")
        if self.night_hot_c <= self.night_cool_c:
            raise ValueError("night_hot_c must be above night_cool_c")
        if not 0.0 <= self.carry_max < 1.0:
            raise ValueError("carry_max must be in [0, 1)")
        if self.scale <= 0 or self.water_limit_frac <= 0:
            raise ValueError("scale and water_limit_frac must be > 0")
        if len(self.band_labels) != len(self.band_edges) + 1:
            raise ValueError("band_labels must have one more entry than band_edges")


@dataclass(frozen=True)
class PHDParams:
    indoor: IndoorParams = field(default_factory=IndoorParams)
    worker: WorkerParams = field(default_factory=WorkerParams)
    elderly: ElderlyParams = field(default_factory=ElderlyParams)
    debt: DebtParams = field(default_factory=DebtParams)


# --------------------------------------------------------------------------- helpers
def _require(df: pd.DataFrame, cols) -> None:
    missing = [c for c in cols if c not in df.columns]
    if missing:
        raise ValueError(f"missing columns: {missing}")


def _esat_hpa(ta_c):
    """Saturation vapour pressure [hPa], the Magnus form used by thermofeel's non-saturation vapour pressure."""
    ta_c = np.asarray(ta_c, dtype=float)
    return 6.105 * np.exp(17.27 * ta_c / (237.7 + ta_c))


def _dubois_area(weight: float, height: float) -> float:
    """DuBois body surface area [m2], as in pythermalcomfort's PHS implementation."""
    return 0.202 * weight ** 0.425 * height ** 0.725


def _naive_utc(t: pd.Series) -> np.ndarray:
    t = pd.to_datetime(t)
    if t.dt.tz is not None:
        t = t.dt.tz_convert("UTC").dt.tz_localize(None)
    return t.to_numpy(dtype="datetime64[ns]")


def _local_date(t: pd.Series) -> pd.Series:
    t = pd.to_datetime(t)
    d = t.dt.normalize()
    return d.dt.tz_localize(None) if d.dt.tz is not None else d


def _day_hour_matrix(df: pd.DataFrame, column: str, dates: pd.DatetimeIndex, hours) -> np.ndarray:
    p = df.pivot_table(index="date", columns="hour", values=column, aggfunc="first")
    return p.reindex(index=dates, columns=list(hours)).to_numpy(dtype=float)


def _row_reduce(m: np.ndarray, fn) -> np.ndarray:
    """Apply ``fn(axis=1)`` to rows with no missing value; incomplete rows give NaN."""
    ok = np.isfinite(m).all(axis=1)
    out = np.full(m.shape[0], np.nan)
    if ok.any():
        out[ok] = fn(m[ok], axis=1)
    return out


# --------------------------------------------------------------------------- 1. indoor exposure
def indoor_climate(hourly: pd.DataFrame, params: IndoorParams = IndoorParams()) -> pd.DataFrame:
    """Add ``ta_in``, ``rh_in`` and ``tr_in`` (indoor air, humidity and radiant temperature).

    T_eq = Ta + roof_gain * GHI / 1000; T_in relaxes towards T_eq with time constant ``tau_hours``.
    The lag restarts at the outdoor temperature after any gap in the hourly series.
    """
    _require(hourly, ("time", "ta", "rh", "ghi"))
    out = hourly.copy()
    t = _naive_utc(out["time"])
    order = np.argsort(t, kind="stable")
    ta = out["ta"].to_numpy(float)[order]
    ghi = np.clip(out["ghi"].to_numpy(float)[order], 0.0, None)
    new_segment = np.r_[True, np.diff(t[order]) != np.timedelta64(1, "h")]

    alpha = 1.0 - np.exp(-1.0 / params.tau_hours)
    t_eq = ta + params.roof_gain_c_per_kw * ghi / 1000.0
    t_in = np.full(ta.shape, np.nan)
    prev = np.nan
    for i in range(ta.size):
        if new_segment[i] or not np.isfinite(prev):
            t_in[i] = ta[i]
        else:
            t_in[i] = prev + alpha * (t_eq[i] - prev)
        prev = t_in[i]

    ta_in = np.empty_like(t_in)
    ta_in[order] = t_in
    e_hpa = out["rh"].to_numpy(float) / 100.0 * _esat_hpa(out["ta"].to_numpy(float))
    out["ta_in"] = ta_in
    out["rh_in"] = np.clip(100.0 * e_hpa / _esat_hpa(ta_in), 1.0, 100.0)
    sun = np.clip(out["ghi"].to_numpy(float) / 1000.0, 0.0, 1.0)
    out["tr_in"] = ta_in + params.radiant_excess_c * sun
    return out


# --------------------------------------------------------------------------- 2. body simulation
def _phs_chain(tdb, tr, v, rh, *, met, clo, posture, weight, height, acclimatized, drink):
    """Chain 60-minute ISO 7933 PHS runs across the columns (hours) of day x hour matrices.

    Returns (rectal temperature, cumulative sweat loss in g) at the end of each hour. A day with any
    missing input is skipped entirely (NaN) - the PHS solver must never see NaN input.
    """
    n_days, n_hours = tdb.shape
    t_re = np.full((n_days, n_hours), np.nan)
    sweat = np.full((n_days, n_hours), np.nan)
    ok = np.isfinite(tdb).all(1) & np.isfinite(tr).all(1) & np.isfinite(v).all(1) & np.isfinite(rh).all(1)
    idx = np.flatnonzero(ok)
    if idx.size == 0:
        return t_re, sweat
    state: dict = {}
    for j in range(n_hours):
        r = phs(tdb=tdb[idx, j], tr=tr[idx, j], v=v[idx, j], rh=rh[idx, j],
                met=np.full(idx.size, met), clo=np.full(idx.size, clo), posture=[posture] * idx.size,
                duration=60, limit_inputs=False, round_output=False, weight=weight, height=height,
                acclimatized=acclimatized, drink=drink, **state)
        t_re[idx, j] = r.t_re
        sweat[idx, j] = r.sweat_loss_g
        state = {k: np.asarray(getattr(r, k), dtype=float) for k in PHS_STATE}
    return t_re, sweat


def _iso7933_in_range(tdb, tr, v, rh):
    """1 where the hour is inside ISO 7933 Annex A applicability limits (2023 edition), else 0; NaN if missing."""
    p_a = 0.6105 * np.exp(17.27 * tdb / (tdb + 237.3)) * rh / 100.0
    inside = ((tdb > 15) & (tdb < 50) & (tr - tdb >= 0) & (tr - tdb <= 60) & (v >= 0) & (v <= 3)
              & (p_a >= 0.5) & (p_a <= 4.5)).astype(float)
    missing = ~(np.isfinite(tdb) & np.isfinite(tr) & np.isfinite(v) & np.isfinite(rh))
    return np.where(missing, np.nan, inside)


def _elderly_core_chain(df: pd.DataFrame, indoor: IndoorParams, p: ElderlyParams) -> np.ndarray:
    """Hourly maximum core temperature of an older adult at home (Ji et al. 2022), chained hour to hour."""
    t = _naive_utc(df["time"])
    order = np.argsort(t, kind="stable")
    ta = df["ta_in"].to_numpy(float)[order]
    tr = df["tr_in"].to_numpy(float)[order]
    rh = df["rh_in"].to_numpy(float)[order]
    new_segment = np.r_[True, np.diff(t[order]) != np.timedelta64(1, "h")]
    bsa = _dubois_area(p.weight, p.height)

    core_max = np.full(ta.size, np.nan)
    core, skin = JI_INITIAL_CORE_C, JI_INITIAL_SKIN_C
    for i in range(ta.size):
        if new_segment[i]:
            core, skin = JI_INITIAL_CORE_C, JI_INITIAL_SKIN_C
        if not (np.isfinite(ta[i]) and np.isfinite(tr[i]) and np.isfinite(rh[i])):
            core, skin = JI_INITIAL_CORE_C, JI_INITIAL_SKIN_C
            continue
        e_torr = rh[i] / 100.0 * float(_esat_hpa(ta[i])) * HPA_TO_TORR
        try:
            r = two_nodes_gagge_ji(tdb=float(ta[i]), tr=float(tr[i]), v=float(indoor.air_speed), met=p.met,
                                   clo=p.clo, vapor_pressure=float(e_torr), body_surface_area=bsa,
                                   position="sitting", body_weight=p.weight, length_time_simulation=60,
                                   initial_skin_temp=skin, initial_core_temp=core, acclimatized=p.acclimatized)
        except (StopIteration, ValueError, OverflowError, ZeroDivisionError):
            core, skin = JI_INITIAL_CORE_C, JI_INITIAL_SKIN_C
            continue
        tc = np.asarray(r.t_core, dtype=float)
        ts = np.asarray(r.t_skin, dtype=float)
        core_max[i] = tc.max()
        core, skin = float(tc[-1]), float(ts[-1])

    result = np.empty_like(core_max)
    result[order] = core_max
    return result


# --------------------------------------------------------------------------- 3-5. load, debt, score
def night_min_by_date(time: pd.Series, values, night_start: int = 20, night_end: int = 7,
                      min_hours: int = 8) -> pd.Series:
    """Minimum of ``values`` over the night *before* each date (night_start on the previous day to night_end)."""
    if not 0 <= night_end < night_start <= 24 or night_end + (24 - night_start) >= 24:
        raise ValueError("night window must span midnight")
    t = pd.to_datetime(pd.Series(time).reset_index(drop=True))
    vals = pd.Series(np.asarray(values, dtype=float))
    h = t.dt.hour
    is_night = ((h >= night_start) | (h < night_end)) & vals.notna()
    key = _local_date(t + pd.Timedelta(hours=24 - night_start))
    g = vals[is_night].groupby(key[is_night])
    return g.min().where(g.count() >= min_hours)


def carry_from_night(night_min_in, params: DebtParams = DebtParams()) -> np.ndarray:
    """Share of yesterday's debt carried into today; 0 after a cool night, ``carry_max`` after a hot one."""
    x = np.asarray(night_min_in, dtype=float)
    frac = np.clip((x - params.night_cool_c) / (params.night_hot_c - params.night_cool_c), 0.0, 1.0)
    return np.where(np.isfinite(x), params.carry_max * frac, 0.0)


def accumulate_debt(dates, load, carry) -> np.ndarray:
    """debt_t = load_t + carry_t * debt_(t-1) over consecutive dates; gaps and missing loads restart the debt."""
    dates = pd.DatetimeIndex(pd.to_datetime(dates))
    load = np.asarray(load, dtype=float)
    carry = np.asarray(carry, dtype=float)
    debt = np.full(load.size, np.nan)
    prev_debt, prev_date = 0.0, None
    for k in range(load.size):
        consecutive = prev_date is not None and (dates[k] - prev_date) == pd.Timedelta(days=1)
        if not np.isfinite(load[k]):
            prev_debt, prev_date = 0.0, dates[k]
            continue
        debt[k] = load[k] + (carry[k] * prev_debt if consecutive else 0.0)
        prev_debt, prev_date = debt[k], dates[k]
    return debt


def score_from_raw(raw, params: DebtParams = DebtParams()):
    raw = np.asarray(raw, dtype=float)
    score = 100.0 * (1.0 - np.exp(-np.maximum(raw, 0.0) / params.scale))
    bands = np.asarray(params.band_labels, dtype=object)[np.digitize(np.nan_to_num(score), params.band_edges)]
    return score, np.where(np.isnan(raw), None, bands)


def compute_phd(hourly: pd.DataFrame, params: PHDParams = PHDParams()) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Run the full Plan C pipeline.

    ``hourly`` needs Plan A's ``compute_hourly`` columns: time, ta, rh, ghi, mrt, wind_2m.
    Returns (hourly frame with indoor and elderly-core columns, daily frame with PHD).
    """
    _require(hourly, ("time", "ta", "rh", "ghi", "mrt", "wind_2m"))
    wp, ep, dp = params.worker, params.elderly, params.debt

    df = indoor_climate(hourly, params.indoor)
    t = pd.to_datetime(df["time"])
    df["date"] = _local_date(t)
    df["hour"] = t.dt.hour
    dates = pd.DatetimeIndex(np.sort(df["date"].unique()))

    # outdoor worker, work hours only, fresh start each morning
    df["tr_worker"] = df["ta"] + wp.sun_exposure * np.clip(df["mrt"] - df["ta"], 0.0, None)
    df["v_worker"] = np.clip(df["wind_2m"], 0.1, 3.0)
    work_hours = range(wp.work_start, wp.work_end)
    W = {c: _day_hour_matrix(df, c, dates, work_hours) for c in ("ta", "tr_worker", "v_worker", "rh")}
    w_tre, w_sweat = _phs_chain(W["ta"], W["tr_worker"], W["v_worker"], W["rh"], met=wp.met, clo=wp.clo,
                                posture="standing", weight=wp.weight, height=wp.height,
                                acclimatized=wp.acclimatized, drink=wp.drink)
    in_range = _iso7933_in_range(W["ta"], W["tr_worker"], W["v_worker"], W["rh"])

    # older adult at home: core temperature continuously, sweat loss per day at rest
    df["elderly_core_max"] = _elderly_core_chain(df, params.indoor, ep)
    all_hours = range(24)
    E = {c: _day_hour_matrix(df, c, dates, all_hours) for c in ("ta_in", "tr_in", "rh_in", "elderly_core_max")}
    _, e_sweat = _phs_chain(E["ta_in"], E["tr_in"], np.full(E["ta_in"].shape, params.indoor.air_speed), E["rh_in"],
                            met=ep.met, clo=ep.clo, posture="sitting", weight=ep.weight, height=ep.height,
                            acclimatized=ep.acclimatized_phs, drink=ep.drink)

    daily = pd.DataFrame({"date": dates})
    daily["worker_rectal_max"] = _row_reduce(w_tre, np.max)
    daily["worker_core_dh"] = _row_reduce(np.maximum(w_tre - dp.core_ref_c, 0.0), np.sum)
    daily["worker_hours_rectal_ge_limit"] = _row_reduce(
        np.where(np.isfinite(w_tre), (w_tre >= dp.rectal_limit_c).astype(float), np.nan), np.sum)
    daily["worker_water_frac"] = w_sweat[:, -1] / (wp.weight * 1000.0)
    daily["iso7933_in_range_frac"] = _row_reduce(in_range, np.mean)
    daily["elderly_core_max"] = _row_reduce(E["elderly_core_max"], np.max)
    daily["elderly_core_dh"] = _row_reduce(np.maximum(E["elderly_core_max"] - dp.core_ref_c, 0.0), np.sum)
    daily["elderly_water_frac"] = e_sweat[:, -1] / (ep.weight * 1000.0)
    daily["indoor_night_min"] = night_min_by_date(df["time"], df["ta_in"]).reindex(dates).to_numpy()

    daily["load_worker"] = dp.w_core * daily["worker_core_dh"] + dp.w_water * daily["worker_water_frac"] / dp.water_limit_frac
    daily["load_elderly"] = dp.w_core * daily["elderly_core_dh"] + dp.w_water * daily["elderly_water_frac"] / dp.water_limit_frac
    daily["carry"] = carry_from_night(daily["indoor_night_min"], dp)
    daily["debt_worker"] = accumulate_debt(dates, daily["load_worker"], daily["carry"])
    daily["debt_elderly"] = accumulate_debt(dates, daily["load_elderly"], daily["carry"])
    total_w = dp.weight_worker + dp.weight_elderly
    daily["phd_raw"] = (dp.weight_worker * daily["debt_worker"] + dp.weight_elderly * daily["debt_elderly"]) / total_w
    daily["phd"], daily["phd_band"] = score_from_raw(daily["phd_raw"], dp)
    daily["phd_calibrated"] = dp.calibrated

    hourly_out = df.drop(columns=["date", "hour", "tr_worker", "v_worker"])
    return hourly_out, daily

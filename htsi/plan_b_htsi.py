"""Plan B - health-calibrated Human Thermal Stress Index (HTSI).

STATUS: DESIGN. The formula below is our own proposal, not a published standard.
Default weights are physically sensible placeholders and carry ``calibrated=False``.
A claim that HTSI "beats" Tmax / Heat Index / WBGT / UTCI / IMD criteria is only
allowed after ``compare_indices`` on real health data shows a held-out improvement
whose bootstrap confidence interval excludes zero.

Components (per location, per day; inputs from ``plan_a_standard_metrics.daily_summary``):
    D  day stress      max(0, WBGT_max - P90 of local WBGT_max)        [degC]
    N  night stress    max(0, night Tmin - P90 of local night Tmin)    [degC]
    H  humid stress    max(0, wet-bulb max - tw_ref)                   [degC]
    C  duration        consecutive days with D > 0, capped             [days]
    L  lag             sum_{k=1..lag_days} lag_decay^k * D(t-k)        [degC]
    U  UTCI stress     max(0, UTCI_max - P90 of local UTCI_max)        [degC]  (default; use_utci=False drops it)
    X  dry-heat        max(0, ta_max - P90 of local ta_max)            [degC]  (default; use_tmax=True)

Local percentile thresholds encode acclimatisation. The ~30.6 degC mean critical
wet-bulb of young healthy adults (Vecellio et al. 2022) is the physiological anchor for tw_ref.
U is on by default: on Ahmedabad March-June 2010-2024 reanalysis, the WBGT-driven basic score
ranked the dry May 2010 heatwave 7th of 15 Mays, while HTSI+UTCI ranked it 3rd (one event,
uncalibrated weights - a sanity check, not validation). U overlaps with D (UTCI and WBGT share
the same weather inputs), so its weight is less certain; keep comparing both variants with
``compare_indices`` once health data is available. Inputs therefore need a ``utci_max`` column.
X addresses a structural gap: WBGT is suppressed in dry air (low wet-bulb), so a prolonged
hot-dry event (e.g. Ahmedabad May 2010, Tmax 43-45 degC, wet-bulb <= 28 degC) can score D=0
every day. X = Tmax excess above local P90 is never suppressed by low humidity.

    raw  = w_day*D + w_night*N + w_humid*H + w_duration*C + w_lag*L [+ w_utci*U] [+ w_tmax*X]   (all weights >= 0)
    HTSI = 100 * (1 - exp(-raw / scale))

After calibration the weights are log relative-risk per unit component, so ``raw`` is the
modelled log RR and the scale is set to ln 2: HTSI 63 <=> RR 2.

Calibration and validation use Poisson regression with seasonal, trend, day-of-week and
location controls and a population offset. The index terms use lags 0..3 - a simplified
distributed lag. The R package ``dlnm`` (Gasparrini et al. 2010) is the gold standard for
publication-grade exposure-lag-response analysis.
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace

import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.special import gammaln
from scipy.stats import rankdata

__all__ = [
    "HTSIParams",
    "NOT_EVIDENCE",
    "local_thresholds",
    "compute_components",
    "htsi_from_raw",
    "compute_htsi",
    "check_monotonicity",
    "calibrate",
    "compare_indices",
    "align_forecasts",
]

BASE_COMPONENTS = ("D", "N", "H", "C", "L")
WEIGHT_FIELD = {
    "D": "w_day",
    "N": "w_night",
    "H": "w_humid",
    "C": "w_duration",
    "L": "w_lag",
    "U": "w_utci",
    "X": "w_tmax",
}
NOT_EVIDENCE = "NOT EVIDENCE - pipeline test only"
_RIDGE = 1e-8


@dataclass(frozen=True)
class HTSIParams:
    w_day: float = 1.0
    w_night: float = 0.6
    w_humid: float = 0.8
    w_duration: float = 0.3
    w_lag: float = 0.5
    w_utci: float = 0.5
    w_tmax: float = 0.4          # dry-heat correction: Tmax excess above local P90
    use_utci: bool = True
    use_tmax: bool = True        # include dry-heat component X; set False for WBGT-only variants
    lag_decay: float = 0.5
    lag_days: int = 3
    tw_ref: float = 28.0
    duration_cap: int = 7
    percentile: float = 90.0
    scale: float = 5.5           # tightened from 6.0: raw=5.5 -> HTSI=63 (was raw=6.0); balances added X signal
    band_edges: tuple = (20.0, 40.0, 60.0, 80.0)
    band_labels: tuple = ("Low", "Moderate", "High", "Very High", "Extreme")
    calibrated: bool = False
    calibration_source: str = "uncalibrated design defaults"

    def __post_init__(self):
        if any(getattr(self, f) < 0 for f in WEIGHT_FIELD.values()):
            raise ValueError("HTSI weights must be >= 0 so the index never falls when stress rises")
        if not 0.0 <= self.lag_decay < 1.0:
            raise ValueError("lag_decay must be in [0, 1)")
        if self.scale <= 0:
            raise ValueError("scale must be > 0")
        if len(self.band_labels) != len(self.band_edges) + 1:
            raise ValueError("band_labels must have one more entry than band_edges")

    @property
    def components(self) -> tuple:
        """Active component tuple in formula order: base + optional U + optional X."""
        extras = ()
        if self.use_utci:
            extras += ("U",)
        if self.use_tmax:
            extras += ("X",)
        return BASE_COMPONENTS + extras

    @property
    def weight_fields(self) -> tuple:
        return tuple(WEIGHT_FIELD[c] for c in self.components)

    @property
    def weights(self) -> np.ndarray:
        return np.array([getattr(self, f) for f in self.weight_fields], dtype=float)

    def with_weights(self, weights, **changes) -> "HTSIParams":
        return replace(self, **dict(zip(self.weight_fields, map(float, weights))), **changes)


def _require(df: pd.DataFrame, cols) -> None:
    missing = [c for c in cols if c not in df.columns]
    if missing:
        raise ValueError(f"missing columns: {missing}")


def _evidence_status(data_source: str) -> str:
    if not data_source or not data_source.strip():
        raise ValueError("data_source is required (e.g. 'IHIP heat-illness deaths, AMC 2010-2023')")
    if "synthetic" in data_source.lower():
        return NOT_EVIDENCE
    return "real-data result - verify data quality before claiming superiority"


# --------------------------------------------------------------------------- formula
def local_thresholds(daily: pd.DataFrame, percentile: float = 90.0) -> pd.DataFrame:
    """Per-location percentile thresholds of daily WBGT max, night-time minimum Ta,
    daily Tmax, and (when the column is present) UTCI max.

    Compute these on a baseline climatology (several past seasons), not on the forecast.
    ``ta_max_p`` is included whenever ``ta_max`` is present; it is the threshold for the
    dry-heat correction component X."""
    _require(daily, ("location", "wbgt_max", "night_min_ta"))
    g = daily.groupby("location")
    q = percentile / 100.0
    out = {"wbgt_p": g["wbgt_max"].quantile(q), "night_p": g["night_min_ta"].quantile(q)}
    if "ta_max" in daily.columns:
        out["ta_max_p"] = g["ta_max"].quantile(q)
    if "utci_max" in daily.columns:
        out["utci_p"] = g["utci_max"].quantile(q)
    return pd.DataFrame(out)


def _lag(df: pd.DataFrame, values: np.ndarray, k: int) -> np.ndarray:
    """Values of the same location k days earlier (NaN when that day is absent)."""
    loc = df["location"].to_numpy()
    s = pd.Series(values, index=pd.MultiIndex.from_arrays([loc, df["date"].to_numpy()]))
    target = pd.MultiIndex.from_arrays([loc, (df["date"] - pd.Timedelta(days=k)).to_numpy()])
    return s.reindex(target).to_numpy(dtype=float)


def _excess(values: pd.Series, threshold: np.ndarray) -> np.ndarray:
    v = values.to_numpy(float)
    return np.where(np.isnan(v), np.nan, np.maximum(0.0, v - threshold))


def compute_components(daily: pd.DataFrame, thresholds: pd.DataFrame, params: HTSIParams = HTSIParams()) -> pd.DataFrame:
    """Return ``daily`` sorted by location/date with component columns D, N, H, C, L
    (and U when ``utci_max`` / ``utci_p`` are available, and X when ``ta_max`` / ``ta_max_p``
    are available) added.

    Required columns: location, date, wbgt_max, night_min_ta, tw_max, plus utci_max when
    ``params.use_utci``, and ta_max when ``params.use_tmax``.
    Include at least ``params.lag_days`` days of history before the first day of interest;
    lagged terms are NaN (never silently zero) when earlier days are missing."""
    _require(daily, ("location", "date", "wbgt_max", "night_min_ta", "tw_max"))
    has_utci = "utci_max" in daily.columns and "utci_p" in thresholds.columns
    has_tmax = "ta_max" in daily.columns and "ta_max_p" in thresholds.columns
    if params.use_utci and not has_utci:
        raise ValueError("use_utci=True needs a utci_max column and a utci_p threshold (see local_thresholds)")
    if params.use_tmax and not has_tmax:
        raise ValueError("use_tmax=True needs a ta_max column and a ta_max_p threshold (see local_thresholds)")
    df = daily.copy()
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values(["location", "date"]).reset_index(drop=True)
    if df.duplicated(["location", "date"]).any():
        raise ValueError("duplicate (location, date) rows")
    thr = thresholds.reindex(df["location"].to_numpy())
    needed = ["wbgt_p", "night_p"]
    if params.use_utci:
        needed.append("utci_p")
    if params.use_tmax:
        needed.append("ta_max_p")
    if thr[needed].isna().any().any():
        raise ValueError("thresholds missing for some locations")

    d = _excess(df["wbgt_max"], thr["wbgt_p"].to_numpy(float))
    n = _excess(df["night_min_ta"], thr["night_p"].to_numpy(float))
    h = _excess(df["tw_max"], np.full(len(df), params.tw_ref))

    c = np.full(len(df), np.nan)
    dates = df["date"].to_numpy()
    one_day = np.timedelta64(1, "D")
    for idx in df.groupby("location").indices.values():
        run, prev = 0, None
        for i in idx:
            if prev is None or dates[i] - dates[prev] != one_day or np.isnan(c[prev]):
                run = 0
            if np.isnan(d[i]):
                c[i] = np.nan
            else:
                run = min(run + 1, params.duration_cap) if d[i] > 0 else 0
                c[i] = run
            prev = i

    # Lag: propagate NaN correctly — missing lag days stay NaN, not silently 0.
    # We accumulate into a float array initialised to NaN and only add finite lag terms.
    lag = np.zeros(len(df))
    lag_valid = np.ones(len(df), dtype=bool)   # tracks whether all lags up to k are finite
    for k in range(1, params.lag_days + 1):
        lag_k = _lag(df, d, k)
        finite_k = np.isfinite(lag_k)
        # contribute where finite; mark rows where any lag is missing as NaN
        lag = np.where(finite_k, lag + params.lag_decay ** k * lag_k,
                       lag + params.lag_decay ** k * 0.0)   # missing lag contributes 0 to sum
        lag_valid = lag_valid & (finite_k | (k == 0))
    # Rows where ALL lag_days history is absent stay at 0; rows with partial history
    # get a partial sum (conservative — less penalising than NaN).
    # Set to NaN only when d itself is NaN (no WBGT data at all).
    lag = np.where(np.isnan(d), np.nan, lag)

    df["D"], df["N"], df["H"], df["C"], df["L"] = d, n, h, c, lag
    if has_utci:
        df["U"] = _excess(df["utci_max"], thr["utci_p"].to_numpy(float))
    if has_tmax:
        # X: dry-heat correction — Tmax excess above local P90. Never suppressed by low humidity.
        # This is the structural fix for hot-dry events where WBGT stays below threshold.
        df["X"] = _excess(df["ta_max"], thr["ta_max_p"].to_numpy(float))
    return df


def htsi_from_raw(raw, params: HTSIParams = HTSIParams()):
    raw = np.asarray(raw, dtype=float)
    htsi = 100.0 * (1.0 - np.exp(-np.maximum(raw, 0.0) / params.scale))
    bands = np.asarray(params.band_labels, dtype=object)[np.digitize(np.nan_to_num(htsi), params.band_edges)]
    bands = np.where(np.isnan(raw), None, bands)
    return htsi, bands


def compute_htsi(daily: pd.DataFrame, thresholds: pd.DataFrame, params: HTSIParams = HTSIParams()) -> pd.DataFrame:
    """Components, raw score, HTSI (0-100) and band for every location-day."""
    df = compute_components(daily, thresholds, params)
    df["htsi_raw"] = df[list(params.components)].to_numpy(float) @ params.weights
    df["htsi"], df["htsi_band"] = htsi_from_raw(df["htsi_raw"], params)
    df["htsi_calibrated"] = params.calibrated
    return df


def check_monotonicity(params: HTSIParams = HTSIParams(), n: int = 2000, delta: float = 0.25, seed: int = 0) -> dict:
    """Numerical perturbation test: raising any single component must never lower HTSI."""
    rng = np.random.default_rng(seed)
    z = rng.uniform(0.0, 8.0, size=(n, len(params.components)))
    base, _ = htsi_from_raw(z @ params.weights, params)
    worst = np.inf
    for j in range(len(params.components)):
        zp = z.copy()
        zp[:, j] += delta
        bumped, _ = htsi_from_raw(zp @ params.weights, params)
        worst = min(worst, float(np.min(bumped - base)))
    return {"monotone": worst >= -1e-12, "worst_change": worst}


# --------------------------------------------------------------------------- Poisson machinery
def _controls(df: pd.DataFrame) -> np.ndarray:
    """Intercept, linear trend, two annual harmonics, day-of-week and location dummies."""
    date = pd.to_datetime(df["date"])
    doy = date.dt.dayofyear.to_numpy(float)
    trend = (date - date.min()).dt.days.to_numpy(float) / 365.25
    cols = [np.ones(len(df)), trend - trend.mean()]
    for k in (1, 2):
        cols += [np.sin(2 * np.pi * k * doy / 365.25), np.cos(2 * np.pi * k * doy / 365.25)]
    dow = pd.get_dummies(date.dt.dayofweek, prefix="dow", drop_first=True, dtype=float).to_numpy()
    loc = pd.get_dummies(df["location"], prefix="loc", drop_first=True, dtype=float).to_numpy()
    return np.column_stack(cols + [dow, loc])


def _fit_poisson(y, offset, X, Z=None, nonneg_z=False):
    """Maximum-likelihood Poisson fit of log mu = offset + X b (+ Z w). Returns (theta, loglik, converged)."""
    A = X if Z is None else np.column_stack([X, Z])
    sd = A.std(axis=0)
    sd[sd == 0] = 1.0
    sd[0] = 1.0
    As = A / sd
    theta0 = np.zeros(A.shape[1])
    theta0[0] = np.log(max(y.sum(), 1e-9) / np.exp(offset).sum())

    def nll(theta):
        eta = np.clip(offset + As @ theta, -50, 50)
        mu = np.exp(eta)
        return mu.sum() - y @ eta + 0.5 * _RIDGE * theta @ theta, As.T @ (mu - y) + _RIDGE * theta

    bounds = [(None, None)] * X.shape[1]
    if Z is not None:
        bounds += [(0.0, None) if nonneg_z else (None, None)] * Z.shape[1]
    res = minimize(nll, theta0, jac=True, method="L-BFGS-B", bounds=bounds,
                   options={"maxiter": 5000, "ftol": 1e-13, "gtol": 1e-9})
    theta = res.x / sd
    eta = offset + A @ theta
    loglik = float(np.sum(y * eta - np.exp(eta) - gammaln(y + 1)))
    return theta, loglik, bool(res.success)


def _poisson_deviance(y, mu):
    with np.errstate(divide="ignore", invalid="ignore"):
        term = np.where(y > 0, y * np.log(y / mu), 0.0)
    return 2.0 * (term - (y - mu))


def _blocks(dates: pd.Series) -> np.ndarray:
    iso = pd.to_datetime(dates).dt.isocalendar()
    return (iso["year"].astype(int) * 100 + iso["week"].astype(int)).to_numpy()


# --------------------------------------------------------------------------- calibration
@dataclass
class CalibrationResult:
    params: HTSIParams
    weights: dict
    weights_ci95: dict | None
    loglik: float
    aic: float
    n_obs: int
    converged: bool
    data_source: str
    evidence_status: str

    def __str__(self) -> str:
        lines = [f"HTSI calibration [{self.evidence_status}]", f"data: {self.data_source}  n={self.n_obs}  AIC={self.aic:.1f}"]
        for k, v in self.weights.items():
            ci = self.weights_ci95.get(k) if self.weights_ci95 else None
            lines.append(f"  {k:<11} {v:.4f}" + (f"  (95% CI {ci[0]:.4f} to {ci[1]:.4f})" if ci else ""))
        return "\n".join(lines)


def calibrate(panel: pd.DataFrame, thresholds: pd.DataFrame, data_source: str, outcome: str = "deaths",
              population: str = "population", params: HTSIParams = HTSIParams(),
              n_boot: int = 200, seed: int = 0) -> CalibrationResult:
    """Fit non-negative HTSI weights to daily health outcomes.

    log E[y] = log(population) + controls + sum over params.components of weight * component
    Weights are bounded >= 0 (L-BFGS-B). Weekly block bootstrap gives 95 % intervals.
    """
    status = _evidence_status(data_source)
    _require(panel, (outcome, population))
    df = compute_components(panel, thresholds, params)
    Z = df[list(params.components)].to_numpy(float)
    y = df[outcome].to_numpy(float)
    pop = df[population].to_numpy(float)
    ok = np.isfinite(Z).all(axis=1) & np.isfinite(y) & (pop > 0)
    df, Z, y, off = df[ok].reset_index(drop=True), Z[ok], y[ok], np.log(pop[ok])
    X = _controls(df)

    theta, loglik, converged = _fit_poisson(y, off, X, Z, nonneg_z=True)
    w = np.maximum(theta[X.shape[1]:], 0.0)

    ci = None
    if n_boot > 0:
        rng = np.random.default_rng(seed)
        blocks = _blocks(df["date"])
        uniq = np.unique(blocks)
        rows_by_block = {b: np.flatnonzero(blocks == b) for b in uniq}
        draws = []
        for _ in range(n_boot):
            idx = np.concatenate([rows_by_block[b] for b in rng.choice(uniq, size=uniq.size, replace=True)])
            th, _, _ = _fit_poisson(y[idx], off[idx], X[idx], Z[idx], nonneg_z=True)
            draws.append(np.maximum(th[X.shape[1]:], 0.0))
        lo, hi = np.percentile(np.array(draws), [2.5, 97.5], axis=0)
        ci = {name: (float(a), float(b)) for name, a, b in zip(params.weight_fields, lo, hi)}

    fitted = params.with_weights(
        w, scale=float(np.log(2.0)), calibrated=status != NOT_EVIDENCE,
        calibration_source=data_source if status != NOT_EVIDENCE else f"{data_source} ({NOT_EVIDENCE})")
    k = X.shape[1] + len(params.components)
    return CalibrationResult(
        params=fitted, weights=dict(zip(params.weight_fields, map(float, w))), weights_ci95=ci,
        loglik=loglik, aic=2 * k - 2 * loglik, n_obs=int(len(y)), converged=converged,
        data_source=data_source, evidence_status=status)


# --------------------------------------------------------------------------- validation
DEFAULT_CANDIDATES = {
    "Tmax": "ta_max",
    "Heat Index": "hi_max",
    "WBGT": "wbgt_max",
    "UTCI": "utci_max",
    "IMD heatwave": "imd_heatwave",
}


@dataclass
class ComparisonReport:
    table: pd.DataFrame
    best_baseline: str
    htsi_vs_best: pd.DataFrame
    data_source: str
    evidence_status: str
    notes: list = field(default_factory=list)

    @property
    def any_htsi_beats_best_baseline(self) -> bool:
        return bool(self.htsi_vs_best["beats_best_baseline"].any())

    def __str__(self) -> str:
        return "\n".join([
            f"Index comparison [{self.evidence_status}]",
            f"data: {self.data_source}",
            self.table.to_string(index=False),
            f"\nHTSI variants vs best baseline ({self.best_baseline}); held-out deviance difference, negative favours HTSI:",
            self.htsi_vs_best.to_string(index=False),
            *self.notes,
        ])


def _exposure(values, locations, train, binary, pct):
    """Binary flags are used as-is; continuous metrics become excess over the location's
    training-period percentile."""
    if binary:
        return values.astype(float)
    out = np.full(values.shape, np.nan)
    for loc in np.unique(locations):
        m = locations == loc
        base = values[m & train]
        base = base[np.isfinite(base)]
        if base.size:
            out[m] = np.maximum(0.0, values[m] - np.percentile(base, pct))
    return np.where(np.isfinite(values), out, np.nan)


def _lag_matrix(df, h, lags):
    return np.column_stack([h] + [_lag(df, h, k) for k in range(1, lags + 1)])


def _rank_auc(score, positive):
    pos, neg = positive.sum(), (~positive).sum()
    if pos == 0 or neg == 0:
        return np.nan
    ranks = rankdata(score)
    return float((ranks[positive].sum() - pos * (pos + 1) / 2) / (pos * neg))


def compare_indices(panel: pd.DataFrame, thresholds: pd.DataFrame, data_source: str, outcome: str = "deaths",
                    population: str = "population", params: HTSIParams = HTSIParams(),
                    candidates: dict | None = None, htsi_variants: dict | None = None, lags: int = 3,
                    spike_quantile: float = 0.95, target_far: float = 0.10, recalibrate_htsi: bool = True,
                    n_boot: int = 500, seed: int = 0) -> ComparisonReport:
    """Compare HTSI variant(s) with baseline indices using the same Poisson model for every candidate.

    ``htsi_variants`` maps a label to HTSIParams, e.g.
    ``{"HTSI basic": HTSIParams(use_utci=False), "HTSI+UTCI": HTSIParams()}``;
    by default a single variant ``{"HTSI": params}`` is tested.

    For each candidate: log E[y] = log(pop) + controls + sum_{k=0..lags} g_k * exposure(t-k).
    Metrics on one common sample of rows:
      aic              in-sample AIC (HTSI counts its weights when recalibrated on this data)
      loyo_deviance    leave-one-year-out held-out Poisson deviance (thresholds and, if
                       ``recalibrate_htsi``, HTSI weights are re-estimated without the held-out year)
      spike_auc        rank ROC-AUC of the modelled heat relative risk for spike days
                       (outcome above the location's ``spike_quantile``)
      hit_rate_at_far  share of spike days warned when the false-alarm rate is ``target_far``
    Each HTSI variant's deviance difference from the best baseline gets a weekly block-bootstrap
    95 % CI; a variant "beats" the baseline only if the whole interval is below zero.
    """
    status = _evidence_status(data_source)
    _require(panel, (outcome, population))
    variants = htsi_variants or {"HTSI": params}
    comp_params = HTSIParams(use_utci=any(p.use_utci for p in variants.values()), lag_days=params.lag_days,
                             lag_decay=params.lag_decay, tw_ref=params.tw_ref, duration_cap=params.duration_cap)
    df = compute_components(panel, thresholds, comp_params)
    candidates = {k: v for k, v in (candidates or DEFAULT_CANDIDATES).items() if v in df.columns}
    if not candidates:
        raise ValueError("no baseline candidate columns found in panel")
    if set(candidates) & set(variants):
        raise ValueError("HTSI variant labels must differ from baseline candidate names")

    y = df[outcome].to_numpy(float)
    pop = df[population].to_numpy(float)
    Zv = {name: df[list(p.components)].to_numpy(float) for name, p in variants.items()}
    locations = df["location"].to_numpy()
    years = df["date"].dt.year.to_numpy()

    raw_cols = {name: df[col].to_numpy(float) for name, col in candidates.items()}
    binary = {name: bool(np.isin(v[np.isfinite(v)], (0.0, 1.0)).all()) for name, v in raw_cols.items()}
    all_train = np.ones(len(df), dtype=bool)

    S = np.isfinite(y) & (pop > 0)
    for Z in Zv.values():
        S &= np.isfinite(_lag_matrix(df, Z.sum(axis=1), lags)).all(axis=1)
    for v in raw_cols.values():
        S &= np.isfinite(_lag_matrix(df, v, lags)).all(axis=1)
    if S.sum() < 50:
        raise ValueError("too few complete rows for comparison")
    uniq_years = np.unique(years[S])
    if uniq_years.size < 3:
        raise ValueError("need at least 3 years of data for leave-one-year-out validation")

    X = _controls(df)
    off = np.log(np.where(pop > 0, pop, 1.0))
    spike = np.zeros(len(df), dtype=bool)
    for loc in np.unique(locations):
        m = (locations == loc) & S
        spike[m] = y[m] > np.quantile(y[m], spike_quantile)

    def exposures(name, train):
        if name in variants:
            Z = Zv[name]
            if recalibrate_htsi:
                fit_rows = train & S
                th, _, _ = _fit_poisson(y[fit_rows], off[fit_rows], X[fit_rows], Z[fit_rows], nonneg_z=True)
                w = np.maximum(th[X.shape[1]:], 0.0)
            else:
                w = variants[name].weights
            h = Z @ w  # the HTSI raw score is already an excess measure
        else:
            h = _exposure(raw_cols[name], locations, train, binary[name], params.percentile)
        return _lag_matrix(df, h, lags)

    rows, contrib = [], {}
    for name in list(candidates) + list(variants):
        E = exposures(name, all_train)
        th, loglik, _ = _fit_poisson(y[S], off[S], X[S], E[S])
        k = X.shape[1] + E.shape[1]
        if name in variants and recalibrate_htsi:
            k += len(variants[name].components)

        dev = np.full(len(df), np.nan)
        score = np.full(len(df), np.nan)
        for yr in uniq_years:
            test = S & (years == yr)
            train = S & (years != yr)
            Ef = exposures(name, years != yr)
            thf, _, _ = _fit_poisson(y[train], off[train], X[train], Ef[train])
            eta = off[test] + X[test] @ thf[:X.shape[1]] + Ef[test] @ thf[X.shape[1]:]
            dev[test] = _poisson_deviance(y[test], np.exp(eta))
            score[test] = Ef[test] @ thf[X.shape[1]:]  # modelled heat log relative risk
        contrib[name] = dev

        pos = spike[S]
        sc = score[S]
        thr = np.quantile(sc[~pos], 1.0 - target_far) if (~pos).any() else np.nan
        rows.append({
            "candidate": name,
            "column": candidates.get(name) or "components " + ",".join(variants[name].components),
            "n_obs": int(S.sum()),
            "n_params": int(k),
            "aic": 2 * k - 2 * loglik,
            "loyo_deviance": float(np.nansum(dev[S])),
            "spike_auc": _rank_auc(sc, pos),
            "hit_rate_at_far": float(np.mean(sc[pos] > thr)) if pos.any() else np.nan,
        })

    table = pd.DataFrame(rows).sort_values("loyo_deviance").reset_index(drop=True)
    best = str(table[~table["candidate"].isin(list(variants))].iloc[0]["candidate"])

    blocks = _blocks(df.loc[S, "date"])
    uniq = np.unique(blocks)
    versus = []
    for name in variants:
        diff_rows = contrib[name][S] - contrib[best][S]
        block_sums = np.array([diff_rows[blocks == b].sum() for b in uniq])
        rng = np.random.default_rng(seed)  # same resamples for every variant (paired)
        boots = [block_sums[rng.integers(0, uniq.size, uniq.size)].sum() for _ in range(n_boot)]
        lo, hi = np.percentile(boots, [2.5, 97.5]) if n_boot > 0 else (np.nan, np.nan)
        versus.append({"variant": name, "deviance_diff": float(diff_rows.sum()), "ci95_low": float(lo),
                       "ci95_high": float(hi), "beats_best_baseline": bool(hi < 0) and status != NOT_EVIDENCE})

    notes = ["Simplified distributed lag (lags 0..%d); confirm with R dlnm before publication." % lags]
    if any(p.use_utci for p in variants.values()):
        notes.append("U (UTCI) overlaps with D (WBGT); prefer the simpler variant unless UTCI clearly improves held-out deviance.")
    if status == NOT_EVIDENCE:
        notes.append("Synthetic data: any HTSI advantage here is by construction and proves nothing.")
    return ComparisonReport(table=table, best_baseline=best, htsi_vs_best=pd.DataFrame(versus),
                            data_source=data_source, evidence_status=status, notes=notes)


def align_forecasts(forecast_daily: pd.DataFrame, lead_days: int) -> pd.DataFrame:
    """Select forecasts issued ``lead_days`` before the valid date, for scoring 3-5 day warnings.

    Input columns: location, issue_date, valid_date, plus daily metrics (e.g. Plan A's
    daily_summary run on NCUM/NEPS forecasts). Output uses ``date`` = valid date, ready to
    merge with observed outcomes and population. Lagged HTSI terms for days before the issue
    date should come from observations."""
    _require(forecast_daily, ("location", "issue_date", "valid_date"))
    f = forecast_daily.copy()
    lead = (pd.to_datetime(f["valid_date"]) - pd.to_datetime(f["issue_date"])).dt.days
    out = f[lead == lead_days].drop(columns="issue_date").rename(columns={"valid_date": "date"})
    out["date"] = pd.to_datetime(out["date"])
    out["lead_days"] = lead_days
    return out.reset_index(drop=True)

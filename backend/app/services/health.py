"""Stage 5 — Mortality Risk Index (R2) and its forecast-day use (R3).
IMPLEMENTATION_PLAN.md §4.2, §7.1.

What this is: a published, Ahmedabad-specific exposure-response relationship
(de Bont et al., Environ Int 2024) applied to HeatLens's own daily mean
temperature series. What it is not: a calibrated forecast of deaths. No
absolute count is produced anywhere — see schemas/health.py.

The exposure definition is the study's, unchanged: a *heatwave day* is a day
inside a run of >= 2 consecutive days whose daily MEAN temperature exceeds the
annual 97th percentile. Inside a heatwave the relative risk is the published
city-specific value (+24.9 %), graded by intensity with the study's
mutually-adjusted modifier (+3.8 % per 1 % above the threshold). The duration
modifier is deliberately NOT applied: it attenuates to null once intensity is
adjusted for, so stacking it would double-count (exposure_response_india.json).
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import pandas as pd

from app.core.config import settings
from app.core.errors import NotFoundError
from app.core.labels import EvidenceLabel
from app.data import store
from app.schemas.health import (
    CrossCheck,
    ExposureTier,
    HealthModelInfo,
    HealthRisk,
    ReferenceStat,
)

THRESHOLD_PERCENTILE = 97.0
MIN_RUN_DAYS = 2
MIN_HOURS_PER_DAY = 20  # a day with fewer hourly rows is not averaged — a partial mean is biased
CITATION = "de Bont et al., Environ Int 2024;184:108461 (PMC11790314)"
_ONE_DAY = pd.Timedelta(days=1)


@dataclass(frozen=True)
class _Coefficients:
    base_effect_pct: float
    base_ci: tuple[float, float]
    slope_pct: float
    slope_ci: tuple[float, float]
    centre_pct: float  # study mean intensity: the intensity at which base_effect applies
    published: dict  # study's own heatwave descriptives, for the reproduction table
    cross_checks: tuple[dict, ...]


@lru_cache(maxsize=1)
def _coefficients() -> _Coefficients:
    c = store.health_coefficients()
    ahm = c["city_specific"]["ahmedabad"]
    inten = c["effect_modification"]["intensity"]
    return _Coefficients(
        base_effect_pct=float(ahm["effect_pct"]),
        base_ci=(float(ahm["ci_low"]), float(ahm["ci_high"])),
        slope_pct=float(inten["mutually_adjusted_pct"]),
        slope_ci=(float(inten["mutually_adjusted_ci"][0]), float(inten["mutually_adjusted_ci"][1])),
        centre_pct=float(ahm["mean_intensity_pct_above_p97"]),
        published=ahm,
        cross_checks=tuple(c["absolute_threshold_effects"]["entries"]),
    )


def _effect_pct(intensity_pct: float) -> tuple[float, float, float]:
    """(effect, ci_low, ci_high), in percent, for a heatwave day at ``intensity_pct``.

    The point estimate is the base city effect moved along the published
    intensity slope from the study's mean intensity. The interval shifts the
    base CI by the slope CI's bounds, ignoring their covariance — an
    approximation, disclosed in ``model_info().deviations``.
    """
    k = _coefficients()
    dev = intensity_pct - k.centre_pct
    slope_lo, slope_hi = k.slope_ci
    shifts = (slope_lo * dev, slope_hi * dev)
    return (
        k.base_effect_pct + k.slope_pct * dev,
        k.base_ci[0] + min(shifts),
        k.base_ci[1] + max(shifts),
    )


def _in_run_mask(above: pd.Series) -> pd.Series:
    """True for days that sit inside a run of >= MIN_RUN_DAYS consecutive True days."""
    run_id = (above != above.shift()).cumsum()
    run_len = above.groupby(run_id).transform("size")
    return above & (run_len >= MIN_RUN_DAYS)


def daily_means_from_hourly(df: pd.DataFrame, time_col: str = "time", temp_col: str = "ta") -> pd.Series:
    """Mean of hourly air temperature per calendar day, complete days only."""
    day = pd.to_datetime(df[time_col]).dt.normalize()
    g = df.groupby(day)[temp_col]
    means = g.mean()
    return means[g.count() >= MIN_HOURS_PER_DAY]


@dataclass(frozen=True)
class Climatology:
    """Reference record the exposure threshold is computed from."""

    daily_mean: pd.Series  # contiguous daily index, NaN for any missing day
    threshold_c: float
    max_intensity_pct: float
    rr_max: float  # RR at max_intensity_pct — the anchor for MRI = 100
    reproduced: dict[str, float]


@lru_cache(maxsize=1)
def climatology() -> Climatology:
    """Annual p97 of daily mean temperature over the full 2010-2024 record.

    Needs the FULL-YEAR hourly file: the original March-June file gave a
    threshold far too high and a detector that under-fired ~6x (§7.6).
    """
    path = settings.hourly_full_csv
    if not path.exists():
        raise FileNotFoundError(f"Full-year hourly weather not found at {path} (IMPLEMENTATION_PLAN.md §7.6).")
    hourly = pd.read_csv(path, usecols=["time", "ta"], parse_dates=["time"])
    means = daily_means_from_hourly(hourly)
    full_index = pd.date_range(means.index.min(), means.index.max(), freq="D")
    means = means.reindex(full_index)  # a gap becomes NaN, which is never "above"

    thr = float(means.quantile(THRESHOLD_PERCENTILE / 100.0))
    above = means > thr
    in_run = _in_run_mask(above)
    intensity = ((means - thr) / thr * 100.0).where(in_run)

    run_id = (above != above.shift()).cumsum()
    runs = above.groupby(run_id).agg(["first", "size"])
    heatwaves = runs[runs["first"] & (runs["size"] >= MIN_RUN_DAYS)]
    years = len(means) / 365.25
    max_i = float(intensity.max())
    rr_max = 1.0 + _effect_pct(max_i)[0] / 100.0

    return Climatology(
        daily_mean=means,
        threshold_c=thr,
        max_intensity_pct=max_i,
        rr_max=rr_max,
        reproduced={
            "heatwaves_per_year": len(heatwaves) / years,
            "mean_length_days": float(heatwaves["size"].mean()),
            "heatwave_days_per_year": float(heatwaves["size"].sum()) / years,
            "mean_heatwave_temp_c": float(means[in_run].mean()),
            "mean_intensity_pct": float(intensity.mean()),
        },
    )


def historical_daily_means() -> pd.Series:
    return climatology().daily_mean


def _lookup(daily_means: pd.Series, ts: pd.Timestamp) -> float | None:
    v = daily_means.get(ts)
    return None if v is None or pd.isna(v) else float(v)


def assess(
    date: str,
    daily_means: pd.Series,
    ta_max: float | None = None,
    hi_max: float | None = None,
) -> HealthRisk:
    """Mortality risk for ``date`` given a series of daily mean temperatures.

    ``daily_means`` must contain the day itself and, when available, its two
    neighbours: whether a hot day belongs to a >= 2-day heatwave depends on
    them. A neighbour that is absent counts as "not above" — which can only
    under-call a heatwave at the very edge of a window, never over-call one.
    """
    clim = climatology()
    k = _coefficients()
    thr = clim.threshold_c

    day = pd.Timestamp(date).normalize()
    t = _lookup(daily_means, day)
    if t is None:
        raise NotFoundError(f"no complete daily mean temperature for {date!r}")

    prev_t, next_t = _lookup(daily_means, day - _ONE_DAY), _lookup(daily_means, day + _ONE_DAY)
    above = t > thr
    neighbour_above = (prev_t is not None and prev_t > thr) or (next_t is not None and next_t > thr)

    tier: ExposureTier
    intensity: float | None = None
    if above:
        intensity = (t - thr) / thr * 100.0
        tier = "heatwave" if neighbour_above else "single_day_above_p97"
    else:
        tier = "below_threshold"

    if tier == "heatwave":
        assert intensity is not None
        eff, lo, hi = _effect_pct(min(intensity, clim.max_intensity_pct))
        rr, rr_lo, rr_hi = 1.0 + eff / 100.0, 1.0 + lo / 100.0, 1.0 + hi / 100.0
        mri = 100.0 * (rr - 1.0) / (clim.rr_max - 1.0)
    else:
        rr = rr_lo = rr_hi = 1.0
        mri = 0.0

    checks = [
        CrossCheck(
            condition=entry["condition"],
            triggered=_cross_check_triggered(entry["maps_to_column"], ta_max, hi_max),
            effect_pct=float(entry["effect_pct"]),
            source="Rathi & Sodani 2021, Hyderabad (descriptive; cross-check only)",
        )
        for entry in k.cross_checks
    ]

    return HealthRisk(
        evidence=EvidenceLabel.MODELLED_UNCALIBRATED,
        exposure_tier=tier,
        daily_mean_temp_c=round(t, 2),
        threshold_p97_c=round(thr, 2),
        intensity_pct=None if intensity is None else round(intensity, 2),
        relative_risk=round(rr, 3),
        rr_ci_low=round(rr_lo, 3),
        rr_ci_high=round(rr_hi, 3),
        mri_0_100=round(min(100.0, max(0.0, mri)), 1),
        source=CITATION,
        cross_checks=checks,
    )


def _cross_check_triggered(column: str, ta_max: float | None, hi_max: float | None) -> bool:
    if column == "ta_max":
        return ta_max is not None and ta_max >= 40.0
    if column == "hi_max":
        return hi_max is not None and hi_max > 54.0
    return False


def model_info() -> HealthModelInfo:
    """Everything the Methods page needs to explain the health layer honestly."""
    clim, k = climatology(), _coefficients()
    pub = k.published
    r = clim.reproduced
    published_days = float(pub["heatwaves_per_year"]) * float(pub["mean_heatwave_length_days"])
    return HealthModelInfo(
        evidence=EvidenceLabel.MODELLED_UNCALIBRATED,
        definition=(
            "Heatwave day: a day within a run of >= 2 consecutive days whose daily mean temperature "
            "exceeds the annual 97th percentile (de Bont et al. 2024, unchanged)."
        ),
        threshold_p97_c=round(clim.threshold_c, 2),
        threshold_basis=(
            f"Annual p97 of daily mean temperature, all days 2010-2024, one Open-Meteo point "
            f"({settings.default_lat} N, {settings.default_lon} E)."
        ),
        base_effect_pct=k.base_effect_pct,
        base_ci_pct=k.base_ci,
        intensity_slope_pct_per_pct=k.slope_pct,
        intensity_slope_ci=k.slope_ci,
        intensity_centre_pct=k.centre_pct,
        mri_definition=(
            "MRI = 100 x (RR - 1) / (RR_max - 1), where RR_max is the relative risk at the highest "
            f"heatwave intensity in the 2010-2024 record ({clim.max_intensity_pct:.1f} % above threshold, "
            f"RR {clim.rr_max:.2f}). 0 = no published heatwave exposure. A design choice for mapping, not a published scale."
        ),
        reference_stats=[
            ReferenceStat(name="Heatwaves per year", published=float(pub["heatwaves_per_year"]),
                          reproduced=round(r["heatwaves_per_year"], 2), unit="per year"),
            ReferenceStat(name="Mean heatwave length", published=float(pub["mean_heatwave_length_days"]),
                          reproduced=round(r["mean_length_days"], 2), unit="days"),
            ReferenceStat(name="Heatwave days per year (waves x length)", published=round(published_days, 1),
                          reproduced=round(r["heatwave_days_per_year"], 1), unit="days/yr"),
            ReferenceStat(name="Mean heatwave temperature", published=float(pub["mean_heatwave_temp_c"]),
                          reproduced=round(r["mean_heatwave_temp_c"], 2), unit="deg C"),
            ReferenceStat(name="Mean intensity above p97", published=float(pub["mean_intensity_pct_above_p97"]),
                          reproduced=round(r["mean_intensity_pct"], 2), unit="%"),
        ],
        deviations=[
            "Exposure series is one Open-Meteo point, not the study's ERA5 0.25-degree grid mean over the "
            "municipal boundary; the reproduction table shows how close the resulting heatwave statistics are.",
            "The published intensity modifier is per heatwave-MEAN intensity. HeatLens applies it to each "
            "day's own intensity, centred on the study's mean, so the index responds daily.",
            "Intervals for graded values shift the base CI by the modifier's CI bounds and ignore their "
            "covariance. This approximation is not a published interval.",
            f"Intensity is capped at the highest value seen in the reference record ({clim.max_intensity_pct:.1f} %): "
            "no extrapolation beyond observed exposure.",
            "One threshold for the whole record (annual p97 over all years), not a per-year percentile.",
        ],
        not_modelled=[
            "Absolute deaths or admissions: daily outcome data for Ahmedabad is confidential and not held, "
            "so no calibration exists. Relative risk only.",
            "Hospitalisation-spike forecast: needs a daily heat-illness admissions series (NCDC/IHIP).",
            "Ward vulnerability adjustment: no ward-level age or worker data for Ahmedabad is in this repo.",
            "Distributed-lag (DLNM) fitting: needs daily outcome data. The cited Hyderabad study finds the "
            "association peaks at lag 0, which is consistent with same-day scoring but is not a fitted lag model.",
        ],
        citation=CITATION,
    )

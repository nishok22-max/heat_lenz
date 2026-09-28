"""Plan A - internationally standardised heat-stress metrics.

Every function either implements a published method exactly or wraps ECMWF's
``thermofeel`` library (Apache-2.0), which ports Liljegren's reference WBGT code
and the Broede et al. UTCI polynomial. The source is cited in each docstring.
These metrics are the trusted baseline and the benchmarks Plan B must beat.

Units unless stated otherwise: air temperature degC, relative humidity %,
10 m wind speed m/s, surface pressure hPa, irradiance W/m2.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import thermofeel as tf
from thermofeel import liljegren as lil

__all__ = [
    "heat_index_nws",
    "wet_bulb_stull",
    "stull_in_range",
    "wbgt_iso7243",
    "dew_point",
    "cos_solar_zenith",
    "direct_beam_fraction",
    "liljegren_wbgt",
    "utci",
    "imd_heat_index_colour",
    "utci_heat_category",
    "wbgt_is_critical",
    "imd_heatwave_level",
    "compute_hourly",
    "daily_summary",
]

WBGT_CRITICAL_C = 33.0
UTCI_HEAT_BANDS = ((26.0, "Moderate heat stress"), (32.0, "Strong heat stress"),
                   (38.0, "Very strong heat stress"), (46.0, "Extreme heat stress"))


def _f(x) -> np.ndarray:
    return np.asarray(x, dtype=float)


def _out(a):
    a = np.asarray(a)
    return a.item() if a.ndim == 0 else a


# --------------------------------------------------------------------------- humidity-based metrics
def heat_index_nws(ta_c, rh):
    """Heat Index in degC.

    NOAA/NWS Weather Prediction Center, "The Heat Index Equation":
    the simple formula is evaluated first and averaged with the air temperature; if that
    average is >= 80 degF the Rothfusz regression is used, with the low-humidity
    (RH < 13 %, 80-112 degF) and high-humidity (RH > 85 %, 80-87 degF) adjustments.
    https://www.wpc.ncep.noaa.gov/html/heatindex_equation.shtml
    IMD's experimental Heat Index uses an equation similar to this one (PIB, July 2023).
    """
    t = _f(ta_c) * 9.0 / 5.0 + 32.0
    rh = _f(rh)
    simple = 0.5 * (t + 61.0 + (t - 68.0) * 1.2 + rh * 0.094)
    full = (-42.379 + 2.04901523 * t + 10.14333127 * rh - 0.22475541 * t * rh
            - 0.00683783 * t * t - 0.05481717 * rh * rh + 0.00122874 * t * t * rh
            + 0.00085282 * t * rh * rh - 0.00000199 * t * t * rh * rh)
    low = (rh < 13.0) & (t >= 80.0) & (t <= 112.0)
    full = np.where(low, full - ((13.0 - rh) / 4.0) * np.sqrt(np.clip(17.0 - np.abs(t - 95.0), 0.0, None) / 17.0), full)
    high = (rh > 85.0) & (t >= 80.0) & (t <= 87.0)
    full = np.where(high, full + ((rh - 85.0) / 10.0) * ((87.0 - t) / 5.0), full)
    hi_f = np.where((simple + t) / 2.0 < 80.0, simple, full)
    return _out((hi_f - 32.0) * 5.0 / 9.0)


def wet_bulb_stull(ta_c, rh):
    """Psychrometric wet-bulb temperature in degC.

    Stull (2011), J. Appl. Meteor. Climatol. 50:2267-2269, https://doi.org/10.1175/JAMC-D-11-0143.1
    Valid for RH 5-99 % and -20..50 degC at standard sea-level pressure (see ``stull_in_range``).
    """
    t, rh = _f(ta_c), _f(rh)
    tw = (t * np.arctan(0.151977 * np.sqrt(rh + 8.313659)) + np.arctan(t + rh)
          - np.arctan(rh - 1.676331) + 0.00391838 * rh ** 1.5 * np.arctan(0.023101 * rh) - 4.686035)
    return _out(tw)


def stull_in_range(ta_c, rh):
    """True where the Stull (2011) regression is inside its published validity range."""
    t, rh = _f(ta_c), _f(rh)
    return _out((rh >= 5.0) & (rh <= 99.0) & (t >= -20.0) & (t <= 50.0))


def wbgt_iso7243(tnw_c, tg_c, ta_c=None, outdoor=True):
    """WBGT from its components (ISO 7243): outdoor 0.7 Tnw + 0.2 Tg + 0.1 Ta; indoor 0.7 Tnw + 0.3 Tg."""
    if outdoor:
        if ta_c is None:
            raise ValueError("outdoor WBGT needs air temperature ta_c")
        return _out(0.7 * _f(tnw_c) + 0.2 * _f(tg_c) + 0.1 * _f(ta_c))
    return _out(0.7 * _f(tnw_c) + 0.3 * _f(tg_c))


def dew_point(ta_c, rh):
    """Dew point in degC (Alduchov & Eskridge 1996 Magnus form, via thermofeel)."""
    return _out(tf.calculate_dew_point_from_relative_humidity(_f(rh), _f(ta_c) + 273.15) - 273.15)


# --------------------------------------------------------------------------- solar geometry
def _utc_index(time) -> pd.DatetimeIndex:
    """Timezone-aware input is converted to UTC; naive input is taken as UTC."""
    if isinstance(time, (pd.Series, pd.Index)):
        return pd.DatetimeIndex(pd.to_datetime(time, utc=True))
    return pd.DatetimeIndex(pd.to_datetime(np.atleast_1d(time), utc=True))


def cos_solar_zenith(lat, lon, time):
    """Cosine of the solar zenith angle.

    NOAA Global Monitoring Laboratory, "General Solar Position Calculations"
    (fractional year, equation of time, declination, true solar time, hour angle).
    https://gml.noaa.gov/grad/solcalc/solareqns.PDF
    ``lon`` is positive east. Time is converted to UTC, so the timezone term is zero.
    """
    t = _utc_index(time)
    doy = t.dayofyear.to_numpy()
    hour = (t.hour + t.minute / 60.0 + t.second / 3600.0).to_numpy()
    days_in_year = np.where(t.is_leap_year, 366.0, 365.0)
    g = 2.0 * np.pi / days_in_year * (doy - 1 + (hour - 12.0) / 24.0)
    eqtime = 229.18 * (0.000075 + 0.001868 * np.cos(g) - 0.032077 * np.sin(g)
                       - 0.014615 * np.cos(2 * g) - 0.040849 * np.sin(2 * g))
    decl = (0.006918 - 0.399912 * np.cos(g) + 0.070257 * np.sin(g) - 0.006758 * np.cos(2 * g)
            + 0.000907 * np.sin(2 * g) - 0.002697 * np.cos(3 * g) + 0.00148 * np.sin(3 * g))
    tst = hour * 60.0 + eqtime + 4.0 * _f(lon)
    ha = np.radians(tst / 4.0 - 180.0)
    phi = np.radians(_f(lat))
    cosz = np.sin(phi) * np.sin(decl) + np.cos(phi) * np.cos(decl) * np.cos(ha)
    cosz = np.clip(cosz, -1.0, 1.0)
    return cosz.item() if np.ndim(time) == 0 and cosz.size == 1 else cosz


def direct_beam_fraction(ghi, direct_horizontal):
    """Fraction of global horizontal irradiance that is direct beam (0 when GHI is 0)."""
    ghi, direct = _f(ghi), _f(direct_horizontal)
    with np.errstate(invalid="ignore", divide="ignore"):
        frac = np.where(ghi > 0.0, direct / ghi, 0.0)
    return _out(np.clip(frac, 0.0, 1.0))


# --------------------------------------------------------------------------- radiation-aware metrics
def liljegren_wbgt(ta_c, rh, pressure_hpa, wind10, ghi, fdir, cossza) -> dict:
    """Outdoor WBGT and its components by the Liljegren et al. (2008) model.

    Liljegren et al. (2008), J. Occup. Environ. Hyg. 5(10):645-655, https://doi.org/10.1080/15459620802310770
    Uses thermofeel's port of the reference code (``thermofeel.liljegren``) with the same
    KNMI guards as ``thermofeel.calculate_wbgt_liljegren``: 10 m wind floored at 0.62 m/s and
    scaled to 2 m with the stability-dependent profile; direct fraction clamped to [0, 0.9]
    and zeroed when the sun is below 89.5 deg zenith.

    Returns degC arrays: ``globe`` (Tg, 50.8 mm globe), ``natural_wet_bulb`` (Tnw), ``wbgt``,
    ``wind_2m`` (m/s) and ``mrt``. ``mrt`` is the radiant temperature implied by the same
    globe energy balance: Tmrt^4 = Tg^4 + h / (eps_g * sigma) * (Tg - Ta), with the
    convective coefficient h of the Liljegren globe (ISO 7726 globe method, Liljegren globe).
    NaN where the iteration did not converge.
    """
    ta, rh, p, va, ghi, fdir, cz = np.broadcast_arrays(
        _f(ta_c), _f(rh), _f(pressure_hpa), _f(wind10), _f(ghi), _f(fdir), _f(cossza))
    t2_k = ta + 273.15
    va = np.maximum(va, lil.MIN_WIND_10M)
    fdir = np.clip(fdir, 0.0, 0.9)
    fdir = np.where(cz < lil.CZA_MIN, 0.0, fdir)
    speed_2m = lil.wind_speed_2m(va, cz, ghi)
    tg = lil.solve_globe(t2_k, rh / 100.0, p, speed_2m, ghi, fdir, cz)
    tnw = lil.solve_wetbulb(t2_k, rh / 100.0, p, speed_2m, ghi, fdir, cz, 1.0)
    wbgt = 0.7 * tnw + 0.2 * tg + 0.1 * ta

    tg_k = tg + 273.15
    h = lil.h_sphere_in_air(0.5 * (tg_k + t2_k), p, speed_2m)
    with np.errstate(invalid="ignore"):
        mrt = (tg_k ** 4 + h / (lil.STEFANB * lil.EMIS_GLOBE) * (tg_k - t2_k)) ** 0.25 - 273.15
    return {k: _out(v) for k, v in
            {"globe": tg, "natural_wet_bulb": tnw, "wbgt": wbgt, "wind_2m": speed_2m, "mrt": mrt}.items()}


def utci(ta_c, wind10, mrt_c, rh):
    """Universal Thermal Climate Index in degC (Broede et al. 2012 polynomial, via thermofeel).

    https://doi.org/10.1007/s00484-011-0454-1 . thermofeel does not clamp inputs, so values
    outside the polynomial's documented fitting range are returned as NaN here:
    air temperature -50..50 degC, 10 m wind 0.5..17 m/s, Tmrt - Ta from -30 to +70 degC,
    water vapour pressure <= 50 hPa.
    """
    ta, va, mrt, rh = np.broadcast_arrays(_f(ta_c), _f(wind10), _f(mrt_c), _f(rh))
    t2_k = ta + 273.15
    e_hpa = tf.calculate_saturation_vapour_pressure(t2_k) * rh / 100.0
    with np.errstate(invalid="ignore", over="ignore"):
        u = tf.calculate_utci(t2_k, va, mrt + 273.15, ehPa=e_hpa) - 273.15
    d = mrt - ta
    valid = ((ta >= -50) & (ta <= 50) & (va >= 0.5) & (va <= 17)
             & (d >= -30) & (d <= 70) & (e_hpa <= 50) & np.isfinite(mrt))
    return _out(np.where(valid, u, np.nan))


# --------------------------------------------------------------------------- categories
def imd_heat_index_colour(hi_c):
    """IMD experimental Heat Index colour (PIB, July 2023): Green < 35, Yellow 36-45,
    Orange 46-55, Red > 55 degC. Values between the published integer bands are assigned
    to the higher band (e.g. 35.5 -> Yellow). NaN -> None."""
    hi = _f(hi_c)
    colour = np.select([hi <= 35.0, hi <= 45.0, hi <= 55.0], ["Green", "Yellow", "Orange"], "Red").astype(object)
    colour[np.isnan(hi)] = None
    return _out(colour)


def utci_heat_category(utci_c):
    """UTCI heat-stress category (Broede et al. assessment scale): 26-32 moderate,
    32-38 strong, 38-46 very strong, > 46 extreme; below 26 no heat stress. NaN -> None."""
    u = _f(utci_c)
    labels = np.full(u.shape, "No heat stress", dtype=object)
    for lower, label in UTCI_HEAT_BANDS:
        labels[u >= lower] = label
    labels[np.isnan(u)] = None
    return _out(labels)


def wbgt_is_critical(wbgt_c):
    """WBGT >= 33 degC, cited as a critical health threshold (rest only) - see
    https://pmc.ncbi.nlm.nih.gov/articles/PMC9941479/ ."""
    return _out(_f(wbgt_c) >= WBGT_CRITICAL_C)


def imd_heatwave_level(ta_max_c, normal_tmax_c, region="plains"):
    """IMD heat-wave criteria for one station-day: 0 none, 1 heat wave, 2 severe heat wave.

    IMD "FAQ on Heat Wave": considered only if Tmax >= 40 degC (plains) or >= 30 degC (hilly);
    departure 4.5-6.4 degC -> heat wave, > 6.4 degC -> severe; coastal stations: departure
    >= 4.5 degC with Tmax >= 37 degC. NDMA: Tmax >= 45 degC is a heat wave irrespective of normal.
    IMD's "at least 2 stations in a sub-division for 2 consecutive days" rule is a
    sub-division declaration rule and is not applied here.
    """
    ta = _f(ta_max_c)
    dep = ta - _f(normal_tmax_c)
    floor = {"plains": 40.0, "hilly": 30.0, "coastal": 37.0}.get(region)
    if floor is None:
        raise ValueError("region must be 'plains', 'hilly' or 'coastal'")
    base = (ta >= floor) & (dep >= 4.5)
    level = np.where(base & (dep > 6.4), 2, np.where(base | (ta >= 45.0), 1, 0))
    return _out(level)


# --------------------------------------------------------------------------- pipeline
HOURLY_COLUMNS = ("time", "ta", "rh", "wind10", "pressure", "ghi", "direct")


def compute_hourly(df: pd.DataFrame, lat: float, lon: float, tz: str = "Asia/Kolkata",
                   radiation_shift_minutes: float = -30.0) -> pd.DataFrame:
    """Add all Plan A metrics to an hourly weather table.

    Required columns: time (local, naive or tz-aware), ta, rh, wind10, pressure (hPa),
    ghi (shortwave radiation) and direct (direct horizontal radiation), both W/m2.
    ``radiation_shift_minutes`` places the solar zenith angle inside the averaging
    interval of the radiation values (-30 for preceding-hour averages, 0 for instantaneous).
    """
    missing = [c for c in HOURLY_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"missing columns: {missing}")
    out = df.copy()
    t = pd.to_datetime(out["time"])
    if t.dt.tz is None:
        t = t.dt.tz_localize(tz)
    out["time"] = t

    cz = cos_solar_zenith(lat, lon, t + pd.Timedelta(minutes=radiation_shift_minutes))
    out["cossza"] = cz
    out["fdir"] = direct_beam_fraction(out["ghi"], out["direct"])
    out["heat_index"] = heat_index_nws(out["ta"], out["rh"])
    out["imd_hi_colour"] = imd_heat_index_colour(out["heat_index"])
    out["wet_bulb"] = wet_bulb_stull(out["ta"], out["rh"])
    out["wet_bulb_in_range"] = stull_in_range(out["ta"], out["rh"])
    out["dew_point"] = dew_point(out["ta"], out["rh"])

    w = liljegren_wbgt(out["ta"], out["rh"], out["pressure"], out["wind10"], out["ghi"], out["fdir"], cz)
    out["wind_2m"] = w["wind_2m"]
    out["globe"] = w["globe"]
    out["natural_wet_bulb"] = w["natural_wet_bulb"]
    out["wbgt"] = w["wbgt"]
    out["wbgt_critical"] = wbgt_is_critical(out["wbgt"])
    out["mrt"] = w["mrt"]
    out["utci"] = utci(out["ta"], out["wind10"], out["mrt"], out["rh"])
    out["utci_category"] = utci_heat_category(out["utci"])
    return out


def daily_summary(hourly: pd.DataFrame, night_start: int = 20, night_end: int = 7,
                  min_hours: int = 20, min_night_hours: int = 8) -> pd.DataFrame:
    """Daily aggregates per local calendar date.

    ``night_min_ta`` is the minimum air temperature of the night *following* the date
    (night_start on the date to night_end the next morning); NaN if fewer than
    ``min_night_hours`` hours are available. ``complete`` flags days with >= ``min_hours`` hours.
    """
    h = hourly.copy()
    t = pd.to_datetime(h["time"])
    h["date"] = t.dt.date
    g = h.groupby("date")
    daily = pd.DataFrame({
        "ta_max": g["ta"].max(),
        "ta_min": g["ta"].min(),
        "hi_max": g["heat_index"].max(),
        "tw_max": g["wet_bulb"].max(),
        "wbgt_max": g["wbgt"].max(),
        "wbgt_mean": g["wbgt"].mean(),
        "mrt_max": g["mrt"].max(),
        "utci_max": g["utci"].max(),
        "hours_wbgt_ge_33": g["wbgt_critical"].sum(),
        "n_hours": g["ta"].count(),
    })
    is_night = (t.dt.hour >= night_start) | (t.dt.hour < night_end)
    night_date = (t[is_night] - pd.Timedelta(hours=night_end)).dt.date
    ng = h.loc[is_night, "ta"].groupby(night_date)
    daily["night_min_ta"] = ng.min().where(ng.count() >= min_night_hours).reindex(daily.index)
    daily["imd_hi_colour"] = imd_heat_index_colour(daily["hi_max"])
    daily["utci_category"] = utci_heat_category(daily["utci_max"])
    daily["complete"] = daily["n_hours"] >= min_hours
    daily.index.name = "date"
    return daily.reset_index()

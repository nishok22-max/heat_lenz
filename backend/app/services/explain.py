"""'Why is it so hot here?' - short, plain-English reasons for one ward on one day.

Every sentence is built from a measured or computed value; nothing is phrased as a cause unless
the data behind it supports it:
- today's weather reason: the largest part of the day's HeatLens heat-stress score (the same
  for every ward - one weather input for the city);
- the ward's own ground temperature, day and night (MODIS), and its rank among the 48 wards;
- what the ward's ground is made of (ESA WorldCover 2021), compared with the city average - and
  a land-cover sentence is only used when that land type is actually linked to ground
  temperature across Ahmedabad's wards in this data (|r| >= LINK_R, from
  backend/scripts/build_ward_landcover.py).
"""
from __future__ import annotations

import json
from functools import lru_cache

from app.core.config import settings
from app.core.labels import EvidenceLabel
from app.schemas.risk import LandCover

LINK_R = 0.3  # minimum |Pearson r| across the 48 wards before a land-cover link is stated

_DRIVER = {
    "WBGT (Humidity)": "Today the air is hot and humid, so sweat cannot cool the body well.",
    "UTCI (Solar/Wind)": "Today the sun is strong and there is little wind to carry the heat away.",
    "Tmax Surge (X)": "Today is much hotter than normal for this time of year.",
    "Heat Debt (Plan C)": "Nights have stayed hot, so people's bodies have not had time to recover.",
}


@lru_cache(maxsize=1)
def _landcover() -> dict | None:
    path = settings.ward_landcover_json
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def land_cover(zone_id: str) -> LandCover | None:
    lc = _landcover()
    w = lc["wards"].get(zone_id) if lc else None
    if not w:
        return None
    city, r = lc["city_average"], lc["correlation_across_wards"]
    return LandCover(
        evidence=EvidenceLabel.MEASURED_SATELLITE,
        built_up_pct=w["built_up_pct"],
        trees_pct=w["trees_pct"],
        grass_shrub_pct=w["grass_shrub_pct"],
        cropland_pct=w["cropland_pct"],
        bare_pct=w["bare_pct"],
        water_pct=w["water_pct"],
        city_built_up_pct=city["built_up_pct"],
        city_trees_pct=city["trees_pct"],
        city_cropland_pct=city["cropland_pct"],
        city_water_pct=city["water_pct"],
        r_built_up_night=r["built_up_vs_night_ground"],
        r_trees_day=r["trees_vs_day_ground"],
        r_trees_night=r["trees_vs_night_ground"],
        r_cropland_night=r["cropland_vs_night_ground"],
        r_water_day=r["water_vs_day_ground"],
        basis=lc["source"],
    )


def _ordinal(n: int) -> str:
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def _rank_phrase(value: float, values: list[float], n: int) -> str:
    if value >= 0:
        return f"{_ordinal(1 + sum(v > value for v in values))} hottest of {n} wards"
    return f"{_ordinal(1 + sum(v < value for v in values))} coolest of {n} wards"


def why_hot(
    dominant_driver: str,
    day_anomaly: float | None,
    night_anomaly: float | None,
    all_day: list[float],
    all_night: list[float],
    lc: LandCover | None,
) -> list[str]:
    out: list[str] = []
    if dominant_driver in _DRIVER:
        out.append(_DRIVER[dominant_driver])

    n = len(all_day)
    if day_anomaly is not None and n:
        a = round(day_anomaly, 1)
        if a >= 0.5:
            out.append(f"By day, roofs and roads here get {a} °C hotter than the city average ({_rank_phrase(day_anomaly, all_day, n)}).")
        elif a <= -0.5:
            out.append(f"By day, the ground here stays {abs(a)} °C cooler than the city average ({_rank_phrase(day_anomaly, all_day, n)}).")
        else:
            out.append("By day, the ground here is about as hot as the city average.")
    if night_anomaly is not None and len(all_night):
        a = round(night_anomaly, 1)
        if a >= 0.5:
            out.append(f"At night it stays {a} °C warmer than the city average, so there is less relief after sunset ({_rank_phrase(night_anomaly, all_night, len(all_night))}).")
        elif a <= -0.5:
            out.append(f"At night it cools down {abs(a)} °C more than the city average.")

    if lc is not None:
        # A land-cover reason is only given when this ward's own measurement points the same way.
        warm_night = night_anomaly is not None and night_anomaly >= 0.5
        cool_night = night_anomaly is not None and night_anomaly <= -0.5
        warm_any = any(v is not None and v >= 0.5 for v in (day_anomaly, night_anomaly))
        cool_any = any(v is not None and v <= -0.5 for v in (day_anomaly, night_anomaly))

        if lc.r_built_up_night >= LINK_R and warm_night and lc.built_up_pct >= lc.city_built_up_pct + 5:
            out.append(
                f"{lc.built_up_pct:.0f}% of this ward is buildings and roads (city average {lc.city_built_up_pct:.0f}%). "
                "Concrete soaks up heat by day and gives it back at night - across Ahmedabad, wards with more of it have warmer nights."
            )
        elif lc.r_built_up_night >= LINK_R and cool_night and lc.built_up_pct <= lc.city_built_up_pct - 5:
            out.append(
                f"Only {lc.built_up_pct:.0f}% of this ward is buildings and roads (city average {lc.city_built_up_pct:.0f}%), so less heat is stored for the night."
            )
        if min(lc.r_trees_day, lc.r_trees_night) <= -LINK_R:
            trees = "almost no trees (under 1%)" if lc.trees_pct < 1 else f"trees on only {lc.trees_pct:.0f}% of the ward"
            if warm_any and lc.trees_pct <= lc.city_trees_pct - 3:
                out.append(f"It has {trees} (city average {lc.city_trees_pct:.0f}%). In Ahmedabad, wards with more trees have cooler ground.")
            elif cool_any and lc.trees_pct >= lc.city_trees_pct + 3:
                out.append(f"{lc.trees_pct:.0f}% of the ward has trees (city average {lc.city_trees_pct:.0f}%), which helps keep the ground cooler.")
        if lc.r_cropland_night <= -LINK_R and cool_night and lc.cropland_pct >= lc.city_cropland_pct + 10:
            out.append(f"{lc.cropland_pct:.0f}% is open farmland, which cools down quickly after dark.")
        if lc.r_water_day <= -LINK_R and day_anomaly is not None and day_anomaly <= -0.5 and lc.water_pct >= 5:
            out.append(f"Lakes or the river cover {lc.water_pct:.0f}% of the ward, which helps cool the ground by day.")
    return out

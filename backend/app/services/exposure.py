"""Stage 4 — exposure & vulnerability. IMPLEMENTATION_PLAN.md §4.2, §7.1, §7.5.

Two real inputs, each with its own evidence label:

* Ward population — JRC GHS-POP R2023A (epoch 2020, 100 m) summed over each real AMC
  ward polygon by backend/scripts/build_ward_population.py. A published MODEL of where
  census counts live, so ``population_evidence`` is MODELLED_PUBLISHED, not a headcount.
  Census 2011's own ward table can't be used directly: it counts the 57 wards of 2011,
  and no boundary file exists to map those onto today's 48.
* Elderly (60+) share — Census 2011 C-13, Ahmedabad district URBAN population
  (app/data/census.py). Real census, but C-13 has no ward breakdown, so the same figure
  applies to every ward and ``elderly_share_geography`` says so.
"""
from __future__ import annotations

import json
from functools import lru_cache

from app.core.config import settings
from app.core.labels import EvidenceLabel
from app.data.census import ahmedabad_urban_elderly_share
from app.schemas.risk import ZoneExposure

_POPULATION_MISSING = (
    "Not available: backend/app/data/ward_population.json has not been built. Run "
    "backend/scripts/build_ward_population.py."
)


@lru_cache(maxsize=1)
def _ward_population() -> dict | None:
    if not settings.ward_population_json.exists():
        return None
    return json.loads(settings.ward_population_json.read_text(encoding="utf-8"))


def _population_status(data: dict) -> str:
    c = data["census_2011_check"]
    return (
        f"{data['source']} A published model of where people live, not a headcount. "
        f"All 48 wards together: {data['ward_total_population']:,} (2020). Cross-check: Census "
        f"2011 counted {c['total_population']:,} in AMC across the {c['ward_count_2011']} wards "
        f"of 2011 - a different year and a different ward delimitation, so the two are not "
        f"expected to match."
    )


def zone_exposure(zone_id: str) -> ZoneExposure:
    s = ahmedabad_urban_elderly_share()
    data = _ward_population()
    ward = data["wards"].get(zone_id) if data else None
    return ZoneExposure(
        evidence=EvidenceLabel.MEASURED_CENSUS,
        population_count=ward["population"] if ward else None,
        population_density_per_km2=ward["density_per_km2"] if ward else None,
        population_evidence=EvidenceLabel.MODELLED_PUBLISHED if ward else None,
        population_status=_population_status(data) if ward else _POPULATION_MISSING,
        elderly_share_pct=s.share_pct,
        elderly_share_geography="district_urban",
        elderly_share_basis=(
            f"Census 2011 table C-13, {s.state_name}: {s.population_60_plus:,} aged 60+ of "
            f"{s.total_population:,}. No ward-level age table exists, so every ward shows this "
            f"same real figure."
        ),
    )

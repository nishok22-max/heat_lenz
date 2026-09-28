"""Heat Action Plan level and actions — requirement R6.

The level is the Ahmedabad Municipal Corporation's own published colour signal
(AMC Heat Action Plan 2019, "Color Signals for Heat Alert"), applied to the
city's daily maximum temperature. The thresholds and the department actions live
in rules/hap_rules.toml, with their source, so they can be checked against the
plan without reading code.

HeatLens's own thermal-stress band and the published-heatwave mortality signal
are reported in the basis as context. They do not move the level: their cut-offs
are not part of any published plan.
"""
from __future__ import annotations

import tomllib
from dataclasses import dataclass
from functools import lru_cache

from app.core.config import settings
from app.schemas.alerts import HapAction, HapLevel
from app.schemas.health import HealthRisk

RULES_PATH = settings.repo_root / "backend" / "rules" / "hap_rules.toml"
LEVEL_ORDER: tuple[HapLevel, ...] = ("Green", "Yellow", "Orange", "Red")
AMC_NAME: dict[HapLevel, str] = {
    "Green": "White - No Alert",
    "Yellow": "Yellow Alert - Hot Day Advisory",
    "Orange": "Orange Alert - Heat Alert Day",
    "Red": "Red Alert - Extreme Heat Alert Day",
}


@dataclass(frozen=True)
class HapDecision:
    level: HapLevel
    basis: str


@dataclass(frozen=True)
class _ActionRule:
    min_level: HapLevel
    action: HapAction


@dataclass(frozen=True)
class _Config:
    source: str
    yellow_min_c: float
    orange_min_c: float
    red_min_c: float
    actions: tuple[_ActionRule, ...]


def level_rank(level: str) -> int:
    return LEVEL_ORDER.index(level)  # type: ignore[arg-type]


@lru_cache(maxsize=1)
def _config() -> _Config:
    if not RULES_PATH.exists():
        raise FileNotFoundError(f"HAP rules not found at {RULES_PATH}")
    data = tomllib.loads(RULES_PATH.read_text(encoding="utf-8"))
    levels = data["levels"]
    rules = tuple(
        _ActionRule(
            min_level=a["min_level"],
            action=HapAction(
                action_id=a["action_id"],
                department=a["department"],
                kind=a["kind"],
                title=a["title"],
                detail=a["detail"],
                basis=a["basis"],
            ),
        )
        for a in data["actions"]
    )
    return _Config(
        source=levels["source"],
        yellow_min_c=float(levels["yellow_min_c"]),
        orange_min_c=float(levels["orange_min_c"]),
        red_min_c=float(levels["red_min_c"]),
        actions=rules,
    )


def amc_level(ta_max_c: float) -> HapLevel:
    # AMC's table is written to one decimal (41.1-43, 43.1-44.9), so compare at that precision.
    cfg = _config()
    t = round(ta_max_c, 1)
    if t >= cfg.red_min_c:
        return "Red"
    if t >= cfg.orange_min_c:
        return "Orange"
    if t >= cfg.yellow_min_c:
        return "Yellow"
    return "Green"


def decide(city_ta_max_c: float, risk_band: str, health: HealthRisk, tmax_source: str = "") -> HapDecision:
    """AMC's published level for this day's city Tmax, with HeatLens's own signals named as context."""
    cfg = _config()
    level = amc_level(city_ta_max_c)
    source = f" ({tmax_source})" if tmax_source else ""
    basis = (
        f"{AMC_NAME[level]}: city max temperature {city_ta_max_c:.1f} C{source} against AMC thresholds "
        f"(Yellow >= {cfg.yellow_min_c} C, Orange >= {cfg.orange_min_c} C, Red >= {cfg.red_min_c} C; "
        f"{cfg.source}). Context, not used for the level: HeatLens thermal-stress band {risk_band}; "
        f"published-heatwave exposure tier {health.exposure_tier}."
    )
    return HapDecision(level=level, basis=basis)


def actions_for(level: str) -> list[HapAction]:
    """Every action whose min_level is at or below ``level`` — Red includes Orange's."""
    rank = level_rank(level)
    return [r.action for r in _config().actions if level_rank(r.min_level) <= rank]

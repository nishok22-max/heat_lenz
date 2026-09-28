"""The assistant's tools: read-only views over HeatLens's existing services.

No tool computes anything new. Each one calls the same service the dashboard's API route calls
and returns a compact, rounded subset, so the model sees the dashboard's own numbers and the
output guard can check every figure in an answer against them.

Arguments are validated by Pydantic models with ``extra="forbid"``: a ward must be one of the 48
real ward IDs, a date must be a real calendar date in a window the data covers, a persona or
topic must come from a fixed list. The model never supplies a query, a path or code; a bad
argument comes back to it as an error message and nothing runs.
"""
from __future__ import annotations

import asyncio
import difflib
import json
import logging
import re
import time
from datetime import date as _date, timedelta
from typing import Any, Awaitable, Callable, Literal

import pandas as pd
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from app.core.cache import TTLCache
from app.core.config import settings
from app.data import registry
from app.services import advisory, alerts, forecast, frames, hap, hourly, spatial, validation

log = logging.getLogger(__name__)

CITY = settings.default_city_id
CITY_KINDS = {"cooling_centre", "vulnerable_check", "regional_alert"}  # frontend/src/lib/advice.ts

_result_cache = TTLCache(ttl_seconds=5 * 60)
_ctx_cache = TTLCache(ttl_seconds=5 * 60)
_ctx_locks: dict[str, asyncio.Lock] = {}
_snapshot_lock = asyncio.Lock()


class ToolError(Exception):
    """A tool refused its arguments or had no data. The message goes back to the model."""


def _r(x: Any, nd: int = 1) -> Any:
    if x is None:
        return None
    if isinstance(x, float):
        return None if pd.isna(x) else round(x, nd)
    return x


def today() -> str:
    city = registry.get_city(CITY)
    return pd.Timestamp.now(tz=city.tz if city else settings.default_tz).strftime("%Y-%m-%d")


def ward_ids() -> dict[str, str]:
    return {z.zone_id: z.name for z in spatial.list_zones()}


def _check_date(value: str) -> str:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value or ""):
        raise ValueError("date must be YYYY-MM-DD")
    d = _date.fromisoformat(value)
    t = _date.fromisoformat(today())
    live = t - timedelta(days=forecast.DEFAULT_PAST_DAYS) <= d <= t + timedelta(days=forecast.DEFAULT_FORECAST_DAYS)
    history = 2010 <= d.year <= 2024 and 3 <= d.month <= 6
    if not (live or history):
        raise ValueError(
            f"no data for {value}: the forecast covers {t - timedelta(days=forecast.DEFAULT_PAST_DAYS)} "
            f"to {t + timedelta(days=forecast.DEFAULT_FORECAST_DAYS)}; history covers March-June 2010-2024"
        )
    return value


class _Args(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, str_max_length=80)


class FindWardArgs(_Args):
    name: str = Field(min_length=2, max_length=60, description="Ward or area name as the user wrote it")


class WardDateArgs(_Args):
    ward_id: str = Field(pattern=r"^ward-\d{2}$", description="A ward_id from find_ward, e.g. ward-07")
    date: str | None = Field(None, description="YYYY-MM-DD; omit for today")

    @field_validator("ward_id")
    @classmethod
    def _known_ward(cls, v: str) -> str:
        if v not in ward_ids():
            raise ValueError(f"unknown ward_id {v!r}; call find_ward first")
        return v

    @field_validator("date")
    @classmethod
    def _date(cls, v: str | None) -> str | None:
        return None if v is None else _check_date(v)


class AdviceArgs(WardDateArgs):
    persona: Literal["general", "construction", "elderly"] = Field(
        "general", description="construction = any outdoor worker; elderly = older or vulnerable people"
    )


class DateArgs(_Args):
    date: str | None = Field(None, description="YYYY-MM-DD; omit for today")

    @field_validator("date")
    @classmethod
    def _date(cls, v: str | None) -> str | None:
        return None if v is None else _check_date(v)


class ForecastArgs(_Args):
    days: int = Field(5, ge=1, le=5)


MethodTopic = Literal[
    "heat_stress_measures", "weather_data", "forecast_accuracy", "amc_alert", "heatlens_score",
    "health_risk", "surface_temperature", "population", "land_cover", "validation", "sms_alerts",
    "limitations",
]


class MethodArgs(_Args):
    topic: MethodTopic


class RememberArgs(_Args):
    ward_id: str | None = Field(None, pattern=r"^ward-\d{2}$")
    role: Literal["resident", "outdoor_worker", "official", "health_worker", "employer"] | None = None
    language: Literal["en", "hi", "gu"] | None = None
    detail: Literal["simple", "detailed"] | None = None
    group: Literal["elderly", "child", "pregnant", "chronic_illness", "none"] | None = None

    @field_validator("ward_id")
    @classmethod
    def _known_ward(cls, v: str | None) -> str | None:
        if v is not None and v not in ward_ids():
            raise ValueError(f"unknown ward_id {v!r}")
        return v


async def _ctx(date: str) -> frames.DayContext:
    """frames.resolve with a short cache: a cold live resolve fetches 8 forecast grid cells."""
    hit = _ctx_cache.get(date)
    if hit is not None:
        return hit
    lock = _ctx_locks.setdefault(date, asyncio.Lock())
    async with lock:  # one fetch per date even under a burst of requests
        hit = _ctx_cache.get(date)
        if hit is None:
            hit = await frames.resolve(CITY, date)
            _ctx_cache.set(date, hit)
        return hit


# ------------------------------------------------------------------------------------ tools


async def find_ward(a: FindWardArgs) -> dict:
    names = ward_ids()
    q = a.name.lower()
    by_name = {n.lower(): (wid, n) for wid, n in names.items()}
    words = [w for w in re.split(r"[\s,/.-]+", q) if len(w) >= 3]
    as_list = lambda hits: [{"ward_id": w, "name": n} for w, n in hits[:3]]  # noqa: E731
    # 1. The name itself, or a word of a two-part name ("Hathijan" -> "Ramol Hathijan").
    hits = [v for k, v in by_name.items() if len(q) >= 3 and (q in k or k in q)]
    hits = hits or [v for k, v in by_name.items() if any(w in k.split() for w in words)]
    if hits:
        return {"matches": as_list(hits)}
    # 2. A misspelling of one ward ("Maninagr"): close enough to be the same name.
    close = difflib.get_close_matches(q, list(by_name), n=2, cutoff=0.85)
    if close:
        return {"matches": as_list([by_name[k] for k in close]), "spelling_guess": True,
                "note": "Matched by spelling; confirm with the user if unsure."}
    # 3. Only similar-looking names ("Bopal" ~ "Paldi"): different places, never assumed.
    similar = difflib.get_close_matches(q, list(by_name), n=3, cutoff=0.6)
    return {
        "matches": [], "similar_names_not_the_same_place": [by_name[k][1] for k in similar],
        "note": "Not one of HeatLens's 48 AMC wards. Do not use a similar name's data; ask the user which ward they mean.",
    }


async def get_ward_conditions(a: WardDateArgs) -> dict:
    date = a.date or today()
    ctx = await _ctx(date)
    z = await asyncio.to_thread(spatial.zone_risk_for_date, CITY, a.ward_id, date, ctx)
    out: dict[str, Any] = {
        "ward": z.name, "ward_id": z.zone_id, "date": date, "data": ctx.source,
        "heatlens_score_0_100": _r(z.calibrated_score), "heatlens_band": z.risk_band,
        "main_driver": z.dominant_driver,
        "max_air_temp_c": _r(z.thermal.ta_max_c), "max_wbgt_c": _r(z.thermal.wbgt_max_c),
        "max_utci_feels_like_c": _r(z.thermal.utci_max_c), "night_min_air_temp_c": _r(z.thermal.night_min_ta_c),
        "why_hot": z.why_hot[:3],
        "population_2020_model": z.exposure.population_count,
        "note": "HeatLens score/band is HeatLens's own heat-stress measure, not the AMC alert.",
    }
    if z.surface_temperature:
        s = z.surface_temperature
        out["ground_surface_vs_city_c"] = {"day": _r(s.lst_day_anomaly_c), "night": _r(s.lst_night_anomaly_c),
                                          "basis": "MODIS satellite, Mar-Jun 2022-2026 mean"}
    return out


async def get_forecast(a: ForecastArgs) -> dict:
    fc = await forecast.get_forecast(CITY, None, forecast.DEFAULT_FORECAST_DAYS)
    return {
        "issued_for": fc.issue_date, "city": "Ahmedabad (city level)",
        "days": [
            {"date": d.date, "amc_alert": d.hap_level, "max_air_temp_c": _r(d.ta_max_c),
             "max_wbgt_c": _r(d.wbgt_max_c), "max_utci_c": _r(d.utci_max_c),
             "night_min_c": _r(d.night_min_ta_c), "heatlens_band": d.risk_band,
             "heat_stress": d.thermal_stress}
            for d in fc.days[: a.days]
        ],
    }


async def get_hourly(a: DateArgs) -> dict:
    date = a.date or today()
    h = await hourly.hourly_for_date(CITY, date)
    peak = (
        f"{h.peak_start_hour:02d}:00-{h.peak_end_hour + 1:02d}:00"
        if h.peak_start_hour is not None and h.peak_end_hour is not None else None
    )
    hottest = max((p for p in h.points if p.utci_c is not None), key=lambda p: p.utci_c, default=None)
    return {
        "date": date, "data": h.source, "peak_heat_stress_hours": peak, "peak_rule": h.peak_rule,
        "hottest_hour": f"{hottest.hour:02d}:00" if hottest else None,
        "max_utci_c": _r(h.max_utci_c), "max_air_temp_c": _r(h.max_ta_c), "min_air_temp_c": _r(h.min_ta_c),
        "max_heat_index_c": _r(h.max_heat_index_c),
        "hours": [{"h": p.hour, "air_c": _r(p.ta_c), "wbgt_c": _r(p.wbgt_c), "utci_c": _r(p.utci_c)}
                  for p in h.points if 6 <= p.hour <= 20],
    }


async def get_amc_alert(a: DateArgs) -> dict:
    date = a.date or today()
    ctx = await _ctx(date)
    tr = await asyncio.to_thread(alerts.triggers, CITY, date, ctx)
    level = tr.groups[0].level if tr.groups else "Green"
    cfg = hap._config()
    return {
        "date": date, "amc_alert": level, "amc_name": hap.AMC_NAME[level],
        "city_max_air_temp_c": _r(tr.city_ta_max_c), "temp_source": tr.city_ta_max_source,
        "thresholds_c": {"yellow": cfg.yellow_min_c, "orange": cfg.orange_min_c, "red": cfg.red_min_c},
        "plan_actions": [
            {"department": x.department, "action": x.title, "detail": x.detail, "source": x.basis}
            for x in hap.actions_for(level)
        ],
        "status": "Dry run: HeatLens shows what the plan asks for; it sends no alerts.",
    }


async def get_advice(a: AdviceArgs) -> dict:
    date = a.date or today()
    ctx = await _ctx(date)
    adv = await asyncio.to_thread(advisory.get_advisory, CITY, a.ward_id, date, a.persona, ctx)
    return {
        "ward_id": a.ward_id, "date": date, "persona": a.persona, "amc_alert": adv.hap_trigger,
        "heatlens_band": adv.risk_band,
        "advice": [
            {"do": r.title, "why": r.rationale, "source": r.basis,
             "audience": "city officials (HeatLens suggestion)" if r.kind in CITY_KINDS else "people"}
            for r in adv.recommendations
        ],
    }


_TOPIC_WORDS: dict[str, tuple[str, ...]] = {
    "heat_stress_measures": ("wbgt", "utci", "heat index", "wet-bulb"),
    "weather_data": ("past weather", "historical weather"),
    "forecast_accuracy": ("forecast",),
    "amc_alert": ("alert", "amc"),
    "heatlens_score": ("score", "composite", "band"),
    "health_risk": ("mortality", "health", "death", "relative risk"),
    "surface_temperature": ("surface", "modis", "satellite", "lst"),
    "population": ("population", "census", "elderly"),
    "land_cover": ("land cover", "worldcover", "tree"),
    "validation": ("validat", "calibrat", "station"),
    "sms_alerts": ("sms", "whatsapp", "cap", "dispatch", "message"),
    "limitations": ("not_available", "not available", "not built"),
}


async def get_method(a: MethodArgs) -> dict:
    words = _TOPIC_WORDS[a.topic]
    rows = []
    for e in validation.evidence_ledger().entries:
        hay = f"{e.component} {e.title} {e.basis} {e.note} {e.status}".lower()
        if any(w in hay for w in words):
            rows.append({"what": e.title, "status": e.status, "source": e.basis, "note": e.note})
    return {"topic": a.topic, "entries": rows[:4] or [{"note": "No ledger entry on this topic."}]}


class TempArgs(_Args):
    temp_c: float = Field(ge=-10, le=60, description="A daily maximum temperature in °C")


async def amc_level_for_temperature(a: TempArgs) -> dict:
    """The AMC level a max temperature falls in: services/hap.py's own comparison, not the model's."""
    level = hap.amc_level(a.temp_c)
    cfg = hap._config()
    return {"temp_c": a.temp_c, "amc_alert": level, "amc_name": hap.AMC_NAME[level],
            "thresholds_c": {"yellow": cfg.yellow_min_c, "orange": cfg.orange_min_c, "red": cfg.red_min_c}}


class LevelArgs(_Args):
    level: Literal["Yellow", "Orange", "Red"]


async def get_plan_actions(a: LevelArgs) -> dict:
    """What the AMC plan asks each department to do at a level (and every level below it)."""
    return {"amc_alert": a.level, "amc_name": hap.AMC_NAME[a.level],
            "plan_actions": [{"department": x.department, "action": x.title, "detail": x.detail, "source": x.basis}
                             for x in hap.actions_for(a.level)]}


class ForgetArgs(_Args):
    pass


async def forget(a: ForgetArgs) -> dict:
    return {"forgotten": True}


# The memory tools are handled by the engine (it writes session state, not data); listed here so
# its schema is validated the same way as the others.
async def remember(a: RememberArgs) -> dict:
    return {"saved": {k: v for k, v in a.model_dump().items() if v is not None}}


_MEMORY_TOOLS = {"remember_user_context", "forget_user_context"}
ToolFn = Callable[[Any], Awaitable[dict]]
TOOLS: dict[str, tuple[type[_Args], ToolFn, str]] = {
    "find_ward": (FindWardArgs, find_ward, "Find the ward_id for a ward or area name in Ahmedabad."),
    "get_ward_conditions": (WardDateArgs, get_ward_conditions,
        "A ward's HeatLens heat-stress score and band, temperatures, WBGT, UTCI, hot-night minimum, "
        "why it runs hot, and its ground surface temperature vs the city."),
    "get_forecast": (ForecastArgs, get_forecast,
        "City forecast for the next days: AMC alert level, max/night temperatures, WBGT, UTCI, HeatLens band."),
    "get_hourly": (DateArgs, get_hourly,
        "Hour-by-hour heat for one day: peak heat-stress hours, hottest hour, per-hour temperature/WBGT/UTCI."),
    "amc_level_for_temperature": (TempArgs, amc_level_for_temperature,
        "Which AMC alert level a given max temperature falls in. Use it instead of comparing thresholds yourself."),
    "get_plan_actions": (LevelArgs, get_plan_actions,
        "What the AMC Heat Action Plan asks departments to do at a level (cooling centres, work hours, "
        "hospitals...), e.g. for 'what happens at a red alert'."),
    "get_amc_alert": (DateArgs, get_amc_alert,
        "The official AMC Heat Action Plan alert level for a date, the temperature it was decided on, "
        "and the actions the plan asks departments to take (incl. outdoor-work rules)."),
    "get_advice": (AdviceArgs, get_advice,
        "HeatLens's rule-based advice for a ward, date and persona, with the source of each item."),
    "get_method": (MethodArgs, get_method,
        "How HeatLens measures something and how reliable it is (evidence ledger)."),
    "remember_user_context": (RememberArgs, remember,
        "Save what the user told you about themselves (ward, role, language, detail level, group) so "
        "later answers fit them. Only facts they stated; never guess."),
    "forget_user_context": (ForgetArgs, forget, "Forget everything saved about the user, when they ask you to."),
}


def openai_schemas() -> list[dict]:
    """Tool definitions in the OpenAI function-calling format (Groq and Gemini accept it)."""
    out = []
    for name, (model, _, desc) in TOOLS.items():
        schema = model.model_json_schema()
        schema.pop("title", None)
        for prop in schema.get("properties", {}).values():
            prop.pop("title", None)
            prop.pop("default", None)
            # "anyOf [X, null]" -> X: shorter, and optional is already expressed by "required".
            if "anyOf" in prop:
                kinds = [k for k in prop.pop("anyOf") if k.get("type") != "null"]
                if len(kinds) == 1:
                    prop.update(kinds[0])
        out.append({"type": "function", "function": {"name": name, "description": desc, "parameters": schema}})
    return out


async def run(name: str, raw_args: str) -> tuple[dict, bool]:
    """Validate and run one tool call. Returns (result, ok). Never raises."""
    spec = TOOLS.get(name)
    if spec is None:
        return {"error": f"unknown tool {name!r}"}, False
    model, fn, _ = spec
    if len(raw_args or "") > 2000:
        return {"error": "arguments too long"}, False
    try:
        parsed = json.loads(raw_args or "{}")
        if not isinstance(parsed, dict):
            raise ValueError("arguments must be a JSON object")
        args = model.model_validate(parsed)
    except (ValueError, ValidationError) as exc:
        if isinstance(exc, ValidationError):
            msg = "; ".join(f"{'.'.join(map(str, e['loc'])) or 'args'}: {e['msg'].removeprefix('Value error, ')}"
                            for e in exc.errors(include_url=False, include_input=False))
        else:
            msg = str(exc)
        return {"error": f"invalid arguments: {msg[:300]}"}, False
    key = (name, args.model_dump_json(), today())
    if name not in _MEMORY_TOOLS:
        hit = _result_cache.get(key)
        if hit is not None:
            return hit, True
    t0 = time.perf_counter()
    try:
        result = await fn(args)
    except Exception as exc:  # a service error must reach the model as data, not crash the chat
        log.warning("chat tool %s failed: %s", name, exc)
        return {"error": f"no data: {str(exc)[:200]}"}, False
    log.debug("chat tool %s %.0f ms", name, (time.perf_counter() - t0) * 1000)
    if name not in _MEMORY_TOOLS:
        _result_cache.set(key, result)
    return result, True


async def snapshot() -> dict:
    """Today's city picture, put into every prompt so most questions need no tool call.

    Cached; engine.py refreshes it in the background so no user request pays the cold fetch."""
    hit = _result_cache.get(("snapshot", today()))
    if hit is not None:
        return hit
    async with _snapshot_lock:  # single flight: the warm-up and a request never fetch it twice
        hit = _result_cache.get(("snapshot", today()))
        if hit is not None:
            return hit
        return await _build_snapshot()


async def _build_snapshot() -> dict:
    t = today()
    alert, fc, hr, bands = await asyncio.gather(
        get_amc_alert(DateArgs(date=t)), get_forecast(ForecastArgs(days=5)), get_hourly(DateArgs(date=t)),
        _today_bands(t), return_exceptions=True,
    )
    snap: dict[str, Any] = {"today": t}
    if isinstance(bands, dict):
        snap["heatlens_today"] = bands
    if isinstance(alert, dict):
        snap["amc_alert_today"] = {k: alert[k] for k in ("amc_alert", "amc_name", "city_max_air_temp_c", "temp_source")}
    if isinstance(hr, dict):
        snap["today_hours"] = {k: hr[k] for k in ("peak_heat_stress_hours", "hottest_hour", "max_utci_c", "max_air_temp_c", "min_air_temp_c", "max_heat_index_c")}
    if isinstance(fc, dict):
        snap["next_days_from_tomorrow"] = [{k: d[k] for k in ("date", "amc_alert", "max_air_temp_c", "night_min_c", "heatlens_band")} for d in fc["days"]]
    if all(isinstance(x, dict) for x in (alert, fc, hr, bands)):  # a partial picture is not cached
        _result_cache.set(("snapshot", t), snap)
    else:
        log.warning("chat snapshot incomplete: %s", [type(x).__name__ for x in (alert, fc, hr, bands)])
    return snap


async def _today_bands(date: str) -> dict:
    """Today's HeatLens heat-stress level across the 48 wards (the dashboard's own map payload)."""
    ctx = await _ctx(date)
    p = await asyncio.to_thread(spatial.map_payload, CITY, date, ctx)
    counts: dict[str, int] = {}
    for z in p.zones:
        counts[z.risk_band] = counts.get(z.risk_band, 0) + 1
    scores = [z.calibrated_score for z in p.zones]
    return {"wards_by_band": counts, "score_range_0_100": [_r(min(scores)), _r(max(scores))],
            "note": "HeatLens heat stress, not an AMC alert"}

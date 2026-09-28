"""Stage 7/8 - rule engine + CAP preview + simulated dispatch.
IMPLEMENTATION_PLAN.md Sec 4.2, 5.5, 5.6.

Rules live in rules/advisory_rules.toml, not in Python if-chains - "so a
domain expert can review them" (the plan's own requirement). This module
loads them, matches (risk_band, regime, persona), and renders each matching
rule's rationale template against the zone's real values. When nothing
matches, plan_d's own `action_advisory` string is the fallback - never an
empty recommendations list for a real zone/date.
"""
from __future__ import annotations

import tomllib
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import lru_cache

from app.core.config import settings
from app.schemas.advisory import (
    AdvisoryResponse,
    CapPreview,
    DispatchRequest,
    DispatchResponse,
    Recommendation,
)
from app.services import ensemble, exposure, hap, spatial
from app.services.frames import DayContext, history_context

RULES_PATH = settings.repo_root / "backend" / "rules" / "advisory_rules.toml"

SEVERITY_RANK = {"high": 0, "moderate": 1, "low": 2}

# CAP 1.2's severity/urgency are fixed enumerations, not free text - HeatLens's
# own Green/Yellow/Orange/Red Heat Action Plan levels (services/hap.py) are mapped
# onto them, not reused directly. Keyed by the COMBINED level, so a CAP message
# can never disagree with the triggers sent alongside it.
CAP_SEVERITY = {"Green": "Minor", "Yellow": "Moderate", "Orange": "Severe", "Red": "Extreme"}
CAP_URGENCY = {"Green": "Future", "Yellow": "Expected", "Orange": "Expected", "Red": "Immediate"}


@dataclass(frozen=True)
class Rule:
    kind: str
    risk_bands: tuple[str, ...]
    regimes: tuple[str, ...]
    personas: tuple[str, ...]
    exposure_tiers: tuple[str, ...]
    title: str
    rationale_template: str
    basis: str
    severity: str


@lru_cache(maxsize=1)
def _load_rules() -> tuple[Rule, ...]:
    if not RULES_PATH.exists():
        raise FileNotFoundError(f"advisory rules not found at {RULES_PATH}")
    data = tomllib.loads(RULES_PATH.read_text(encoding="utf-8"))
    return tuple(
        Rule(
            kind=r["kind"],
            risk_bands=tuple(r["risk_bands"]),
            regimes=tuple(r["regimes"]),
            personas=tuple(r["personas"]),
            exposure_tiers=tuple(r.get("exposure_tiers", ["*"])),
            title=r["title"],
            rationale_template=r["rationale"],
            basis=r["basis"],
            severity=r["severity"],
        )
        for r in data["rules"]
    )


def _rule_matches(rule: Rule, risk_band: str, regime: str, persona: str, exposure_tier: str) -> bool:
    band_ok = "*" in rule.risk_bands or risk_band in rule.risk_bands
    regime_ok = "*" in rule.regimes or regime in rule.regimes
    persona_ok = "*" in rule.personas or persona in rule.personas
    tier_ok = "*" in rule.exposure_tiers or exposure_tier in rule.exposure_tiers
    return band_ok and regime_ok and persona_ok and tier_ok


def _build_context(zone_risk) -> dict:
    t = zone_risk.thermal
    return {
        "wbgt_max_c": t.wbgt_max_c or 0.0,
        "ta_max_c": t.ta_max_c or 0.0,
        "utci_max_c": t.utci_max_c or 0.0,
        "night_min_ta_c": t.night_min_ta_c or 0.0,
        "calibrated_score": zone_risk.calibrated_score,
        "risk_band": zone_risk.risk_band,
        "regime": zone_risk.regime,
        "dominant_driver": zone_risk.dominant_driver,
        "elderly_share_pct": zone_risk.exposure.elderly_share_pct,
        "exposure_tier": zone_risk.health.exposure_tier,
        "daily_mean_temp_c": zone_risk.health.daily_mean_temp_c,
        "threshold_p97_c": zone_risk.health.threshold_p97_c,
        "relative_risk": zone_risk.health.relative_risk,
        "rr_ci_low": zone_risk.health.rr_ci_low,
        "rr_ci_high": zone_risk.health.rr_ci_high,
        "mri_0_100": zone_risk.health.mri_0_100,
    }


def _recommendations(zone_risk, date: str, persona: str, ctx: DayContext) -> list[Recommendation]:
    context = _build_context(zone_risk)
    matched = [
        Recommendation(
            kind=rule.kind,
            title=rule.title,
            rationale=rule.rationale_template.format(**context),
            basis=rule.basis,
            severity=rule.severity,
        )
        for rule in _load_rules()
        if _rule_matches(rule, zone_risk.risk_band, zone_risk.regime, persona, zone_risk.health.exposure_tier)
    ]
    if not matched:
        # No rule fired (typically a Low-band day) - fall back to plan_d's own
        # advisory string rather than returning nothing for a real zone/date.
        pred = ensemble.predict_for_date(ctx.frame, date)
        matched.append(
            Recommendation(
                kind="general",
                title="General heat guidance",
                rationale=pred.action_advisory,
                basis="HeatLens ensemble advisory (htsi/plan_d_ensemble.py::predict_row, fallback)",
                severity="low",
            )
        )
    return sorted(matched, key=lambda r: SEVERITY_RANK.get(r.severity, 9))


def cap_description(zone_risk) -> str:
    """The plain-text body of a CAP message - shared by the JSON preview here and the
    XML feed in services/alerts.py so the two can never say different things.
    """
    h = zone_risk.health
    text = (
        f"HeatLens score {zone_risk.calibrated_score:.1f} ({zone_risk.risk_band}), "
        f"regime {zone_risk.regime}, dominant driver {zone_risk.dominant_driver}."
    )
    if h.exposure_tier == "heatwave":
        text += (
            f" Daily mean {h.daily_mean_temp_c:.1f} C is inside a heatwave by the published definition "
            f"(2+ days above {h.threshold_p97_c:.1f} C); Ahmedabad daily mortality was about "
            f"{h.relative_risk:.2f}x non-heatwave days (95% CI {h.rr_ci_low:.2f}-{h.rr_ci_high:.2f})."
        )
    return text + " Uncalibrated HeatLens composite index - not a validated health-outcome forecast."


def _build_cap_preview(zone_risk, zone_name: str, date: str, decision: hap.HapDecision) -> CapPreview:
    level = decision.level
    now = datetime.now(timezone.utc).isoformat()
    return CapPreview(
        identifier=f"heatlens-{zone_risk.zone_id}-{date}",
        sender="heatlens-demo@example.invalid",  # no real sending identity exists - Phase 3 note
        sent=now,
        status="Draft",  # never "Actual" - this is a preview, not a live alert (Sec 5.6)
        msg_type="Alert",
        scope="Public",
        category="Met",
        event="Extreme Heat" if level in ("Orange", "Red") else "Heat Advisory",
        urgency=CAP_URGENCY[level],
        severity=CAP_SEVERITY[level],
        certainty="Likely",  # a modelled/uncalibrated score, never "Observed" (Sec 7.2)
        headline=f"AMC {hap.AMC_NAME[level]} - {zone_name}, {date}",
        description=cap_description(zone_risk),
        area_desc=zone_name,
    )


def get_advisory(
    city_id: str, zone_id: str, date: str, persona: str, ctx: DayContext | None = None
) -> AdvisoryResponse:
    ctx = ctx or history_context()
    zone_risk = spatial.zone_risk_for_date(city_id, zone_id, date, ctx)
    t = spatial.city_ta_max(date, ctx)
    decision = hap.decide(t.value_c, zone_risk.risk_band, zone_risk.health, t.source)
    return AdvisoryResponse(
        zone_id=zone_id,
        date=date,
        source=ctx.source,
        persona=persona,
        risk_band=zone_risk.risk_band,
        regime=zone_risk.regime,
        recommendations=_recommendations(zone_risk, date, persona, ctx),
        hap_trigger=decision.level,
        hap_trigger_basis=decision.basis,
        health=zone_risk.health,
        cap_preview=_build_cap_preview(zone_risk, zone_risk.name, date, decision),
    )


# --------------------------------------------------------------------------- dispatch (Sec 5.6)

# Deliberately short, simple sentences rather than machine-translating
# open-ended generated text - bounds the translation risk to a small set of
# fixed phrases that can be reviewed once, instead of an open-ended generation
# problem. NOT verified by a native speaker; review before any real use.
# Escaped as \uXXXX (generated programmatically, not hand-typed, to avoid
# transcription errors) rather than literal script in this source file.
_BAND_WORD = {
    "en": {"Low": "low", "Moderate": "moderate", "High": "high", "Extreme": "extreme"},
    "hi": {
        "Low": "कम",
        "Moderate": "मध्यम",
        "High": "उच्च",
        "Extreme": "अत्यधिक",
    },
    "gu": {
        "Low": "ઓછું",
        "Moderate": "મધ્યમ",
        "High": "ઊંચું",
        "Extreme": "અત્યંત",
    },
}

_MESSAGE_TEMPLATE = {
    "en": "HeatLens: {band_word} heat stress in {zone_name} ({date}). {action} Drink water; stay out of direct sun in the hottest hours. [SIMULATED PREVIEW]",
    "hi": (
        "हीटलेंस: "
        "{zone_name} में गर्मी का "
        "{band_word} खतरा ({date})। {action} पानी "
        "पिएं, सबसे गर्म घंटों में सीधी "
        "धूप से बचें। [यह "
        "सिम्युलेटेड "
        "पूर्वावलोकन है]"
    ),
    "gu": (
        "હીટલેન્સ: "
        "{zone_name} માં ગરમીનું "
        "{band_word} જોખમ ({date}). "
        "{action} પાણી પીવો, સૌથી ગરમ "
        "કલાકોમાં સીધા તડકાથી બચો. [આ "
        "સિમ્યુલેટેડ "
        "પૂર્વાવલોકન છે]"
    ),
}

# Persona-specific action clause - same "small fixed set" reasoning as above.
_ACTION = {
    "en": {
        "construction": "Shift outdoor work to early morning.",
        "elderly": "Stay indoors if possible.",
        "general": "Check on elderly neighbours.",
    },
    "hi": {
        "construction": "बाहर का काम सुबह जल्दी करें।",
        "elderly": "यथासंभव घर के अंदर रहें।",
        "general": "बुजुर्ग पड़ोसियों का हालचाल लें।",
    },
    "gu": {
        "construction": "બહારનું કામ વહેલી સવારે કરો.",
        "elderly": "શક્ય હોય તો ઘરની અંદર રહો.",
        "general": "વડીલ પડોશીઓના ખબરઅંતર પૂછો.",
    },
}


def _message_preview(zone_name: str, risk_band: str, date: str, language: str, persona: str) -> str:
    template = _MESSAGE_TEMPLATE[language]
    band_word = _BAND_WORD[language][risk_band]
    action = _ACTION[language][persona]
    return template.format(band_word=band_word, zone_name=zone_name, date=date, action=action)


def dispatch_preview(req: DispatchRequest, ctx: DayContext | None = None) -> DispatchResponse:
    zone = spatial.get_zone(req.zone_id)  # raises NotFoundError if unknown
    date = req.date or datetime.now().strftime("%Y-%m-%d")
    # No weather data for the date -> NotFoundError (404). The message states a risk level, so it
    # is never written with a level the data does not give.
    risk_band = spatial.zone_risk_for_date("ahmedabad", req.zone_id, date, ctx).risk_band
    message = _message_preview(zone.name, risk_band, date, req.language, req.persona)
    people = exposure.zone_exposure(req.zone_id).population_count

    return DispatchResponse(
        recipients_estimated=None,
        recipients_basis=(
            (
                f"Not estimated. About {people:,} people live in {zone.name} (JRC GHS-POP 2020 "
                f"model), but how many would get this message depends on a subscriber or "
                f"registration list, which does not exist yet."
            )
            if people is not None
            else "Not estimated: no subscriber or registration list exists yet."
        ),
        message_preview=message,
    )

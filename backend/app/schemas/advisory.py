"""Stage 7/8 schemas — IMPLEMENTATION_PLAN.md §5.5, §5.6.

CapPreview uses real CAP 1.2 (OASIS Common Alerting Protocol) field names and
their FIXED enumerated vocabularies — severity/urgency/certainty are not free
text in the real spec, so HeatLens's own Low/Moderate/High/Extreme bands are
mapped onto CAP's controlled vocabulary (see advisory.py's CAP_SEVERITY_MAP)
rather than reused directly. This is a real CAP-shaped structure for a
*preview*, not a claim that HeatLens is wired to a CAP alerting gateway.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.schemas.alerts import HapLevel
from app.schemas.health import HealthRisk
from app.schemas.risk import DataSource


class Recommendation(BaseModel):
    model_config = ConfigDict(frozen=True)

    kind: str
    title: str
    rationale: str
    basis: str
    severity: Literal["low", "moderate", "high"]


class CapPreview(BaseModel):
    model_config = ConfigDict(frozen=True)

    identifier: str
    sender: str
    sent: str
    status: Literal["Actual", "Exercise", "System", "Test", "Draft"]
    msg_type: Literal["Alert", "Update", "Cancel"]
    scope: Literal["Public", "Restricted", "Private"]
    category: Literal["Met"]
    event: str
    urgency: Literal["Immediate", "Expected", "Future", "Past", "Unknown"]
    severity: Literal["Extreme", "Severe", "Moderate", "Minor", "Unknown"]
    certainty: Literal["Observed", "Likely", "Possible", "Unlikely", "Unknown"]
    headline: str
    description: str
    area_desc: str


class AdvisoryResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    zone_id: str
    date: str
    source: DataSource
    persona: str
    risk_band: str
    regime: str
    recommendations: list[Recommendation]
    hap_trigger: HapLevel
    hap_trigger_basis: str  # which rule set the level - MRI side, thermal-stress side, or both
    health: HealthRisk
    cap_preview: CapPreview


class DispatchRequest(BaseModel):
    model_config = ConfigDict(frozen=True)

    zone_id: str
    channel: Literal["sms", "whatsapp"]
    language: Literal["en", "hi", "gu"]
    persona: Literal["construction", "elderly", "general"]
    date: str | None = None  # defaults to today's server date if omitted


class DispatchResponse(BaseModel):
    """§5.6: status is hard-coded SIMULATED — there is no code path that can
    return anything else until a real gateway is wired (Open Decision, not yet
    scheduled). A demo cannot accidentally imply a message was sent.
    """
    model_config = ConfigDict(frozen=True)

    status: Literal["SIMULATED"] = "SIMULATED"
    gateway: Literal["not_configured"] = "not_configured"
    disclaimer: str = "No message was sent. Gateway integration pending authorisation."
    recipients_estimated: int | None
    recipients_basis: str
    message_preview: str

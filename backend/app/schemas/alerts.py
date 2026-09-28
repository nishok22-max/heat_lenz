"""Stage 7/8 trigger and webhook schemas — SIH PS 26083 requirement R6.

Everything here is a dry run. ``WebhookPreview.status`` and ``delivery`` are
Literals with a single value, so there is no code path that can report a
delivery: an outbound webhook to a municipal, health, labour or power-utility
system does not exist yet, and a demo must not be able to imply otherwise.
This is the same rule schemas/advisory.py applies to SMS dispatch.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

HapLevel = Literal["Green", "Yellow", "Orange", "Red"]
Department = Literal["public", "municipal", "health", "labour", "power_utility"]


class HapAction(BaseModel):
    model_config = ConfigDict(frozen=True)

    action_id: str
    department: Department
    kind: str
    title: str
    detail: str
    basis: str


class TriggerGroup(BaseModel):
    """All zones that share one level on the requested date.

    Grouped rather than listed per zone because every zone currently shares one
    weather point (services/spatial.py COVERAGE_NOTE), so a per-zone list would
    repeat the same object 127 times. The shape is unchanged once zones diverge:
    there would simply be more than one group.
    """

    model_config = ConfigDict(frozen=True)

    level: HapLevel
    zone_ids: list[str]
    actions: list[HapAction]


class TriggersResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    status: Literal["DRY_RUN"] = "DRY_RUN"
    city: str
    date: str
    source: Literal["history", "forecast"]
    issued_at: str | None
    level_basis: str
    # The city max temperature the level was decided on, and where it came from
    # (station reading for history, forecast for live dates).
    city_ta_max_c: float | None = None
    city_ta_max_source: str | None = None
    calibration_status: Literal["not_validated_locally"] = "not_validated_locally"
    groups: list[TriggerGroup]


class WebhookRequest(BaseModel):
    model_config = ConfigDict(frozen=True)

    department: Department
    date: str
    city: str = "ahmedabad"
    min_level: HapLevel = "Yellow"


class WebhookDelivery(BaseModel):
    model_config = ConfigDict(frozen=True)

    status: Literal["SIMULATED"] = "SIMULATED"
    target_url: None = None
    note: str = "No HTTP request was made. Webhook endpoints for this department are not configured."


class WebhookPreview(BaseModel):
    """What WOULD be POSTed to a department's system, and nothing more."""

    model_config = ConfigDict(frozen=True)

    delivery: WebhookDelivery
    payload: dict

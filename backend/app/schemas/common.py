"""Shared response envelope conventions — IMPLEMENTATION_PLAN.md §4.3.

``EvidencedModel`` is the base for any response model carrying a value that is
measured, modelled or illustrative. ``evidence`` has no default, so a subclass
cannot be instantiated without declaring it — see tests/test_schemas_labels.py.
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from app.core.labels import EvidenceLabel


# Shown in the OpenAPI docs next to every `calibrated_score` field. The field keeps its
# name (renaming it would break the API contract and the frontend), so the honest
# description travels with it instead.
CALIBRATED_SCORE_NOTE = (
    "HeatLens composite thermal-stress score, 0-100: a regime-weighted combination of UTCI, WBGT, "
    "dry-heat excess and heat debt. Its meaning in deaths is calibrated on one event - the 31 days of "
    "the May 2010 Ahmedabad heatwave (backend/scripts/calibrate_score.py): see ``score_mortality`` and "
    "/api/v1/validation/status. Its internal weights and band cut-offs are still hand-set."
)


class EvidencedModel(BaseModel):
    model_config = ConfigDict(frozen=True)

    evidence: EvidenceLabel


class VersionInfo(BaseModel):
    model_config = ConfigDict(frozen=True)

    version: str
    data_as_of: str
    calibration_status: str
    cities: int
    zones: int

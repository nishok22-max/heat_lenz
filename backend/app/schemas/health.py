"""Stage 5 health-risk schemas — IMPLEMENTATION_PLAN.md §5.3, §7.1.

Deliberately has NO absolute death/admission count field. §7.1 Option C ("show
an absolute predicted count") is ruled out in the plan because the
calibration it would need does not exist: daily mortality for Ahmedabad is
confidential (datasets/health/README.md). A relative risk with its published
confidence interval is the strongest claim the available evidence supports.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.schemas.common import EvidencedModel

ExposureTier = Literal["heatwave", "single_day_above_p97", "below_threshold"]


class CrossCheck(BaseModel):
    """An independent absolute-threshold effect from a *different* city and a
    weaker (descriptive) study design. Informational only — never folded into
    ``relative_risk`` (datasets/health/exposure_response_india.json says to use
    it "only as a cross-check").
    """

    model_config = ConfigDict(frozen=True)

    condition: str
    triggered: bool
    effect_pct: float
    source: str


class HealthRisk(EvidencedModel):
    """Mortality risk for one date, from a published exposure-response model.

    ``relative_risk`` is a ratio against non-heatwave days of the same city —
    the comparison the source study makes — not a forecast of deaths. It is
    exactly 1.0 outside a published heatwave, because that is what the
    study's reference group means, not because heat is harmless there.
    ``calibration_status`` is a Literal with one value on purpose: there is no
    code path that can claim local validation.
    """

    exposure_tier: ExposureTier
    daily_mean_temp_c: float
    threshold_p97_c: float
    intensity_pct: float | None  # (T - p97) / p97 * 100 on days above the threshold, else None
    relative_risk: float
    rr_ci_low: float
    rr_ci_high: float
    mri_0_100: float
    calibration_status: Literal["not_validated_locally"] = "not_validated_locally"
    source: str
    cross_checks: list[CrossCheck]


class ReferenceStat(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: str
    published: float | None
    reproduced: float
    unit: str


class HealthModelInfo(EvidencedModel):
    """How the health layer is built and how well this data reproduces the
    source study's own exposure definition — served on the Methods page.
    """

    definition: str
    threshold_p97_c: float
    threshold_basis: str
    base_effect_pct: float
    base_ci_pct: tuple[float, float]
    intensity_slope_pct_per_pct: float
    intensity_slope_ci: tuple[float, float]
    intensity_centre_pct: float
    mri_definition: str
    reference_stats: list[ReferenceStat]
    deviations: list[str]
    not_modelled: list[str]
    citation: str

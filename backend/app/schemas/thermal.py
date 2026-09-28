"""Thermal-stress schemas — Stage 2. IMPLEMENTATION_PLAN.md §5.2, §5.3."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class ThermalSnapshot(BaseModel):
    """One day's worth of headline thermal indices for a location. All measured
    or published-standard values — WBGT/UTCI/Heat Index are validated
    international standards, not HeatLens's own uncalibrated composites.
    """
    model_config = ConfigDict(frozen=True)

    ta_max_c: float | None
    wbgt_max_c: float | None
    utci_max_c: float | None
    night_min_ta_c: float | None

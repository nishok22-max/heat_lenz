"""Evidence labels — the structural enforcement of IMPLEMENTATION_PLAN.md §7.2.

Every response schema that carries a modelled or measured value must set one of
these on itself. This is not a convention; see schemas/common.py, where the base
response model makes the field mandatory (no default), so a schema literally
cannot be constructed without declaring what kind of evidence it is.
"""
from __future__ import annotations

from enum import Enum


class EvidenceLabel(str, Enum):
    MEASURED_POINT = "MEASURED_POINT"              # observed/reanalysis weather at a point
    MEASURED_CENSUS = "MEASURED_CENSUS"             # Census 2011 counts
    MEASURED_FORECAST = "MEASURED_FORECAST"         # NWP forecast input
    MODELLED_PUBLISHED = "MODELLED_PUBLISHED"       # WBGT/UTCI — published, validated standard
    MODELLED_UNCALIBRATED = "MODELLED_UNCALIBRATED"  # HTSI, PHD, relative risk
    MODELLED_CALIBRATED = "MODELLED_CALIBRATED"      # fitted to real local outcomes (score vs May 2010 deaths)
    MEASURED_SATELLITE = "MEASURED_SATELLITE"       # MODIS land-surface temperature (remote sensing)
    ILLUSTRATIVE = "ILLUSTRATIVE"                   # demo-only, never presented as real

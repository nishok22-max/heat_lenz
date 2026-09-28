"""Domain exceptions, translated to HTTP responses by main.py's exception handlers.

Routers and services raise these instead of constructing HTTPException directly,
so the mapping to a status code lives in exactly one place.
"""
from __future__ import annotations


class HeatLensError(Exception):
    """Base class for all domain errors."""


class NotFoundError(HeatLensError):
    """A city, zone or date was requested that does not exist in the store."""


class ValidationError(HeatLensError):
    """Input failed a domain-level check (e.g. missing weather columns)."""


class UpstreamError(HeatLensError):
    """A downstream dependency (e.g. Open-Meteo) failed or timed out."""

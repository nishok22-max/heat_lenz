"""GET /validation/status, /validation/evidence-ledger — IMPLEMENTATION_PLAN.md §5.7.

The credibility endpoints: "is this validated?" answered by a URL.
"""
from __future__ import annotations

from fastapi import APIRouter

from app.schemas.validation import EvidenceLedger, ValidationStatus
from app.services import validation

router = APIRouter(prefix="/validation", tags=["validation"])


@router.get("/status", response_model=ValidationStatus)
def get_validation_status() -> ValidationStatus:
    return validation.status()


@router.get("/evidence-ledger", response_model=EvidenceLedger)
def get_evidence_ledger() -> EvidenceLedger:
    return validation.evidence_ledger()

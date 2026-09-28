"""Aggregates all v1 sub-routers. IMPLEMENTATION_PLAN.md §5 lists the full contract.
Phase 0: /meta. Phase 1: /cities, /risk. Phase 2: /forecast. Phase 3: /advisory,
/dispatch. Phase 4: /validation, /alerts (Heat Action Plan triggers, CAP, webhooks). /chat: the grounded
assistant (app/chat/).
"""
from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import advisory, alerts, chat, cities, forecast, meta, risk, validation

api_router = APIRouter()
api_router.include_router(meta.router)
api_router.include_router(cities.router)
api_router.include_router(risk.router)
api_router.include_router(forecast.router)
api_router.include_router(advisory.router)
api_router.include_router(alerts.router)
api_router.include_router(validation.router)
api_router.include_router(chat.router)

"""Makes htsi/ (at the repo root, one level above backend/) importable.

Idempotent and safe to call from any module's top level before importing
htsi.plan_*. Centralised here instead of duplicated sys.path.insert calls in
every service module, and instead of relying on import order (app.data.store
happening to run first) — that was the original Phase-0/1 approach and is
fragile once multiple services import htsi directly (Phase 2 onward).
"""
from __future__ import annotations

import sys

from app.core.config import settings

_done = False


def ensure_htsi_importable() -> None:
    global _done
    if _done:
        return
    root = str(settings.repo_root)
    if root not in sys.path:
        sys.path.insert(0, root)
    _done = True

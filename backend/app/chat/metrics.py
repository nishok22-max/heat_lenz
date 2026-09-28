"""In-process chat metrics: stage timings and blocked-message counts, for /chat/health.

Per worker (not shared through Redis): each replica reports its own numbers. Nothing here holds
message text or anything that identifies a user.
"""
from __future__ import annotations

import logging
from collections import Counter, deque
from statistics import quantiles

log = logging.getLogger("heatlens.chat")

_timings: dict[str, deque[float]] = {}
blocked: Counter[str] = Counter()
events: Counter[str] = Counter()


def timing(stage: str, ms: float) -> None:
    _timings.setdefault(stage, deque(maxlen=500)).append(ms)


def block(kind: str, where: str) -> None:
    blocked[f"{where}:{kind}"] += 1
    log.info("chat blocked where=%s kind=%s", where, kind)  # the rule only, never the text


def count(name: str) -> None:
    events[name] += 1


def summary() -> dict:
    out = {}
    for stage, xs in _timings.items():
        data = sorted(xs)
        if len(data) >= 2:
            q = quantiles(data, n=20, method="inclusive")
            out[stage] = {"n": len(data), "p50_ms": round(q[9]), "p95_ms": round(q[18])}
        else:
            out[stage] = {"n": len(data), "p50_ms": round(data[0]), "p95_ms": round(data[0])}
    return {"latency": out, "blocked": dict(blocked), "events": dict(events)}


def reset() -> None:
    _timings.clear()
    blocked.clear()
    events.clear()

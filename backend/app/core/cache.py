"""A minimal in-process TTL cache for forecast pulls.

Deliberately dependency-free — this is small enough that pulling in a package
for it would cost more than it saves. Not thread-safe beyond the GIL's normal
guarantees, which is sufficient for a single-process uvicorn worker; if the app
is ever run with multiple workers, replace this with a shared cache (Redis).
"""
from __future__ import annotations

import time
from typing import Any, Callable, Hashable, TypeVar

T = TypeVar("T")


class TTLCache:
    def __init__(self, ttl_seconds: float) -> None:
        self._ttl = ttl_seconds
        self._store: dict[Hashable, tuple[float, Any]] = {}

    def get(self, key: Hashable) -> Any | None:
        entry = self._store.get(key)
        if entry is None:
            return None
        expires_at, value = entry
        if time.monotonic() >= expires_at:
            del self._store[key]
            return None
        return value

    def set(self, key: Hashable, value: Any) -> None:
        self._store[key] = (time.monotonic() + self._ttl, value)

    async def get_or_set_async(
        self, key: Hashable, factory: Callable[[], "T"]
    ) -> "T":
        """Return the cached value, or await ``factory()`` and cache the result."""
        cached = self.get(key)
        if cached is not None:
            return cached
        value = await factory()  # type: ignore[misc]
        self.set(key, value)
        return value

    def clear(self) -> None:
        self._store.clear()

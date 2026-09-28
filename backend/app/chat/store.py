"""Session memory, rate limits and the answer cache, behind one interface.

``MemoryStore`` keeps everything in this process: right for one worker and for tests.
``RedisStore`` shares it across replicas: set CHAT_REDIS_URL and any worker can serve any message.

NoSQL-injection safety (Redis):
- Keys are built only from server-made values: a session ID that must parse as a UUID4 the server
  issued, or a SHA-256 digest. User text never becomes part of a key, so no key-pattern tricks,
  no `*`, no access to another session's key.
- Values are JSON produced by Pydantic models and parsed back through them; nothing is ever
  evaluated. No Lua script, no EVAL, no command is built from user input.
- Commands are the fixed set GET / SET EX / DEL / INCR / EXPIRE, called through redis-py's
  argument API (it sends each argument as a separate RESP bulk string, not as a command line).
"""
from __future__ import annotations

import hashlib
import time
import uuid
from collections import OrderedDict
from typing import Literal, Protocol

from pydantic import BaseModel, Field

from app.chat.settings import chat_settings


class Msg(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=6000)


class Facts(BaseModel):
    ward_id: str | None = None
    ward_name: str | None = None
    role: str | None = None
    language: str | None = None
    detail: str | None = None
    group: str | None = None

    def public(self) -> dict:
        return {k: v for k, v in self.model_dump().items() if v is not None}


class Session(BaseModel):
    history: list[Msg] = Field(default_factory=list)
    summary: str = Field("", max_length=2000)
    facts: Facts = Field(default_factory=Facts)
    turns: int = 0


def valid_sid(sid: str | None) -> bool:
    if not sid or len(sid) != 36:
        return False
    try:
        return uuid.UUID(sid).version == 4 and str(uuid.UUID(sid)) == sid
    except ValueError:
        return False


def new_sid() -> str:
    return str(uuid.uuid4())


def digest(*parts: str) -> str:
    return hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()[:32]


class Store(Protocol):
    kind: str

    async def load(self, sid: str) -> Session | None: ...
    async def save(self, sid: str, s: Session) -> None: ...
    async def delete(self, sid: str) -> None: ...
    async def hit_rate(self, bucket: str, ident: str, limit: int, window_s: int = 60) -> bool: ...
    async def cache_get(self, key: str) -> str | None: ...
    async def cache_set(self, key: str, value: str, ttl_s: int) -> None: ...
    async def ping(self) -> bool: ...


class MemoryStore:
    kind = "memory"

    def __init__(self, ttl_s: int, max_sessions: int) -> None:
        self.ttl, self.max = ttl_s, max_sessions
        self._s: OrderedDict[str, tuple[float, str]] = OrderedDict()
        self._rate: dict[str, tuple[int, int]] = {}
        self._cache: OrderedDict[str, tuple[float, str]] = OrderedDict()

    async def load(self, sid: str) -> Session | None:
        if not valid_sid(sid):
            return None
        entry = self._s.get(sid)
        if entry is None or entry[0] < time.monotonic():
            self._s.pop(sid, None)
            return None
        return Session.model_validate_json(entry[1])

    async def save(self, sid: str, s: Session) -> None:
        if not valid_sid(sid):
            raise ValueError("bad session id")
        self._s[sid] = (time.monotonic() + self.ttl, s.model_dump_json())
        self._s.move_to_end(sid)
        while len(self._s) > self.max:  # cap: a flood of new sessions cannot exhaust memory
            self._s.popitem(last=False)

    async def delete(self, sid: str) -> None:
        self._s.pop(sid, None)

    async def hit_rate(self, bucket: str, ident: str, limit: int, window_s: int = 60) -> bool:
        """True if this request is within the limit (fixed window)."""
        win = int(time.time() // window_s)
        key = f"{bucket}:{digest(ident)}"
        w, n = self._rate.get(key, (win, 0))
        n = n + 1 if w == win else 1
        self._rate[key] = (win, n)
        if len(self._rate) > 50_000:
            self._rate = {k: v for k, v in self._rate.items() if v[0] == win}
        return n <= limit

    async def cache_get(self, key: str) -> str | None:
        e = self._cache.get(key)
        if e is None or e[0] < time.monotonic():
            self._cache.pop(key, None)
            return None
        return e[1]

    async def cache_set(self, key: str, value: str, ttl_s: int) -> None:
        self._cache[key] = (time.monotonic() + ttl_s, value)
        while len(self._cache) > 2000:
            self._cache.popitem(last=False)

    async def ping(self) -> bool:
        return True


class RedisStore:
    kind = "redis"
    _P = "hl:chat"

    def __init__(self, url: str, ttl_s: int) -> None:
        import redis.asyncio as redis

        self.ttl = ttl_s
        self.r = redis.from_url(url, decode_responses=True, socket_timeout=0.5, socket_connect_timeout=1.0,
                                health_check_interval=30)

    def _skey(self, sid: str) -> str:
        if not valid_sid(sid):
            raise ValueError("bad session id")
        return f"{self._P}:s:{sid}"

    async def load(self, sid: str) -> Session | None:
        if not valid_sid(sid):
            return None
        raw = await self.r.get(self._skey(sid))
        return Session.model_validate_json(raw) if raw else None

    async def save(self, sid: str, s: Session) -> None:
        await self.r.set(self._skey(sid), s.model_dump_json(), ex=self.ttl)

    async def delete(self, sid: str) -> None:
        if valid_sid(sid):
            await self.r.delete(self._skey(sid))

    async def hit_rate(self, bucket: str, ident: str, limit: int, window_s: int = 60) -> bool:
        win = int(time.time() // window_s)
        key = f"{self._P}:rl:{digest(bucket)}:{digest(ident)}:{win}"
        async with self.r.pipeline(transaction=True) as p:
            p.incr(key)
            p.expire(key, window_s + 5)
            n, _ = await p.execute()
        return int(n) <= limit

    async def cache_get(self, key: str) -> str | None:
        return await self.r.get(f"{self._P}:c:{digest(key)}")

    async def cache_set(self, key: str, value: str, ttl_s: int) -> None:
        await self.r.set(f"{self._P}:c:{digest(key)}", value, ex=ttl_s)

    async def ping(self) -> bool:
        try:
            return bool(await self.r.ping())
        except Exception:
            return False


_store: Store | None = None


def get_store() -> Store:
    global _store
    if _store is None:
        s = chat_settings()
        _store = RedisStore(s.chat_redis_url, s.chat_session_ttl_s) if s.chat_redis_url else MemoryStore(
            s.chat_session_ttl_s, s.chat_max_sessions
        )
    return _store


def set_store(store: Store | None) -> None:
    """Tests swap in a fresh store (or fakeredis)."""
    global _store
    _store = store

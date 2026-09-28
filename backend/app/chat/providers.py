"""LLM providers behind one interface, with fallback and a circuit breaker.

Groq and Gemini both expose an OpenAI-compatible chat-completions API, so one streaming client
covers both; switching or adding a provider is configuration. The chain is tried in order:
Groq primary model -> Groq backup model -> Gemini (only if GEMINI_API_KEY is set). A provider that
fails three times in a row is skipped for 30 s instead of making every user wait for its timeout.

The API key is sent only in the Authorization header to the provider's own host; it is never
logged (httpx does not log headers) and never leaves the backend.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from typing import AsyncIterator, Literal

import httpx

from app.chat.settings import chat_settings

log = logging.getLogger(__name__)


class ProviderError(Exception):
    pass


class RateLimited(ProviderError):
    def __init__(self, retry_after: float | None):
        super().__init__(f"rate limited, retry after {retry_after}")
        self.retry_after = retry_after


@dataclass
class Event:
    kind: Literal["text", "tool_calls", "done"]
    text: str = ""
    tool_calls: list[dict] = field(default_factory=list)
    finish: str = ""


@dataclass
class Provider:
    name: str
    base_url: str
    api_key: str
    model: str
    failures: int = 0
    open_until: float = 0.0

    def available(self) -> bool:
        return time.monotonic() >= self.open_until

    def cool_down(self, seconds: float | None) -> None:
        """A 429 is not an outage: skip this provider only for as long as it asked, and do not
        count it toward the circuit breaker."""
        self.open_until = max(self.open_until, time.monotonic() + min(seconds or 2.0, 60.0))

    def wait_s(self) -> float:
        return max(0.0, self.open_until - time.monotonic())

    def record(self, ok: bool) -> None:
        if ok:
            self.failures = 0
            return
        self.failures += 1
        if self.failures >= 3:
            self.open_until = time.monotonic() + 30
            self.failures = 0
            log.warning("chat provider %s circuit open for 30 s", self.name)

    def _extra(self) -> dict:
        if self.model.startswith("openai/gpt-oss"):
            # Groq docs (reasoning): low effort keeps the first word fast; reasoning text is not
            # needed by the user and would only cost tokens.
            return {"reasoning_effort": "low", "include_reasoning": False}
        return {}


_client: httpx.AsyncClient | None = None


def client() -> httpx.AsyncClient:
    """One pooled client per process: keeps TLS connections to Groq warm between requests."""
    global _client
    if _client is None or _client.is_closed:
        s = chat_settings()
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(s.chat_llm_timeout_s, connect=5.0),
            limits=httpx.Limits(max_connections=64, max_keepalive_connections=32, keepalive_expiry=120),
            http2=False,
        )
    return _client


async def aclose() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


_chain: list[Provider] | None = None


def chain() -> list[Provider]:
    global _chain
    if _chain is None:
        s = chat_settings()
        out: list[Provider] = []
        if s.groq_api_key:
            key = s.groq_api_key.get_secret_value()
            out.append(Provider("groq-primary", s.groq_base_url, key, s.chat_primary_model))
            if s.chat_backup_model and s.chat_backup_model != s.chat_primary_model:
                out.append(Provider("groq-backup", s.groq_base_url, key, s.chat_backup_model))
        if s.gemini_api_key:
            out.append(Provider("gemini", s.gemini_base_url, s.gemini_api_key.get_secret_value(), s.chat_gemini_model))
        _chain = out
    return _chain


def reset_chain() -> None:
    global _chain
    _chain = None


def configured() -> bool:
    return bool(chain())


async def stream(
    p: Provider, messages: list[dict], tools: list[dict] | None, max_tokens: int
) -> AsyncIterator[Event]:
    """One streamed completion. Yields text deltas, then the assembled tool calls (if any), then done."""
    body: dict = {
        "model": p.model, "messages": messages, "stream": True, "temperature": 0.2,
        "max_tokens": max_tokens, **p._extra(),
    }
    if tools:
        body["tools"] = tools
        body["tool_choice"] = "auto"
    headers = {"Authorization": f"Bearer {p.api_key}", "Content-Type": "application/json"}
    calls: dict[int, dict] = {}
    finish = ""
    try:
        async with client().stream("POST", f"{p.base_url}/chat/completions", json=body, headers=headers) as r:
            if r.status_code == 429:
                ra = r.headers.get("retry-after")
                raise RateLimited(float(ra) if ra and ra.replace(".", "", 1).isdigit() else None)
            if r.status_code >= 400:
                detail = (await r.aread())[:300].decode("utf-8", "replace")
                raise ProviderError(f"{p.name} HTTP {r.status_code}: {detail}")
            async for line in r.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                if chunk.get("error"):
                    raise ProviderError(f"{p.name}: {str(chunk['error'])[:200]}")
                for ch in chunk.get("choices", []):
                    delta = ch.get("delta") or {}
                    if delta.get("content"):
                        yield Event("text", text=delta["content"])
                    for tc in delta.get("tool_calls") or []:
                        slot = calls.setdefault(tc.get("index", 0), {"id": "", "name": "", "arguments": ""})
                        slot["id"] = tc.get("id") or slot["id"]
                        fn = tc.get("function") or {}
                        slot["name"] += fn.get("name") or ""
                        slot["arguments"] += fn.get("arguments") or ""
                    if ch.get("finish_reason"):
                        finish = ch["finish_reason"]
    except httpx.HTTPError as exc:
        raise ProviderError(f"{p.name}: {type(exc).__name__}") from exc
    if calls:
        yield Event("tool_calls", tool_calls=[calls[i] for i in sorted(calls)])
    yield Event("done", finish=finish)


async def complete(model: str, messages: list[dict], max_tokens: int = 300, timeout: float = 8.0) -> str:
    """Small non-streamed call on Groq (summaries, the injection classifier). '' if unavailable."""
    s = chat_settings()
    if not s.groq_api_key or not model:
        return ""
    body = {"model": model, "messages": messages, "max_tokens": max_tokens, "temperature": 0,
            **Provider("fast", "", "", model)._extra()}  # gpt-oss: reasoning counts toward max_tokens
    headers = {"Authorization": f"Bearer {s.groq_api_key.get_secret_value()}"}
    r = await client().post(f"{s.groq_base_url}/chat/completions", json=body, headers=headers, timeout=timeout)
    if r.status_code == 429:
        raise RateLimited(None)
    r.raise_for_status()
    return (r.json()["choices"][0]["message"].get("content") or "").strip()

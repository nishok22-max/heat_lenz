"""POST /chat (streamed), GET /chat/memory, DELETE /chat/session, GET /chat/health.

The answer streams as Server-Sent Events so the first checked sentence reaches the screen while the
rest is still being written. The client IP is used only for rate limiting, hashed before storage.
Behind a proxy, uvicorn's --proxy-headers sets request.client from the trusted X-Forwarded-For.
"""
from __future__ import annotations

import json
from typing import Literal

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from app.chat import engine, metrics, providers
from app.chat.settings import chat_settings
from app.chat.store import get_store, valid_sid

router = APIRouter(prefix="/chat", tags=["chat"])

_UUID = r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"


class ChatProfile(BaseModel):
    """What the user chose to keep on their own device ("remember my ward & language"). Used only
    to start a new session, and validated again like any tool argument (engine.respond)."""

    model_config = ConfigDict(extra="forbid")

    ward_id: str | None = Field(None, pattern=r"^ward-\d{2}$")
    language: Literal["en", "hi", "gu"] | None = None


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(max_length=8000)
    session_id: str | None = Field(None, pattern=_UUID)
    audience: Literal["public", "authority"] = "public"
    profile: ChatProfile | None = None


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False, separators=(',', ':'))}\n\n"


@router.post("")
async def post_chat(req: ChatRequest, request: Request) -> StreamingResponse:
    ip = request.client.host if request.client else "unknown"

    async def gen():
        profile = req.profile.model_dump(exclude_none=True) if req.profile else None
        async for ev in engine.respond(req.message, req.session_id, ip, req.audience, profile):
            yield _sse(ev)

    return StreamingResponse(
        gen(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-store", "X-Accel-Buffering": "no"},
    )


@router.get("/memory")
async def get_memory(session_id: str = Query(..., pattern=_UUID)) -> dict:
    """What the assistant remembers about this chat: the validated facts, never message text."""
    s = await get_store().load(session_id) if valid_sid(session_id) else None
    return {"memory": s.facts.public() if s else {}, "turns": s.turns if s else 0,
            "expires_after_idle_min": chat_settings().chat_session_ttl_s // 60}


@router.delete("/session/{session_id}")
async def delete_session(session_id: str) -> dict:
    if valid_sid(session_id):
        await get_store().delete(session_id)
    return {"cleared": True}


@router.get("/health")
async def chat_health() -> dict:
    store = get_store()
    return {
        "configured": providers.configured(),
        "providers": [
            {"name": p.name, "model": p.model, "available": p.available()} for p in providers.chain()
        ],
        "store": store.kind, "store_ok": await store.ping(),
        **metrics.summary(),
    }

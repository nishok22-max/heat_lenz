"""HeatLens API — app factory and startup warm-up.

IMPLEMENTATION_PLAN.md §4.1. Loads the precomputed daily frame, fits the
Plan D ensemble and builds the health-layer climatology once at startup, so no
request pays those costs.
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from app.api.v1.router import api_router
from app.chat import engine as chat_engine, providers as chat_providers, tools as chat_tools
from app.core.config import settings
from app.core.errors import HeatLensError, NotFoundError, UpstreamError, ValidationError
from app.data import store
from app.services import health


@asynccontextmanager
async def lifespan(app: FastAPI):
    store.load()
    store.fit_ensemble()
    health.climatology()  # 15-year daily-mean series + p97 threshold, ~0.3 s: not paid per request
    warm = None
    if chat_providers.configured():
        # Today's chat snapshot (forecast + ward weather, ~9 s cold) before serving, so the first
        # user does not pay it; then kept warm in the background.
        try:
            await asyncio.wait_for(chat_tools.snapshot(), timeout=45)
        except Exception as exc:  # the API must still start if Open-Meteo is down
            logging.getLogger(__name__).warning("chat warm-up failed: %s", exc)
        warm = asyncio.create_task(chat_engine.warm_loop())
    yield
    if warm:
        warm.cancel()
    await chat_providers.aclose()
    store.clear()


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version=settings.version,
        lifespan=lifespan,
        # No default_response_class: FastAPI's Pydantic-direct serialization
        # is faster than routing every response through a custom Response
        # class. ORJSONResponse itself is deprecated on this FastAPI version
        # (fastapi/responses.py) — the exception handlers below use the
        # standard JSONResponse instead.
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(api_router, prefix="/api/v1")

    @app.exception_handler(NotFoundError)
    async def _not_found(request: Request, exc: NotFoundError):
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    @app.exception_handler(ValidationError)
    async def _validation(request: Request, exc: ValidationError):
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    @app.exception_handler(UpstreamError)
    async def _upstream(request: Request, exc: UpstreamError):
        return JSONResponse(status_code=502, content={"detail": str(exc)})

    @app.exception_handler(HeatLensError)
    async def _generic(request: Request, exc: HeatLensError):
        return JSONResponse(status_code=500, content={"detail": str(exc)})

    if settings.frontend_dist.is_dir():
        _serve_frontend(app, settings.frontend_dist)
    return app


def _serve_frontend(app: FastAPI, dist: Path) -> None:
    """Serve the built single-page app: real files as-is, every other path gets index.html so
    client-side routes (/forecast, /zones/ward-01, ...) load. Registered last, so the API and
    /docs still win; an unknown /api/ path stays a 404 instead of returning the page."""
    root = dist.resolve()

    @app.get("/{path:path}", include_in_schema=False)
    async def _spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        file = (root / path).resolve()
        if path and file.is_file() and root in file.parents:
            return FileResponse(file)
        return FileResponse(root / "index.html")


app = create_app()

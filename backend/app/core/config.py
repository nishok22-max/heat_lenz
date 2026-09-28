"""Application settings, loaded once at import time.

All paths are resolved relative to the repository root so the app can be launched
either from the repo root (``uvicorn app.main:app --app-dir backend``) or from
inside ``backend/`` directly.
"""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="HEATLENS_", extra="ignore")

    app_name: str = "HeatLens API"
    version: str = "1.0.0"

    # CORS — Vite's default dev port plus a couple of common alternates.
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    # Data paths (repo-root relative; overridable via env for tests/deployment).
    repo_root: Path = REPO_ROOT
    results_dir: Path = REPO_ROOT / "results"
    datasets_dir: Path = REPO_ROOT / "datasets"
    # Built frontend (npm run build). When present, the API also serves it, so one process is the
    # whole app (deployment); absent in development, where Vite serves the frontend.
    frontend_dist: Path = REPO_ROOT / "frontend" / "dist"
    warm_dir: Path = REPO_ROOT / "results" / "warm"
    daily_csv: Path = REPO_ROOT / "results" / "ahmedabad_daily_2010_2024.csv"
    daily_parquet: Path = REPO_ROOT / "results" / "warm" / "daily.parquet"
    zones_geojson: Path = BACKEND_DIR / "app" / "data" / "zones.geojson"
    # Written by scripts/build_lst_offsets.py from real MODIS satellite data. May be
    # absent (e.g. a fresh clone before the script has been run) — callers must handle that.
    lst_offsets_json: Path = BACKEND_DIR / "app" / "data" / "lst_offsets.json"
    # Written by scripts/build_ward_population.py from JRC GHS-POP. May be absent on a
    # fresh clone — services/exposure.py then reports population as not available.
    ward_population_json: Path = BACKEND_DIR / "app" / "data" / "ward_population.json"
    # Written by scripts/build_station_verification.py: Ahmedabad airport (WMO 42647) daily
    # max temperature from NOAA GSOD. May be absent — city_ta_max then uses the reanalysis.
    station_tmax_csv: Path = BACKEND_DIR / "app" / "data" / "station_daily_tmax.csv"
    station_verification_json: Path = BACKEND_DIR / "app" / "data" / "station_verification.json"
    # Written by scripts/build_ward_landcover.py (ESA WorldCover 2021). May be absent - wards then
    # carry no land_cover and the "why" text leaves land cover out.
    ward_landcover_json: Path = BACKEND_DIR / "app" / "data" / "ward_landcover.json"
    benchmark_report_md: Path = REPO_ROOT / "results" / "benchmark_report.md"
    # Written only by scripts/run_validation.py, and only from REAL outcome data.
    validation_report_json: Path = REPO_ROOT / "results" / "validation_report.json"
    score_calibration_json: Path = REPO_ROOT / "results" / "score_calibration.json"
    health_coefficients_json: Path = (
        REPO_ROOT / "datasets" / "health" / "exposure_response_india.json"
    )
    hourly_full_csv: Path = (
        REPO_ROOT
        / "datasets"
        / "open_meteo"
        / "ahmedabad_hourly_full_2010_2024_clean.csv"
    )

    # Default city used until multi-city support lands (Open Decision #3).
    default_city_id: str = "ahmedabad"
    default_lat: float = 23.03
    default_lon: float = 72.58
    default_tz: str = "Asia/Kolkata"

    # Forecast cache TTL, minutes.
    forecast_cache_ttl_minutes: int = 30


settings = Settings()

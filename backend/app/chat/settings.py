"""Chat assistant settings, read from the environment and ``backend/.env``.

Kept apart from app.core.config because the chat keys (GROQ_API_KEY, GEMINI_API_KEY) are secrets
with their conventional names, not HEATLENS_-prefixed app settings. ``backend/.env`` is gitignored.
Nothing here is ever sent to the frontend or written to a log.
"""
from __future__ import annotations

from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.config import BACKEND_DIR


class ChatSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    groq_api_key: SecretStr | None = None
    gemini_api_key: SecretStr | None = None

    groq_base_url: str = "https://api.groq.com/openai/v1"
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta/openai"

    # Answer models, tried in order (provider fallback). Groq model IDs, checked against this
    # project's key (GET /openai/v1/models) on 2026-09-25; both support tool use. The Llama models
    # in Groq's public docs were not available to the key, so both are gpt-oss.
    chat_primary_model: str = "openai/gpt-oss-120b"
    chat_backup_model: str = "openai/gpt-oss-20b"
    chat_gemini_model: str = "gemini-2.5-flash"
    # Small fast model for history summaries (never for answers).
    chat_fast_model: str = "openai/gpt-oss-20b"
    # Injection classifier; empty disables the model check (the rule-based check always runs).
    chat_guard_model: str = "meta-llama/llama-prompt-guard-2-86m"
    # Measured 2026-09-25 on the red-team corpus: a benign "Delete from memory the ward I told you"
    # scored 0.96; a plain injection 0.9996; subtle attacks all < 0.002. 0.99 keeps the true catch
    # and drops that false positive. Subtle attacks are the rulebook's and output guard's job.
    chat_guard_threshold: float = 0.99

    # Shared state. Empty -> in-process store (one worker only). Set for more than one replica.
    chat_redis_url: str = ""

    chat_max_input_chars: int = 1000
    chat_max_output_tokens: int = 700
    chat_history_turns: int = 8  # messages kept word for word
    chat_session_ttl_s: int = 30 * 60
    chat_max_sessions: int = 5000  # in-process store cap, oldest dropped first
    chat_rate_per_min_session: int = 12
    chat_rate_per_min_ip: int = 30
    chat_max_concurrent_llm: int = 16  # per worker; beyond this a request gets a quick "busy"
    chat_llm_timeout_s: float = 20.0
    chat_max_tool_rounds: int = 3


@lru_cache
def chat_settings() -> ChatSettings:
    return ChatSettings()

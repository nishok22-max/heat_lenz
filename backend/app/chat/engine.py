"""One chat turn, end to end, as a stream of events for the frontend.

    user text -> rate limit -> input guard -> (answer cache) -> prompt with today's data + memory
      -> LLM (streamed; tools as needed) -> every sentence checked by output guard -> user
      model injection check runs alongside the LLM call and must pass before the first sentence

Events (dicts; api/v1/chat.py sends each as one SSE message):
    session {session_id}   status {text}   delta {text}   retract {}   done {...}
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from typing import AsyncIterator

from app.chat import input_guard, metrics, output_guard, providers, rulebook, tools
from app.chat.providers import ProviderError, RateLimited
from app.chat.settings import chat_settings
from app.chat.store import Facts, Msg, Session, digest, get_store, new_sid

log = logging.getLogger(__name__)

_STATUS = {
    "find_ward": "Finding the ward",
    "get_ward_conditions": "Checking the ward's heat data",
    "get_forecast": "Checking the forecast",
    "get_hourly": "Checking hour-by-hour heat",
    "get_amc_alert": "Checking the AMC alert",
    "get_advice": "Looking up advice",
    "get_method": "Looking up how HeatLens measures this",
    "remember_user_context": "Noting that",
    "forget_user_context": "Forgetting that",
    "amc_level_for_temperature": "Checking the AMC alert level",
    "get_plan_actions": "Looking up the Heat Action Plan",
}
_SOURCES = {
    "get_ward_conditions": "HeatLens ward data (Open-Meteo forecast, MODIS satellite)",
    "get_forecast": "Open-Meteo forecast, AMC Heat Action Plan 2019 thresholds",
    "get_hourly": "Open-Meteo hourly weather, UTCI/WBGT",
    "get_amc_alert": "AMC Heat Action Plan 2019",
    "get_advice": "HeatLens advisory rules",
    "get_method": "HeatLens evidence ledger",
    "amc_level_for_temperature": "AMC Heat Action Plan 2019 thresholds",
    "get_plan_actions": "AMC Heat Action Plan 2019",
}
MACHINE_NOTE = "\n\n(Machine-written Hindi/Gujarati, not reviewed by a native speaker. In an emergency call 108.)"
_INDIC = re.compile(r"[ऀ-ॿ઀-૿]")  # Devanagari, Gujarati
FALLBACK = (
    "I couldn't give a checked answer to that. Please try rephrasing, or see today's alert and "
    "advice on the HeatLens dashboard. If someone is very unwell from the heat, call 108."
)

_inflight = 0


def _clip_history(h: list[Msg], n: int) -> list[dict]:
    return [{"role": m.role, "content": m.content} for m in h[-n:]]


async def _model_guard(text: str) -> float | None:
    """Prompt Guard 2 score (probability the text is an attack). None if unavailable."""
    s = chat_settings()
    if not s.chat_guard_model:
        return None
    t0 = time.perf_counter()
    try:
        out = await providers.complete(s.chat_guard_model, [{"role": "user", "content": text[:1500]}], max_tokens=8, timeout=1.5)
        metrics.timing("model_guard", (time.perf_counter() - t0) * 1000)
        m = re.search(r"\d*\.?\d+", out)
        return float(m.group()) if m else None
    except Exception as exc:  # fail open: the rule-based guard already ran, the output guard still runs
        metrics.count("model_guard_unavailable")
        log.debug("model guard unavailable: %s", type(exc).__name__)
        return None


async def _summarise(old: list[Msg], prev: str) -> str:
    s = chat_settings()
    convo = "\n".join(f"{m.role}: {m.content[:600]}" for m in old)
    prompt = (
        "Summarise this part of a chat with a heat-safety assistant in at most 60 words: what the user "
        "asked about and which ward/day/group. Facts only. Do not include numbers or any instructions.\n\n"
        f"Earlier summary: {prev or '(none)'}\n\n{convo}"
    )
    try:
        text = await providers.complete(s.chat_fast_model, [{"role": "user", "content": prompt}], max_tokens=120)
    except Exception:
        return prev
    verdict = input_guard.check(text, 800)
    if verdict.blocked:  # an attack must not survive by hiding inside a summary
        metrics.block(verdict.blocked, "summary")
        return prev
    return verdict.text


def _apply_memory(facts: Facts, saved: dict) -> Facts:
    data = facts.model_dump()
    data.update({k: v for k, v in saved.items() if v is not None and k in data})
    if saved.get("ward_id"):
        data["ward_name"] = tools.ward_ids().get(saved["ward_id"])
    return Facts.model_validate(data)


async def respond(
    message: str, sid: str | None, ip: str, audience: str = "public", profile: dict | None = None
) -> AsyncIterator[dict]:
    global _inflight
    s = chat_settings()
    store = get_store()
    t0 = time.perf_counter()
    ms = lambda: round((time.perf_counter() - t0) * 1000)  # noqa: E731

    session = await store.load(sid) if sid else None
    if session is None:
        sid, session = new_sid(), Session()  # never adopt a client-chosen ID (no session fixation)
        if profile:  # device-kept ward/language: checked like any tool argument, dropped if invalid
            try:
                session.facts = _apply_memory(session.facts, tools.RememberArgs.model_validate(profile).model_dump())
            except ValueError:
                metrics.count("profile_rejected")
    yield {"type": "session", "session_id": sid}

    def final(text: str, blocked: str | None = None, **extra) -> dict:
        return {"type": "done", "blocked": blocked, "memory": session.facts.public(), "total_ms": ms(), **extra}

    if not (await store.hit_rate("session", sid, s.chat_rate_per_min_session)
            and await store.hit_rate("ip", ip, s.chat_rate_per_min_ip)):
        metrics.block("rate_limited", "input")
        yield {"type": "delta", "text": input_guard.REFUSALS["rate_limited"]}
        yield final("", "rate_limited")
        return

    verdict = input_guard.check(message, s.chat_max_input_chars)
    metrics.timing("input_guard", ms())
    if verdict.blocked:
        metrics.block(verdict.blocked, "input")
        yield {"type": "delta", "text": input_guard.REFUSALS[verdict.blocked]}
        yield final("", verdict.blocked)
        return
    text = verdict.text

    if not providers.configured():
        yield {"type": "delta", "text": "The assistant is not configured yet (no LLM key on the server)."}
        yield final("", "not_configured")
        return

    if _inflight >= s.chat_max_concurrent_llm:
        metrics.block("busy", "capacity")
        yield {"type": "delta", "text": input_guard.REFUSALS["busy"]}
        yield final("", "busy")
        return

    # Answer cache: first message of a fresh chat only (no memory to personalise), keyed on the
    # normalised question, the audience and today's data, so a new forecast means a new answer.
    snapshot = await tools.snapshot()
    first_turn = not session.history and not session.facts.public()
    cache_key = digest("answer", re.sub(r"[^\w]+", " ", text.lower()).strip(), audience, json.dumps(snapshot, sort_keys=True))
    if first_turn:
        cached = await store.cache_get(cache_key)
        if cached:
            data = json.loads(cached)
            metrics.count("answer_cache_hit")
            metrics.timing("first_text", ms())
            yield {"type": "delta", "text": data["answer"]}
            session.history += [Msg(role="user", content=text), Msg(role="assistant", content=data["answer"])]
            session.turns += 1
            await store.save(sid, session)
            yield final(data["answer"], None, sources=data["sources"], cached=True)
            return

    system = rulebook.build_system(snapshot, session.facts.public(), session.summary, audience, text)
    messages: list[dict] = [{"role": "system", "content": system}, *_clip_history(session.history, s.chat_history_turns),
                            {"role": "user", "content": text}]
    grounding = output_guard.Grounding()
    grounding.add_text(system)
    grounding.add_text(text)

    guard_task = asyncio.create_task(_model_guard(text))
    guard_checked = False
    waited = False
    sources: set[str] = {"HeatLens today (Open-Meteo forecast, AMC Heat Action Plan 2019)"}
    answer_parts: list[str] = []
    violation: str | None = None
    used_tools = False
    first_text_at: int | None = None

    async def guard_ok() -> bool:
        nonlocal guard_checked
        if guard_checked:
            return True
        score = await guard_task
        guard_checked = True
        if score is not None and score >= s.chat_guard_threshold:
            metrics.block("model_guard", "input")
            return False
        return True

    _inflight += 1
    try:
        for _round in range(s.chat_max_tool_rounds + 1):
            tool_calls: list[dict] = []
            buffer = ""
            emitted_this_round = False
            served = False
            # Two passes at most. A 429 puts a model on the cool-down Groq asked for (seconds);
            # if every model is cooling down, wait once for the soonest and say so, rather than
            # answering "busy" to a limit that clears in a moment.
            for _pass in range(2):
                attempts = [p for p in providers.chain() if p.available()]
                if _pass == 1 and attempts:
                    break  # the second pass is only for waiting out a 429, not for retrying errors
                if not attempts:
                    wait = min((p.wait_s() for p in providers.chain()), default=99.0)
                    if waited or wait > 8:
                        break
                    waited = True
                    metrics.count("rate_limit_wait")
                    yield {"type": "status", "text": f"Busy, retrying in {max(1, round(wait))} s"}
                    await asyncio.sleep(wait + 0.2)
                    attempts = [p for p in providers.chain() if p.available()]
                for p in attempts:
                    try:
                        t_call = time.perf_counter()
                        async for ev in providers.stream(p, messages, tools.openai_schemas() if _round < s.chat_max_tool_rounds else None, s.chat_max_output_tokens):
                            if ev.kind == "text":
                                buffer += ev.text
                                ready, buffer = output_guard.split_ready(buffer)
                                for sentence in ready:
                                    if not await guard_ok():
                                        raise _Refused()
                                    why = output_guard.check(sentence, grounding)
                                    if why:
                                        violation = why
                                        raise _Violation()
                                    if first_text_at is None:
                                        first_text_at = ms()
                                        metrics.timing("first_text", first_text_at)
                                    sentence = _plain(sentence)
                                    answer_parts.append(sentence)
                                    emitted_this_round = True
                                    yield {"type": "delta", "text": sentence}
                            elif ev.kind == "tool_calls":
                                tool_calls = ev.tool_calls
                        metrics.timing(f"llm_round_{p.name}", (time.perf_counter() - t_call) * 1000)
                        p.record(True)
                        served = True
                        break
                    except (RateLimited, ProviderError) as exc:
                        if isinstance(exc, RateLimited):
                            p.cool_down(exc.retry_after)  # not an outage: no circuit-breaker count
                            metrics.count(f"rate_limited:{p.name}")
                        else:
                            p.record(False)
                            metrics.count(f"provider_error:{p.name}")
                        log.warning("chat provider %s failed: %s", p.name, str(exc)[:200])
                        if emitted_this_round:  # half an answer from a failed provider is withdrawn
                            answer_parts.clear()
                            yield {"type": "retract"}
                            emitted_this_round = False
                        buffer = ""
                if served:
                    break
            if not served:  # every provider failed, is circuit-broken or still rate-limited
                yield {"type": "delta", "text": input_guard.REFUSALS["busy"]}
                yield final("", "providers_unavailable")
                return

            if not tool_calls:
                # Flush the last sentence (no trailing whitespace after it).
                if buffer.strip():
                    if not await guard_ok():
                        raise _Refused()
                    why = output_guard.check(buffer, grounding)
                    if why:
                        violation = why
                        raise _Violation()
                    if first_text_at is None:
                        first_text_at = ms()
                        metrics.timing("first_text", first_text_at)
                    buffer = _plain(buffer)
                    answer_parts.append(buffer)
                    yield {"type": "delta", "text": buffer}
                break

            # Tool round: run every requested tool in parallel, feed results back as data.
            used_tools = True
            messages.append({
                "role": "assistant", "content": ("".join(answer_parts) + buffer) or None,
                "tool_calls": [{"id": c["id"] or f"call_{i}", "type": "function",
                                "function": {"name": c["name"], "arguments": c["arguments"] or "{}"}}
                               for i, c in enumerate(tool_calls)],
            })
            for c in tool_calls:
                if c["name"] in _STATUS:
                    yield {"type": "status", "text": _STATUS[c["name"]]}
            t_tools = time.perf_counter()
            results = await asyncio.gather(*(tools.run(c["name"], c["arguments"]) for c in tool_calls))
            metrics.timing("tools", (time.perf_counter() - t_tools) * 1000)
            for i, (c, (result, ok)) in enumerate(zip(tool_calls, results)):
                if ok and c["name"] == "remember_user_context":
                    session.facts = _apply_memory(session.facts, result["saved"])
                    yield {"type": "memory", "memory": session.facts.public()}
                elif ok and c["name"] == "forget_user_context":
                    session.facts = Facts()
                    yield {"type": "memory", "memory": {}}
                if ok and c["name"] in _SOURCES:
                    sources.add(_SOURCES[c["name"]])
                content = json.dumps(result, separators=(",", ":"), default=str)
                grounding.add_text(content)
                messages.append({"role": "tool", "tool_call_id": c["id"] or f"call_{i}", "content": content})
    except _Refused:
        yield {"type": "retract"}
        yield {"type": "delta", "text": input_guard.REFUSALS["model_guard"]}
        yield final("", "model_guard")
        return
    except _Violation:
        metrics.block(violation or "unknown", "output")
        yield {"type": "retract"}
        answer = await _retry_clean(messages, grounding, violation or "")
        yield {"type": "delta", "text": answer}
        answer_parts = [answer]
    finally:
        _inflight -= 1
        if not guard_task.done():
            guard_task.cancel()

    answer = "".join(answer_parts).strip() or FALLBACK
    if _INDIC.search(answer) and answer != FALLBACK:
        # The rulebook asks the model to say this; it does not always, so it is added here.
        yield {"type": "delta", "text": MACHINE_NOTE}
        answer += MACHINE_NOTE
    metrics.timing("total", ms())
    src = sorted(sources)
    yield final(answer, None, sources=src, first_text_ms=first_text_at)

    # After "done": the user already has the answer; memory upkeep costs them nothing.
    session.history += [Msg(role="user", content=text), Msg(role="assistant", content=answer[:6000])]
    session.turns += 1
    if len(session.history) > s.chat_history_turns:
        old, session.history = session.history[: -s.chat_history_turns], session.history[-s.chat_history_turns :]
        session.summary = (await _summarise(old, session.summary))[:2000]
    await store.save(sid, session)
    if first_turn and not used_tools and answer != FALLBACK and violation is None:
        await store.cache_set(cache_key, json.dumps({"answer": answer, "sources": src}), 10 * 60)


def _plain(text: str) -> str:
    """The panel shows plain text: drop Markdown emphasis and headings the model may still add.
    Applied after the output check, and it only removes characters, so it cannot add anything."""
    text = text.replace("**", "").replace("__", "")
    return re.sub(r"(?m)^#{1,6}\s+", "", text)


class _Violation(Exception):
    pass


class _Refused(Exception):
    pass


async def _retry_clean(messages: list[dict], grounding: output_guard.Grounding, why: str) -> str:
    """One rewrite, fully buffered and checked, after the output guard blocked a sentence."""
    rule, _, detail = why.partition(":")
    specific = (
        f" It used the number {detail}, which is not in the data for this question: leave it out, and "
        "any rule or advice it belonged to." if rule == "ungrounded_number" else ""
    )
    note = {
        "role": "system",
        "content": (
            f"Your previous draft was blocked by a safety check ({rule}).{specific} Write the answer "
            "again. Use only numbers that appear in TODAY'S DATA or the tool results; no death or "
            "hospital counts; no medicine names or doses; no diagnosis; no phone number except 108."
        ),
    }
    for p in providers.chain():
        if not p.available():
            continue
        try:
            text = ""
            async for ev in providers.stream(p, [*messages, note], None, chat_settings().chat_max_output_tokens):
                if ev.kind == "text":
                    text += ev.text
            p.record(True)
            sentences, rest = output_guard.split_ready(text)
            if all(output_guard.check(x, grounding) is None for x in [*sentences, rest] if x.strip()):
                metrics.count("output_retry_ok")
                return _plain(text.strip())
            metrics.count("output_retry_failed")
            return FALLBACK
        except ProviderError:
            p.record(False)
            continue
    return FALLBACK


async def warm_loop() -> None:
    """Keep today's snapshot (and the forecast behind it) warm, so no user pays the cold fetch."""
    while True:
        await asyncio.sleep(4 * 60)  # startup already warmed it (main.py); refresh before the 5-min TTL
        try:
            await tools.snapshot()
        except Exception as exc:
            log.warning("chat snapshot warm-up failed: %s", exc)

"""Input guard: runs on every user message before anything else sees it.

Rule-based and synchronous (well under a millisecond), so a blocked message never costs an LLM
call. The optional model check (Llama Prompt Guard 2, engine.py) runs alongside the answer call as
a second opinion; this module does not depend on it.

What it does, in order:
1. normalise: Unicode NFKC (folds full-width and other look-alike letters), strip control and
   zero-width characters, collapse whitespace, cap the length;
2. refuse empty input and input that is mostly symbols;
3. detect prompt-injection / jailbreak phrasing;
4. detect SQL and NoSQL (Mongo operator, Redis command) injection payloads.

HeatLens has no SQL database and the assistant never builds a query, a key or a path from user
text (tools take only schema-checked arguments; store.py builds keys from server-made UUIDs), so
steps 4's payloads could not reach anything. They are refused anyway: a message that is an attack
payload is not a heat question, and logging it gives an honest count of attempts.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Literal

BlockKind = Literal[
    "empty", "too_long", "gibberish", "prompt_injection", "prompt_leak", "sql_injection",
    "nosql_injection",
]


@dataclass(frozen=True)
class InputVerdict:
    text: str  # the cleaned text; what the model sees
    blocked: BlockKind | None = None
    matched: str = ""  # which rule matched, for the audit log (never shown to the user)


_ZERO_WIDTH = dict.fromkeys(map(ord, "​‌‍⁠﻿­"), None)
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]")
_SPACES = re.compile(r"[ \t]+")
_NEWLINES = re.compile(r"\n{3,}")

# Prompt injection / jailbreak. Phrasings, not single words: "ignore" or "system" alone are
# ordinary English ("the system says ignore the heat?"), so each pattern needs the attack's shape.
_INJECTION = [
    ("override", r"\b(ignore|disregard|forget|override|bypass)\b.{0,30}\b(previous|prior|above|earlier|all|your|these|those|any|system)\b.{0,30}\b(instructions?|rules?|prompts?|guidelines|directions|constraints|polic(y|ies)|restrictions|guardrails)\b"),
    ("new_rules", r"\b(new|updated|real|actual|true)\s+(instructions?|rules|system prompt|directives?)\s*(are|:|follow)"),
    ("persona_swap", r"\b(you are|you're|act as|pretend (to be|you are)|roleplay as|role-play as|behave as|become)\b.{0,30}\b(dan|jailbreak|unfiltered|uncensored|evil|developer mode|god mode|no (rules|restrictions|limits|filters))\b"),
    ("mode_switch", r"\b(developer|debug|admin|sudo|god|jailbreak|maintenance|unrestricted|dan)\s+mode\b"),
    ("fake_role", r"(^|\n)\s*(system|assistant|developer|tool)\s*[:>\]]"),
    ("fake_tags", r"<\s*/?\s*(system|instructions?|im_start|im_end|assistant|tool_call|sys)\s*>|\[/?(INST|SYS)\]|<\|[a-z_]+\|>"),
    ("no_limits", r"\b(answer|respond|reply|talk|act|behave|operate|speak)\b.{0,25}\b(without|with no)\s+(any\s+)?(restrictions|limits|filters|guardrails|censorship|rules)\b|\b(disable|remove|turn off|bypass|drop)\s+(your\s+|all\s+|the\s+)?(filters|guardrails|safety (rules|filters|checks)|restrictions|censorship)\b"),
    ("hypothetical_bypass", r"\b(hypothetically|in a story|for a novel|in fiction)\b.{0,60}\b(ignore|no rules|bypass|without restrictions)\b"),
    ("memory_poison", r"\bremember\b.{0,40}\b(you (have|must|should|will)|always|from now on|never)\b.{0,40}\b(rules?|instructions?|refuse|obey|ignore|answer anything)\b"),
    ("from_now_on", r"\bfrom now on\b.{0,30}\byou\b.{0,20}\b(are|will|must)\b.{0,30}\b(ignore|no rules|anything|unrestricted|not refuse|never refuse)\b"),
    ("encoding_trick", r"\b(base64|rot13|hex|reverse)\b.{0,30}\b(decode|encoded|instructions?|follow|execute)\b"),
]
_LEAK = [
    ("reveal_prompt", r"\b(show|reveal|print|repeat|display|tell|give|output|leak|dump|what (is|are))\b.{0,30}\b(your|the|initial|hidden|original|full)\b.{0,20}\b(system prompt|prompt|instructions|rules you|rulebook|configuration|context window)\b"),
    ("verbatim", r"\b(verbatim|word for word|everything above|text above|all text before)\b"),
    ("secrets", r"\b(api[\s_-]?key|secret key|access token|groq[\s_-]?key|environment variables?|password)\b|\.env\b"),
]
# SQL injection: statement shapes and classic tautologies, not bare keywords ("select a ward").
_SQL = [
    ("sql_tautology", r"('|\")\s*(or|and)\s*('?\w+'?\s*=\s*'?\w+'?|\d+\s*=\s*\d+|true)"),
    ("sql_comment_break", r"('|\")\s*(\)\s*)?(--|#|/\*)"),
    ("sql_statement", r"\b(union\s+(all\s+)?select|select\s+(\*|count\s*\(|[\w.]+\s*,\s*[\w.]+)[^.?!]{0,60}\bfrom\b|insert\s+into\s+[\w.]+\s*(\(|values)|delete\s+from\s+[\w.]+\s*(where\b|;)|drop\s+(table|database|schema)|truncate\s+table|update\s+[\w.]+\s+set\s+\w+\s*=|alter\s+table|exec(\s+|\()xp_|information_schema|pg_sleep\s*\(|sleep\s*\(\s*\d+\s*\)|benchmark\s*\(|waitfor\s+delay|load_file\s*\(|into\s+outfile)"),
    ("sql_stacked", r";\s*(drop|delete|insert|update|select|shutdown|exec)\b"),
]
# NoSQL: Mongo query operators and JS injection, Redis commands.
_NOSQL = [
    ("mongo_operator", r"[\[{\"']\s*\$(where|ne|gt|gte|lt|lte|in|nin|regex|exists|expr|function|accumulator|lookup|or|and|not|nor|elemMatch|set|unset|eval)\b|\$(where|regex|ne|gt|expr|function)\s*[:=]"),
    ("js_injection", r"\b(db\.\w+\.(find|drop|remove|insert|update)|this\.\w+\s*==|function\s*\(\s*\)\s*\{|sleep\(\d+\)\s*;?\s*return|process\.env|require\s*\(|constructor\s*\.\s*constructor)"),
    ("redis_command", r"(^|[\n;])\s*(flushall|flushdb|config\s+set|eval\s+\"|script\s+load|keys\s+\*|shutdown\s+(nosave|save)|slaveof|replicaof|module\s+load)(?!\w)"),
    ("prototype_pollution", r"__proto__|constructor\s*\[\s*['\"]prototype"),
]


_SPACELESS = (
    "ignoreallpreviousinstructions", "ignorepreviousinstructions", "ignoreallinstructions",
    "ignoreyourinstructions", "ignoreallrules", "ignoreyourrules", "disregardpreviousinstructions",
    "disregardallinstructions", "disregardyourrules", "forgetyourinstructions", "forgetallinstructions",
    "developermode", "jailbreak", "doanythingnow", "revealyoursystemprompt", "showyoursystemprompt",
)


def _compile(rules):
    return [(name, re.compile(p, re.IGNORECASE)) for name, p in rules]


_CHECKS: list[tuple[BlockKind, list[tuple[str, re.Pattern[str]]]]] = [
    ("prompt_injection", _compile(_INJECTION)),
    ("prompt_leak", _compile(_LEAK)),
    ("sql_injection", _compile(_SQL)),
    ("nosql_injection", _compile(_NOSQL)),
]


def clean(text: str, max_chars: int) -> str:
    text = unicodedata.normalize("NFKC", text or "").translate(_ZERO_WIDTH)
    text = _CONTROL.sub("", text).replace("\r\n", "\n").replace("\r", "\n")
    text = _NEWLINES.sub("\n\n", _SPACES.sub(" ", text)).strip()
    return text[:max_chars] if len(text) > max_chars else text


def check(raw: str, max_chars: int) -> InputVerdict:
    if raw is not None and len(raw) > max_chars * 4:
        # Far over the cap: refuse rather than silently truncating something that big.
        return InputVerdict(text="", blocked="too_long", matched=f"{len(raw)} chars")
    text = clean(raw, max_chars)
    if not text:
        return InputVerdict(text="", blocked="empty")
    letters = sum(ch.isalnum() for ch in text)
    if len(text) >= 12 and letters / len(text) < 0.35:
        return InputVerdict(text=text, blocked="gibberish", matched="symbol ratio")
    for kind, rules in _CHECKS:
        for name, rx in rules:
            if rx.search(text):
                return InputVerdict(text=text, blocked=kind, matched=name)
    # Letters only, no spaces or punctuation: catches "i g n o r e", "i.g.n.o.r.e" and similar
    # splitting. Only unambiguous signatures, since word boundaries are gone here.
    letters_only = re.sub(r"[^a-z]", "", text.lower())
    for sig in _SPACELESS:
        if sig in letters_only:
            return InputVerdict(text=text, blocked="prompt_injection", matched=f"spaceless:{sig}")
    return InputVerdict(text=text)


# What the user sees for each block. Short, calm, and says what the assistant can do instead.
REFUSALS: dict[str, str] = {
    "empty": "Please type a question about heat, the forecast or staying safe.",
    "too_long": "That message is too long. Please ask in a shorter message.",
    "gibberish": "I couldn't read that. Please ask your question in words.",
    "prompt_injection": (
        "I can't change how I work or set my rules aside. I can help with heat risk, the forecast "
        "for your ward, AMC heat alerts, and how to stay safe in the heat."
    ),
    "prompt_leak": (
        "I can't share my internal setup or any keys. I'm happy to explain how HeatLens works, "
        "where its data comes from, or today's heat risk."
    ),
    "sql_injection": "That looks like a database command, not a question. Please ask about heat or the forecast.",
    "nosql_injection": "That looks like a database command, not a question. Please ask about heat or the forecast.",
    "model_guard": (
        "I can't follow that request. I can help with heat risk, the forecast, AMC heat alerts and "
        "staying safe in the heat."
    ),
    "rate_limited": "You're sending messages quickly. Please wait a few seconds and try again.",
    "busy": "The assistant is busy right now. Please try again in a moment.",
}

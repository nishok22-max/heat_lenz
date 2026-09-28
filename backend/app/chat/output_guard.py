"""Output guard: fixed checks on every sentence before the user sees it.

The model is told the rules (rulebook.py) and usually follows them; these checks exist for the
times it does not, and cannot be argued with because they are not part of the conversation.

1. Grounded numbers: every figure must appear in this turn's data (the snapshot, tool results,
   the rulebook's own published figures, or the user's own message). Rounding a grounded value
   is allowed; a new number is not.
2. No casualty or hospitalisation counts.
3. No medicine names or doses, no diagnosis of the person.
4. No claim that HeatLens is validated/official or has sent an alert.
5. No phone number except 108; no link outside the sources HeatLens cites.
6. No prompt leak: the per-process canary, or the rulebook's section headings.
"""
from __future__ import annotations

import math
import re
import unicodedata
from dataclasses import dataclass, field

from app.chat.rulebook import CANARY

_NUM = re.compile(r"(?<![\w.])-?\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\w])|(?<![\w.])-?\d+(?:\.\d+)?")
_ALLOWED_DOMAINS = ("ndma.gov.in", "nrdc.org", "imd.gov.in", "mausam.imd.gov.in", "open-meteo.com", "ahmedabadcity.gov.in")

_CASUALTY = re.compile(
    r"\d[\d,.]*\s*(\+\s*)?(more\s+|extra\s+|additional\s+|excess\s+)?(people\s+|persons\s+|lives\s+|residents\s+)?"
    r"((could|may|might|will|would|can|are likely to|are expected to|expected to)\s+)?(be\s+)?"
    r"(deaths?|died|dead|die|deceased|casualt\w*|fatalit\w*|hospitali[sz]ed|hospitali[sz]ations?|admissions|killed|lives lost)\b"
    r"|\b(deaths?|died|killed|casualties|fatalities|death toll|hospitali[sz]ations|admissions)\s+"
    r"((of|was|were|toll|count|could|may|might|will|would|reach\w*|rise to|hit|total\w*|:)\s*){0,3}(be\s+)?"
    r"(about|around|nearly|over|up to|~|approximately|roughly)?\s*\d",
    re.IGNORECASE,
)
_DRUGS = re.compile(
    r"\b(paracetamol|acetaminophen|ibuprofen|aspirin|crocin|dolo|combiflam|diclofenac|nimesulide|"
    r"antibiotic|steroid|insulin|saline drip|iv fluids?)\b|\b\d+(\.\d+)?\s*(mg|mcg|ml|tablets?|pills?|capsules?|drops)\b",
    re.IGNORECASE,
)
_DIAGNOSIS = re.compile(
    r"\b(you|he|she|they|your (father|mother|child|son|daughter|husband|wife))\s+"
    r"(have|has|are having|is having|'ve got|are suffering from|is suffering from|definitely have)\s+"
    r"(heat ?stroke|heat exhaustion|heat cramps|dehydration|sunstroke)",
    re.IGNORECASE,
)
_HEDGE = re.compile(r"\b(if|may|might|could|whether|possibly|signs? of|check)\b[^.]{0,25}$", re.IGNORECASE)
_VALIDATED = re.compile(
    r"\b(heatlens|this (tool|app|system|assistant|score))\b[^.]{0,40}\b(is|are|has been|have been)\s+"
    r"(\w+ly\s+)?(validated|verified|certified|approved|official|government[- ]approved|accurate to)\b",
    re.IGNORECASE,
)
_SENT = re.compile(r"\b(i|we|heatlens)\s+(have\s+|has\s+|just\s+)?(sent|dispatched|notified|alerted|messaged|informed the)\b", re.IGNORECASE)
_PHONE = re.compile(r"\b(call|dial|phone|ring|helpline)\b[^.\d]{0,20}(\+?\d[\d\s-]{1,14}\d)", re.IGNORECASE)
_LONG_DIGITS = re.compile(r"(?<!\d)(\+?\d[\d\s-]{7,}\d)(?!\d)")
_URL = re.compile(r"https?://([^/\s)]+)|\bwww\.([^/\s)]+)", re.IGNORECASE)
_LEAK_MARKERS = ("TWO SIGNALS - ALWAYS NAME THEM APART", "HOW TO WORK\n", "WHAT THE USER TOLD YOU", "TODAY'S DATA (from HeatLens")


def ascii_digits(text: str) -> str:
    """Devanagari/Gujarati (and other) digits -> ASCII, so Hindi/Gujarati answers are checked too."""
    return "".join(str(unicodedata.digit(c)) if c.isdigit() and not c.isascii() else c for c in text)


def numbers_in(text: str) -> list[str]:
    return _NUM.findall(ascii_digits(text))


@dataclass
class Grounding:
    """The numbers an answer may use this turn."""

    values: set[float] = field(default_factory=set)

    def add_text(self, text: str) -> None:
        # Looser than numbers_in: also digits inside identifiers ("population_2020_model", "ward-07").
        # Commas are kept: in JSON "[59.5,64.0]" they separate two numbers. Thousands-grouped
        # figures ("7,334,231") are added again whole.
        text = ascii_digits(text)
        found = re.findall(r"\d+(?:\.\d+)?", text)
        found += [g.replace(",", "") for g in re.findall(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?", text)]
        for n in found:
            try:
                self.values.add(float(n.replace(",", "")))
            except ValueError:
                pass

    def allows(self, token: str) -> bool:
        # Magnitudes only: "1.4 C cooler" states an anomaly of -1.41 without its sign.
        try:
            n = abs(float(token.replace(",", "")))
        except ValueError:
            return True
        if n.is_integer() and n <= 12:
            return True  # counting words, list numbers, clock hours ("2 pm")
        if n in self.values:
            return True
        decimals = len(token.split(".")[1]) if "." in token else 0
        for v in self.values:
            if round(v, decimals) == n:
                return True
            if decimals == 0 and n in (math.floor(v), math.ceil(v)):
                return True
        return False


def check(sentence: str, grounding: Grounding) -> str | None:
    """None if the sentence may be shown, else the rule it broke (for the log and the retry)."""
    s = ascii_digits(sentence)
    if CANARY in s or any(m in sentence for m in _LEAK_MARKERS):
        return "prompt_leak"
    if _CASUALTY.search(s):
        return "casualty_count"
    if _DRUGS.search(s):
        return "medicine"
    m = _DIAGNOSIS.search(s)
    if m and not _HEDGE.search(s[: m.start()]):
        return "diagnosis"
    if _VALIDATED.search(s):
        return "validation_claim"
    if _SENT.search(s):
        return "sent_claim"
    for m in _PHONE.finditer(s):
        if re.sub(r"\D", "", m.group(2)) != "108":
            return "phone_number"
    for m in _LONG_DIGITS.finditer(s):
        digits = re.sub(r"\D", "", m.group(1))
        if len(digits) >= 8 and not grounding.allows(m.group(1).strip()):
            return "phone_number"
    for m in _URL.finditer(s):
        host = (m.group(1) or m.group(2) or "").lower().rstrip(".,")
        if not any(host == d or host.endswith("." + d) for d in _ALLOWED_DOMAINS):
            return "unknown_link"
    for n in numbers_in(s):
        if not grounding.allows(n):
            return f"ungrounded_number:{n}"
    return None


_SENTENCE_END = re.compile(r"(?<=[.!?।])\s+|\n+")


def split_ready(buffer: str) -> tuple[list[str], str]:
    """Split streamed text into complete sentences (ready to check) and the unfinished rest.

    A number like "41.1" is not a sentence end because the split needs whitespace after the mark.
    """
    parts = _SENTENCE_END.split(buffer)
    if len(parts) == 1:
        return [], buffer
    # Keep the separators: find each complete piece's end in the original buffer.
    ready, pos = [], 0
    for m in _SENTENCE_END.finditer(buffer):
        ready.append(buffer[pos : m.end()])
        pos = m.end()
    return ready, buffer[pos:]

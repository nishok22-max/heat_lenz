"""Methods-page content — IMPLEMENTATION_PLAN.md §5.7.

Everything here is read from the repo's own artefacts (the benchmark report, the
evidence ledger, the health-model description) rather than restated, so the
Methods page cannot drift from what the code and the report actually say.
"""
from __future__ import annotations

import json
import re
import tomllib
from functools import lru_cache

from app.core.config import settings
from app.core.errors import NotFoundError
from app.schemas.validation import (
    Benchmark,
    BenchmarkTable,
    EvidenceLedger,
    LedgerEntry,
    OutcomeValidation,
    StationVerification,
    ValidationStatus,
    VerificationScore,
)
from app.services import health, score_calibration

LEDGER_PATH = settings.repo_root / "backend" / "rules" / "evidence_ledger.toml"

# Only the three summary tables are served. Section 4 of the report is a 17-column
# day-by-day component dump that belongs in the report file, not on a Methods page.
_TABLE_SECTIONS = {
    "1": ("may2010_rank", "May 2010 rank among 15 years (rank 1 = correctly flagged as the worst May)"),
    "2": ("spearman_vs_imd_tmax", "Rank correlation of each index's May mean with IMD Tmax across years"),
    "3": ("false_alarm_missed_event", "False-alarm and missed-event rate against IMD heat-wave days"),
}
_HOW_TO_RUN = (
    "python backend/scripts/run_validation.py --outcomes <daily_deaths.csv> "
    "--source \"<who supplied it, period>\" --population <city population>"
)


def _parse_fixed_width_table(block: str) -> tuple[list[str], list[dict[str, float | str]]]:
    """Parse a pandas-printed table: a header, then rows of ``<label> <number> ...``.

    Labels can contain spaces and parentheses ("Heat Index (degC)"), so each row is
    split from the RIGHT: the last ``ncols - 1`` tokens are numbers, the rest is the label.
    """
    lines = [ln for ln in block.strip().splitlines() if ln.strip()]
    columns = lines[0].split()
    n_numeric = len(columns) - 1
    rows: list[dict[str, float | str]] = []
    for ln in lines[1:]:
        parts = ln.split()
        label, tail = " ".join(parts[:-n_numeric]), parts[-n_numeric:]
        row: dict[str, float | str] = {columns[0]: label}
        for name, tok in zip(columns[1:], tail):
            row[name] = float(tok)
        rows.append(row)
    return columns, rows


@lru_cache(maxsize=1)
def benchmark() -> Benchmark:
    path = settings.benchmark_report_md
    if not path.exists():
        raise NotFoundError(f"benchmark report not found at {path}; run scripts/benchmark.py")
    text = path.read_text(encoding="utf-8")

    scope = " ".join(ln.lstrip("> ").strip() for ln in text.splitlines() if ln.startswith(">"))
    sections = re.split(r"^## (\d+)\. ", text, flags=re.M)
    # re.split with one group yields [preamble, num, body, num, body, ...]
    by_num = {sections[i]: sections[i + 1] for i in range(1, len(sections) - 1, 2)}

    tables: list[BenchmarkTable] = []
    for num, (key, title) in _TABLE_SECTIONS.items():
        block = re.search(r"```\n(.*?)```", by_num.get(num, ""), flags=re.S)
        if not block:
            continue
        columns, rows = _parse_fixed_width_table(block.group(1))
        tables.append(BenchmarkTable(key=key, title=title, columns=columns, rows=rows))

    limitations = [
        ln[2:].strip() for ln in by_num.get("6", "").splitlines() if ln.startswith("- ")
    ]
    return Benchmark(scope=scope, tables=tables, limitations=limitations)


@lru_cache(maxsize=1)
def evidence_ledger() -> EvidenceLedger:
    data = tomllib.loads(LEDGER_PATH.read_text(encoding="utf-8"))
    return EvidenceLedger(entries=[LedgerEntry(**e) for e in data["entries"]])


def _outcome_validation() -> OutcomeValidation:
    path = settings.validation_report_json
    if not path.exists():
        return OutcomeValidation(
            status="not_run",
            data_source=None,
            evidence_status=None,
            report=None,
            how_to_run=_HOW_TO_RUN,
        )
    report = json.loads(path.read_text(encoding="utf-8"))
    return OutcomeValidation(
        status="completed",
        data_source=report.get("data_source"),
        evidence_status=report.get("evidence_status"),
        report=report,
        how_to_run=_HOW_TO_RUN,
    )


_SCORE_FIELDS = tuple(VerificationScore.model_fields)


def _score(d: dict) -> VerificationScore:
    return VerificationScore(**{k: d[k] for k in _SCORE_FIELDS})


def station_verification() -> StationVerification | None:
    path = settings.station_verification_json
    if not path.exists():
        return None
    d = json.loads(path.read_text(encoding="utf-8"))
    return StationVerification(
        station_name=d["station"]["name"],
        source=d["station"]["source"],
        season=d["season"],
        retrieved=d["retrieved"],
        caveats=d["caveats"],
        history_model=d["history"]["model"],
        history=_score(d["history"]),
        forecast_model=d["forecast"]["model"],
        forecast_leads={k: _score(v) for k, v in d["forecast"]["leads"].items()},
    )


def _calibration_line(cal: dict) -> str:
    rows = {(c["measure"], c["timing"]): c for c in cal["comparison"]}
    score = rows[("HeatLens score", "same day")]["loo_mae_deaths_per_day"]
    station = rows[("Airport thermometer (daily max)", "same day")]["loo_mae_deaths_per_day"]
    lo, hi = cal["calibrated_range"]
    return (
        f"The HeatLens score against real daily deaths, May 2010 ({cal['data']['n_days']} days, read from the "
        f"published figures of Azhar et al. 2014): each +10 points meant about +{cal['extra_deaths_pct_per_10_points']:.0f} % "
        f"deaths (valid for scores {lo:.0f}-{hi:.0f}). Leave-one-day-out error {score} deaths/day, against {station} "
        f"for the airport thermometer on the same days."
    )


def status() -> ValidationStatus:
    outcome = _outcome_validation()
    cal = score_calibration.report()
    calibrated = outcome.status == "completed" or cal is not None
    if outcome.status == "completed":
        reason = "A comparison against real health outcomes has been run; see outcome_validation."
    elif cal is not None:
        reason = (
            "The HeatLens score is calibrated against real deaths for one event: the 31 days of the May 2010 "
            "heatwave, the only day-by-day Ahmedabad death counts in the public record (read from the published "
            "figures of Azhar et al. 2014). The multi-year comparison still needs a daily mortality series, "
            "which is available only on request."
        )
    else:
        reason = (
            "No daily mortality or admissions series for Ahmedabad is available to this project; the "
            "source study's data is confidential. The indices have therefore never been tested against outcomes."
        )
    return ValidationStatus(
        index_calibrated_against_health_outcomes=calibrated,
        reason=reason,
        what_was_tested=([_calibration_line(cal)] if cal else []) + [
            "May 2010 (the ~1,344 excess-death event) ranked against the other 14 years for each index. "
            "This is in-sample: the indices were shaped with that event in view, so it is a sanity check, "
            "not evidence that they would have warned about an event they were not built around.",
            "Year-to-year rank correlation of each index against IMD Tmax.",
            "False-alarm and missed-event rates against IMD heat-wave days. This is a consistency check: "
            "IMD heat-wave days are not health outcomes.",
            "How closely the point temperature series reproduces the heatwave statistics of the study the "
            "mortality coefficients come from (five metrics, tabulated below).",
            "Daily max temperature against a real thermometer (Ahmedabad airport, NOAA GSOD): the 2010-2024 "
            "history, and archived forecasts at 1-5 days ahead. Tabulated below.",
        ],
        what_was_not_tested=[
            "Whether the score predicts deaths better than WBGT, UTCI or Tmax over many years: only one event "
            "(May 2010) has public daily deaths, and on it the airport thermometer did slightly better same-day.",
            "The score's internal weights and band cut-offs: still hand-set; only its meaning in deaths is fitted.",
            "Ward-level air temperature: every ward has a measured MODIS ground-temperature difference, "
            "but ground and air temperature differ, and there is no ward-level station or health record "
            "to check a ward's air temperature or heat stress against.",
            "Local calibration of the relative-risk model. The coefficients are published, not fitted here.",
        ],
        benchmark=benchmark(),
        health_model=health.model_info(),
        outcome_validation=outcome,
        station_verification=station_verification(),
        score_calibration=score_calibration.report(),
    )

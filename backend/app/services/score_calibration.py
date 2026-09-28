"""The HeatLens score in deaths: the calibration fitted by backend/scripts/calibrate_score.py on the
31 days of the May 2010 Ahmedabad heatwave (results/score_calibration.json).

``for_score`` reads the fitted curve - deaths as a multiple of a normal May day, with its 95 %
bootstrap interval - and interpolates between whole score points. It gives a ratio only inside the
range of scores seen in May 2010; outside it the answer is "no estimate", never an extrapolation.
"""
from __future__ import annotations

import json
from functools import lru_cache

import numpy as np

from app.core.config import settings
from app.core.labels import EvidenceLabel
from app.schemas.risk import ScoreMortality

BASIS = (
    "Deaths as a multiple of a normal May day, from the HeatLens score's fit to daily deaths in the "
    "May 2010 Ahmedabad heatwave (31 days; Azhar et al. 2014 figures). "
    "One event only: not tested on other years."
)


@lru_cache(maxsize=1)
def report() -> dict | None:
    path = settings.score_calibration_json
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def for_score(score: float) -> ScoreMortality | None:
    rep = report()
    if rep is None:
        return None
    lo, hi = rep["calibrated_range"]
    if not lo <= score <= hi:
        return ScoreMortality(
            evidence=EvidenceLabel.MODELLED_CALIBRATED,
            in_calibrated_range=False,
            death_ratio=None,
            ci_low=None,
            ci_high=None,
            calibrated_range=(lo, hi),
            basis=f"Score {score:.0f} is outside the {lo:.0f}-{hi:.0f} range seen in May 2010, so there is no "
            "death estimate for it. " + BASIS,
        )
    xs = [c["score"] for c in rep["curve"]]

    def interp(key: str) -> float:
        return round(float(np.interp(score, xs, [c[key] for c in rep["curve"]])), 2)

    return ScoreMortality(
        evidence=EvidenceLabel.MODELLED_CALIBRATED,
        in_calibrated_range=True,
        death_ratio=interp("death_ratio"),
        ci_low=interp("ci_low"),
        ci_high=interp("ci_high"),
        calibrated_range=(lo, hi),
        basis=BASIS,
    )

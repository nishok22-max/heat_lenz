"""Census 2011 C-13 (single-year age) parsing — state and district level.

datasets/census/DDW-2400C-13.xls is Gujarat's single-year age table: a state block
followed by one block per district, each split Total/Rural/Urban.
datasets/census/DDW_PCA0702_2011_MDDS with UI.xlsx is a *different city's* ward file
(State code 7 = NCT of Delhi, District 91 = "North") — it is the worked example from
SIH_26083_Dataset_Links.pdf, not Ahmedabad data, and must never be attributed to
Ahmedabad. It is intentionally not read here.

The elderly share HeatLens uses is Ahmedabad DISTRICT, URBAN population (6.06 M, of which
AMC's 5.58 M is ~92 %) — the closest geography C-13 publishes to the municipal
corporation. C-13 has no ward breakdown, so the same real district-urban figure applies
to every ward and says so (``elderly_share_geography``). The Gujarat state figure is kept
as the comparison it used to replace.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from app.core.config import settings

_C13_PATH = settings.datasets_dir / "census" / "DDW-2400C-13.xls"

# The C-13 sheet stacks a state-level block (Distt. Code == 0) followed by one block
# per district, each with its own "All ages" row and a full 0..99 age breakdown.
# Filtering on distt_code == 0 selects the state total only — summing across every
# block (an earlier draft's bug, caught by cross-checking against the known 2011
# Gujarat population) double- (in fact 26x-order) counts and yields a nonsense
# ~15.75% "elderly share" instead of the correct ~7.9%.
_DISTRICT_CODE_STATE_TOTAL = 0.0
_AHMEDABAD_AREA_NAME = "District - Ahmadabad (07)"


@dataclass(frozen=True)
class ElderlyShare:
    state_name: str
    census_year: int
    total_population: int
    population_60_plus: int
    share_pct: float
    source_file: str


def _read_c13(path: Path) -> pd.DataFrame:
    df = pd.read_excel(path, header=None, skiprows=6)
    df.columns = [
        "table", "state_code", "distt_code", "area_name", "age",
        "tot_p", "tot_m", "tot_f", "rur_p", "rur_m", "rur_f", "urb_p", "urb_m", "urb_f",
    ]
    return df[df["age"].notna()]


def _share(block: pd.DataFrame, col: str, name: str, path: Path) -> ElderlyShare:
    total = int(block.loc[block["age"] == "All ages", col].iloc[0])
    age_num = pd.to_numeric(block["age"], errors="coerce")
    elderly_1_99 = int(block.loc[age_num >= 60, col].sum())
    elderly_100plus = int(block.loc[block["age"] == "100+", col].iloc[0])
    elderly = elderly_1_99 + elderly_100plus
    return ElderlyShare(
        state_name=name,
        census_year=2011,
        total_population=total,
        population_60_plus=elderly,
        share_pct=round(100 * elderly / total, 2),
        source_file=path.name,
    )


def load_gujarat_elderly_share(path: Path = _C13_PATH) -> ElderlyShare:
    df = _read_c13(path)
    return _share(df[df["distt_code"] == _DISTRICT_CODE_STATE_TOTAL], "tot_p", "Gujarat", path)


def load_ahmedabad_urban_elderly_share(path: Path = _C13_PATH) -> ElderlyShare:
    df = _read_c13(path)
    block = df[df["area_name"].astype(str).str.strip() == _AHMEDABAD_AREA_NAME]
    if block.empty:
        raise ValueError(f"{_AHMEDABAD_AREA_NAME!r} block not found in {path.name}")
    return _share(block, "urb_p", "Ahmadabad district, urban", path)


_cached: dict[str, ElderlyShare] = {}


def gujarat_elderly_share() -> ElderlyShare:
    if "state" not in _cached:
        _cached["state"] = load_gujarat_elderly_share()
    return _cached["state"]


def ahmedabad_urban_elderly_share() -> ElderlyShare:
    if "district_urban" not in _cached:
        _cached["district_urban"] = load_ahmedabad_urban_elderly_share()
    return _cached["district_urban"]

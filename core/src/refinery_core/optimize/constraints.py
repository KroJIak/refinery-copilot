from __future__ import annotations

from datetime import datetime

SULFUR_MAX = 10.0
T95_MAX = 360.0
CETANE_SUMMER = 51.0
CETANE_WINTER = 49.0
ADDITIVE_MAX = 3.0
WINTER_MONTHS = {11, 12, 1, 2, 3}


def season_of(t_point: datetime, override: str = "auto") -> str:
    if override in {"summer", "winter"}:
        return override
    return "winter" if t_point.month in WINTER_MONTHS else "summer"


def cetane_floor(season: str) -> float:
    return CETANE_WINTER if season == "winter" else CETANE_SUMMER

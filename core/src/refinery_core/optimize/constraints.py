from __future__ import annotations

from datetime import datetime

SULFUR_MAX = 10.0
T95_MAX = 360.0
CETANE_SUMMER = 51.0
CETANE_WINTER = 49.0
DENSITY_MIN = 820.0
DENSITY_MAX = 845.0
ADDITIVE_MAX = 3.0
WINTER_MONTHS = {11, 12, 1, 2, 3}


def season_of(t_point: datetime, override: str = "auto") -> str:
    if override in {"summer", "winter"}:
        return override
    return "winter" if t_point.month in WINTER_MONTHS else "summer"


def cetane_floor(season: str) -> float:
    return CETANE_WINTER if season == "winter" else CETANE_SUMMER


# Модельный блендинг: материалов по резервуарам организаторы не выдали.
# Числа — явные допущения для эксперимента, не лабораторные факты.
# Керосин легче и чище, газойль тяжелее и сернистее, присадка поднимает ЦЧ.
BLEND_KEROSENE = {"sulfur": 8.0, "t95": 220.0, "cetane": 45.0, "d15": 800.0}
BLEND_GASOIL = {"sulfur": 20.0, "t95": 370.0, "cetane": 48.0, "d15": 860.0}
# 1 % присадки ≈ +2.5 пункта ЦЧ внутри разрешённых 0–3 %.
ADDITIVE_CETANE_PER_PCT = 2.5
# Стоимость: 1 т присадки в 100 раз дороже 1 т ДТ, индекс нормирован на долю.
ADDITIVE_COST_PER_PCT = 1.0
SULFUR_ENERGY = 0.08

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from refinery_core.types import CONTROLLED_TAGS, ScenarioKind

DEMO_ORDER: tuple[ScenarioKind, ...] = (
    "normal",
    "quality_risk",
    "bad_data",
    "sour_crude",
    "stale_lims",
)


@dataclass(frozen=True)
class FaultInjection:
    sentinel_tags: tuple[str, ...] = ()
    lims_age_hours: float | None = None


@dataclass(frozen=True)
class Scenario:
    scenario_id: str
    kind: ScenarioKind
    t_point: datetime
    overrides: dict[str, float]
    seed: int
    description: str
    season: str = "auto"
    fault_injection: FaultInjection = field(default_factory=FaultInjection)


def _sid(kind: str, t_point: datetime, seed: int) -> str:
    raw = f"{kind}|{t_point.strftime('%Y-%m-%dT%H:%M:%SZ')}|{seed}"
    return hashlib.sha256(raw.encode()).hexdigest()[:8]


LABELS: dict[ScenarioKind, str] = {
    "normal": "Норма",
    "quality_risk": "Риск серы",
    "bad_data": "Плохие данные",
    "sour_crude": "Сернистая нефть",
    "stale_lims": "Старый ЛИМС",
}

# Часы подобраны по quality-датасету (момент = проба + 4 ч публикации).
# Подмен сырья и датчиков нет. У bad_data лаборатория в архиве уже старше порога.
PRESETS: dict[ScenarioKind, dict[str, Any]] = {
    "normal": {
        "t_point": datetime(2024, 8, 17, 14, 0, tzinfo=UTC),
        "overrides": {},
        "description": "17.08.2024, сера пробы 6.7, лаборатория свежая",
        "fault": FaultInjection(),
    },
    "quality_risk": {
        "t_point": datetime(2026, 5, 24, 14, 0, tzinfo=UTC),
        "overrides": {},
        "description": "24.05.2026, сера пробы 9.5 у нормы 10",
        "fault": FaultInjection(),
    },
    "bad_data": {
        "t_point": datetime(2026, 4, 27, 19, 30, tzinfo=UTC),
        "overrides": {},
        "description": "27.04.2026, предыдущая проба 317 ч назад",
        "fault": FaultInjection(),
    },
    "sour_crude": {
        "t_point": datetime(2025, 5, 20, 14, 0, tzinfo=UTC),
        "overrides": {},
        "description": "20.05.2025, сера сырья 1.057, проба продукта 11.3",
        "fault": FaultInjection(),
    },
    "stale_lims": {
        "t_point": datetime(2026, 7, 2, 16, 0, tzinfo=UTC),
        "overrides": {},
        "description": "02.07.2026, предыдущая проба 350 ч назад",
        "fault": FaultInjection(),
    },
}


def scenario_title(kind: ScenarioKind) -> str:
    return f"{LABELS[kind]} ({kind})"


def resolve_scenario(
    kind: ScenarioKind,
    *,
    t_point: datetime | None = None,
    overrides: dict[str, float] | None = None,
    seed: int = 42,
    season: str = "auto",
) -> Scenario:
    if kind not in PRESETS:
        raise ValueError(f"unknown scenario {kind}")
    if season not in {"auto", "summer", "winter"}:
        raise ValueError(f"unknown season {season}")
    spec = PRESETS[kind]
    tp = t_point or spec["t_point"]
    if tp.tzinfo is None:
        tp = tp.replace(tzinfo=UTC)
    ov = dict(spec["overrides"])
    if overrides:
        bad = [k for k in overrides if k not in CONTROLLED_TAGS]
        if bad:
            raise ValueError(f"unmanaged_override: {', '.join(bad)}")
        ov.update(overrides)
    return Scenario(
        scenario_id=_sid(kind, tp, seed),
        kind=kind,
        t_point=tp,
        overrides=ov,
        seed=seed,
        description=spec["description"],
        season=season,
        fault_injection=spec["fault"],
    )


def preset_feed_delta(kind: ScenarioKind) -> float:
    return float(PRESETS[kind].get("feed_sulfur_delta", 0.0))

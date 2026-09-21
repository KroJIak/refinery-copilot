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

PRESETS: dict[ScenarioKind, dict[str, Any]] = {
    "normal": {
        "t_point": datetime(2024, 5, 15, 8, 0, tzinfo=UTC),
        "overrides": {},
        "description": "Устойчивый режим, свежая лаборатория",
        "fault": FaultInjection(),
    },
    "quality_risk": {
        "t_point": datetime(2026, 6, 15, 8, 0, tzinfo=UTC),
        "overrides": {},
        "description": "Сера у границы 10 мг/кг",
        "fault": FaultInjection(),
    },
    "bad_data": {
        "t_point": datetime(2026, 6, 15, 8, 0, tzinfo=UTC),
        "overrides": {},
        "description": "Сентинелы в T5/F26 и устаревший ЛИМС",
        "fault": FaultInjection(sentinel_tags=("T5", "F26"), lims_age_hours=60.0),
    },
    "sour_crude": {
        "t_point": datetime(2026, 6, 15, 8, 0, tzinfo=UTC),
        "overrides": {"blend_share_kerosene": 0.12},
        "description": "Выше сера сырья",
        "fault": FaultInjection(),
        "feed_sulfur_delta": 0.4,
    },
    "stale_lims": {
        "t_point": datetime(2026, 6, 1, 12, 0, tzinfo=UTC),
        "overrides": {},
        "description": "Только устаревший ЛИМС",
        "fault": FaultInjection(lims_age_hours=60.0),
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
) -> Scenario:
    if kind not in PRESETS:
        raise ValueError(f"unknown scenario {kind}")
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
        fault_injection=spec["fault"],
    )


def preset_feed_delta(kind: ScenarioKind) -> float:
    return float(PRESETS[kind].get("feed_sulfur_delta", 0.0))

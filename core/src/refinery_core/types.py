from __future__ import annotations

from typing import Literal

AgentRole = Literal["data", "quality", "reliability", "optimization", "orchestrator"]
FreshnessStatus = Literal["ok", "warn", "stale", "missing"]
RefusalReason = Literal[
    "stale_lims",
    "wide_interval",
    "out_of_training_domain",
    "no_feasible_variant",
    "sensor_fault",
]

REFUSAL_REASON_LABELS: dict[RefusalReason, str] = {
    "stale_lims": "лаборатория слишком старая",
    "sensor_fault": "ключевые датчики врут, залипли или вместо числа пришла заглушка",
    "wide_interval": "вилка прогноза слишком широкая и задевает норму",
    "out_of_training_domain": "режим не похож на то, на чём училась модель",
    "no_feasible_variant": "все варианты крутки ломают ограничения",
}

FRESHNESS_STATUS_LABELS: dict[FreshnessStatus, str] = {
    "ok": "свежая",
    "warn": "уже стареет",
    "stale": "устарела",
    "missing": "нет данных",
}


def refusal_reason_label(reason: str) -> str:
    if reason in REFUSAL_REASON_LABELS:
        return REFUSAL_REASON_LABELS[reason]  # type: ignore[index]
    return reason


def freshness_status_label(status: str) -> str:
    if status in FRESHNESS_STATUS_LABELS:
        return FRESHNESS_STATUS_LABELS[status]  # type: ignore[index]
    return status
RunStatus = Literal["started", "running", "completed", "refused", "failed"]
ScenarioKind = Literal["normal", "quality_risk", "bad_data", "sour_crude", "stale_lims"]
QualityTarget = Literal["sulfur", "t95", "d15", "cetane"]
Decision = Literal["recommend", "refuse"]
LlmMode = Literal["off", "local", "external"]

DEMO_KINDS: tuple[ScenarioKind, ...] = (
    "normal",
    "quality_risk",
    "bad_data",
    "sour_crude",
)

EXPECTED_OUTCOME: dict[ScenarioKind, Decision] = {
    "normal": "recommend",
    "quality_risk": "recommend",
    "bad_data": "refuse",
    "sour_crude": "recommend",
    "stale_lims": "refuse",
}

CONTROLLED_TAGS = frozenset(
    {
        "24-2000.T11",
        "24-2000.F26",
        "24-2000.F19",
        "blend_share_kerosene",
        "blend_share_gasoil",
        "blend_additive_pct",
    }
)

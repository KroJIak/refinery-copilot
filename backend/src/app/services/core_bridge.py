from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from refinery_core.agents.orchestrator import run_pipeline
from refinery_core.config import Settings as CoreSettings
from refinery_core.events import CoreEvent
from refinery_core.registry import EnvironmentError, ModelRegistry
from refinery_core.report.run_report import persist
from refinery_core.scenarios import LABELS, PRESETS, resolve_scenario
from refinery_core.store import SliceStore
from refinery_core.types import ScenarioKind

CONTROLLED = [
    {"key": "24-2000.P8", "group": "hdu", "label": "Температура входа реактора", "unit": "°C", "p2": 330, "p98": 375, "step": 0.5},
    {"key": "24-2000.T11", "group": "hdu", "label": "Расход сырья", "unit": "т/ч", "p2": 150, "p98": 300, "step": 1},
    {"key": "24-2000.F19", "group": "hdu", "label": "Давление реактора", "unit": "МПа", "p2": 3, "p98": 5.5, "step": 0.1},
    {"key": "crude_feed_rate_tph", "group": "avt", "label": "Расход нефти", "unit": "т/ч", "p2": 42.9, "p98": 1181.3, "step": 5},
    {"key": "avt_furnace_outlet_temp_c", "group": "avt", "label": "Температура выхода печи", "unit": "°C", "p2": 20.4, "p98": 385.7, "step": 0.5},
    {"key": "avt_column_pressure_mpa_abs", "group": "avt", "label": "Давление колонны", "unit": "МПа", "p2": 0.36, "p98": 1.21, "step": 0.01},
    {"key": "blend_share_kerosene", "group": "blend", "label": "Доля керосина", "unit": "доля", "p2": 0, "p98": 1, "step": 0.01},
    {"key": "blend_share_gasoil", "group": "blend", "label": "Доля газойля", "unit": "доля", "p2": 0, "p98": 1, "step": 0.01},
    {"key": "blend_additive_pct", "group": "blend", "label": "Присадка", "unit": "%", "p2": 0, "p98": 3, "step": 0.1},
]


def _iso(ts: datetime) -> str:
    return ts.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _num(value: Any) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number):
        return None
    return number


def _sentinel(value: float | None) -> bool:
    if value is None:
        return True
    return any(abs(value - item) < 0.05 for item in (24.9, 307, 251, 252, 240))


def _tag(code: str, ts: str, value: Any, unit: str | None, source: str, flag: str | None = None) -> dict[str, Any]:
    number = _num(value)
    return {
        "tagCode": code,
        "ts": ts,
        "value": None if number is not None and _sentinel(number) and code == "Q21" else number,
        "qualityFlag": flag or ("sentinel" if code == "Q21" and _sentinel(number) else "ok"),
        "source": source,
        "unit": unit,
    }


class MemorySink:
    def __init__(self) -> None:
        self.events: list[CoreEvent] = []

    def emit(self, event: CoreEvent) -> None:
        self.events.append(event)


@dataclass
class AppState:
    settings: CoreSettings
    registry: ModelRegistry | None
    store: SliceStore | None
    error: str | None
    runs: dict[str, dict[str, Any]] = field(default_factory=dict)
    active: str | None = None

    @classmethod
    def load(cls) -> AppState:
        settings = CoreSettings.from_env()
        registry = None
        store = None
        error = None
        try:
            registry = ModelRegistry.load(settings)
        except EnvironmentError as exc:
            error = str(exc)
        dataset = settings.quality_dataset
        if dataset.is_file():
            store = SliceStore.load(dataset)
        elif error is None:
            error = f"data_missing: {dataset}"
        return cls(settings=settings, registry=registry, store=store, error=error)


def scenarios_payload() -> list[dict[str, Any]]:
    return [
        {
            "kind": kind,
            "tPoint": _iso(spec["t_point"]),
            "label": LABELS[kind],
            "description": spec["description"],
            "overrides": spec["overrides"],
        }
        for kind, spec in PRESETS.items()
    ]


def state_payload(app: AppState, t_point: datetime) -> dict[str, Any]:
    if app.store is None:
        raise FileNotFoundError("data_missing")
    row = app.store.row_at(t_point)
    sample = row["sample_ts"].to_pydatetime()
    sample_iso = _iso(sample)
    tags = [
        _tag("24-2000.T5", sample_iso, row.get("T5_lag0"), "°C", "kip"),
        _tag("24-2000.F26", sample_iso, row.get("F26_lag0"), "т/ч", "kip"),
        _tag("24-2000.P8", sample_iso, row.get("P8_lag0"), "°C", "kip"),
        _tag("t95", sample_iso, row.get("t95_same_sample"), "°C", "lims"),
        _tag("cetane", sample_iso, row.get("cetane_same_sample") or row.get("cetane_last"), None, "lims"),
        _tag("d15", sample_iso, row.get("d15_same_sample") or row.get("d15_last"), "кг/м³", "lims"),
    ]
    recent = app.store.frame[app.store.frame["sample_ts"] <= sample].tail(48)
    for _, rec in recent.iterrows():
        stamp = _iso(rec["sample_ts"].to_pydatetime())
        tags.append(_tag("sulfur", stamp, rec.get("y_sulfur"), "мг/кг", "lims"))
        tags.append(_tag("Q21", stamp, rec.get("Q21_lag0"), "мг/кг", "pak"))
    age = _num(row.get("lims_age_h"))
    status = "missing" if age is None else "stale" if age > 52 else "warn" if age > 28 else "ok"
    freshness = [
        {
            "pointId": "сера продукта",
            "source": "lims",
            "lastSampleTs": sample_iso,
            "availableTs": sample_iso,
            "ageHours": age,
            "status": status,
            "warnAfterH": 28,
            "staleAfterH": 52,
        },
        {
            "pointId": "сера анализатора",
            "source": "pak",
            "lastSampleTs": sample_iso,
            "availableTs": sample_iso,
            "ageHours": 0.2,
            "status": "ok",
            "warnAfterH": 2,
            "staleAfterH": 6,
        },
    ]
    return {
        "tPoint": _iso(t_point),
        "tags": tags,
        "freshness": freshness,
        "telemetryWindow": app.store.window(t_point),
    }


def models_payload(app: AppState) -> list[dict[str, Any]]:
    if app.registry is None:
        return []
    hold = app.registry.sulfur_metrics.get("hold_cqr") or {}
    t95 = app.registry.t95_baseline
    names = {"sulfur": "Сера", "t95": "Температура выкипания"}
    return [
        {
            "artifactId": names["sulfur"],
            "target": "sulfur",
            "active": True,
            "algorithm": "квантили",
            "quantiles": [0.1, 0.5, 0.9],
            "features": [],
            "monotoneConstraints": {},
            "conformal": {},
            "metrics": {"mae": hold.get("mae")},
            "coverage": hold.get("coverage"),
            "trainedOnRange": {"start": "2023-01-01T00:00:00Z", "end": "2026-08-09T00:00:00Z"},
            "seed": 42,
            "createdAt": "2026-08-09T00:00:00Z",
            "coreVersion": "0.1.0",
            "dataHashes": {},
        },
        {
            "artifactId": names["t95"],
            "target": "t95",
            "active": True,
            "algorithm": "последняя проба",
            "quantiles": [],
            "features": [],
            "monotoneConstraints": {},
            "conformal": {},
            "metrics": {"mae": t95.get("hold_mae")},
            "coverage": t95.get("coverage"),
            "trainedOnRange": {"start": "2023-01-01T00:00:00Z", "end": "2026-08-09T00:00:00Z"},
            "seed": 42,
            "createdAt": "2026-08-09T00:00:00Z",
            "coreVersion": "0.1.0",
            "dataHashes": {},
        },
    ]


def start_run(app: AppState, kind: ScenarioKind, t_point: datetime, overrides: dict[str, float], seed: int, season: str) -> str:
    if app.registry is None or app.store is None:
        raise EnvironmentError(app.error or "models_not_loaded")
    if app.active:
        raise RuntimeError("run_already_active")
    scenario = resolve_scenario(kind, t_point=t_point, overrides=overrides, seed=seed, season=season)
    sink = MemorySink()
    app.active = "starting"
    try:
        result = run_pipeline(scenario, app.store, app.registry, sink=sink, settings=app.settings)
        artifacts = persist(result, app.settings)
    finally:
        app.active = None
    app.runs[result.run_id] = {"result": result, "events": sink.events, "artifacts": artifacts}
    return result.run_id

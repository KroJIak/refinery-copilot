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
    {"key": "24-2000.P8", "group": "hdu", "label": "Температура входа Р-202", "unit": "°C", "p2": 330, "p98": 375, "step": 0.5},
    {"key": "24-2000.T11", "group": "hdu", "label": "Расход сырья", "unit": "т/ч", "p2": 150, "p98": 300, "step": 1},
    {"key": "24-2000.F19", "group": "hdu", "label": "Давление Р-202", "unit": "МПа", "p2": 3, "p98": 5.5, "step": 0.1},
    {"key": "crude_feed_rate_tph", "group": "avt", "label": "Расход нефти", "unit": "т/ч", "p2": 42.9, "p98": 1181.3, "step": 5},
    {"key": "avt_furnace_outlet_temp_c", "group": "avt", "label": "Температура выхода печи", "unit": "°C", "p2": 20.4, "p98": 385.7, "step": 0.5},
    {"key": "avt_column_pressure_mpa_abs", "group": "avt", "label": "Давление колонны", "unit": "МПа", "p2": 0.36, "p98": 1.21, "step": 0.01},
    {"key": "blend_share_kerosene", "group": "blend", "label": "Керосин", "unit": "доля", "p2": 0, "p98": 1, "step": 0.01},
    {"key": "blend_share_gasoil", "group": "blend", "label": "Газойль", "unit": "доля", "p2": 0, "p98": 1, "step": 0.01},
    {"key": "blend_additive_pct", "group": "blend", "label": "Присадка", "unit": "%", "p2": 0, "p98": 3, "step": 0.1},
]


def _iso(ts: datetime) -> str:
    return ts.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


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
        ds = settings.quality_dataset
        if ds.is_file():
            store = SliceStore.load(ds)
        elif error is None:
            error = f"data_missing: {ds}"
        return cls(settings=settings, registry=registry, store=store, error=error)


def scenarios_payload() -> list[dict[str, Any]]:
    out = []
    for kind, spec in PRESETS.items():
        out.append(
            {
                "kind": kind,
                "tPoint": _iso(spec["t_point"]),
                "label": LABELS[kind],
                "description": spec["description"],
                "overrides": spec["overrides"],
            }
        )
    return out


def state_payload(app: AppState, t_point: datetime) -> dict[str, Any]:
    if app.store is None:
        raise FileNotFoundError("data_missing")
    row = app.store.row_at(t_point)
    sample = row["sample_ts"].to_pydatetime()
    tags = []
    mapping = {
        "24-2000.T5": ("T5_lag0", "°C"),
        "24-2000.F26": ("F26_lag0", None),
        "24-2000.P8": ("P8_lag0", None),
        "Q21": ("Q21_lag0", "мг/кг"),
    }
    for code, (col, unit) in mapping.items():
        val = row.get(col)
        tags.append(
            {
                "tagCode": code,
                "ts": _iso(sample),
                "value": None if val is None or (isinstance(val, float) and math.isnan(val)) else float(val),
                "qualityFlag": "ok",
                "source": "telemetry",
                "unit": unit,
            }
        )
    age = float(row["lims_age_h"]) if row.get("lims_age_h") == row.get("lims_age_h") else None
    status = "missing" if age is None else "stale" if age > 52 else "warn" if age > 28 else "ok"
    freshness = [
        {
            "pointId": "hdu_product_sulfur",
            "source": "lims",
            "lastSampleTs": _iso(sample),
            "availableTs": _iso(sample),
            "ageHours": age,
            "status": status,
            "warnAfterH": 28,
            "staleAfterH": 52,
        }
    ]
    window = app.store.window(t_point)
    return {
        "tPoint": _iso(t_point),
        "tags": tags,
        "freshness": freshness,
        "telemetryWindow": window,
    }


def models_payload(app: AppState) -> list[dict[str, Any]]:
    if app.registry is None:
        return []
    m = app.registry.sulfur_metrics
    hold = m.get("hold_cqr") or {}
    t95 = app.registry.t95_baseline
    return [
        {
            "artifactId": "sulfur_advisory",
            "target": "sulfur",
            "active": True,
            "metrics": {"mae": hold.get("mae")},
            "coverage": hold.get("coverage"),
            "trainedOnRange": {"start": "2023-01-01T00:00:00Z", "end": "2026-08-09T00:00:00Z"},
            "seed": 42,
        },
        {
            "artifactId": "t95_advisory",
            "target": "t95",
            "active": True,
            "metrics": {"mae": t95.get("hold_mae")},
            "coverage": t95.get("coverage"),
            "trainedOnRange": {"start": "2023-01-01T00:00:00Z", "end": "2026-08-09T00:00:00Z"},
            "seed": 42,
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

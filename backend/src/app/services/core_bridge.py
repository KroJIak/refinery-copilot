from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from refinery_core import __version__
from refinery_core.agents.orchestrator import run_pipeline
from refinery_core.config import Settings as CoreSettings
from refinery_core.events import CoreEvent
from refinery_core.registry import EnvironmentError, ModelRegistry
from refinery_core.report.run_report import persist
from refinery_core.scenarios import LABELS, PRESETS, resolve_scenario
from refinery_core.store import SliceStore
from refinery_core.types import ScenarioKind

# Имена ручек — официальные теги ТЗ. Числа p2–p98 и источник ряда взяты по поведению
# архива: справочник 24-2000 подписан иначе, чем ведут себя колонки.
# T11 в справочнике — температура входа, в ряду это колонка T11 (~364 °C).
# F19 в справочнике — давление реактора, в ряду это колонка P13 (~3.9 МПа).
# Расход продукта, который двигает модель серы, — колонка F26.
CONTROLLED = [
    {"key": "24-2000.T11", "group": "hdu", "label": "Температура входа реактора", "unit": "°C", "p2": 345, "p98": 382, "step": 0.5},
    {"key": "24-2000.F26", "group": "hdu", "label": "Расход продукта", "unit": "т/ч", "p2": 163, "p98": 301, "step": 1},
    {"key": "24-2000.F19", "group": "hdu", "label": "Давление реактора", "unit": "МПа", "p2": 3.66, "p98": 4.05, "step": 0.01},
    {"key": "blend_share_kerosene", "group": "blend", "label": "Доля керосина", "unit": "доля", "p2": 0, "p98": 0.4, "step": 0.01},
    {"key": "blend_share_gasoil", "group": "blend", "label": "Доля газойля", "unit": "доля", "p2": 0, "p98": 0.4, "step": 0.01},
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
        _tag("24-2000.T6", sample_iso, row.get("T6_lag0"), "°C", "kip"),
        _tag("24-2000.T11", sample_iso, row.get("T11_lag0"), "°C", "kip"),
        _tag("24-2000.P8", sample_iso, row.get("P8_lag0"), "МПа", "kip"),
        _tag("24-2000.F19", sample_iso, row.get("P13_lag0"), "МПа", "kip"),
        _tag("24-2000.F26", sample_iso, row.get("F26_lag0"), "т/ч", "kip"),
        _tag("24-2000.P13", sample_iso, row.get("P13_lag0"), "МПа", "kip"),
        _tag("T55", sample_iso, row.get("T55_lag0"), "°C", "kip"),
        _tag("F65", sample_iso, row.get("F65_lag0"), "т/ч", "kip"),
        _tag("W70", sample_iso, row.get("W70_lag0"), None, "kip"),
        _tag("t95", sample_iso, row.get("t95_same_sample"), "°C", "lims"),
        _tag("cetane", sample_iso, row.get("cetane_same_sample") if _num(row.get("cetane_same_sample")) is not None else row.get("cetane_last"), None, "lims"),
        _tag("d15", sample_iso, row.get("d15_same_sample") if _num(row.get("d15_same_sample")) is not None else row.get("d15_last"), "кг/м³", "lims"),
        _tag("feed_sulfur", sample_iso, row.get("feed_sulfur"), "%", "lims"),
    ]
    recent = app.store.frame[app.store.frame["sample_ts"] <= sample].tail(48)
    for _, rec in recent.iterrows():
        stamp = _iso(rec["sample_ts"].to_pydatetime())
        tags.append(_tag("sulfur", stamp, rec.get("y_sulfur"), "мг/кг", "lims"))
        tags.append(_tag("Q21", stamp, rec.get("Q21_lag0"), "мг/кг", "pak"))
    age = _num(row.get("lims_age_h"))
    status = "missing" if age is None else "stale" if age > 52 else "warn" if age > 28 else "ok"
    asked = t_point.astimezone(UTC)
    pak_ts = asked
    if app.store.telemetry is not None and not app.store.telemetry.empty:
        past = app.store.telemetry[app.store.telemetry["date"] <= pd_stamp(asked)]
        if not past.empty:
            pak_ts = past.iloc[-1]["date"].to_pydatetime()
    pak_age = max(0.0, (asked - pak_ts.astimezone(UTC)).total_seconds() / 3600.0)
    pak_status = "missing" if pak_age > 24 * 14 else "stale" if pak_age > 6 else "warn" if pak_age > 2 else "ok"
    pak_iso = _iso(pak_ts)
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
            "lastSampleTs": pak_iso,
            "availableTs": pak_iso,
            "ageHours": round(pak_age, 2),
            "status": pak_status,
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


def _file_stamp(path) -> str:
    moment = datetime.fromtimestamp(path.stat().st_mtime, UTC)
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def _file_hash(path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()[:16]


def _train_range(app: AppState) -> dict[str, str]:
    """Окно обучения — всё, кроме отложенной проверки (последние ~3 % проб)."""
    start = "2023-01-01T00:00:00Z"
    end = "2026-08-07T00:00:00Z"
    if app.store is not None and not app.store.frame.empty:
        stamps = app.store.frame["sample_ts"].sort_values()
        hold = max(1, int(len(stamps) * 0.03))
        train = stamps.iloc[:-hold]
        start = _iso(train.min().to_pydatetime())
        end = _iso(train.max().to_pydatetime())
    return {"start": start, "end": end}


def pd_stamp(moment: datetime):
    import pandas as pd

    return pd.Timestamp(moment)


def models_payload(app: AppState) -> list[dict[str, Any]]:
    if app.registry is None:
        return []
    metrics = app.registry.sulfur_metrics
    hold = metrics.get("hold_cqr") or {}
    t95_metrics = {}
    t95_path = app.registry.t95_dir / "metrics.json"
    if t95_path.is_file():
        import json

        t95_metrics = json.loads(t95_path.read_text(encoding="utf-8")).get("hold") or {}
    window = _train_range(app)
    sulfur_file = app.registry.sulfur_dir / "metrics.json"
    t95_file = app.registry.t95_dir / "baseline.json"
    mono = {"T5": -1, "F26": 1}
    return [
        {
            "artifactId": "Сера",
            "target": "sulfur",
            "active": True,
            "algorithm": "LightGBM quantile",
            "quantiles": [0.1, 0.5, 0.9],
            "features": list(app.registry.features_quantile),
            "monotoneConstraints": mono,
            "conformal": {"q": (metrics.get("hold_cqr") or {}).get("q")},
            "metrics": {
                "mae": hold.get("mae"),
                "winkler": hold.get("winkler"),
                "coverage": hold.get("coverage"),
            },
            "coverage": hold.get("coverage"),
            "trainedOnRange": window,
            "seed": int(metrics.get("seed") or app.settings.seed),
            "createdAt": _file_stamp(sulfur_file),
            "coreVersion": __version__,
            "dataHashes": {"metrics": _file_hash(sulfur_file)},
        },
        {
            "artifactId": "Температура выкипания",
            "target": "t95",
            "active": True,
            "algorithm": "persistence_month_offset",
            "quantiles": [],
            "features": ["t95_same_sample", "month"],
            "monotoneConstraints": {},
            "conformal": {"halfwidth": app.registry.t95_baseline.get("interval_halfwidth")},
            "metrics": {"mae": t95_metrics.get("mae"), "coverage": t95_metrics.get("coverage")},
            "coverage": t95_metrics.get("coverage"),
            "trainedOnRange": window,
            "seed": int(app.registry.t95_baseline.get("seed") or app.settings.seed),
            "createdAt": _file_stamp(t95_file),
            "coreVersion": __version__,
            "dataHashes": {"baseline": _file_hash(t95_file)},
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
    app.runs[result.run_id] = {
        "result": result,
        "events": sink.events,
        "artifacts": artifacts,
        "created_at": datetime.now(UTC),
    }
    return result.run_id

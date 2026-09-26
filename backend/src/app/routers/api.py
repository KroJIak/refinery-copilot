import math

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel
from sse_starlette.sse import EventSourceResponse

from app.services.core_bridge import (
    CONTROLLED,
    AppState,
    models_payload,
    scenarios_payload,
    start_run,
    state_payload,
)
from refinery_core import __version__
from refinery_core.registry import EnvironmentError
from refinery_core.scenarios import PRESETS

router = APIRouter()


class Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class RunBody(Camel):
    kind: str
    t_point: str = Field(alias="tPoint")
    overrides: dict[str, float] = Field(default_factory=dict)
    seed: int | None = None
    season: str = "auto"

    @field_validator("t_point")
    @classmethod
    def valid_t_point(cls, value: str) -> str:
        _moment(value)
        return value


def _app(request: Request) -> AppState:
    return request.app.state.core


def _err(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status, {"error": {"code": code, "message": message, "details": {}}})


def _moment(raw: str):
    from datetime import datetime

    text = raw[:-1] + "+00:00" if raw.endswith("Z") else raw
    return datetime.fromisoformat(text)


def _finite(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return number


def _valid_overrides(value: object) -> dict[str, float]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise TypeError("overrides должны быть объектом")
    allowed = {item["key"] for item in CONTROLLED}
    unknown = set(value) - allowed
    if unknown:
        raise ValueError("неуправляемые параметры: " + ", ".join(sorted(unknown)))
    return {key: _validated_number(key, raw) for key, raw in value.items()}


def _validated_number(key: str, value: object) -> float:
    number = _finite(value)
    if number is None:
        raise ValueError(f"некорректное значение {key}")
    return number


class _T95Ctx:
    """Минимальный контекст для сезонной поправки T95 из ядра."""

    def __init__(self, row, registry) -> None:
        self.row = row
        self.registry = registry


@router.get("/health")
def health(request: Request) -> dict:
    app = _app(request)
    loaded = 0 if app.registry is None else 2
    return {
        "status": "ok" if app.error is None else "degraded",
        "contract": "1.0.0",
        "core": __version__,
        "modelsLoaded": loaded,
    }


@router.get("/scenarios")
def scenarios() -> list:
    return scenarios_payload()


@router.get("/controlled-variables")
def controlled() -> list:
    return CONTROLLED


@router.get("/models")
def models(request: Request) -> list:
    return models_payload(_app(request))


@router.get("/state")
def state(request: Request, t_point: str | None = Query(None, alias="tPoint")) -> dict:
    app = _app(request)
    if app.store is None:
        raise _err(503, "data_missing", "Датасет качества не найден")
    raw = t_point or PRESETS["quality_risk"]["t_point"].strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        ts = _moment(raw)
        return state_payload(app, ts)
    except ValueError as exc:
        raise _err(400, "bad_t_point", "Некорректная временная метка") from exc
    except LookupError as exc:
        raise _err(404, "no_sample", str(exc)) from exc


@router.post("/runs", status_code=202)
def create_run(body: RunBody, request: Request) -> dict:
    app = _app(request)
    try:
        ts = _moment(body.t_point)
        run_id = start_run(
            app,
            body.kind,  # type: ignore[arg-type]
            ts,
            body.overrides,
            body.seed or app.settings.seed,
            body.season,
        )
    except EnvironmentError as exc:
        raise _err(503, "models_not_loaded", str(exc)) from exc
    except RuntimeError as exc:
        raise _err(409, "run_already_active", str(exc)) from exc
    except ValueError as exc:
        raise _err(400, "bad_request", str(exc)) from exc
    return {"runId": run_id, "status": "started", "eventsUrl": f"/api/runs/{run_id}/events"}


@router.get("/runs")
def list_runs(request: Request) -> list:
    app = _app(request)
    rows = []
    for run_id, item in app.runs.items():
        result = item["result"]
        rows.append(
            {
                "runId": run_id,
                "status": result.status,
                "kind": result.scenario.kind,
                "tPoint": result.scenario.t_point.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "decision": result.recommendation.get("decision"),
                "createdAt": item["created_at"].strftime("%Y-%m-%dT%H:%M:%SZ"),
            }
        )
    return rows


def _camel(value):
    if isinstance(value, list):
        return [_camel(item) for item in value]
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            parts = str(key).split("_")
            if len(parts) == 1:
                name = str(key)
            else:
                name = parts[0] + "".join(part[:1].upper() + part[1:] for part in parts[1:])
            out[name] = _camel(item)
        return out
    return value


@router.get("/runs/{run_id}")
def get_run(run_id: str, request: Request) -> dict:
    item = _app(request).runs.get(run_id)
    if not item:
        raise _err(404, "run_not_found", "Прогон не найден")
    path = _app(request).settings.root / item["artifacts"]["report_json"]
    import json

    return _camel(json.loads(path.read_text(encoding="utf-8")))


@router.get("/runs/{run_id}/report.{fmt}")
def report(run_id: str, fmt: str, request: Request):
    item = _app(request).runs.get(run_id)
    if not item or fmt not in {"md", "json"}:
        raise _err(404, "run_not_found", "Прогон не найден")
    key = "report_md" if fmt == "md" else "report_json"
    path = _app(request).settings.root / item["artifacts"][key]
    if fmt == "md":
        return PlainTextResponse(path.read_text(encoding="utf-8"))
    return FileResponse(path, media_type="application/json")


@router.get("/runs/{run_id}/events")
async def events(run_id: str, request: Request):
    item = _app(request).runs.get(run_id)
    if not item:
        raise _err(404, "run_not_found", "Прогон не найден")

    async def gen():
        import json

        for ev in item["events"]:
            payload = {"seq": ev.seq, "runId": ev.run_id, "kind": ev.kind, **ev.payload}
            yield {"event": ev.kind, "data": json.dumps(payload, ensure_ascii=False, default=str)}

    return EventSourceResponse(gen())


@router.post("/whatif")
def whatif(request: Request, body: dict) -> dict:
    app = _app(request)
    if app.registry is None or app.store is None:
        raise _err(503, "models_not_loaded", app.error or "модели не загружены")
    from time import perf_counter

    import pandas as pd

    from refinery_core.agents.quality import _t95, bump_tag, feature_matrix
    from refinery_core.models.round2_search import add_plant_features
    from refinery_core.optimize.constraints import (
        ADDITIVE_CETANE_PER_PCT,
        ADDITIVE_COST_PER_PCT,
        ADDITIVE_MAX,
        BLEND_GASOIL,
        BLEND_KEROSENE,
        DENSITY_MAX,
        DENSITY_MIN,
        SULFUR_ENERGY,
        T95_MAX,
        cetane_floor,
        season_of,
    )

    started = perf_counter()
    raw = body.get("tPoint")
    try:
        ts = _moment(str(raw))
    except ValueError as exc:
        raise _err(400, "bad_t_point", "Некорректная временная метка") from exc
    try:
        row = app.store.row_at(ts)
    except LookupError as exc:
        raise _err(404, "no_sample", str(exc)) from exc
    df = add_plant_features(pd.DataFrame([row]))
    season = season_of(ts, str(body.get("season") or "auto"))
    floor = cetane_floor(season)
    cetane_id = "cetane_min_winter" if season == "winter" else "cetane_min_summer"
    base_t5 = _finite(df.iloc[0].get("T5_lag0"))
    base_t11 = _finite(df.iloc[0].get("T11_lag0"))
    base_f26 = _finite(df.iloc[0].get("F26_lag0"))
    base_p13 = _finite(df.iloc[0].get("P13_lag0"))
    loc_cols = app.registry.features_whatif
    loc0 = app.registry.loc_value(feature_matrix(df, loc_cols))
    x = feature_matrix(df, app.registry.features_quantile)
    s10, s50, s90 = app.registry.predict_quantiles(x)
    t95 = _t95(df, _T95Ctx(row, app.registry))
    half = float(app.registry.t95_baseline["interval_halfwidth"])
    cetane0 = _finite(row.get("cetane_same_sample"))
    if cetane0 is None:
        cetane0 = _finite(row.get("cetane_last"))
    density0 = _finite(row.get("d15_same_sample"))
    if density0 is None:
        density0 = _finite(row.get("d15_last"))
    kerosene_s = BLEND_KEROSENE["sulfur"]
    kerosene_t = BLEND_KEROSENE["t95"]
    kerosene_c = BLEND_KEROSENE["cetane"]
    kerosene_d = BLEND_KEROSENE["d15"]
    gasoil_s = BLEND_GASOIL["sulfur"]
    gasoil_t = BLEND_GASOIL["t95"]
    gasoil_c = BLEND_GASOIL["cetane"]
    gasoil_d = BLEND_GASOIL["d15"]

    def point(target: str, p10: float, p50: float, p90: float, unit: str, risk: float) -> dict:
        return {
            "target": target,
            "p10": round(p10, 4),
            "p50": round(p50, 4),
            "p90": round(p90, 4),
            "specRisk": round(max(0.0, risk), 4),
            "unit": unit,
        }

    def blend(overrides: dict) -> dict:
        delta_t5 = 0.0
        # Ползунок показывает T11. Модель серы двигает ряд T5 на ту же величину.
        if "24-2000.T11" in overrides and base_t11 is not None:
            delta_t5 = float(overrides["24-2000.T11"]) - base_t11
        if "24-2000.T5" in overrides and base_t5 is not None:
            delta_t5 = float(overrides["24-2000.T5"]) - base_t5
        delta_f26 = 0.0
        if "24-2000.F26" in overrides and base_f26 is not None:
            delta_f26 = float(overrides["24-2000.F26"]) - base_f26
        delta_p13 = 0.0
        if "24-2000.F19" in overrides and base_p13 is not None:
            delta_p13 = float(overrides["24-2000.F19"]) - base_p13
        moved = df
        if delta_t5:
            moved = bump_tag(moved, "T5", loc_cols, delta_t5)
        if delta_f26:
            moved = bump_tag(moved, "F26", loc_cols, delta_f26)
        if delta_p13:
            moved = bump_tag(moved, "P13", loc_cols, delta_p13)
        shift = app.registry.loc_value(feature_matrix(moved, loc_cols)) - loc0
        kerosene = float(overrides.get("blend_share_kerosene", 0.0) or 0.0)
        gasoil = float(overrides.get("blend_share_gasoil", 0.0) or 0.0)
        diesel = 1.0 - kerosene - gasoil
        additive = float(overrides.get("blend_additive_pct", 0.0) or 0.0)
        hdu_s, hdu_t = s50 + shift, t95
        sulfur = diesel * hdu_s + kerosene * kerosene_s + gasoil * gasoil_s
        boiling = diesel * hdu_t + kerosene * kerosene_t + gasoil * gasoil_t
        cetane = (
            None
            if cetane0 is None
            else diesel * cetane0
            + kerosene * kerosene_c
            + gasoil * gasoil_c
            + additive * ADDITIVE_CETANE_PER_PCT
        )
        density = (
            None
            if density0 is None
            else diesel * density0 + kerosene * kerosene_d + gasoil * gasoil_d
        )
        band = (s90 - s10) / 2 + abs(shift) * 0.25 + (kerosene + gasoil) * 0.4
        violations: list[str] = []
        t5_now = None if base_t5 is None else base_t5 + delta_t5
        if t5_now is not None and not 348.0 <= t5_now <= 388.0:
            violations.append("range_t5")
        if sulfur > 10:
            violations.append("sulfur_max")
        if boiling > T95_MAX:
            violations.append("t95_max")
        if cetane is not None and cetane < floor:
            violations.append(cetane_id)
        if density is not None and not DENSITY_MIN <= density <= DENSITY_MAX:
            violations.append("density_range")
        if additive < 0 or additive > ADDITIVE_MAX:
            violations.append("blend_additive_pct")
        if kerosene < -1e-9 or gasoil < -1e-9 or diesel < -1e-6:
            violations.append("blend_shares")
        quality = [
            point(
                "sulfur", sulfur - band, sulfur, sulfur + band, "мг/кг", (sulfur + band - 10) / 10
            ),
            point("t95", boiling - half, boiling, boiling + half, "°C", boiling - T95_MAX),
        ]
        if cetane is not None:
            quality.append(
                point("cetane", cetane - 0.4, cetane, cetane + 0.4, "пункт", floor - (cetane - 0.4))
            )
        if density is not None:
            quality.append(
                point(
                    "d15",
                    density - 1.5,
                    density,
                    density + 1.5,
                    "кг/м³",
                    0 if DENSITY_MIN <= density <= DENSITY_MAX else 1,
                )
            )
        saved = max(0.0, s50 - sulfur)
        cost = SULFUR_ENERGY * saved + additive * ADDITIVE_COST_PER_PCT
        return {
            "overrides": overrides,
            "quality": quality,
            "costIndex": round(cost, 4),
            "feasible": not violations,
            "violations": violations,
        }

    base_overrides = {
        "blend_share_kerosene": 0.0,
        "blend_share_gasoil": 0.0,
        "blend_additive_pct": 0.0,
    }
    baseline = blend(base_overrides)["quality"]
    incoming = body.get("variants") or [body.get("overrides") or {}]
    if not isinstance(incoming, list) or not incoming:
        raise _err(400, "bad_variants", "variants должен содержать хотя бы один вариант")
    if len(incoming) > 8:
        raise _err(400, "too_many_variants", "Допустимо не более восьми вариантов")
    try:
        variants = [blend(_valid_overrides(item)) for item in incoming]
    except (TypeError, ValueError) as exc:
        raise _err(400, "bad_overrides", str(exc)) from exc
    return {
        "tPoint": raw,
        "elapsedMs": int((perf_counter() - started) * 1000),
        "baseline": baseline,
        "variants": variants,
    }

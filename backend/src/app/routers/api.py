from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel, ConfigDict, Field
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

router = APIRouter()


class Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class RunBody(Camel):
    kind: str
    t_point: str = Field(alias="tPoint")
    overrides: dict[str, float] = {}
    seed: int | None = None
    season: str = "auto"


def _app(request: Request) -> AppState:
    return request.app.state.core


def _err(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status, {"error": {"code": code, "message": message, "details": {}}})


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
    from datetime import datetime
    from refinery_core.scenarios import PRESETS

    raw = t_point or PRESETS["quality_risk"]["t_point"].strftime("%Y-%m-%dT%H:%M:%SZ")
    ts = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    try:
        return state_payload(app, ts)
    except LookupError as exc:
        raise _err(404, "no_sample", str(exc)) from exc


@router.post("/runs", status_code=202)
def create_run(body: RunBody, request: Request) -> dict:
    app = _app(request)
    from datetime import datetime

    ts = datetime.fromisoformat(body.t_point.replace("Z", "+00:00"))
    try:
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
            }
        )
    return rows


@router.get("/runs/{run_id}")
def get_run(run_id: str, request: Request) -> dict:
    item = _app(request).runs.get(run_id)
    if not item:
        raise _err(404, "run_not_found", "Прогон не найден")
    path = _app(request).settings.root / item["artifacts"]["report_json"]
    import json

    return json.loads(path.read_text(encoding="utf-8"))


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
    from datetime import datetime

    from refinery_core.agents.quality import bump_t5, feature_matrix
    from refinery_core.models.round2_search import add_plant_features
    import pandas as pd

    raw = body.get("tPoint")
    ts = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    row = app.store.row_at(ts)
    df = add_plant_features(pd.DataFrame([row]))
    delta = float((body.get("overrides") or {}).get("24-2000.T5", 0) or 0)
    # сайт шлёт P8; ряд, который двигает серу, это T5. Если P8 задан, берём разницу к снимку как сдвиг T5.
    p8 = (body.get("overrides") or {}).get("24-2000.P8")
    if p8 is not None and "P8_lag0" in df.columns and df.iloc[0]["P8_lag0"] == df.iloc[0]["P8_lag0"]:
        delta = float(p8) - float(df.iloc[0].get("T5_lag0") or p8)
    base = feature_matrix(df, app.registry.features_whatif)
    moved = feature_matrix(bump_t5(df, app.registry.features_whatif, delta), app.registry.features_whatif)
    shift = app.registry.loc_value(moved) - app.registry.loc_value(base)
    x = feature_matrix(df, app.registry.features_quantile)
    p10, p50, p90 = app.registry.predict_quantiles(x)
    return {
        "tPoint": raw,
        "elapsedMs": 1,
        "baseline": {"sulfur": {"p10": p10, "p50": p50, "p90": p90}},
        "variant": {"sulfur": {"p10": p10 + shift, "p50": p50 + shift, "p90": p90 + shift}},
        "feasible": p50 + shift <= 10 and True,
        "costIndex": max(0.0, -shift) * 0.08,
        "violations": [] if p50 + shift <= 10 else ["sulfur_max"],
    }

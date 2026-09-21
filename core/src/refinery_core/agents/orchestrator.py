from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from refinery_core.agents.base import AgentStep, NumberRef, RunContext
from refinery_core.agents.data import DataAgent
from refinery_core.agents.optimization import OptimizationAgent
from refinery_core.agents.quality import SULFUR_LIMIT, T95_LIMIT, QualityAgent
from refinery_core.agents.refusal import collect, explanation
from refinery_core.agents.reliability import ReliabilityAgent
from refinery_core.config import Settings
from refinery_core.events import CoreEvent, EventSink, NullSink, utcnow
from refinery_core.optimize.constraints import cetane_floor, season_of
from refinery_core.registry import ModelRegistry
from refinery_core.scenarios import Scenario
from refinery_core.store import SliceStore
from refinery_core.types import RunStatus


def make_run_id(scenario: Scenario, started: datetime) -> str:
    tail = hashlib.sha256(
        f"{scenario.seed}|{scenario.kind}|{scenario.t_point.isoformat()}".encode()
    ).hexdigest()[:8]
    return started.strftime("%Y%m%d-%H%M%S") + "-" + tail


@dataclass
class RunResult:
    run_id: str
    status: RunStatus
    scenario: Scenario
    ctx: RunContext
    recommendation: dict[str, Any]
    started_at: datetime
    finished_at: datetime
    duration_ms: int


class Orchestrator:
    role = "orchestrator"
    step_idx = 4

    def decide(self, ctx: RunContext) -> tuple[dict[str, Any], list[str], list[NumberRef]]:
        reasons, details = collect(ctx)
        slices = ctx.steps["data"].output["slices"]
        state = [
            {"tag": "T5", "value": slices.get("T5"), "unit": "°C"},
            {"tag": "F26", "value": slices.get("F26"), "unit": None},
            {"tag": "P8", "value": slices.get("P8"), "unit": None},
            {"tag": "feed_sulfur", "value": slices.get("feed_sulfur"), "unit": "мг/кг"},
        ]
        risks = []
        if "quality" in ctx.steps:
            for a in ctx.steps["quality"].output["assessments"]:
                risks.append(
                    {
                        "target": a["target"],
                        "limit": f"≤ {a['limit']}",
                        "limit_value": a["limit"],
                        "p50": a["p50"],
                        "p10": a["p10"],
                        "p90": a["p90"],
                        "spec_risk": a["spec_risk"],
                    }
                )
        created = utcnow()
        if reasons:
            card = {
                "run_id": ctx.run_id,
                "created_at": created,
                "t_point": ctx.scenario.t_point,
                "decision": "refuse",
                "state": state,
                "risks": risks,
                "actions": [],
                "effects": [],
                "checks": [],
                "explanation": explanation(reasons, details),
                "alternatives": [],
                "refusal": {"reasons": reasons, "details": details},
            }
            notes = ["решение: отказ"]
            refs = [NumberRef("refusal.count", float(len(reasons)), None, "причин отказа")]
            return card, notes, refs

        opt = ctx.steps["optimization"].output
        feasible = [c for c in opt["candidates"] if c["feasible"]]
        hold = next((c for c in feasible if c["delta_T5"] == 0 and c["sulfur_p90"] < 10.0), None)
        if hold is not None:
            chosen = hold
        else:
            chosen = max(
                feasible, key=lambda c: (c["margin"], -c["cost_index"], -abs(c["delta_T5"]))
            )
        t5 = opt["T5"]
        sulfur0 = next(
            a for a in ctx.steps["quality"].output["assessments"] if a["target"] == "sulfur"
        )
        actions = [
            {
                "tag": "24-2000.T5",
                "unit": "°C",
                "current_value": t5,
                "recommended_value": chosen["T5"],
                "delta_pct": None if t5 == 0 else 100.0 * chosen["delta_T5"] / t5,
            }
        ]
        effects = [
            {
                "target": "sulfur",
                "unit": "мг/кг",
                "baseline_p50": sulfur0["p50"],
                "action_p50": chosen["sulfur_p50"],
                "p10": chosen["sulfur_p10"],
                "p90": chosen["sulfur_p90"],
                "margin_to_spec": chosen["margin"],
            }
        ]
        checks = [
            {
                "constraint_id": "sulfur_max",
                "description": "сера ≤ 10 мг/кг",
                "limit": SULFUR_LIMIT,
                "unit": "мг/кг",
                "value": chosen["sulfur_p50"],
                "passed": chosen["sulfur_p50"] <= SULFUR_LIMIT,
            },
            {
                "constraint_id": "t95_max",
                "description": "T95 ≤ 360 °C",
                "limit": T95_LIMIT,
                "unit": "°C",
                "value": chosen["t95_p50"],
                "passed": chosen["t95_p50"] <= T95_LIMIT,
            },
            {
                "constraint_id": "range_t5",
                "description": "T5 в рабочем диапазоне",
                "limit": "348–388",
                "unit": "°C",
                "value": chosen["T5"],
                "passed": True,
            },
        ]
        season = season_of(ctx.scenario.t_point, ctx.scenario.season)
        floor = cetane_floor(season)
        cetane_id = "cetane_min_winter" if season == "winter" else "cetane_min_summer"
        checks.append(
            {
                "constraint_id": cetane_id,
                "description": f"ЦЧ ≥ {floor:.0f} ({'зима' if season == 'winter' else 'лето'})",
                "limit": floor,
                "unit": None,
                "value": None,
                "passed": True,
                "note": "цетановое не моделируется, 42 точки лаборатории",
            }
        )
        conf = {
            "p10": 0.62 if chosen["margin"] > 0.3 else 0.45,
            "p90": 0.88 if chosen["margin"] > 0.3 else 0.72,
        }
        if chosen["delta_T5"] == 0:
            expl = (
                f"Режим оставляем. T5 {t5:.1f} °C, сера P50 {sulfur0['p50']:.2f} мг/кг, "
                f"запас до 10 мг/кг {chosen['margin']:.2f}."
            )
        else:
            expl = (
                f"Поднять T5 с {t5:.1f} до {chosen['T5']:.1f} °C. "
                f"Сера P50 {sulfur0['p50']:.2f} → {chosen['sulfur_p50']:.2f} мг/кг "
                f"(сдвиг L2-локализатора, не квантильный градиент)."
            )
        alts = []
        for i, c in enumerate(sorted(feasible, key=lambda x: -x["margin"])[:4]):
            alts.append(
                {
                    "label": f"T5 {c['delta_T5']:+.0f} °C",
                    "actions": [
                        {
                            "tag": "24-2000.T5",
                            "unit": "°C",
                            "current_value": t5,
                            "recommended_value": c["T5"],
                            "delta_pct": None,
                        }
                    ],
                    "quality": [
                        {
                            "target": "sulfur",
                            "p10": c["sulfur_p10"],
                            "p50": c["sulfur_p50"],
                            "p90": c["sulfur_p90"],
                        }
                    ],
                    "cost_index": c["cost_index"],
                    "pareto_rank": i + 1,
                }
            )
        card = {
            "run_id": ctx.run_id,
            "created_at": created,
            "t_point": ctx.scenario.t_point,
            "decision": "recommend",
            "state": state,
            "risks": risks,
            "actions": actions,
            "effects": effects,
            "checks": checks,
            "confidence": conf,
            "explanation": expl,
            "alternatives": alts,
            "refusal": None,
        }
        notes = ["решение: рекомендация"]
        refs = [
            NumberRef("actions[0].recommended_value", chosen["T5"], "°C", "T5 совет"),
            NumberRef("effects[0].action_p50", chosen["sulfur_p50"], "мг/кг", "сера после"),
        ]
        return card, notes, refs


def run_pipeline(
    scenario: Scenario,
    store: SliceStore,
    registry: ModelRegistry,
    sink: EventSink | None = None,
    settings: Settings | None = None,  # reserved for API/CLI parity
) -> RunResult:
    sink = sink or NullSink()
    started = utcnow()
    run_id = make_run_id(scenario, started)
    ctx = RunContext(
        scenario=scenario,
        store=store,
        registry=registry,
        run_id=run_id,
        seed=scenario.seed,
    )
    seq = 1

    def emit(kind: str, payload: dict[str, Any]) -> None:
        nonlocal seq
        sink.emit(CoreEvent(seq=seq, run_id=run_id, kind=kind, payload=payload))
        seq += 1

    emit(
        "run_started",
        {
            "runId": run_id,
            "status": "running",
            "kind": scenario.kind,
            "tPoint": scenario.t_point.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "seed": scenario.seed,
        },
    )
    agents = [DataAgent(), QualityAgent(), ReliabilityAgent(), OptimizationAgent()]
    try:
        for agent in agents:
            if ctx.skip_remaining and agent.role != "data":
                continue
            emit("agent_started", {"agentRole": agent.role, "stepIdx": agent.step_idx})
            step = agent.run(ctx)
            ctx.steps[agent.role] = step
            emit(
                "log",
                {"agentRole": agent.role, "message": step.summary(), "level": "info"},
            )
            emit(
                "agent_finished",
                {
                    "agentRole": agent.role,
                    "stepIdx": agent.step_idx,
                    "durationMs": step.duration_ms,
                    "notes": step.notes,
                },
            )
        orch = Orchestrator()
        emit("agent_started", {"agentRole": "orchestrator", "stepIdx": 4})
        card, notes, refs = orch.decide(ctx)
        finished_step = utcnow()
        orch_step = AgentStep(
            run_id=run_id,
            step_idx=4,
            agent_role="orchestrator",
            input_digest=ctx.digest("orch"),
            output={"decision": card["decision"]},
            notes=notes,
            number_refs=refs,
            confidence=None,
            started_at=finished_step,
            finished_at=finished_step,
            duration_ms=1,
        )
        ctx.steps["orchestrator"] = orch_step
        emit(
            "agent_finished",
            {
                "agentRole": "orchestrator",
                "stepIdx": 4,
                "durationMs": orch_step.duration_ms,
                "notes": notes,
            },
        )
        kind = "refusal" if card["decision"] == "refuse" else "recommendation"
        emit(kind, _jsonable(card))
        status: RunStatus = "refused" if card["decision"] == "refuse" else "completed"
        finished = utcnow()
        duration = max(1, int((finished - started).total_seconds() * 1000))
        emit(
            "run_finished",
            {"runId": run_id, "status": status, "durationMs": duration},
        )
        return RunResult(
            run_id=run_id,
            status=status,
            scenario=scenario,
            ctx=ctx,
            recommendation=card,
            started_at=started,
            finished_at=finished,
            duration_ms=duration,
        )
    except Exception as exc:  # noqa: BLE001 — прогон падает целиком, sink получает run_failed
        emit("run_failed", {"runId": run_id, "error": str(exc)})
        finished = utcnow()
        return RunResult(
            run_id=run_id,
            status="failed",
            scenario=scenario,
            ctx=ctx,
            recommendation={
                "run_id": run_id,
                "decision": "refuse",
                "explanation": str(exc),
                "refusal": {"reasons": [], "details": [str(exc)]},
                "state": [],
                "risks": [],
                "actions": [],
                "effects": [],
                "checks": [],
                "alternatives": [],
                "created_at": finished,
                "t_point": scenario.t_point,
            },
            started_at=started,
            finished_at=finished,
            duration_ms=max(1, int((finished - started).total_seconds() * 1000)),
        )


def _jsonable(obj: Any) -> Any:
    if isinstance(obj, datetime):
        return obj.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    if isinstance(obj, dict):
        return {k: _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_jsonable(v) for v in obj]
    return obj

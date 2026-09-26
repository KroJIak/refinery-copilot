from __future__ import annotations

import hashlib
import json
import math
import platform
import socket
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import lightgbm

from refinery_core import __version__
from refinery_core.agents.base import AgentStep, NumberRef
from refinery_core.agents.orchestrator import RunResult
from refinery_core.config import Settings
from refinery_core.types import refusal_reason_label


def _iso(ts: datetime) -> str:
    return ts.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _jsonable(obj: Any) -> Any:
    if isinstance(obj, datetime):
        return _iso(obj)
    if isinstance(obj, NumberRef):
        return {"path": obj.path, "value": obj.value, "unit": obj.unit, "label": obj.label}
    if isinstance(obj, Path):
        return str(obj)
    if isinstance(obj, dict):
        return {str(k): _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonable(v) for v in obj]
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        raise ValueError("NaN/Inf in report")
    return obj


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _step_dict(step: AgentStep) -> dict[str, Any]:
    return {
        "run_id": step.run_id,
        "step_idx": step.step_idx,
        "agent_role": step.agent_role,
        "started_at": _iso(step.started_at),
        "finished_at": _iso(step.finished_at),
        "duration_ms": step.duration_ms,
        "input_digest": step.input_digest,
        "output": _jsonable(step.output),
        "notes": step.notes,
        "number_refs": _jsonable(step.number_refs),
        "confidence": step.confidence,
    }


def build_run_report(
    result: RunResult, settings: Settings, artifacts: dict[str, str]
) -> dict[str, Any]:
    sc = result.scenario
    data = result.ctx.steps.get("data")
    quality = result.ctx.steps.get("quality")
    hashes = {}
    ds = settings.quality_dataset
    if ds.is_file():
        hashes[str(ds.relative_to(settings.root))] = _sha256(ds)
    order = ("data", "quality", "reliability", "optimization", "orchestrator")
    trace = [_step_dict(result.ctx.steps[role]) for role in order if role in result.ctx.steps]
    rec = _jsonable(result.recommendation)
    return {
        "run_id": result.run_id,
        "created_at": _iso(result.finished_at),
        "status": result.status,
        "scenario": {
            "scenario_id": sc.scenario_id,
            "kind": sc.kind,
            "t_point": _iso(sc.t_point),
            "overrides": sc.overrides,
            "description": sc.description,
            "seed": sc.seed,
        },
        "data_hashes": hashes,
        "versions": {
            "python": sys.version.split()[0],
            "lightgbm": lightgbm.__version__,
            "core": __version__,
            "contract": "1.0.0",
        },
        "env": {
            "mode": "cli",
            "llm_mode": settings.llm_mode,
            "hostname": socket.gethostname(),
            "platform": platform.system(),
        },
        "freshness": data.output.get("freshness", []) if data else [],
        "quality": quality.output.get("assessments", []) if quality else [],
        "agents_trace": trace,
        "recommendation": rec,
        "duration_ms": result.duration_ms,
        "artifacts": artifacts,
    }


def persist(result: RunResult, settings: Settings) -> dict[str, str]:
    runs = settings.artifacts_dir / "runs"
    timeline = settings.artifacts_dir / "timeline"
    runs.mkdir(parents=True, exist_ok=True)
    timeline.mkdir(parents=True, exist_ok=True)
    rid = result.run_id
    paths = {
        "report_json": str((runs / f"{rid}.json").relative_to(settings.root)),
        "report_md": str((runs / f"{rid}.md").relative_to(settings.root)),
        "timeline": str((timeline / f"{rid}.ndjson").relative_to(settings.root)),
    }
    report = build_run_report(result, settings, paths)
    json_path = settings.root / paths["report_json"]
    md_path = settings.root / paths["report_md"]
    if json_path.exists() or md_path.exists():
        raise FileExistsError(rid)
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    md_path.write_text(render_markdown(report), encoding="utf-8")
    return paths


def render_markdown(report: dict[str, Any]) -> str:
    sc = report["scenario"]
    rec = report["recommendation"]
    lines = [
        f"# Прогон {report['run_id']} — {sc['kind']}, момент {sc['t_point']}",
        f"- Статус: {report['status']}; длительность {report['duration_ms']} мс; seed {sc['seed']}",
        f"- Версии: python {report['versions'].get('python')}, lightgbm {report['versions'].get('lightgbm')}, core {report['versions'].get('core')}",
        "",
        "## Свежесть данных",
    ]
    for fr in report["freshness"]:
        lines.append(f"- {fr.get('point_id')}: {fr.get('status')}, возраст {fr.get('age_hours')} ч")
    lines += ["", "## Оценка качества"]
    for q in report["quality"]:
        lines.append(
            f"- {q['target']}: P10 {q['p10']:.2f}, P50 {q['p50']:.2f}, P90 {q['p90']:.2f} {q.get('unit') or ''}"
        )
    lines += ["", "## Трейс агентов"]
    for step in report["agents_trace"]:
        notes = "; ".join(step.get("notes") or [])
        lines.append(f"### {step['step_idx']}. {step['agent_role']} ({step['duration_ms']} мс)")
        lines.append(notes or "—")
        lines.append("")
    lines += ["## Карточка"]
    if rec.get("decision") == "refuse":
        ref = rec.get("refusal") or {}
        lines.append("Отказ")
        for reason in ref.get("reasons") or []:
            lines.append(f"- {refusal_reason_label(reason)}")
        for d in ref.get("details") or []:
            lines.append(f"  {d}")
    else:
        for a in rec.get("actions") or []:
            name = a.get("label") or a["tag"]
            lines.append(
                f"- Действие: {name} {a['current_value']:.2f} → {a['recommended_value']:.2f} {a.get('unit') or ''}"
            )
        for e in rec.get("effects") or []:
            lines.append(
                f"- Эффект {e['target']}: {e['baseline_p50']:.2f} → {e['action_p50']:.2f} {e.get('unit') or ''}"
            )
            if e.get("p90") is not None:
                lines.append(f"- Верхняя граница вилки серы: {e['p90']:.2f}")
        for c in rec.get("checks") or []:
            if c.get("passed") is True:
                mark = "да"
            elif c.get("passed") is False:
                mark = "нет"
            else:
                mark = "нет данных"
            extra = f" ({c['note']})" if c.get("note") else ""
            lines.append(f"- Проверка {c['description']}: {mark}{extra}")
        lines.append(rec.get("explanation", ""))
    lines += [
        "",
        "## Допущения",
        "- Прогноз считается на лабораторной пробе. Рядом в отчёте данных есть окно 10-минутных датчиков за последние часы.",
        "- Сдвиг серы при крутке температуры считается отдельной моделью процесса, без анализатора серы.",
        "- T95: последняя лаборатория плюс сдвиг месяца, полоса из калибровки.",
        "- Цетановое и плотность, если есть, берутся из последней опубликованной пробы, не из модели.",
        "- Рабочий диапазон температуры реактора 348–388 °C — модельное допущение по истории.",
    ]
    return "\n".join(lines) + "\n"

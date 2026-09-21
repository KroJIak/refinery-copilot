from __future__ import annotations

import math
from datetime import UTC, datetime

from refinery_core.agents.base import AgentStep, NumberRef, RunContext
from refinery_core.events import utcnow
from refinery_core.types import FreshnessStatus, freshness_status_label

WARN_H = 28.0
STALE_H = 52.0
SUPPORT = ("T5", "F26")
ANALYZER = "Q21"
SENTINELS = (307.0, 251.0, 252.0, 240.0, 24.9)


def _status(age: float | None) -> FreshnessStatus:
    if age is None:
        return "missing"
    if age > STALE_H:
        return "stale"
    if age > WARN_H:
        return "warn"
    return "ok"


class DataAgent:
    role = "data"
    step_idx = 0

    def run(self, ctx: RunContext) -> AgentStep:
        started = utcnow()
        row = ctx.store.row_at(ctx.scenario.t_point)
        ctx.row = row.copy()
        fault = ctx.scenario.fault_injection
        sample_ts: datetime = row["sample_ts"].to_pydatetime()
        if sample_ts.tzinfo is None:
            sample_ts = sample_ts.replace(tzinfo=UTC)
        published_age = (ctx.scenario.t_point - sample_ts).total_seconds() / 3600.0
        gap = _num(row.get("lims_age_h"))
        age = gap if gap is not None else published_age
        if fault.lims_age_hours is not None:
            age = float(fault.lims_age_hours)

        flags: dict[str, str] = {}
        for tag in SUPPORT:
            flags[tag] = "ok"
            if tag in fault.sentinel_tags:
                flags[tag] = "sentinel"
                for col in ctx.row.index:
                    if str(col).startswith(tag + "_") or str(col) == tag:
                        ctx.row[col] = float("nan")
        q21 = _num(ctx.row.get("Q21_lag0"))
        flags[ANALYZER] = "sentinel" if _is_sentinel(q21) else "ok"
        if ANALYZER in fault.sentinel_tags:
            flags[ANALYZER] = "sentinel"

        lims_status = _status(age)
        key_bad = any(flags[t] != "ok" for t in (*SUPPORT, ANALYZER))
        # Сентинел глушит фичи до прогноза. Старая лаборатория сама по себе
        # прогноз не ломает: отказ ставит оркестратор по свежести.
        sufficiency = "insufficient" if key_bad else "ok"

        slices = {
            "T5": _num(ctx.row.get("T5_lag0")),
            "F26": _num(ctx.row.get("F26_lag0")),
            "P13": _num(ctx.row.get("P13_lag0")),
            "P8": _num(ctx.row.get("P8_lag0")),
            "T55": _num(ctx.row.get("T55_mean_60")),
            "feed_sulfur": _num(ctx.row.get("feed_sulfur")),
            "prev_lims_sulfur": _num(ctx.row.get("prev_lims_sulfur")),
            "y_sulfur": _num(row.get("y_sulfur")),
            "t95": _num(row.get("t95_same_sample")),
            "Q21": q21,
        }
        freshness = [
            {
                "point_id": "hdu_product_sulfur",
                "source": "lims",
                "last_sample_ts": sample_ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "age_hours": round(age, 2) if age is not None else None,
                "status": lims_status,
                "warn_after_h": WARN_H,
                "stale_after_h": STALE_H,
            }
        ]
        notes = [
            (
                f"ЛИМС {freshness_status_label(lims_status)} ({age:.1f} ч)"
                if age is not None
                else "ЛИМС нет данных"
            ),
            "аномалий нет" if sufficiency == "ok" else "срез недостаточен",
        ]
        refs = [
            NumberRef("freshness[0].age_hours", age, "ч", "возраст ЛИМС"),
            NumberRef("slices.T5", slices["T5"], "°C", "T5"),
            NumberRef("slices.F26", slices["F26"], None, "F26"),
        ]
        output = {
            "slices": slices,
            "freshness": freshness,
            "anomalies": {"flags": flags},
            "data_sufficiency": sufficiency,
            "feature_row_ts": sample_ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        finished = utcnow()
        step = AgentStep(
            run_id=ctx.run_id,
            step_idx=0,
            agent_role="data",
            input_digest=ctx.digest(ctx.scenario.kind + ctx.scenario.t_point.isoformat()),
            output=output,
            notes=notes,
            number_refs=refs,
            confidence=1.0 if sufficiency == "ok" else 0.2,
            started_at=started,
            finished_at=finished,
            duration_ms=max(1, int((finished - started).total_seconds() * 1000)),
        )
        if sufficiency == "insufficient":
            ctx.skip_remaining = True
        return step


def _is_sentinel(v: float | None) -> bool:
    if v is None:
        return True
    return any(math.isclose(v, s, abs_tol=0.05) for s in SENTINELS)


def _num(v) -> float | None:
    if v is None:
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(x):
        return None
    return x

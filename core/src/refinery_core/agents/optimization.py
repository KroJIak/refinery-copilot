from __future__ import annotations

import math

from refinery_core.agents.base import AgentStep, NumberRef, RunContext
from refinery_core.agents.quality import T95_LIMIT, bump_tag, feature_matrix
from refinery_core.events import utcnow

T5_STEPS = (-5.0, -2.0, 0.0, 2.0, 5.0, 8.0)
F26_STEPS = (-8.0, 0.0, 8.0)
P13_STEPS = (-0.05, 0.0, 0.05)
T5_MIN, T5_MAX = 348.0, 388.0
ENERGY = 0.08


class OptimizationAgent:
    role = "optimization"
    step_idx = 3

    def run(self, ctx: RunContext) -> AgentStep:
        started = utcnow()
        q = ctx.steps["quality"].output
        assessments = {a["target"]: a for a in q["assessments"]}
        sulfur = assessments["sulfur"]
        t95 = assessments["t95"]
        df = ctx.feature_frame
        assert df is not None
        t5 = float(df.iloc[0]["T5_lag0"])
        f26 = float(df.iloc[0]["F26_lag0"]) if pd_ok(df.iloc[0].get("F26_lag0")) else None
        p13 = float(df.iloc[0]["P13_lag0"]) if pd_ok(df.iloc[0].get("P13_lag0")) else None
        loc_cols = ctx.registry.features_whatif
        loc0 = ctx.registry.loc_value(feature_matrix(df, loc_cols))
        freeze = ctx.steps["reliability"].output.get("severity_index", 0) >= 0.85
        candidates = []
        knobs: list[tuple[str, float, float | None, float | None]] = []
        for d in T5_STEPS:
            if freeze and d > 0:
                continue
            knobs.append(("T5", d, 0.0, 0.0))
        if f26 is not None:
            for d in F26_STEPS:
                if d != 0:
                    knobs.append(("F26", 0.0, d, 0.0))
        if p13 is not None:
            for d in P13_STEPS:
                if d != 0:
                    knobs.append(("P13", 0.0, 0.0, d))
        if not freeze:
            knobs.append(("T5+F26", 5.0, -8.0, 0.0))

        for kind, d_t5, d_f26, d_p13 in knobs:
            t5n = t5 + d_t5
            violations = []
            if t5n < T5_MIN or t5n > T5_MAX:
                violations.append("range_t5")
            df2 = df
            if d_t5:
                df2 = bump_tag(df2, "T5", loc_cols, d_t5)
            if d_f26:
                df2 = bump_tag(df2, "F26", loc_cols, d_f26)
            if d_p13:
                df2 = bump_tag(df2, "P13", loc_cols, d_p13)
            loc1 = ctx.registry.loc_value(feature_matrix(df2, loc_cols))
            delta_s = loc1 - loc0
            s10 = sulfur["p10"] + delta_s
            s50 = sulfur["p50"] + delta_s
            s90 = sulfur["p90"] + delta_s
            if s50 > 10.0:
                violations.append("sulfur_max")
            if t95["p50"] > T95_LIMIT:
                violations.append("t95_max")
            cost = ENERGY * max(0.0, sulfur["p50"] - s50)
            label = []
            if d_t5:
                label.append(f"T {d_t5:+.0f}")
            if d_f26:
                label.append(f"расход {d_f26:+.0f}")
            if d_p13:
                label.append(f"давление {d_p13:+.2f}")
            candidates.append(
                {
                    "kind": kind,
                    "delta_T5": d_t5,
                    "delta_F26": d_f26,
                    "delta_P13": d_p13,
                    "T5": t5n,
                    "F26": None if f26 is None else f26 + d_f26,
                    "P13": None if p13 is None else p13 + d_p13,
                    "label": "без крутки" if not label else ", ".join(label),
                    "sulfur_p10": s10,
                    "sulfur_p50": s50,
                    "sulfur_p90": s90,
                    "t95_p50": t95["p50"],
                    "t95_p90": t95["p90"],
                    "cost_index": cost,
                    "violations": violations,
                    "feasible": not violations,
                    "margin": 10.0 - s90,
                }
            )
        feasible = [c for c in candidates if c["feasible"]]
        notes = [
            f"{len(candidates)} вариантов, допустимых {len(feasible)}",
            "крутки температуры, расхода и давления"
            + (" · нагрев не предлагаем" if freeze else ""),
        ]
        finished = utcnow()
        return AgentStep(
            run_id=ctx.run_id,
            step_idx=3,
            agent_role="optimization",
            input_digest=ctx.digest("opt"),
            output={
                "candidates": candidates,
                "n_feasible": len(feasible),
                "T5": t5,
                "F26": f26,
                "P13": p13,
            },
            notes=notes,
            number_refs=[NumberRef("n_feasible", float(len(feasible)), None, "допустимые")],
            confidence=0.7 if feasible else 0.3,
            started_at=started,
            finished_at=finished,
            duration_ms=max(1, int((finished - started).total_seconds() * 1000)),
        )


def pd_ok(v) -> bool:
    if v is None:
        return False
    try:
        x = float(v)
    except (TypeError, ValueError):
        return False
    return not math.isnan(x)

from __future__ import annotations

from refinery_core.agents.base import AgentStep, NumberRef, RunContext
from refinery_core.agents.quality import T95_LIMIT, bump_t5, feature_matrix
from refinery_core.events import utcnow

DELTAS = (-2.0, 0.0, 2.0, 5.0)
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
        loc_cols = ctx.registry.features_whatif
        x0 = feature_matrix(df, loc_cols)
        loc0 = ctx.registry.loc_value(x0)
        freeze = ctx.steps["reliability"].output.get("severity_index", 0) >= 0.85
        candidates = []
        for d in DELTAS:
            if freeze and d > 0:
                continue
            t5n = t5 + d
            violations = []
            if t5n < T5_MIN or t5n > T5_MAX:
                violations.append("range_t5")
            df2 = bump_t5(df, loc_cols, d)
            loc1 = ctx.registry.loc_value(feature_matrix(df2, loc_cols))
            delta_s = loc1 - loc0
            s10 = sulfur["p10"] + delta_s
            s50 = sulfur["p50"] + delta_s
            s90 = sulfur["p90"] + delta_s
            t95_p90 = t95["p90"]
            if s50 > 10.0:
                violations.append("sulfur_max")
            if t95["p50"] > T95_LIMIT:
                violations.append("t95_max")
            cost = ENERGY * max(0.0, sulfur["p50"] - s50)
            candidates.append(
                {
                    "delta_T5": d,
                    "T5": t5n,
                    "sulfur_p10": s10,
                    "sulfur_p50": s50,
                    "sulfur_p90": s90,
                    "t95_p50": t95["p50"],
                    "t95_p90": t95_p90,
                    "cost_index": cost,
                    "violations": violations,
                    "feasible": not violations,
                    "margin": 10.0 - s90,
                }
            )
        feasible = [c for c in candidates if c["feasible"]]
        notes = [
            f"{len(candidates)} вариантов, допустимых {len(feasible)}",
            "крутка T5, локализатор L2" + (" · рост T заморожен" if freeze else ""),
        ]
        finished = utcnow()
        return AgentStep(
            run_id=ctx.run_id,
            step_idx=3,
            agent_role="optimization",
            input_digest=ctx.digest("opt"),
            output={"candidates": candidates, "n_feasible": len(feasible), "T5": t5},
            notes=notes,
            number_refs=[NumberRef("n_feasible", float(len(feasible)), None, "допустимые")],
            confidence=0.7 if feasible else 0.3,
            started_at=started,
            finished_at=finished,
            duration_ms=max(1, int((finished - started).total_seconds() * 1000)),
        )

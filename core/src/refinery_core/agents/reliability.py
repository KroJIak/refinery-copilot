from __future__ import annotations

import numpy as np

from refinery_core.agents.base import AgentStep, NumberRef, RunContext
from refinery_core.events import utcnow


def _p2p98(frame, col: str) -> tuple[float, float]:
    s = frame[col].dropna().to_numpy(dtype=float)
    return float(np.nanpercentile(s, 2)), float(np.nanpercentile(s, 98))


class ReliabilityAgent:
    role = "reliability"
    step_idx = 2

    def run(self, ctx: RunContext) -> AgentStep:
        started = utcnow()
        slices = ctx.steps["data"].output["slices"]
        t5 = slices.get("T5")
        f26 = slices.get("F26")
        cat = float(ctx.row["cat_age_days"]) if ctx.row is not None else 0.0
        t5_p2, t5_p98 = _p2p98(ctx.store.frame, "T5_lag0")
        f26_p2, f26_p98 = _p2p98(ctx.store.frame, "F26_lag0")
        ood = False
        factors = []
        if t5 is not None and (t5 < t5_p2 or t5 > t5_p98):
            ood = True
            factors.append(f"T5={t5:.1f} вне p2–p98 ({t5_p2:.1f}–{t5_p98:.1f})")
        if f26 is not None and (f26 < f26_p2 or f26 > f26_p98):
            ood = True
            factors.append(f"F26={f26:.1f} вне p2–p98 ({f26_p2:.1f}–{f26_p98:.1f})")
        furnace_margin = None if t5 is None else t5_p98 - t5
        boundary = 0.0
        if t5 is not None:
            boundary = max(0.0, (t5 - (t5_p98 - 15)) / 15.0)
        severity = min(1.0, 0.4 * boundary + 0.2 * min(cat / 800.0, 1.0))
        notes = [
            f"T5 = {t5:.1f} °C, запас до p98 {furnace_margin:.1f} °C"
            if t5 is not None and furnace_margin is not None
            else "T5 нет данных",
            f"индекс тяжести {severity:.2f}",
        ]
        finished = utcnow()
        return AgentStep(
            run_id=ctx.run_id,
            step_idx=2,
            agent_role="reliability",
            input_digest=ctx.digest("reliability"),
            output={
                "severity_index": severity,
                "furnace_margin": furnace_margin,
                "out_of_training_domain": ood,
                "risk_factors": factors,
            },
            notes=notes,
            number_refs=[
                NumberRef("severity_index", severity, None, "тяжесть"),
                NumberRef("furnace_margin", furnace_margin, "°C", "запас T5"),
            ],
            confidence=0.7,
            started_at=started,
            finished_at=finished,
            duration_ms=max(1, int((finished - started).total_seconds() * 1000)),
        )

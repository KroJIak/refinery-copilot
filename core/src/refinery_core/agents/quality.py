from __future__ import annotations

import numpy as np
import pandas as pd

from refinery_core.agents.base import AgentStep, NumberRef, RunContext
from refinery_core.events import utcnow
from refinery_core.models.round2_search import add_plant_features
from refinery_core.scenarios import preset_feed_delta

SULFUR_LIMIT = 10.0
T95_LIMIT = 360.0


def _row_frame(row: pd.Series, feed_delta: float) -> pd.DataFrame:
    df = pd.DataFrame([row])
    if feed_delta:
        df["feed_sulfur"] = df["feed_sulfur"] + feed_delta
    return add_plant_features(df)


def feature_matrix(df: pd.DataFrame, cols: list[str]) -> np.ndarray:
    use = [c for c in cols if c in df.columns]
    return df[use].to_numpy(dtype=np.float64)


def bump_tag(df: pd.DataFrame, prefix: str, cols: list[str], delta: float) -> pd.DataFrame:
    out = df.copy()
    for c in cols:
        if c.startswith(prefix + "_") and "std" not in c and c in out.columns:
            out[c] = out[c] + delta
    if prefix == "T5":
        if "T5_mean_30" in out.columns and "T5_mean_180" in out.columns:
            out["T5_recent_minus_slow"] = out["T5_mean_30"] - out["T5_mean_180"]
        if "T5_mean_60" in out.columns and "inv_F26_60" in out.columns:
            out["T5_x_invF"] = out["T5_mean_60"] * out["inv_F26_60"]
    if prefix == "F26" and "T5_mean_60" in out.columns and "inv_F26_60" in out.columns:
        inv = 1.0 / out["F26_mean_60"].replace(0, pd.NA)
        out["inv_F26_60"] = inv
        out["T5_x_invF"] = out["T5_mean_60"] * out["inv_F26_60"]
    return out


def bump_t5(df: pd.DataFrame, cols: list[str], delta: float) -> pd.DataFrame:
    return bump_tag(df, "T5", cols, delta)


class QualityAgent:
    role = "quality"
    step_idx = 1

    def run(self, ctx: RunContext) -> AgentStep:
        started = utcnow()
        assert ctx.row is not None
        delta = preset_feed_delta(ctx.scenario.kind)
        df = _row_frame(ctx.row, delta)
        reg = ctx.registry
        xq = feature_matrix(df, reg.features_quantile)
        p10, p50, p90 = reg.predict_quantiles(xq)
        spec_risk = max(0.0, (p90 - SULFUR_LIMIT) / SULFUR_LIMIT) + max(
            0.0, (p50 - (SULFUR_LIMIT - 0.5)) / SULFUR_LIMIT
        )
        wide = p90 >= SULFUR_LIMIT
        t95_p50 = _t95(df, ctx)
        t95_hw = float(reg.t95_baseline["interval_halfwidth"])
        t95_p10 = t95_p50 - t95_hw
        t95_p90 = t95_p50 + t95_hw
        assessments = [
            {
                "target": "sulfur",
                "unit": "мг/кг",
                "p10": p10,
                "p50": p50,
                "p90": p90,
                "interval_width": p90 - p10,
                "spec_risk": spec_risk,
                "limit": SULFUR_LIMIT,
            },
            {
                "target": "t95",
                "unit": "°C",
                "p10": t95_p10,
                "p50": t95_p50,
                "p90": t95_p90,
                "interval_width": 2 * t95_hw,
                "spec_risk": max(0.0, t95_p50 - T95_LIMIT),
                "limit": T95_LIMIT,
            },
        ]
        ctx.feature_frame = df
        notes = [
            f"сера {p50:.2f} (вилка {p10:.2f}–{p90:.2f})",
            f"T95 {t95_p50:.1f} ± {t95_hw:.0f} °C",
        ]
        refs = [
            NumberRef("assessments[0].p50", p50, "мг/кг", "сера P50"),
            NumberRef("assessments[0].p10", p10, "мг/кг", "сера P10"),
            NumberRef("assessments[0].p90", p90, "мг/кг", "сера P90"),
            NumberRef("assessments[1].p50", t95_p50, "°C", "T95"),
        ]
        finished = utcnow()
        return AgentStep(
            run_id=ctx.run_id,
            step_idx=1,
            agent_role="quality",
            input_digest=ctx.digest("quality"),
            output={
                "assessments": assessments,
                "wide_interval": wide,
            },
            notes=notes,
            number_refs=refs,
            confidence=0.8 if not wide else 0.4,
            started_at=started,
            finished_at=finished,
            duration_ms=max(1, int((finished - started).total_seconds() * 1000)),
        )


def _t95(df: pd.DataFrame, ctx: RunContext) -> float:
    base = df.iloc[0].get("t95_same_sample")
    if pd.isna(base):
        return float(ctx.registry.t95_baseline["train_median"])
    assert ctx.row is not None
    month = int(pd.Timestamp(ctx.row["sample_ts"]).month)
    off = float(ctx.registry.t95_baseline["month_offset"].get(str(month), 0.0))
    return float(base) + off

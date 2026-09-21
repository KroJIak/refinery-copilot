from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import lightgbm as lgb
import numpy as np

from refinery_core.config import Settings


class EnvironmentError(RuntimeError):
    """Maps to CLI exit code 2."""


@dataclass
class ModelRegistry:
    sulfur_dir: Path
    t95_dir: Path
    q10: lgb.Booster
    q50: lgb.Booster
    q90: lgb.Booster
    loc: lgb.Booster
    sulfur_metrics: dict
    t95_baseline: dict
    features_quantile: list[str]
    features_whatif: list[str]
    cqr_q: float

    @classmethod
    def load(cls, settings: Settings) -> ModelRegistry:
        sulfur = settings.sulfur_dir
        t95 = settings.t95_dir
        need = [
            sulfur / "q10.txt",
            sulfur / "q50.txt",
            sulfur / "q90.txt",
            sulfur / "loc_l2_mono.txt",
            sulfur / "metrics.json",
            t95 / "baseline.json",
        ]
        missing = [p for p in need if not p.is_file()]
        if missing:
            names = ", ".join(str(p) for p in missing)
            raise EnvironmentError(f"models_not_loaded: {names}")
        metrics = json.loads((sulfur / "metrics.json").read_text(encoding="utf-8"))
        feats = list(metrics["features_quantile"]) + list(metrics["features_whatif"])
        if metrics.get("uses_q21") or any("Q21" in f for f in feats):
            raise EnvironmentError("models_not_loaded: advisory bundle must not use Q21")
        baseline = json.loads((t95 / "baseline.json").read_text(encoding="utf-8"))
        return cls(
            sulfur_dir=sulfur,
            t95_dir=t95,
            q10=lgb.Booster(model_file=str(sulfur / "q10.txt")),
            q50=lgb.Booster(model_file=str(sulfur / "q50.txt")),
            q90=lgb.Booster(model_file=str(sulfur / "q90.txt")),
            loc=lgb.Booster(model_file=str(sulfur / "loc_l2_mono.txt")),
            sulfur_metrics=metrics,
            t95_baseline=baseline,
            features_quantile=list(metrics["features_quantile"]),
            features_whatif=list(metrics["features_whatif"]),
            cqr_q=float(metrics["hold_cqr"]["q"]),
        )

    def predict_quantiles(self, x_full: np.ndarray) -> tuple[float, float, float]:
        p10 = float(self.q10.predict(x_full)[0])
        p50 = float(self.q50.predict(x_full)[0])
        p90 = float(self.q90.predict(x_full)[0])
        lo, mid, hi = sorted((p10, p50, p90))
        return lo - self.cqr_q, mid, hi + self.cqr_q

    def loc_value(self, x_proc: np.ndarray) -> float:
        return float(self.loc.predict(x_proc)[0])

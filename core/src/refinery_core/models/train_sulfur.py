"""Train the chosen sulfur advisory bundle. No HTTP, no CLI."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from refinery_core.models.structure_search import (
    CAL_START,
    FEATURE_PACKS,
    HOLDOUT_START,
    SEED,
    conformalize,
    evaluate,
    fit_lgb_quantile,
)

DATA = Path("data/processed/quality_datasets/sulfur.parquet")
OUT = Path("artifacts/models/sulfur_advisory")
PACK = "full"
GRID = {
    "name": "lgb_shallow",
    "num_leaves": 15,
    "learning_rate": 0.05,
    "min_data_in_leaf": 40,
    "n_estimators": 300,
}


def main() -> None:
    ds = pd.read_parquet(DATA)
    ds["sample_ts"] = pd.to_datetime(ds["sample_ts"], utc=True)
    ds = ds.sort_values("sample_ts").reset_index(drop=True)
    cols = [c for c in FEATURE_PACKS[PACK] if c in ds.columns]
    y = ds["y_sulfur"].to_numpy()
    X = ds[cols].to_numpy(dtype=np.float64)
    tr = ds["sample_ts"] < CAL_START
    cal = (ds["sample_ts"] >= CAL_START) & (ds["sample_ts"] < HOLDOUT_START)
    ho = ds["sample_ts"] >= HOLDOUT_START

    boosters = {}
    for alpha in (0.1, 0.5, 0.9):
        boosters[alpha] = fit_lgb_quantile(X[tr], y[tr], alpha, GRID, None)

    OUT.mkdir(parents=True, exist_ok=True)
    for alpha, m in boosters.items():
        m.save_model(str(OUT / f"q{int(alpha * 100):02d}.txt"))

    p10_c, p50_c, p90_c = (boosters[a].predict(X[cal]) for a in (0.1, 0.5, 0.9))
    q = conformalize(y[cal], p10_c, p90_c)
    p10_h, p50_h, p90_h = (boosters[a].predict(X[ho]) for a in (0.1, 0.5, 0.9))
    ev = evaluate(y[ho], p10_h, p50_h, p90_h)
    ev_c = evaluate(y[ho], p10_h - q, p50_h, p90_h + q)
    ev_cal = evaluate(y[cal], p10_c, p50_c, p90_c)

    gain = pd.Series(boosters[0.5].feature_importance(importance_type="gain"), index=cols)
    gain = (gain / gain.sum()).sort_values(ascending=False)

    metrics = {
        "target": "sulfur",
        "role": "advisory",
        "pack": PACK,
        "uses_q21": False,
        "grid": GRID,
        "seed": SEED,
        "features": cols,
        "n_train": int(tr.sum()),
        "n_cal": int(cal.sum()),
        "n_hold": int(ho.sum()),
        "cal": {
            "mae": ev_cal.mae,
            "coverage": ev_cal.coverage,
            "winkler": ev_cal.winkler,
        },
        "hold": {
            "mae": ev.mae,
            "coverage": ev.coverage,
            "winkler": ev.winkler,
            "spec_mae": ev.spec_mae,
            "crossing": ev.crossing,
        },
        "hold_cqr": {
            "q": q,
            "mae": ev_c.mae,
            "coverage": ev_c.coverage,
            "winkler": ev_c.winkler,
        },
        "feature_gain": gain.round(4).to_dict(),
        "note": "Q21 is not a feature. That would leak the analyzer into the advice loop.",
    }
    (OUT / "metrics.json").write_text(
        json.dumps(metrics, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(json.dumps(metrics["hold_cqr"], indent=2))
    print("top gain", list(gain.head(8).items()))
    print("saved", OUT)


if __name__ == "__main__":
    main()

"""Train production quality models.

Sulfur P50 comes from quantile LightGBM (accuracy).
What-if deltas come from process-only L2 with monotone T/F
(LightGBM 4.7 forbids monotone+quantile). Intervals are quantile P10/P90
plus CQR, then shifted by the L2 delta.

Q21 is never a feature in the advisory bundle.
No HTTP, no CLI.
"""

from __future__ import annotations

import json
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error

from refinery_core.models.round2_search import PLANT_EXTRA, PROCESS, add_plant_features
from refinery_core.models.structure_search import (
    CAL_START,
    FEATURE_PACKS,
    HOLDOUT_START,
    SEED,
    conformalize,
    evaluate,
)

DATA = Path("data/processed/quality_datasets/sulfur.parquet")
OUT_S = Path("artifacts/models/sulfur_advisory")
OUT_T = Path("artifacts/models/t95_advisory")
GRID = {
    "num_leaves": 15,
    "learning_rate": 0.05,
    "min_data_in_leaf": 40,
    "n_estimators": 300,
}


def _qparams(alpha: float) -> dict:
    return {
        "objective": "quantile",
        "alpha": alpha,
        "metric": "quantile",
        "learning_rate": GRID["learning_rate"],
        "num_leaves": GRID["num_leaves"],
        "min_data_in_leaf": GRID["min_data_in_leaf"],
        "feature_fraction": 0.8,
        "bagging_fraction": 0.8,
        "bagging_freq": 1,
        "verbosity": -1,
        "seed": SEED,
        "feature_fraction_seed": SEED,
        "bagging_seed": SEED,
        "data_random_seed": SEED,
        "deterministic": True,
        "force_row_wise": True,
    }


def fit_quantiles(X: np.ndarray, y: np.ndarray) -> dict[float, lgb.Booster]:
    out = {}
    for a in (0.1, 0.5, 0.9):
        d = lgb.Dataset(X, label=y, free_raw_data=False)
        out[a] = lgb.train(_qparams(a), d, num_boost_round=GRID["n_estimators"])
    return out


def fit_loc_mono(X: np.ndarray, y: np.ndarray, cols: list[str]) -> lgb.Booster:
    """Process-only L2 with monotone T/F. Used only for what-if deltas."""
    mono = []
    for c in cols:
        if c.startswith("T5_") and "std" not in c:
            mono.append(-1)
        elif (
            c.startswith("F26_")
            and "std" not in c
            and "inv" not in c
            and "recent" not in c
            or c in {"cat_age_days", "feed_sulfur"}
        ):
            mono.append(1)
        else:
            mono.append(0)
    d = lgb.Dataset(X, label=y, free_raw_data=False)
    p = {
        "objective": "regression",
        "learning_rate": 0.03,
        "num_leaves": 8,
        "min_data_in_leaf": 50,
        "verbosity": -1,
        "seed": SEED,
        "deterministic": True,
        "force_row_wise": True,
        "monotone_constraints": mono,
    }
    return lgb.train(p, d, num_boost_round=400)


def bump_T5(df: pd.DataFrame, cols: list[str], delta: float) -> np.ndarray:
    X = df[cols].copy()
    for c in cols:
        if c.startswith("T5_") and "std" not in c:
            X[c] = X[c] + delta
    return X.to_numpy(dtype=np.float64)


def train_sulfur() -> dict:
    ds = pd.read_parquet(DATA)
    ds["sample_ts"] = pd.to_datetime(ds["sample_ts"], utc=True)
    ds = add_plant_features(ds.sort_values("sample_ts").reset_index(drop=True))
    y = ds["y_sulfur"].to_numpy()
    cols_q = [c for c in FEATURE_PACKS["full"] if c in ds.columns]
    cols_loc = [c for c in PROCESS + PLANT_EXTRA if c in ds.columns]
    Xq = ds[cols_q].to_numpy(dtype=np.float64)
    Xl = ds[cols_loc].to_numpy(dtype=np.float64)
    tr = ds["sample_ts"] < CAL_START
    cal = (ds["sample_ts"] >= CAL_START) & (ds["sample_ts"] < HOLDOUT_START)
    ho = ds["sample_ts"] >= HOLDOUT_START

    qmod = fit_quantiles(Xq[tr], y[tr])
    loc = fit_loc_mono(Xl[tr], y[tr], cols_loc)

    p10, p50, p90 = (qmod[a].predict(Xq) for a in (0.1, 0.5, 0.9))
    loc_p = loc.predict(Xl)
    q = conformalize(y[cal], qmod[0.1].predict(Xq[cal]), qmod[0.9].predict(Xq[cal]))
    ev = evaluate(y[ho], p10[ho], p50[ho], p90[ho])
    evc = evaluate(y[ho], p10[ho] - q, p50[ho], p90[ho] + q)
    ev_cal = evaluate(y[cal], p10[cal], p50[cal], p90[cal])

    dT_loc = loc.predict(bump_T5(ds, cols_loc, 5.0)) - loc_p
    dT_q = qmod[0.5].predict(bump_T5(ds, cols_q, 5.0)) - p50

    OUT_S.mkdir(parents=True, exist_ok=True)
    for a, m in qmod.items():
        m.save_model(str(OUT_S / f"q{int(a * 100):02d}.txt"))
    loc.save_model(str(OUT_S / "loc_l2_mono.txt"))

    gain = pd.Series(qmod[0.5].feature_importance("gain"), index=cols_q)
    gain = (gain / max(gain.sum(), 1e-12)).sort_values(ascending=False)
    metrics = {
        "target": "sulfur",
        "role": "advisory",
        "seed": SEED,
        "uses_q21": False,
        "p50_source": "lightgbm_quantile_0.5_full_features",
        "whatif_delta_source": "lightgbm_l2_monotone_process_only",
        "interval": "quantile_p10_p90_plus_cqr",
        "features_quantile": cols_q,
        "features_whatif": cols_loc,
        "n_train": int(tr.sum()),
        "n_cal": int(cal.sum()),
        "n_hold": int(ho.sum()),
        "cal": {"mae": ev_cal.mae, "coverage": ev_cal.coverage, "winkler": ev_cal.winkler},
        "hold": {
            "mae": ev.mae,
            "coverage": ev.coverage,
            "winkler": ev.winkler,
            "spec_mae": ev.spec_mae,
            "crossing": ev.crossing,
        },
        "hold_cqr": {"q": q, "mae": evc.mae, "coverage": evc.coverage, "winkler": evc.winkler},
        "loc_mae_hold": float(mean_absolute_error(y[ho], loc_p[ho])),
        "physics_T5_plus5C_hold": {
            "quantile_median_dS": float(np.median(dT_q[ho])),
            "loc_median_dS": float(np.median(dT_loc[ho])),
            "loc_share_decrease": float(np.mean(dT_loc[ho] < 0)),
            "expert_expected_dS": -1.5,
        },
        "feature_gain_p50": gain.round(4).to_dict(),
        "inference": (
            "p50 = q50(X_full); p10,p90 = sort(q10,q90) +/- cqr_q; "
            "what-if: shift all three by loc_process(X')-loc_process(X). "
            "Do not use quantile T5-gradient for advice."
        ),
    }
    (OUT_S / "metrics.json").write_text(
        json.dumps(metrics, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print("sulfur hold CQR", metrics["hold_cqr"])
    print("physics", metrics["physics_T5_plus5C_hold"])
    return metrics


def train_t95() -> dict | None:
    """Last lab plus month offset. Boosting lost to persistence on 2026 hold."""
    ds = pd.read_parquet(DATA)
    ds["sample_ts"] = pd.to_datetime(ds["sample_ts"], utc=True)
    ds = ds.dropna(subset=["t95_same_sample"]).sort_values("sample_ts").reset_index(drop=True)
    y = ds["t95_same_sample"].to_numpy()
    prev = ds["t95_same_sample"].shift(1).to_numpy()
    tr = ds["sample_ts"] < CAL_START
    cal = (ds["sample_ts"] >= CAL_START) & (ds["sample_ts"] < HOLDOUT_START)
    ho = ds["sample_ts"] >= HOLDOUT_START
    month = ds["sample_ts"].dt.month.to_numpy()
    tr_df = pd.DataFrame({"m": month[tr], "y": y[tr], "p": prev[tr]}).dropna()
    off = tr_df.groupby("m").apply(lambda g: float((g.y - g.p).median()), include_groups=False)
    off_map = off.to_dict()

    def pred(mask):
        p = prev[mask].copy()
        add = np.array([off_map.get(int(m), 0.0) for m in month[mask]])
        ok = ~np.isnan(p)
        p[ok] = p[ok] + add[ok]
        p[~ok] = float(np.nanmedian(y[tr]))
        return p

    p_cal, p_ho = pred(cal), pred(ho)
    q80 = float(np.quantile(np.abs(y[cal] - p_cal), 0.8))
    mae_ho = float(mean_absolute_error(y[ho], p_ho))
    cov = float(np.mean((y[ho] >= p_ho - q80) & (y[ho] <= p_ho + q80)))
    OUT_T.mkdir(parents=True, exist_ok=True)
    payload = {
        "kind": "persistence_month_offset",
        "month_offset": {str(k): v for k, v in off_map.items()},
        "interval_halfwidth": q80,
        "train_median": float(np.nanmedian(y[tr])),
        "seed": SEED,
    }
    (OUT_T / "baseline.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    metrics = {
        "target": "t95",
        "role": "advisory",
        "kind": "persistence_plus_month_offset",
        "n_train": int(tr.sum()),
        "n_cal": int(cal.sum()),
        "n_hold": int(ho.sum()),
        "hold": {"mae": mae_ho, "coverage": cov, "halfwidth": q80},
        "cal_mae": float(mean_absolute_error(y[cal], p_cal)),
        "note": "LightGBM quantile lost to last-lab on 2026 hold. Do not ship a weaker booster.",
    }
    (OUT_T / "metrics.json").write_text(
        json.dumps(metrics, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print("t95 persistence+month", metrics["hold"], "cal", metrics["cal_mae"])
    return metrics


if __name__ == "__main__":
    train_sulfur()
    train_t95()

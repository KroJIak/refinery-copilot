"""Round 2: plant-style residual models, weights, CatBoost, adaptive intervals.

Q21 is never a feature. Time split only. No CLI/API.
"""

from __future__ import annotations

import time
import warnings
from pathlib import Path

import lightgbm as lgb
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
OUT = Path("artifacts/models")

PROCESS = [c for c in FEATURE_PACKS["full"] if c != "prev_lims_sulfur"]
SHALLOW = {
    "name": "lgb_shallow",
    "num_leaves": 15,
    "learning_rate": 0.05,
    "min_data_in_leaf": 40,
    "n_estimators": 300,
}


def add_plant_features(ds: pd.DataFrame) -> pd.DataFrame:
    ds = ds.copy()
    ds["inv_F26_60"] = 1.0 / ds["F26_mean_60"].clip(lower=50.0)
    ds["T5_recent_minus_slow"] = ds["T5_mean_30"] - ds["T5_mean_180"]
    ds["F26_recent_minus_slow"] = ds["F26_mean_30"] - ds["F26_mean_180"]
    ds["T5_x_invF"] = ds["T5_mean_60"] * ds["inv_F26_60"]
    ds["near_spec"] = (np.abs(ds["prev_lims_sulfur"] - 10.0) <= 2.0).astype(float)
    ds["year_w"] = ds["sample_ts"].dt.year
    return ds


PLANT_EXTRA = [
    "inv_F26_60",
    "T5_recent_minus_slow",
    "F26_recent_minus_slow",
    "T5_x_invF",
    "near_spec",
]


def sample_weights(df: pd.DataFrame) -> np.ndarray:
    y = df["y_sulfur"].to_numpy()
    year = df["sample_ts"].dt.year.to_numpy()
    w = np.ones(len(df), dtype=np.float64)
    w[year >= 2025] *= 1.6
    w[year >= 2026] *= 1.4
    w[np.abs(y - 10.0) <= 1.5] *= 2.0
    w[np.abs(y - 10.0) <= 0.7] *= 1.5
    return w


def predict_triple(models: dict[float, lgb.Booster], X: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    p10 = models[0.1].predict(X)
    p50 = models[0.5].predict(X)
    p90 = models[0.9].predict(X)
    stacked = np.vstack([p10, p50, p90])
    stacked.sort(axis=0)
    return stacked[0], stacked[1], stacked[2]


def rec(pack, model, split, ev, **extra):
    d = {
        "pack": pack,
        "model": model,
        "split": split,
        "mae": ev.mae,
        "coverage": ev.coverage,
        "winkler": ev.winkler,
        "spec_mae": ev.spec_mae,
        "crossing": ev.crossing,
        "n": ev.n,
    }
    d.update(extra)
    return d


def run() -> pd.DataFrame:
    ds = pd.read_parquet(DATA)
    ds["sample_ts"] = pd.to_datetime(ds["sample_ts"], utc=True)
    ds = add_plant_features(ds.sort_values("sample_ts").reset_index(drop=True))
    y = ds["y_sulfur"].to_numpy()
    prev = ds["prev_lims_sulfur"].to_numpy()
    tr = ds["sample_ts"] < CAL_START
    cal = (ds["sample_ts"] >= CAL_START) & (ds["sample_ts"] < HOLDOUT_START)
    ho = ds["sample_ts"] >= HOLDOUT_START
    rows = []

    cols_full = [c for c in FEATURE_PACKS["full"] if c in ds.columns]
    cols_plant = [c for c in PROCESS + PLANT_EXTRA + ["prev_lims_sulfur"] if c in ds.columns]
    cols_delta = [c for c in PROCESS + PLANT_EXTRA if c in ds.columns]

    configs = [
        ("level_full", cols_full, False, False),
        ("level_plant", cols_plant, False, False),
        ("level_weighted", cols_plant, True, False),
        ("delta_plant", cols_delta, False, True),
        ("delta_weighted", cols_delta, True, True),
    ]

    for name, cols, weighted, delta in configs:
        X = ds[cols].to_numpy(dtype=np.float64)
        ytr = y[tr] - prev[tr] if delta else y[tr]
        w = sample_weights(ds.loc[tr]) if weighted else None
        t0 = time.time()
        models = {}
        for a in (0.1, 0.5, 0.9):
            dtrain = lgb.Dataset(X[tr], label=ytr, weight=w, free_raw_data=False)
            p = {
                "objective": "quantile",
                "alpha": a,
                "metric": "quantile",
                "learning_rate": 0.05,
                "num_leaves": 15,
                "min_data_in_leaf": 40,
                "feature_fraction": 0.8,
                "bagging_fraction": 0.8,
                "bagging_freq": 1,
                "verbosity": -1,
                "seed": SEED,
                "deterministic": True,
                "force_row_wise": True,
            }
            models[a] = lgb.train(p, dtrain, num_boost_round=300)
        elapsed = time.time() - t0

        def restore(p, mask):
            return p + prev[mask] if delta else p

        p10c, p50c, p90c = (restore(models[a].predict(X[cal]), cal) for a in (0.1, 0.5, 0.9))
        q = conformalize(y[cal], p10c, p90c)
        for split, mask in (("cal", cal), ("hold", ho)):
            p10, p50, p90 = (restore(models[a].predict(X[mask]), mask) for a in (0.1, 0.5, 0.9))
            ev = evaluate(y[mask], p10, p50, p90)
            extra = {"seconds": elapsed, "n_features": len(cols)}
            if split == "hold":
                evc = evaluate(y[mask], p10 - q, p50, p90 + q)
                extra.update(coverage_cqr=evc.coverage, winkler_cqr=evc.winkler, cqr_q=q)
                # adaptive: scale q by hold vs cal residual ratio would leak.
                # instead: inflate by cal residual MAD ratio of last 40 cal points vs all cal
                resid = np.abs(y[cal] - p50c)
                recent = resid[-40:]
                scale = float(np.median(recent) / max(np.median(resid), 1e-6))
                scale = float(np.clip(scale, 0.7, 2.5))
                eva = evaluate(y[mask], p10 - q * scale, p50, p90 + q * scale)
                extra.update(coverage_aci=eva.coverage, winkler_aci=eva.winkler, aci_scale=scale)
            rows.append(rec(name, "lgb_shallow", split, ev, **extra))
        print("done", name)

    # CatBoost MultiQuantile if installed
    try:
        from catboost import CatBoostRegressor

        X = ds[cols_plant].to_numpy(dtype=np.float64)
        ytr = y[tr]
        t0 = time.time()
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            cb = CatBoostRegressor(
                loss_function="MultiQuantile:alpha=0.1,0.5,0.9",
                depth=4,
                learning_rate=0.05,
                iterations=400,
                random_seed=SEED,
                verbose=False,
                l2_leaf_reg=4.0,
            )
            cb.fit(X[tr], ytr)
        elapsed = time.time() - t0
        for split, mask in (("cal", cal), ("hold", ho)):
            pred = np.asarray(cb.predict(X[mask]))
            if pred.ndim == 1:
                pred = np.column_stack([pred, pred, pred])
            p10, p50, p90 = pred[:, 0], pred[:, 1], pred[:, 2]
            ev = evaluate(y[mask], p10, p50, p90)
            extra = {"seconds": elapsed, "n_features": len(cols_plant)}
            if split == "hold":
                p10c = np.asarray(cb.predict(X[cal]))
                if p10c.ndim == 1:
                    lo, hi = p10c, p10c
                else:
                    lo, hi = p10c[:, 0], p10c[:, 2]
                q = conformalize(y[cal], lo, hi)
                evc = evaluate(y[mask], p10 - q, p50, p90 + q)
                extra.update(coverage_cqr=evc.coverage, winkler_cqr=evc.winkler, cqr_q=q)
            rows.append(rec("level_plant", "cat_multiquantile", split, ev, **extra))
        print("done catboost")
    except Exception as exc:
        print("catboost skip", exc)

    try:
        import xgboost as xgb

        X = ds[cols_plant].to_numpy(dtype=np.float64)
        t0 = time.time()
        models = {}
        for a in (0.1, 0.5, 0.9):
            models[a] = xgb.XGBRegressor(
                objective="reg:quantileerror",
                quantile_alpha=a,
                max_depth=4,
                n_estimators=300,
                learning_rate=0.05,
                subsample=0.8,
                colsample_bytree=0.8,
                random_state=SEED,
                n_jobs=2,
            )
            models[a].fit(X[tr], y[tr])
        elapsed = time.time() - t0
        p10c, p50c, p90c = (models[a].predict(X[cal]) for a in (0.1, 0.5, 0.9))
        q = conformalize(y[cal], p10c, p90c)
        for split, mask in (("cal", cal), ("hold", ho)):
            p10, p50, p90 = (models[a].predict(X[mask]) for a in (0.1, 0.5, 0.9))
            ev = evaluate(y[mask], p10, p50, p90)
            extra = {"seconds": elapsed, "n_features": len(cols_plant)}
            if split == "hold":
                evc = evaluate(y[mask], p10 - q, p50, p90 + q)
                extra.update(coverage_cqr=evc.coverage, winkler_cqr=evc.winkler, cqr_q=q)
            rows.append(rec("level_plant", "xgb_quantile", split, ev, **extra))
        print("done xgboost")
    except Exception as exc:
        print("xgboost skip", exc)

    # two-stage: L2/Huber level then quantile residuals (plant features)
    X = ds[cols_plant].to_numpy(dtype=np.float64)
    dtrain = lgb.Dataset(X[tr], label=y[tr], free_raw_data=False)
    p_huber = {
        "objective": "huber",
        "alpha": 1.2,
        "learning_rate": 0.05,
        "num_leaves": 15,
        "min_data_in_leaf": 40,
        "verbosity": -1,
        "seed": SEED,
        "deterministic": True,
        "force_row_wise": True,
    }
    hub = lgb.train(p_huber, dtrain, num_boost_round=300)
    resid = y[tr] - hub.predict(X[tr])
    qmods = {}
    for a in (0.1, 0.5, 0.9):
        qmods[a] = fit_lgb_quantile(X[tr], resid, a, SHALLOW, None)
    p10c = hub.predict(X[cal]) + qmods[0.1].predict(X[cal])
    p50c = hub.predict(X[cal]) + qmods[0.5].predict(X[cal])
    p90c = hub.predict(X[cal]) + qmods[0.9].predict(X[cal])
    q = conformalize(y[cal], p10c, p90c)
    for split, mask in (("cal", cal), ("hold", ho)):
        base = hub.predict(X[mask])
        p10 = base + qmods[0.1].predict(X[mask])
        p50 = base + qmods[0.5].predict(X[mask])
        p90 = base + qmods[0.9].predict(X[mask])
        ev = evaluate(y[mask], p10, p50, p90)
        extra = {"n_features": len(cols_plant)}
        if split == "hold":
            evc = evaluate(y[mask], p10 - q, p50, p90 + q)
            extra.update(coverage_cqr=evc.coverage, winkler_cqr=evc.winkler, cqr_q=q)
        rows.append(rec("level_plant", "huber_then_quantile", split, ev, **extra))
    print("done two-stage")

    res = pd.DataFrame(rows)
    OUT.mkdir(parents=True, exist_ok=True)
    res.to_csv(OUT / "round2_ablation.csv", index=False)
    hold = res[res["split"] == "hold"].sort_values("mae")
    print("\n=== HOLD ===")
    cols_print = [c for c in ["pack", "model", "mae", "coverage", "coverage_cqr", "winkler", "winkler_cqr", "spec_mae"] if c in hold.columns]
    print(hold[cols_print].to_string(index=False))
    calr = res[res["split"] == "cal"].sort_values("mae")
    print("\n=== CAL ===")
    print(calr[["pack", "model", "mae", "coverage"]].to_string(index=False))
    return res


if __name__ == "__main__":
    run()

"""Ablation of sulfur model structures. Time-split only. No CLI/API."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.cross_decomposition import PLSRegression
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

SEED = 42
DATA = Path("data/processed/quality_datasets/sulfur.parquet")
OUT_DIR = Path("artifacts/models")
HOLDOUT_START = pd.Timestamp("2026-07-01", tz="UTC")
CAL_START = pd.Timestamp("2026-01-01", tz="UTC")


def pinball(y, q, alpha: float) -> float:
    e = y - q
    return float(np.mean(np.maximum(alpha * e, (alpha - 1) * e)))


def winkler(y, lo, hi, alpha: float = 0.2) -> float:
    width = hi - lo
    below = np.maximum(lo - y, 0)
    above = np.maximum(y - hi, 0)
    return float(np.mean(width + (2 / alpha) * (below + above)))


def coverage(y, lo, hi) -> float:
    return float(np.mean((y >= lo) & (y <= hi)))


def spec_mae(y, pred, thr: float = 10.0, band: float = 1.5) -> float:
    m = np.abs(y - thr) <= band
    if m.sum() < 8:
        return float("nan")
    return float(mean_absolute_error(y[m], pred[m]))


def crossing_rate(p10, p50, p90) -> float:
    return float(np.mean((p10 > p50) | (p50 > p90)))


FEATURE_PACKS: dict[str, list[str]] = {
    "official_y": [
        "P8_mean_60",
        "T11_mean_60",
        "F19_mean_60",
        "P8_lag0",
        "T11_lag0",
        "F19_lag0",
    ],
    "behavior_core": [
        "T5_mean_60",
        "F26_mean_60",
        "P13_mean_60",
        "T5_lag0",
        "F26_lag0",
        "P13_lag0",
    ],
    "windows": [
        "T5_mean_30",
        "T5_std_30",
        "T5_mean_60",
        "T5_mean_180",
        "F26_mean_30",
        "F26_std_30",
        "F26_mean_60",
        "F26_mean_180",
        "P13_mean_30",
        "P13_mean_60",
        "P13_mean_180",
        "P8_mean_60",
    ],
    "lags_0_3h": [
        "T5_lag0",
        "T5_lag6",
        "T5_lag12",
        "T5_lag18",
        "F26_lag0",
        "F26_lag6",
        "F26_lag12",
        "F26_lag18",
        "P13_lag0",
        "P13_lag6",
        "P13_lag12",
        "P13_lag18",
    ],
    "hds_no_dupes": [
        "T5_mean_30",
        "T5_mean_60",
        "T5_mean_180",
        "T5_std_30",
        "T5_lag0",
        "T5_lag6",
        "T5_lag12",
        "T5_lag18",
        "F26_mean_30",
        "F26_mean_60",
        "F26_mean_180",
        "F26_lag0",
        "F26_lag6",
        "F26_lag12",
        "P13_mean_60",
        "P13_lag0",
        "P8_mean_60",
        "P8_lag0",
        "F15_mean_60",
        "T12_mean_60",
    ],
    "hds_with_dupes": [
        "T5_mean_60",
        "T6_mean_60",
        "T11_mean_60",
        "F19_mean_60",
        "F26_mean_60",
        "F17_mean_60",
        "P13_mean_60",
        "P8_mean_60",
        "T5_lag0",
        "T11_lag0",
        "F19_lag0",
        "F26_lag0",
    ],
    "plus_avt": [
        "T5_mean_60",
        "T5_mean_180",
        "T5_lag0",
        "T5_lag12",
        "F26_mean_60",
        "F26_lag0",
        "P13_mean_60",
        "P8_mean_60",
        "T55_mean_60",
        "F65_mean_60",
        "W70_mean_60",
        "T55_lag0",
        "F65_lag0",
    ],
    "plus_context": [
        "T5_mean_30",
        "T5_mean_60",
        "T5_mean_180",
        "T5_lag0",
        "T5_lag6",
        "T5_lag12",
        "T5_lag18",
        "F26_mean_60",
        "F26_mean_180",
        "F26_lag0",
        "F26_lag12",
        "P13_mean_60",
        "P8_mean_60",
        "T55_mean_60",
        "F65_mean_60",
        "W70_mean_60",
        "prev_lims_sulfur",
        "lims_age_h",
        "feed_sulfur",
        "cat_age_days",
        "month_sin",
        "month_cos",
    ],
    "full": [
        "T5_mean_30",
        "T5_std_30",
        "T5_mean_60",
        "T5_mean_180",
        "T5_lag0",
        "T5_lag3",
        "T5_lag6",
        "T5_lag9",
        "T5_lag12",
        "T5_lag18",
        "F26_mean_30",
        "F26_std_30",
        "F26_mean_60",
        "F26_mean_180",
        "F26_lag0",
        "F26_lag6",
        "F26_lag12",
        "F26_lag18",
        "P13_mean_30",
        "P13_mean_60",
        "P13_mean_180",
        "P13_lag0",
        "P8_mean_30",
        "P8_mean_60",
        "P8_lag0",
        "F15_mean_60",
        "T12_mean_60",
        "T55_mean_60",
        "T55_mean_180",
        "F65_mean_60",
        "W70_mean_60",
        "prev_lims_sulfur",
        "lims_age_h",
        "feed_sulfur",
        "cat_age_days",
        "month_sin",
        "month_cos",
        "hour",
    ],
    "full_plus_q21": None,  # filled later
    "naive_persistence": ["prev_lims_sulfur"],
}

FEATURE_PACKS["full_plus_q21"] = FEATURE_PACKS["full"] + ["Q21_mean_60", "Q21_lag0"]


MONOTONE = {
    "T5_mean_30": -1,
    "T5_mean_60": -1,
    "T5_mean_180": -1,
    "T5_lag0": -1,
    "T5_lag3": -1,
    "T5_lag6": -1,
    "T5_lag9": -1,
    "T5_lag12": -1,
    "T5_lag18": -1,
    "T11_mean_60": -1,
    "T11_lag0": -1,
    "T6_mean_60": -1,
    "F26_mean_30": 1,
    "F26_mean_60": 1,
    "F26_mean_180": 1,
    "F26_lag0": 1,
    "F26_lag6": 1,
    "F26_lag12": 1,
    "F26_lag18": 1,
    "F19_mean_60": 1,
    "F19_lag0": 1,
    "F17_mean_60": 1,
    "cat_age_days": 1,
    "feed_sulfur": 1,
    "prev_lims_sulfur": 1,
}


LGBM_GRIDS = [
    {"name": "lgb_default", "num_leaves": 31, "learning_rate": 0.05, "min_data_in_leaf": 20, "n_estimators": 400},
    {"name": "lgb_shallow", "num_leaves": 15, "learning_rate": 0.05, "min_data_in_leaf": 40, "n_estimators": 300},
    {"name": "lgb_deep", "num_leaves": 63, "learning_rate": 0.03, "min_data_in_leaf": 12, "n_estimators": 500},
    {"name": "lgb_slow", "num_leaves": 24, "learning_rate": 0.02, "min_data_in_leaf": 25, "n_estimators": 800},
]


def split_frames(ds: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    train = ds[ds["sample_ts"] < CAL_START]
    cal = ds[(ds["sample_ts"] >= CAL_START) & (ds["sample_ts"] < HOLDOUT_START)]
    hold = ds[ds["sample_ts"] >= HOLDOUT_START]
    return train, cal, hold


def matrix(df: pd.DataFrame, cols: list[str]) -> tuple[np.ndarray, list[str]]:
    use = [c for c in cols if c in df.columns]
    X = df[use].to_numpy(dtype=np.float64)
    return X, use


def fit_lgb_quantile(X, y, alpha: float, params: dict, monotone: list[int] | None) -> lgb.Booster:
    dtrain = lgb.Dataset(X, label=y, free_raw_data=False)
    p = {
        "objective": "quantile",
        "alpha": alpha,
        "metric": "quantile",
        "learning_rate": params["learning_rate"],
        "num_leaves": params["num_leaves"],
        "min_data_in_leaf": params["min_data_in_leaf"],
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
    if monotone is not None:
        p["monotone_constraints"] = monotone
    return lgb.train(p, dtrain, num_boost_round=params["n_estimators"])


def conformalize(y_cal, lo, hi, alpha=0.2) -> float:
    scores = np.maximum(lo - y_cal, y_cal - hi)
    q = np.quantile(scores, min(1.0, np.ceil((len(scores) + 1) * (1 - alpha)) / max(len(scores), 1)))
    return float(max(q, 0.0))


@dataclass
class Eval:
    mae: float
    coverage: float
    winkler: float
    pinball10: float
    pinball50: float
    pinball90: float
    spec_mae: float
    crossing: float
    n: int


def evaluate(y, p10, p50, p90) -> Eval:
    lo = np.minimum.reduce([p10, p50, p90])
    mid = np.median(np.vstack([p10, p50, p90]), axis=0)
    hi = np.maximum.reduce([p10, p50, p90])
    return Eval(
        mae=float(mean_absolute_error(y, mid)),
        coverage=coverage(y, lo, hi),
        winkler=winkler(y, lo, hi),
        pinball10=pinball(y, p10, 0.1),
        pinball50=pinball(y, p50, 0.5),
        pinball90=pinball(y, p90, 0.9),
        spec_mae=spec_mae(y, mid),
        crossing=crossing_rate(p10, p50, p90),
        n=int(len(y)),
    )


def time_folds(ds: pd.DataFrame, n_splits: int = 5) -> list[tuple[np.ndarray, np.ndarray]]:
    """Expanding time folds on LIMS rows with a 1-day embargo."""
    ts = ds["sample_ts"].to_numpy()
    idx = np.arange(len(ds))
    folds = []
    # use years 2023-2025 as CV, leave 2026 for cal+hold
    cut_points = pd.to_datetime(
        ["2023-10-01", "2024-04-01", "2024-10-01", "2025-04-01", "2025-10-01"], utc=True
    )
    for cut in cut_points:
        tr = idx[ds["sample_ts"] < (cut - pd.Timedelta(days=1))]
        te = idx[(ds["sample_ts"] >= cut) & (ds["sample_ts"] < cut + pd.DateOffset(months=3))]
        if len(tr) < 80 or len(te) < 20:
            continue
        folds.append((tr, te))
    return folds


def run() -> pd.DataFrame:
    ds = pd.read_parquet(DATA)
    ds["sample_ts"] = pd.to_datetime(ds["sample_ts"], utc=True)
    ds = ds.sort_values("sample_ts").reset_index(drop=True)
    train, cal, hold = split_frames(ds)
    print("n train/cal/hold", len(train), len(cal), len(hold), "total", len(ds))

    rows = []

    # persistence
    for split_name, part in [("cal", cal), ("hold", hold)]:
        y = part["y_sulfur"].to_numpy()
        pred = part["prev_lims_sulfur"].to_numpy()
        mae = float(mean_absolute_error(y[~np.isnan(pred)], pred[~np.isnan(pred)]))
        rows.append(
            {
                "pack": "naive_persistence",
                "model": "prev_lims",
                "split": split_name,
                "mae": mae,
                "coverage": np.nan,
                "winkler": np.nan,
                "pinball50": mae / 2,
                "spec_mae": spec_mae(y[~np.isnan(pred)], pred[~np.isnan(pred)]),
                "crossing": 0.0,
                "n": int((~np.isnan(pred)).sum()),
                "seconds": 0.0,
            }
        )

    packs = {k: v for k, v in FEATURE_PACKS.items() if k != "naive_persistence"}

    for pack_name, cols in packs.items():
        X_all, used = matrix(ds, cols)
        y_all = ds["y_sulfur"].to_numpy()
        tr_mask = ds["sample_ts"] < CAL_START
        cal_mask = (ds["sample_ts"] >= CAL_START) & (ds["sample_ts"] < HOLDOUT_START)
        ho_mask = ds["sample_ts"] >= HOLDOUT_START

        # ridge / pls on median only, fake quantiles via residual std
        for model_name, est in [
            ("ridge", make_pipeline(StandardScaler(), Ridge(alpha=1.0))),
            ("pls2", make_pipeline(StandardScaler(), PLSRegression(n_components=min(2, len(used))))),
        ]:
            t0 = time.time()
            Xtr = np.nan_to_num(X_all[tr_mask], nan=np.nanmedian(X_all[tr_mask], axis=0))
            ytr = y_all[tr_mask]
            est.fit(Xtr, ytr)
            for split_name, mask in [("cal", cal_mask), ("hold", ho_mask)]:
                Xs = np.nan_to_num(X_all[mask], nan=np.nanmedian(X_all[tr_mask], axis=0))
                pred = np.asarray(est.predict(Xs)).reshape(-1)
                resid = ytr - np.asarray(est.predict(Xtr)).reshape(-1)
                s = float(np.std(resid))
                ev = evaluate(y_all[mask], pred - 1.28 * s, pred, pred + 1.28 * s)
                rows.append(
                    {
                        "pack": pack_name,
                        "model": model_name,
                        "split": split_name,
                        "mae": ev.mae,
                        "coverage": ev.coverage,
                        "winkler": ev.winkler,
                        "pinball50": ev.pinball50,
                        "spec_mae": ev.spec_mae,
                        "crossing": ev.crossing,
                        "n": ev.n,
                        "seconds": time.time() - t0,
                    }
                )

        for grid in LGBM_GRIDS:
            for mono in (False, True):
                if pack_name in {"official_y"} and mono:
                    # official names have wrong physics; still test
                    pass
                t0 = time.time()
                Xtr = X_all[tr_mask]
                ytr = y_all[tr_mask]
                constraints = [MONOTONE.get(c, 0) for c in used] if mono else None
                if mono and all(c == 0 for c in constraints):
                    continue
                try:
                    m10 = fit_lgb_quantile(Xtr, ytr, 0.1, grid, constraints)
                    m50 = fit_lgb_quantile(Xtr, ytr, 0.5, grid, constraints)
                    m90 = fit_lgb_quantile(Xtr, ytr, 0.9, grid, constraints)
                except Exception as exc:
                    print("fail", pack_name, grid["name"], mono, exc)
                    continue
                for split_name, mask in [("cal", cal_mask), ("hold", ho_mask)]:
                    Xs = X_all[mask]
                    p10 = m10.predict(Xs)
                    p50 = m50.predict(Xs)
                    p90 = m90.predict(Xs)
                    ev = evaluate(y_all[mask], p10, p50, p90)
                    # conformal on cal applied to hold
                    extra = {}
                    if split_name == "hold":
                        Xc = X_all[cal_mask]
                        yc = y_all[cal_mask]
                        lo_c, hi_c = m10.predict(Xc), m90.predict(Xc)
                        q = conformalize(yc, lo_c, hi_c)
                        ev_c = evaluate(y_all[mask], p10 - q, p50, p90 + q)
                        extra = {
                            "mae_cqr": ev_c.mae,
                            "coverage_cqr": ev_c.coverage,
                            "winkler_cqr": ev_c.winkler,
                            "cqr_q": q,
                        }
                    rec = {
                        "pack": pack_name,
                        "model": grid["name"] + ("_mono" if mono else ""),
                        "split": split_name,
                        "mae": ev.mae,
                        "coverage": ev.coverage,
                        "winkler": ev.winkler,
                        "pinball50": ev.pinball50,
                        "spec_mae": ev.spec_mae,
                        "crossing": ev.crossing,
                        "n": ev.n,
                        "seconds": time.time() - t0,
                        "n_features": len(used),
                    }
                    rec.update(extra)
                    rows.append(rec)

        # CV MAE for best insight on pack with default lgb no mono
        cv_mae = []
        for tr_idx, te_idx in time_folds(ds):
            Xtr, ytr = X_all[tr_idx], y_all[tr_idx]
            Xte, yte = X_all[te_idx], y_all[te_idx]
            m50 = fit_lgb_quantile(Xtr, ytr, 0.5, LGBM_GRIDS[0], None)
            cv_mae.append(mean_absolute_error(yte, m50.predict(Xte)))
        if cv_mae:
            rows.append(
                {
                    "pack": pack_name,
                    "model": "lgb_default_cv",
                    "split": "cv5",
                    "mae": float(np.mean(cv_mae)),
                    "coverage": np.nan,
                    "winkler": np.nan,
                    "pinball50": np.nan,
                    "spec_mae": np.nan,
                    "crossing": 0.0,
                    "n": int(np.mean([len(te) for _, te in time_folds(ds)])),
                    "seconds": 0.0,
                    "cv_mae_std": float(np.std(cv_mae)),
                }
            )
        print("done pack", pack_name)

    res = pd.DataFrame(rows)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    res.to_csv(OUT_DIR / "structure_ablation.csv", index=False)
    hold = res[res["split"] == "hold"].sort_values("mae")
    print("\n=== HOLD MAE top ===")
    print(hold[["pack", "model", "mae", "coverage", "winkler", "spec_mae", "crossing", "n"]].head(25).to_string(index=False))
    print("\n=== HOLD MAE bottom ===")
    print(hold[["pack", "model", "mae", "coverage"]].tail(10).to_string(index=False))
    return res


if __name__ == "__main__":
    run()

"""Offline quality dataset for sulfur (and helpers). No HTTP, no CLI."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

RAW = Path("data/raw")
OUT = Path("data/processed/quality_datasets")
SENTINELS = {307.0, 251.0, 252.0, 240.0}
CAT_RESETS = pd.to_datetime(["2024-04-01", "2026-05-01"], utc=True)


def _is_sentinel(v: np.ndarray) -> np.ndarray:
    out = np.zeros(v.shape, dtype=bool)
    for s in SENTINELS:
        out |= np.isclose(v, s, atol=1e-6)
    return out


def load_telemetry() -> pd.DataFrame:
    path = RAW / "242000_tags.csv"
    usecols = [
        "date",
        "T5",
        "T6",
        "T11",
        "T12",
        "T23",
        "P8",
        "P13",
        "P3",
        "F19",
        "F17",
        "F26",
        "F9",
        "F15",
        "Q21",
        "W7",
        "F1",
        "F22",
        "P24",
        "T16",
    ]
    df = pd.read_csv(path, usecols=usecols, parse_dates=["date"])
    df["date"] = pd.to_datetime(df["date"], utc=True)
    df = df.sort_values("date").drop_duplicates("date")
    df = df.set_index("date")
    for col in df.columns:
        v = pd.to_numeric(df[col], errors="coerce").to_numpy(dtype=np.float64, copy=True)
        bad = _is_sentinel(v)
        if col == "Q21":
            bad |= np.isclose(v, 24.9, atol=0.02)
        if col in {"F19", "F17", "F26", "F9", "P8", "P13", "P3"}:
            bad |= v <= 0
        if col in {"T5", "T6", "T11"}:
            bad |= (v < 200) | (v > 450)
        v[bad] = np.nan
        df[col] = v
    return df


def load_avt_subset() -> pd.DataFrame:
    path = RAW / "avt_tags.csv"
    header = pd.read_csv(path, nrows=0)
    want = [c for c in ["date", "T55", "F65", "W70", "P22"] if c in header.columns]
    df = pd.read_csv(path, usecols=want, parse_dates=["date"])
    df["date"] = pd.to_datetime(df["date"], utc=True)
    df = df.sort_values("date").drop_duplicates("date").set_index("date")
    for col in df.columns:
        v = pd.to_numeric(df[col], errors="coerce").to_numpy(dtype=np.float64, copy=True)
        bad = _is_sentinel(v)
        if col in {"F65", "W70"}:
            bad |= v <= 0
        v[bad] = np.nan
        df[col] = v
    return df


def parse_lims_pairs(path: Path, time_col: int, value_col: int) -> pd.Series:
    raw = pd.read_excel(path, header=None)
    ts = pd.to_datetime(raw.iloc[4:, time_col], errors="coerce", utc=True)
    val = pd.to_numeric(raw.iloc[4:, value_col], errors="coerce")
    s = pd.Series(val.to_numpy(), index=ts)
    s = s[s.index.notna() & val.notna().to_numpy()]
    s = s[~s.index.duplicated(keep="last")].sort_index()
    return s


def load_labels() -> tuple[pd.Series, pd.Series, pd.Series]:
    path = next(RAW.glob("*ЛИМС*"))
    sulfur = parse_lims_pairs(path, 94, 95)
    t95 = parse_lims_pairs(path, 92, 93)
    feed_s = parse_lims_pairs(path, 80, 81)
    sulfur = sulfur[(sulfur > 0) & (sulfur < 50)]
    t95 = t95[(t95 > 250) & (t95 < 420)]
    return sulfur, t95, feed_s


def window_stats(series: pd.Series, t: pd.Timestamp, minutes: int) -> tuple[float, float]:
    start = t - pd.Timedelta(minutes=minutes)
    w = series.loc[start:t]
    if w.empty:
        return np.nan, np.nan
    return float(w.mean()), float(w.std(ddof=0)) if len(w) > 1 else 0.0


def lagged(series: pd.Series, t: pd.Timestamp, steps: list[int]) -> dict[str, float]:
    out = {}
    name = series.name
    for k in steps:
        ts = t - pd.Timedelta(minutes=10 * k)
        try:
            out[f"{name}_lag{k}"] = float(series.asof(ts))
        except Exception:
            out[f"{name}_lag{k}"] = np.nan
    return out


def cat_age_days(t: pd.Timestamp) -> float:
    prev = CAT_RESETS[CAT_RESETS <= t]
    if len(prev) == 0:
        origin = pd.Timestamp("2023-01-01", tz="UTC")
    else:
        origin = prev.max()
    return float((t - origin) / pd.Timedelta(days=1))


def asof_available(label: pd.Series, t: pd.Timestamp, delay_h: float = 4.0) -> float:
    available = label.copy()
    available.index = available.index + pd.Timedelta(hours=delay_h)
    v = available.asof(t)
    return float(v) if pd.notna(v) else np.nan


def build_rows() -> pd.DataFrame:
    tel = load_telemetry()
    avt = load_avt_subset()
    tel = tel.join(avt, how="left")
    sulfur, t95, feed_s = load_labels()
    tags = {
        "T5": tel["T5"],
        "T11": tel["T11"],
        "P8": tel["P8"],
        "F19": tel["F19"],
        "F26": tel["F26"],
        "P13": tel["P13"],
        "Q21": tel["Q21"],
        "F15": tel["F15"],
        "T12": tel["T12"],
        "T6": tel["T6"],
        "P3": tel["P3"],
        "F9": tel["F9"],
    }
    if "T55" in tel.columns:
        tags["T55"] = tel["T55"]
    if "F65" in tel.columns:
        tags["F65"] = tel["F65"]
    if "W70" in tel.columns:
        tags["W70"] = tel["W70"]

    rows = []
    for t, y in sulfur.items():
        if t not in tel.index and t < tel.index[0]:
            continue
        t_feat = t if t in tel.index else tel.index.asof(t)
        if pd.isna(t_feat):
            continue
        rec: dict = {
            "sample_ts": t,
            "y_sulfur": float(y),
            "y_t95": float(t95.asof(t)) if t in t95.index or True else np.nan,
            "month": int(t.month),
            "month_sin": np.sin(2 * np.pi * t.month / 12),
            "month_cos": np.cos(2 * np.pi * t.month / 12),
            "cat_age_days": cat_age_days(t),
            "hour": int(t.hour),
        }
        prev_lims = sulfur[sulfur.index < t]
        if len(prev_lims):
            last_ts = prev_lims.index.max()
            rec["lims_age_h"] = (t - last_ts) / pd.Timedelta(hours=1)
            rec["prev_lims_sulfur"] = float(prev_lims.iloc[-1])
        else:
            rec["lims_age_h"] = np.nan
            rec["prev_lims_sulfur"] = np.nan
        rec["feed_sulfur"] = asof_available(feed_s, t, 4.0)
        t95_prev = t95[t95.index < t]
        rec["y_t95"] = float(t95.asof(t)) if pd.notna(t95.asof(t)) else np.nan
        rec["t95_same_sample"] = float(t95.loc[t]) if t in t95.index else np.nan

        for name, series in tags.items():
            m30, s30 = window_stats(series, t, 30)
            m60, _ = window_stats(series, t, 60)
            m180, _ = window_stats(series, t, 180)
            rec[f"{name}_mean_30"] = m30
            rec[f"{name}_std_30"] = s30
            rec[f"{name}_mean_60"] = m60
            rec[f"{name}_mean_180"] = m180
            rec.update(lagged(series.rename(name), t, [0, 3, 6, 9, 12, 18]))
        rows.append(rec)

    ds = pd.DataFrame(rows)
    ds["year"] = ds["sample_ts"].dt.year
    return ds


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    ds = build_rows()
    ds.to_parquet(OUT / "sulfur.parquet", index=False)
    print(ds.shape)
    print(ds[["sample_ts", "y_sulfur"]].head())
    print("years", ds.groupby("year").size().to_dict())
    print("y describe", ds["y_sulfur"].describe().to_string())
    print("null frac top")
    print(ds.isna().mean().sort_values(ascending=False).head(15).to_string())


if __name__ == "__main__":
    main()

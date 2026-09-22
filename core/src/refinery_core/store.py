from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd

from refinery_core.models.build_quality_dataset import SENTINELS
from refinery_core.models.round2_search import add_plant_features


def _aware(ts: datetime) -> datetime:
    if ts.tzinfo is None:
        return ts.replace(tzinfo=UTC)
    return ts.astimezone(UTC)


@dataclass
class SliceStore:
    frame: pd.DataFrame
    telemetry: pd.DataFrame | None = None

    @classmethod
    def load(cls, path: Path) -> SliceStore:
        if not path.is_file():
            raise FileNotFoundError(str(path))
        ds = pd.read_parquet(path)
        ds["sample_ts"] = pd.to_datetime(ds["sample_ts"], utc=True)
        ds = add_plant_features(ds.sort_values("sample_ts").reset_index(drop=True))
        tel_path = path.parents[2] / "raw" / "242000_tags.csv"
        telemetry = None
        if tel_path.is_file():
            telemetry = pd.read_csv(
                tel_path,
                usecols=["date", "T5", "T11", "P8", "F19", "F26", "P13", "Q21"],
                parse_dates=["date"],
            )
            telemetry["date"] = pd.to_datetime(telemetry["date"], utc=True)
            telemetry = telemetry.sort_values("date")
        return cls(frame=ds, telemetry=telemetry)

    def window(self, t_point: datetime, hours: float = 3.0) -> list[dict]:
        if self.telemetry is None:
            return []
        t = pd.Timestamp(_aware(t_point))
        start = t - pd.Timedelta(hours=hours)
        chunk = self.telemetry[(self.telemetry["date"] >= start) & (self.telemetry["date"] <= t)]
        if chunk.empty:
            return []
        step = max(1, len(chunk) // 18)
        rows = []
        for _, rec in chunk.iloc[::step].iterrows():
            rows.append(
                {
                    "ts": rec["date"].strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "T5": _clean(rec.get("T5")),
                    "F26": _clean(rec.get("F26")),
                    "P8": _clean(rec.get("P8")),
                    "T11": _clean(rec.get("T11")),
                    "F19": _clean(rec.get("F19")),
                }
            )
        return rows[-18:]

    def row_at(self, t_point: datetime) -> pd.Series:
        """Last LIMS sample already published by t_point (sample_ts + 4h)."""
        t = pd.Timestamp(_aware(t_point))
        available = self.frame["sample_ts"] + pd.Timedelta(hours=4)
        mask = available <= t
        if not mask.any():
            raise LookupError(f"no published LIMS sample at {t_point.isoformat()}")
        return self.frame.loc[mask].iloc[-1]


def _clean(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(x):
        return None
    if any(abs(x - s) < 0.05 for s in SENTINELS) or abs(x - 24.9) < 0.05:
        return None
    return x

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd

from refinery_core.models.round2_search import add_plant_features


def _aware(ts: datetime) -> datetime:
    if ts.tzinfo is None:
        return ts.replace(tzinfo=UTC)
    return ts.astimezone(UTC)


@dataclass
class SliceStore:
    frame: pd.DataFrame

    @classmethod
    def load(cls, path: Path) -> SliceStore:
        if not path.is_file():
            raise FileNotFoundError(str(path))
        ds = pd.read_parquet(path)
        ds["sample_ts"] = pd.to_datetime(ds["sample_ts"], utc=True)
        ds = add_plant_features(ds.sort_values("sample_ts").reset_index(drop=True))
        return cls(frame=ds)

    def row_at(self, t_point: datetime) -> pd.Series:
        """Last LIMS sample already published by t_point (sample_ts + 4h)."""
        t = pd.Timestamp(_aware(t_point))
        available = self.frame["sample_ts"] + pd.Timedelta(hours=4)
        mask = available <= t
        if not mask.any():
            raise LookupError(f"no published LIMS sample at {t_point.isoformat()}")
        return self.frame.loc[mask].iloc[-1]

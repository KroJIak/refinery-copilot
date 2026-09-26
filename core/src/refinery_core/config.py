from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    root: Path
    data_dir: Path
    artifacts_dir: Path
    models_dir: Path
    seed: int
    llm_mode: str

    @classmethod
    def from_env(cls, root: Path | None = None) -> Settings:
        root = (root or Path.cwd()).resolve()
        data_dir = Path(os.environ.get("DATA_DIR", str(root / "data")))
        if not data_dir.is_absolute():
            data_dir = root / data_dir
        artifacts_dir = Path(os.environ.get("ARTIFACTS_DIR", str(root / "artifacts")))
        if not artifacts_dir.is_absolute():
            artifacts_dir = root / artifacts_dir
        models_dir = Path(os.environ.get("MODEL_REGISTRY_DIR", str(artifacts_dir / "models")))
        if not models_dir.is_absolute():
            models_dir = root / models_dir
        return cls(
            root=root,
            data_dir=data_dir,
            artifacts_dir=artifacts_dir,
            models_dir=models_dir,
            seed=int(os.environ.get("SEED", "42")),
            llm_mode=os.environ.get("LLM_MODE", "off"),
        )

    @property
    def sulfur_dir(self) -> Path:
        return self.models_dir / "sulfur_advisory"

    @property
    def t95_dir(self) -> Path:
        return self.models_dir / "t95_advisory"

    @property
    def quality_dataset(self) -> Path:
        return self.data_dir / "processed" / "quality_datasets" / "sulfur.parquet"

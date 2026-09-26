from __future__ import annotations

from pathlib import Path

import pytest

from refinery_core.config import Settings
from refinery_core.registry import ModelRegistry
from refinery_core.store import SliceStore

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="session")
def settings() -> Settings:
    return Settings.from_env(ROOT)


@pytest.fixture(scope="session")
def registry(settings: Settings) -> ModelRegistry:
    return ModelRegistry.load(settings)


@pytest.fixture(scope="session")
def store(settings: Settings) -> SliceStore:
    return SliceStore.load(settings.quality_dataset)

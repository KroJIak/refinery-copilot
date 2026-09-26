from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from hashlib import sha256
from typing import Any, Protocol

import pandas as pd

from refinery_core.registry import ModelRegistry
from refinery_core.scenarios import Scenario
from refinery_core.store import SliceStore
from refinery_core.types import AgentRole


@dataclass
class NumberRef:
    path: str
    value: float | None
    unit: str | None
    label: str


@dataclass
class AgentStep:
    run_id: str
    step_idx: int
    agent_role: AgentRole
    input_digest: str
    output: dict[str, Any]
    notes: list[str]
    number_refs: list[NumberRef]
    confidence: float | None
    started_at: datetime
    finished_at: datetime
    duration_ms: int

    def summary(self) -> str:
        return "; ".join(self.notes[:2]) if self.notes else ""


@dataclass
class RunContext:
    scenario: Scenario
    store: SliceStore
    registry: ModelRegistry
    run_id: str
    seed: int
    row: pd.Series | None = None
    feature_frame: pd.DataFrame | None = None
    steps: dict[AgentRole, AgentStep] = field(default_factory=dict)
    skip_remaining: bool = False

    def digest(self, payload: str) -> str:
        return sha256(f"{self.seed}|{payload}".encode()).hexdigest()[:16]


class Agent(Protocol):
    role: AgentRole
    step_idx: int

    def run(self, ctx: RunContext) -> AgentStep: ...

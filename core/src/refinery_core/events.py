from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Protocol

from refinery_core.types import AgentRole


def utcnow() -> datetime:
    return datetime.now(UTC)


@dataclass
class CoreEvent:
    seq: int
    run_id: str
    kind: str
    payload: dict[str, Any]
    ts: datetime = field(default_factory=utcnow)


class EventSink(Protocol):
    def emit(self, event: CoreEvent) -> None: ...


class NullSink:
    def emit(self, event: CoreEvent) -> None:
        return None


@dataclass
class TimelineSink:
    path: Any
    _file: Any = None

    def emit(self, event: CoreEvent) -> None:
        import json

        if self._file is None:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self._file = self.path.open("a", encoding="utf-8")
        rec = {
            "seq": event.seq,
            "runId": event.run_id,
            "kind": event.kind,
            "ts": event.ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "payload": event.payload,
        }
        self._file.write(json.dumps(rec, ensure_ascii=False, default=str) + "\n")
        self._file.flush()

    def close(self) -> None:
        if self._file is not None:
            self._file.close()
            self._file = None


@dataclass
class MultiplexSink:
    sinks: list[EventSink]

    def emit(self, event: CoreEvent) -> None:
        for sink in self.sinks:
            sink.emit(event)


def agent_label(role: AgentRole) -> str:
    return {
        "data": "Данные",
        "quality": "Качество",
        "reliability": "Надёжность",
        "optimization": "Варианты",
        "orchestrator": "Итог",
    }[role]

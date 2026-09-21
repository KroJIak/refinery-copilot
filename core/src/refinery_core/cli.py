from __future__ import annotations

import argparse
import sys
from datetime import UTC, datetime
from pathlib import Path

from rich.console import Console

from refinery_core.agents.orchestrator import RunResult, run_pipeline
from refinery_core.cli_render import ConsoleSink, print_session_banner
from refinery_core.config import Settings
from refinery_core.events import MultiplexSink, TimelineSink
from refinery_core.registry import EnvironmentError, ModelRegistry
from refinery_core.report.run_report import persist
from refinery_core.scenarios import DEMO_ORDER, ScenarioKind, resolve_scenario
from refinery_core.store import SliceStore
from refinery_core.types import DEMO_KINDS, EXPECTED_OUTCOME


def _parse_overrides(raw: str | None) -> dict[str, float]:
    if not raw:
        return {}
    out: dict[str, float] = {}
    for part in raw.split(","):
        if not part.strip():
            continue
        if "=" not in part:
            raise ValueError(f"override без '=': {part}")
        k, v = part.split("=", 1)
        out[k.strip()] = float(v)
    return out


def _parse_tpoint(raw: str | None) -> datetime | None:
    if not raw:
        return None
    ts = datetime.fromisoformat(raw.replace("Z", "+00:00"))  # noqa: FURB162
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=UTC)
    return ts


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="refinery-core")
    sub = p.add_subparsers(dest="cmd", required=True)
    demo = sub.add_parser("demo", help="четыре демо-сценария или один --scenario")
    demo.add_argument("--scenario", choices=[*DEMO_KINDS, "stale_lims", "all"], default="all")
    demo.add_argument("--t-point", dest="t_point")
    demo.add_argument("--overrides")
    demo.add_argument("--seed", type=int, default=None)
    demo.add_argument("--format", choices=["text", "json"], default="text")
    return p


def _kinds(name: str) -> list[ScenarioKind]:
    if name == "all":
        return list(DEMO_ORDER)
    return [name]  # type: ignore[list-item]


def _exit_code(results: list[RunResult]) -> int:
    if any(r.status == "failed" for r in results):
        return 3
    ok = all(EXPECTED_OUTCOME[r.scenario.kind] == r.recommendation.get("decision") for r in results)
    return 0 if ok else 1


class BoundTimeline:
    def __init__(self, artifacts_dir: Path) -> None:
        self.artifacts_dir = artifacts_dir
        self.sink: TimelineSink | None = None

    def emit(self, event) -> None:
        if self.sink is None:
            path = self.artifacts_dir / "timeline" / f"{event.run_id}.ndjson"
            path.parent.mkdir(parents=True, exist_ok=True)
            self.sink = TimelineSink(path)
        self.sink.emit(event)

    def close(self) -> None:
        if self.sink is not None:
            self.sink.close()


def cmd_demo(args: argparse.Namespace) -> int:
    console = Console(highlight=False, soft_wrap=True)
    settings = Settings.from_env()
    try:
        registry = ModelRegistry.load(settings)
    except EnvironmentError as e:
        console.print(f"[red]окружение не готово[/] {e}")
        return 2
    ds = settings.quality_dataset
    if not ds.is_file():
        console.print(f"[red]data_missing[/] нет {ds}")
        return 2
    store = SliceStore.load(ds)
    seed = args.seed if args.seed is not None else settings.seed
    kinds = _kinds(args.scenario)
    t_point = _parse_tpoint(args.t_point)
    overrides = _parse_overrides(args.overrides)
    if args.format == "text":
        print_session_banner(console, seed=seed, registry=registry, kinds=kinds)
    results: list[RunResult] = []
    json_runs: list[dict] = []

    for kind in kinds:
        scenario = resolve_scenario(kind, t_point=t_point, overrides=overrides, seed=seed)
        console_sink = ConsoleSink(console, fmt=args.format)
        tl = BoundTimeline(settings.artifacts_dir)
        result = run_pipeline(
            scenario, store, registry, sink=MultiplexSink([console_sink, tl]), settings=settings
        )
        tl.close()
        artifacts = persist(result, settings)
        if args.format == "text":
            console.print(f"[dim]отчёт[/] {artifacts['report_md']}")
        results.append(result)
        expected = EXPECTED_OUTCOME[scenario.kind]
        json_runs.append(
            {
                "run_id": result.run_id,
                "scenario": scenario.kind,
                "status": result.status,
                "decision": result.recommendation.get("decision"),
                "exit_hint": 0 if expected == result.recommendation.get("decision") else 1,
                "artifacts": artifacts,
            }
        )

    code = _exit_code(results)
    if args.format == "json":
        console.print_json(
            data={
                "runs": json_runs,
                "summary": {
                    "total": len(results),
                    "matched_expected": sum(1 for r in json_runs if r["exit_hint"] == 0),
                    "exit_code": code,
                },
            }
        )
    else:
        console.print(f"[dim]код выхода {code}[/]")
    return code


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.cmd != "demo":
        return 2
    try:
        return cmd_demo(args)
    except ValueError as e:
        print(e, file=sys.stderr)
        return 3
    except FileExistsError as e:
        print(f"артефакт уже есть: {e}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())

from __future__ import annotations

from typing import Any

from rich.console import Console
from rich.panel import Panel
from rich.rule import Rule
from rich.text import Text

from refinery_core.events import CoreEvent, agent_label
from refinery_core.registry import ModelRegistry
from refinery_core.scenarios import scenario_title
from refinery_core.types import ScenarioKind, refusal_reason_label


def print_session_banner(
    console: Console,
    *,
    seed: int,
    registry: ModelRegistry,
    kinds: list[ScenarioKind],
) -> None:
    titles = ", ".join(scenario_title(k) for k in kinds)
    t95 = registry.t95_baseline
    body = Text()
    body.append(f"seed {seed}\n")
    body.append("сера считается по процессу и вчерашней пробе, анализатор серы в расчёт не берём\n")
    body.append("ошибка на проверке около 1.8 мг/кг, облако попадает в норму примерно в 8 случаях из 10\n")
    body.append(
        f"T95 берём из последней пробы, запас ±{t95.get('interval_halfwidth', 7):.0f} °C\n"
    )
    body.append(f"сценарии: {titles}")
    console.print(Panel(body, title="демо", border_style="bright_black", padding=(0, 1), expand=True))


class ConsoleSink:
    def __init__(self, console: Console, fmt: str = "text") -> None:
        self.console = console
        self.fmt = fmt
        self.events: list[CoreEvent] = []
        self._roles_done: set[str] = set()

    def emit(self, event: CoreEvent) -> None:
        self.events.append(event)
        if self.fmt != "text":
            return
        kind = event.kind
        p = event.payload
        if kind == "run_started":
            title = scenario_title(p["kind"])
            self.console.print(Rule(f"[bold]{title}[/]  {p['tPoint']}", style="bright_black"))
            self.console.print(f"[dim]прогон {p['runId']}[/]")
        elif kind == "agent_finished":
            role = p["agentRole"]
            if role in self._roles_done:
                return
            self._roles_done.add(role)
            notes = "; ".join(p.get("notes") or [])
            dur = p.get("durationMs", 0)
            label = agent_label(role)
            idx = {"data": 0, "quality": 1, "reliability": 2, "optimization": 3, "orchestrator": 4}[
                role
            ]
            color = "green" if role != "orchestrator" else "cyan"
            self.console.print(f"  [{idx}/4] [{color}]{label:<12}[/] {dur:>4} мс  {notes}")
        elif kind == "recommendation":
            self._print_card(p)
        elif kind == "refusal":
            self._print_refusal(p)
        elif kind == "run_failed":
            self.console.print(f"[red]авария[/] {p.get('error')}")

    def _print_card(self, rec: dict[str, Any]) -> None:
        actions = rec.get("actions") or []
        effects = rec.get("effects") or []
        checks = rec.get("checks") or []
        body = Text()
        if actions:
            a = actions[0]
            name = a.get("label") or a["tag"]
            body.append(
                f"{name}: {a['current_value']:.1f} → {a['recommended_value']:.1f} {a.get('unit') or ''}\n",
                style="bold",
            )
        if effects:
            e = effects[0]
            body.append(f"сера {e['baseline_p50']:.2f} → {e['action_p50']:.2f} {e.get('unit')}\n")
            if e.get("p90") is not None:
                body.append(f"верхняя граница вилки {e['p90']:.2f} (норма 10)\n")
        scored = [c for c in checks if c.get("passed") is True]
        unknown = [c for c in checks if c.get("passed") is None]
        failed = [c for c in checks if c.get("passed") is False]
        if failed:
            body.append(f"проверки не прошли: {len(failed)}\n", style="red")
            for c in failed:
                body.append(f"  {c['description']}\n", style="red")
        if scored:
            body.append(f"прошли {len(scored)}\n", style="green")
        if unknown:
            for c in unknown:
                body.append(f"{c['description']}: нет данных\n", style="yellow")
        conf = rec.get("confidence") or {}
        if conf:
            body.append(f"уверенность {conf.get('p10', 0):.2f}–{conf.get('p90', 0):.2f}\n")
        expl = rec.get("explanation") or ""
        for line in expl.split(". "):
            piece = line.strip()
            if piece and not piece.endswith("."):
                piece += "."
            if piece:
                body.append(piece + "\n", style="dim")
        self.console.print(
            Panel(body, title="рекомендация", border_style="blue", padding=(0, 1), expand=True)
        )

    def _print_refusal(self, rec: dict[str, Any]) -> None:
        ref = rec.get("refusal") or {}
        reasons = [refusal_reason_label(r) for r in (ref.get("reasons") or [])]
        body = Text()
        body.append("Надёжной рекомендации нет\n", style="bold red")
        for label in reasons:
            body.append(label + "\n", style="red")
        for d in ref.get("details") or []:
            body.append(d + "\n", style="dim")
        self.console.print(
            Panel(body, title="отказ", border_style="red", padding=(0, 1), expand=True)
        )

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
    sulfur = registry.sulfur_metrics
    t95 = registry.t95_baseline
    body = Text()
    body.append(f"seed {seed}\n")
    body.append(
        "сера: квантили LightGBM + CQR, what-if через L2 с монотонностью, без Q21\n",
        style="dim",
    )
    hold = sulfur.get("hold_cqr") or {}
    if hold:
        body.append(
            f"hold MAE {hold.get('mae', 0):.2f}, покрытие {hold.get('coverage', 0):.2f}\n",
            style="dim",
        )
    body.append(
        f"T95: последняя лаборатория и сдвиг месяца, полоса ±{t95.get('interval_halfwidth', 7):.0f} °C\n",
        style="dim",
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
            body.append(
                f"{a['tag']}: {a['current_value']:.1f} → {a['recommended_value']:.1f} {a.get('unit') or ''}\n",
                style="bold",
            )
        if effects:
            e = effects[0]
            body.append(f"сера {e['baseline_p50']:.2f} → {e['action_p50']:.2f} {e.get('unit')}\n")
        ok = sum(1 for c in checks if c.get("passed"))
        body.append(f"проверки {ok}/{len(checks)}\n", style="green")
        conf = rec.get("confidence") or {}
        if conf:
            body.append(f"уверенность {conf.get('p10', 0):.2f}–{conf.get('p90', 0):.2f}\n")
        body.append(rec.get("explanation") or "", style="dim")
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

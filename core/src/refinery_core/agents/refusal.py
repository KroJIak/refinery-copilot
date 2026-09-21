from __future__ import annotations

from refinery_core.agents.base import RunContext
from refinery_core.types import RefusalReason, refusal_reason_label


def collect(ctx: RunContext) -> tuple[list[RefusalReason], list[str]]:
    reasons: list[RefusalReason] = []
    details: list[str] = []
    data = ctx.steps.get("data")
    if data:
        fr = data.output["freshness"][0]
        if fr["status"] in {"stale", "missing"}:
            reasons.append("stale_lims")
            details.append(
                f"Возраст последнего ЛИМС {fr['age_hours']} ч, порог устаревания {fr['stale_after_h']} ч"
            )
        flags = data.output["anomalies"]["flags"]
        bad = [k for k, v in flags.items() if v != "ok"]
        if bad:
            reasons.append("sensor_fault")
            details.append("Каналы с заглушкой или без числа: " + ", ".join(bad))
    opt = ctx.steps.get("optimization")
    quality = ctx.steps.get("quality")
    no_variant = opt is not None and opt.output.get("n_feasible") == 0
    if quality and quality.output.get("wide_interval") and (no_variant or opt is None):
        s = quality.output["assessments"][0]
        reasons.append("wide_interval")
        details.append(
            f"Интервал серы {s['p10']:.1f}–{s['p90']:.1f} мг/кг пересекает границу 10 мг/кг"
        )
    rel = ctx.steps.get("reliability")
    if rel and rel.output.get("out_of_training_domain") and no_variant:
        reasons.append("out_of_training_domain")
        details.append("; ".join(rel.output.get("risk_factors") or ["вне области обучения"]))
    if no_variant:
        reasons.append("no_feasible_variant")
        details.append("Все варианты крутки нарушают ограничения")
    return reasons, details


def explanation(reasons: list[RefusalReason], details: list[str]) -> str:
    lead = "Надёжной рекомендации нет."
    if details:
        return lead + " " + " ".join(details)
    return lead + " " + "; ".join(refusal_reason_label(r) for r in reasons)

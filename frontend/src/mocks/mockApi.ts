import type {
  AgentStep,
  ControlledVariable,
  HealthResponse,
  RunCreated,
  RunReport,
  RunSummary,
  ScenarioDraft,
  ScenarioKind,
  ScenarioPreset,
  StateResponse,
  WhatifRequest,
  WhatifResponse,
  ModelArtifact,
  TagPoint,
} from "@/types";
import { ApiError } from "@/services/client";
import { health, models, report, state, whatifResult } from "./fixtures";
import scenarioData from "./fixtures/scenarios.json";
import variableData from "./fixtures/controlledVariables.json";
import telemetrySamples from "./fixtures/telemetry-samples.json";
import scenarioProfileData from "./fixtures/scenarioProfiles.json";

export const controlledVariables = variableData as ControlledVariable[];
export const scenarioCatalog = scenarioData as ScenarioPreset[];
type ScenarioProfile = {
  variation: number;
  controls: Record<string, number>;
  extras: Record<string, number | null>;
  quality: { sulfur: number; t95: number; cetane: number };
  freshness: { limsAgeHours: number | null; pakAgeHours: number | null; d15AgeHours: number | null };
};
const scenarioProfiles = scenarioProfileData as Record<ScenarioKind, ScenarioProfile>;
const profileFor = (kind: ScenarioKind) => scenarioProfiles[kind] ?? scenarioProfiles.normal;
const STORAGE_KEY = "refinery.mock.runs.v1";
type SavedRun = { draft: ScenarioDraft; createdAt: string; complete: boolean };
const runs = new Map<string, SavedRun>();
try {
  const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  if (Array.isArray(saved))
    for (const row of saved) {
      if (
        Array.isArray(row) &&
        typeof row[0] === "string" &&
        row[1]?.draft?.kind
      )
        runs.set(row[0], row[1] as SavedRun);
    }
} catch {
  /* Local storage may be unavailable. The session still works. */
}
let n = runs.size;
let activeKind: ScenarioKind = "quality_risk";
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...runs]));
  } catch {
    /* Storage quota does not block a mock run. */
  }
}
export function setMockScenario(kind: ScenarioKind) {
  activeKind = kind;
}
export function completeMockRun(id: string) {
  const item = runs.get(id);
  if (item) {
    item.complete = true;
    save();
  }
}
export function getMockRun(id: string) {
  const item = runs.get(id);
  return item
    ? {
        runId: id,
        kind: item.draft.kind,
        tPoint: item.draft.tPoint,
        seed: item.draft.seed ?? 42,
      }
    : undefined;
}
export function mockReport(id: string): RunReport {
  const item = runs.get(id);
  if (!item) throw new ApiError(404, "run_not_found", "Прогон не найден");
  const profile = profileFor(item.draft.kind);
  const result = report(id, item.draft.kind);
  result.scenario = {
    ...item.draft,
    scenarioId: String([...runs.keys()].indexOf(id) + 1).padStart(8, "0"),
    seed: item.draft.seed ?? 42,
  };
  result.createdAt = item.createdAt;
  result.freshness = snapshot(
    { tPoint: item.draft.tPoint },
    item.draft.kind,
  ).freshness;
  result.recommendation.tPoint = item.draft.tPoint;
  const qualityByTarget = {
    sulfur: profile.quality.sulfur,
    t95: profile.quality.t95,
    cetane: profile.quality.cetane,
    d15: profile.extras.pak_d15 ?? 835,
  } as const;
  result.quality = result.quality.map((itemQuality) => {
    const p50 = qualityByTarget[itemQuality.target];
    const spread = itemQuality.target === "sulfur" ? 0.7 : itemQuality.target === "t95" ? 1.8 : 0.5;
    return { ...itemQuality, p10: round(p50 - spread), p50, p90: round(p50 + spread), intervalWidth: round(spread * 2), specRisk: itemQuality.target === "sulfur" ? round(Math.min(1, Math.max(0, (p50 - 8.8) / 2))) : itemQuality.target === "t95" ? (p50 + spread > 360 ? 0.7 : 0.05) : (p50 - spread < 51 ? 0.45 : 0.04) };
  });
  result.recommendation.risks = result.recommendation.risks.map((risk) => {
    const p50 = qualityByTarget[risk.target];
    const spread = risk.target === "sulfur" ? 0.7 : risk.target === "t95" ? 1.8 : 0.5;
    return { ...risk, p10: round(p50 - spread), p50, p90: round(p50 + spread), specRisk: result.quality.find((quality) => quality.target === risk.target)?.specRisk ?? risk.specRisk };
  });
  result.recommendation.checks = result.recommendation.checks?.map((check) => {
    if (check.constraintId === "sulfur_max") return { ...check, value: qualityByTarget.sulfur, passed: qualityByTarget.sulfur <= 10 };
    if (check.constraintId === "t95_max") return { ...check, value: qualityByTarget.t95, passed: qualityByTarget.t95 <= 360 };
    if (check.constraintId === "cetane_min_summer") return { ...check, value: qualityByTarget.cetane, passed: qualityByTarget.cetane >= 51 };
    return check;
  });
  result.recommendation.effects = result.recommendation.effects?.map((effect) => ({ ...effect, baselineP50: qualityByTarget[effect.target], actionP50: qualityByTarget[effect.target], p10: round(qualityByTarget[effect.target] - (effect.target === "sulfur" ? 0.7 : effect.target === "t95" ? 1.8 : 0.5)), p90: round(qualityByTarget[effect.target] + (effect.target === "sulfur" ? 0.7 : effect.target === "t95" ? 1.8 : 0.5)) }));
  result.agentsTrace = agentTrace(id);
  if (!item.complete) result.status = "running";
  return result;
}
export function agentTrace(id: string): AgentStep[] {
  const run = getMockRun(id);
  const profile = profileFor(run?.kind ?? "normal");
  const notes = [
    "Проверены источники и флаги качества",
    "Рассчитаны интервалы качества",
    "Проверены ограничения оборудования",
    "Сопоставлены допустимые варианты",
    "Сформировано итоговое решение",
  ];
  const roles = [
    "data",
    "quality",
    "reliability",
    "optimization",
    "orchestrator",
  ] as const;
  return roles.map((agentRole, stepIdx) => ({
    runId: id,
    stepIdx,
    agentRole,
    startedAt: new Date(
      Date.parse(run?.tPoint ?? state.tPoint) + stepIdx * 1100,
    ).toISOString(),
    finishedAt: new Date(
      Date.parse(run?.tPoint ?? state.tPoint) + stepIdx * 1100 + 900,
    ).toISOString(),
    durationMs: 900,
    inputDigest: "9f2a1c4e8b7d0f31",
    inputSummary: { tPoint: run?.tPoint, kind: run?.kind },
    output:
      agentRole === "quality"
        ? { sulfur: { p50: profile.quality.sulfur, p10: round(profile.quality.sulfur - 0.7), p90: round(profile.quality.sulfur + 0.7) } }
        : agentRole === "data"
          ? { freshness: report(id, run?.kind ?? "normal").freshness }
          : { passed: run?.kind !== "bad_data" },
    notes: [notes[stepIdx] ?? "Проверка завершена"],
    numberRefs:
      agentRole === "quality"
        ? [
            {
              path: "sulfur.p50",
              value: profile.quality.sulfur,
              unit: "мг/кг",
              label: "Прогноз серы",
            },
          ]
        : [],
    confidence: 0.78,
  }));
}
function delay<T>(value: T, signal?: AbortSignal, ms = 150): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve(structuredClone(value));
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
const round = (n: number) => Number(n.toFixed(2));
function evaluate(req: WhatifRequest): WhatifResponse {
  if (req.variants.length > 8)
    throw new ApiError(400, "too_many_variants", "Не более 8 вариантов");
  const profile = profileFor(activeKind);
  const variants = (req.variants.length ? req.variants : [req.overrides]).map(
    (changes) => {
      const overrides = { ...req.overrides, ...changes };
      const allowed = new Set(controlledVariables.map((v) => v.key));
      for (const [key, value] of Object.entries(overrides))
        if (!allowed.has(key) || !Number.isFinite(value))
          throw new ApiError(
            400,
            "unmanaged_override",
            `Неуправляемый или некорректный параметр: ${key}`,
          );
      const baseline = profile.controls;
      const p8 = baseline["24-2000.P8"] ?? 0;
      const t11 = baseline["24-2000.T11"] ?? 0;
      const f19 = baseline["24-2000.F19"] ?? 0;
      const baseAdditive = baseline.blend_additive_pct ?? 0;
      const baseKerosene = baseline.blend_share_kerosene ?? 0;
      const baseGasoil = baseline.blend_share_gasoil ?? 0;
      const delta = (overrides["24-2000.P8"] ?? p8) - p8;
      const additive = overrides.blend_additive_pct ?? baseAdditive;
      const kerosene = overrides.blend_share_kerosene ?? baseKerosene;
      const gasoil = overrides.blend_share_gasoil ?? baseGasoil;
      const sulfur = round(
        profile.quality.sulfur +
          // Expert sensitivity: raising the reactor inlet temperature lowers
          // sulfur by about 0.3 mg/kg per °C.
          delta * -0.3 +
          ((overrides["24-2000.T11"] ?? t11) - t11) * 0.004 -
          ((overrides["24-2000.F19"] ?? f19) - f19) * 0.8,
      );
      const t95 = round(
        profile.quality.t95 - delta * 0.7 + (gasoil - baseGasoil) * 25 - (kerosene - baseKerosene) * 18,
      );
      const cetane = round(profile.quality.cetane + (additive - baseAdditive) * 0.75 - (kerosene - baseKerosene) * 5);
      const quality = [
        {
          target: "sulfur" as const,
          p10: round(sulfur - 0.7),
          p50: sulfur,
          p90: round(sulfur + 0.7),
          specRisk: round(Math.min(1, Math.max(0, (sulfur - 8.8) / 2))),
          unit: "мг/кг",
        },
        {
          target: "t95" as const,
          p10: round(t95 - 1.8),
          p50: t95,
          p90: round(t95 + 1.8),
          specRisk: t95 + 1.8 > 360 ? 0.7 : 0.05,
          unit: "°C",
        },
        {
          target: "cetane" as const,
          p10: round(cetane - 0.5),
          p50: cetane,
          p90: round(cetane + 0.5),
          specRisk: cetane - 0.5 < 51 ? 0.45 : 0.04,
          unit: "пункт",
        },
      ];
      const violations: string[] = [];
      if (sulfur + 0.7 > 10)
        violations.push("sulfur_max: верхняя граница серы > 10 мг/кг");
      if (t95 + 1.8 > 360)
        violations.push("t95_max: верхняя граница T95 > 360 °C");
      if (cetane - 0.5 < 51)
        violations.push("cetane_min_summer: нижняя граница ЦЧ < 51");
      if (additive < 0 || additive > 3)
        violations.push(
          "blend_additive_pct: присадка должна быть в пределах 0–3 %",
        );
      if (kerosene < 0 || gasoil < 0 || kerosene + gasoil > 1)
        violations.push("blend_shares: сумма долей должна быть равна 1");
      return {
        overrides,
        quality,
        costIndex: round(1 + Math.abs(delta) * 0.03 + additive * 0.2),
        feasible: violations.length === 0,
        violations,
      };
    },
  );
  const baselineQuality = [
    { target: "sulfur" as const, p10: round(profile.quality.sulfur - 0.7), p50: profile.quality.sulfur, p90: round(profile.quality.sulfur + 0.7), specRisk: round(Math.min(1, Math.max(0, (profile.quality.sulfur - 8.8) / 2))), unit: "мг/кг" },
    { target: "t95" as const, p10: round(profile.quality.t95 - 1.8), p50: profile.quality.t95, p90: round(profile.quality.t95 + 1.8), specRisk: profile.quality.t95 + 1.8 > 360 ? 0.7 : 0.05, unit: "°C" },
    { target: "cetane" as const, p10: round(profile.quality.cetane - 0.5), p50: profile.quality.cetane, p90: round(profile.quality.cetane + 0.5), specRisk: profile.quality.cetane - 0.5 < 51 ? 0.45 : 0.04, unit: "пункт" },
  ];
  return { ...whatifResult, tPoint: req.tPoint, baseline: baselineQuality, variants };
}
function snapshot(
  params: { tPoint?: string; tags?: string[] },
  kind: ScenarioKind = activeKind,
): StateResponse {
  const profile = profileFor(kind);
  const tPoint =
    params.tPoint ??
    scenarioCatalog.find((p) => p.kind === kind)?.tPoint ??
    state.tPoint;
  const tags: TagPoint[] = controlledVariables.map((v) => ({
    tagCode: v.key,
    ts: tPoint,
    value: profile.controls[v.key] ?? v.current ?? null,
    qualityFlag: "ok",
    source: "kip",
    unit: v.unit,
  }));
  const extraUnits: Record<string, string> = { Q21: "мг/кг", T5: "°C", T6: "°C", T55: "°C", F65: "т/ч", W70: "%", P22: "МПа", P13: "МПа", F26: "м³/ч", T18: "°C", Q20: "мг/кг", W4: "%", W10: "%", pak_sulfur: "мг/кг", pak_d15: "кг/м³", lims_sulfur: "мг/кг", lims_cetane: "пункт", blend_cetane: "пункт", blend_t95: "°C" };
  const extra: [string, number | null, string][] = Object.keys(extraUnits).map((tag) => [tag, profile.extras[tag] ?? null, extraUnits[tag] ?? ""]);
  if (kind === "bad_data") extra.push(["D10", null, "кг/м³"]);
  tags.push(
    ...extra.map(([tagCode, value, unit]) => ({
      tagCode,
      ts: tPoint,
      value,
      unit,
      qualityFlag: value === null ? ("missing" as const) : ("ok" as const),
      source: "kip" as const,
    })),
  );
  if (kind === "bad_data")
    for (const tag of tags)
      if (
        ["D10", "Q20", "Q21", "T18", "F26", "W4", "W10"].includes(tag.tagCode)
      ) {
        tag.value = null;
        tag.qualityFlag = ["T18", "F26"].includes(tag.tagCode)
          ? "stuck"
          : "sentinel";
      }
  const freshness: StateResponse["freshness"] = [
    {
      pointId: "hdu_product_sulfur",
      source: "lims",
      lastSampleTs: tPoint,
      availableTs: tPoint,
      // Age is measured from sampling. Four hours later the LIMS result becomes
      // available, so this sample is usable at tPoint without future leakage.
      ageHours: profile.freshness.limsAgeHours,
      status: profile.freshness.limsAgeHours === null ? "missing" : profile.freshness.limsAgeHours > 52 ? "stale" : profile.freshness.limsAgeHours > 28 ? "warn" : "ok",
      warnAfterH: 28,
      staleAfterH: 52,
    },
    {
      pointId: "blend_product_cn",
      source: "pak",
      lastSampleTs: tPoint,
      availableTs: tPoint,
      ageHours: profile.freshness.pakAgeHours,
      status: profile.freshness.pakAgeHours === null ? "missing" : profile.freshness.pakAgeHours > 52 ? "stale" : profile.freshness.pakAgeHours > 28 ? "warn" : "ok",
      warnAfterH: 28,
      staleAfterH: 52,
    },
    {
      pointId: "hdu_product_d15",
      source: "pak",
      lastSampleTs: tPoint,
      availableTs: tPoint,
      ageHours: profile.freshness.d15AgeHours,
      status: profile.freshness.d15AgeHours === null ? "missing" : profile.freshness.d15AgeHours > 52 ? "stale" : profile.freshness.d15AgeHours > 28 ? "warn" : "ok",
      warnAfterH: 28,
      staleAfterH: 52,
    },
    {
      pointId: "blend_product_cetane",
      source: "lims",
      lastSampleTs: null,
      availableTs: null,
      ageHours: null,
      status: "missing",
      warnAfterH: 28,
      staleAfterH: 52,
    },
    {
      pointId: "virtual_quality",
      source: "vak",
      lastSampleTs: tPoint,
      availableTs: tPoint,
      ageHours: 0.1,
      status: "ok",
      warnAfterH: 28,
      staleAfterH: 52,
    },
    {
      pointId: "telemetry",
      source: "kip",
      lastSampleTs: tPoint,
      availableTs: tPoint,
      ageHours: 0.1,
      status: "ok",
      warnAfterH: 28,
      staleAfterH: 52,
    },
  ];
  if (kind === "stale_lims") {
    const lims = freshness[0];
    if (lims) {
      lims.ageHours = 54;
      lims.status = "stale";
    }
  }
  if (kind === "bad_data") {
    const pak = freshness[1];
    if (pak) {
      pak.ageHours = null;
      pak.lastSampleTs = null;
      pak.availableTs = null;
      pak.status = "missing";
    }
  }
  for (const item of freshness) {
    if (item.ageHours !== null) {
      item.lastSampleTs = new Date(
        Date.parse(tPoint) - item.ageHours * 3600000,
      ).toISOString();
      item.availableTs = item.source === "lims"
        ? new Date(Date.parse(item.lastSampleTs) + 4 * 3600000).toISOString()
        : item.lastSampleTs;
    }
  }
  const history: TagPoint[] = tags.flatMap((tag) => {
    const source: TagPoint["source"] = tag.tagCode.startsWith("lims_")
      ? "lims"
      : tag.tagCode.startsWith("pak_")
        ? "pak"
        : tag.tagCode.startsWith("blend_")
          ? "vak"
          : tag.source;
    const indexes =
      source === "lims"
        ? [5, 29, 47]
        : telemetrySamples.map((_, index) => index);
    return indexes.map((index) => {
      const sample = telemetrySamples[index] ?? 0;
      const wasMasked = tag.value === null;
      const inGap =
        kind === "bad_data" &&
        wasMasked &&
        ((index >= 15 && index <= 28) || index >= 43);
      const base = tag.value;
      return {
        ...tag,
        source,
        ts: new Date(Date.parse(tPoint) - (47 - index) * 600000).toISOString(),
        value:
          inGap || base === null
            ? null
            : round(base + sample * profile.variation * (Math.abs(base) > 100 ? 3 : 0.5)),
        qualityFlag: inGap || base === null ? tag.qualityFlag : ("ok" as const),
      };
    });
  });
  const lastComplete = [...runs]
    .reverse()
    .find(([, item]) => item.complete && item.draft.kind === kind);
  return {
    tPoint,
    tags: params.tags?.length
      ? history.filter((t) => params.tags?.includes(t.tagCode))
      : history,
    freshness,
    ...(lastComplete
      ? {
          lastRun: {
            runId: lastComplete[0],
            decision:
              lastComplete[1].draft.kind === "bad_data" ||
              lastComplete[1].draft.kind === "stale_lims"
                ? ("refuse" as const)
                : ("recommend" as const),
          },
        }
      : {}),
  };
}
export const mockApi = {
  getHealth: (signal?: AbortSignal): Promise<HealthResponse> =>
    delay(health, signal),
  getScenarios: (signal?: AbortSignal): Promise<ScenarioPreset[]> =>
    delay(scenarioCatalog, signal),
  getControlledVariables: (
    signal?: AbortSignal,
  ): Promise<ControlledVariable[]> => delay(controlledVariables, signal),
  getState: (
    params: { tPoint?: string; tags?: string[] } = {},
    signal?: AbortSignal,
  ): Promise<StateResponse> => delay(snapshot(params), signal),
  createRun: async (
    draft: ScenarioDraft,
    signal?: AbortSignal,
  ): Promise<RunCreated> => {
    const runId = `mock-${draft.kind}-${++n}`;
    runs.set(runId, {
      draft,
      createdAt: new Date().toISOString(),
      complete: false,
    });
    save();
    return delay(
      { runId, status: "started", eventsUrl: `/api/runs/${runId}/events` },
      signal,
    );
  },
  getRuns: (signal?: AbortSignal): Promise<RunSummary[]> =>
    delay(
      [...runs].reverse().map(([runId, item]) => ({
        runId,
        createdAt: item.createdAt,
        kind: item.draft.kind,
        tPoint: item.draft.tPoint,
        status: item.complete
          ? item.draft.kind === "bad_data" || item.draft.kind === "stale_lims"
            ? "refused"
            : "completed"
          : "running",
        decision: item.complete
          ? item.draft.kind === "bad_data" || item.draft.kind === "stale_lims"
            ? "refuse"
            : "recommend"
          : null,
      })),
      signal,
    ),
  getRun: (id: string, signal?: AbortSignal): Promise<RunReport> =>
    delay(mockReport(id), signal),
  getReport: async (
    id: string,
    format: "json" | "md",
    signal?: AbortSignal,
  ): Promise<Response> => {
    const result = await delay(mockReport(id), signal);
    return new Response(
      format === "json"
        ? JSON.stringify(result, null, 2)
        : `# Refinery Copilot — ${id}\n\n${result.recommendation.explanation}\n\n## Сценарий\n${JSON.stringify(result.scenario, null, 2)}\n\n## Рекомендация\n${JSON.stringify(result.recommendation, null, 2)}`,
      {
        headers: {
          "Content-Type":
            format === "json" ? "application/json" : "text/markdown",
        },
      },
    );
  },
  whatif: (req: WhatifRequest, signal?: AbortSignal): Promise<WhatifResponse> =>
    delay(evaluate(req), signal, 25),
  getModels: (signal?: AbortSignal): Promise<ModelArtifact[]> =>
    delay(models, signal),
};

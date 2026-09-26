import type {
  HealthResponse,
  ModelArtifact,
  RunCreated,
  RunReport,
  RunSummary,
  ScenarioDraft,
  StateResponse,
  WhatifRequest,
  WhatifResponse,
  ScenarioPreset,
  ControlledVariable,
} from "@/types";
import { request, requestFile } from '@/services/http';

export { ApiError } from '@/services/http';
export const getHealth = (signal?: AbortSignal) =>
  request<HealthResponse>("/health", { signal });
export const getState = (
  p: { tPoint?: string; tags?: string[] } = {},
  signal?: AbortSignal,
) => {
  const q = new URLSearchParams();
  if (p.tPoint) q.set("tPoint", p.tPoint);
  if (p.tags?.length) q.set("tags", p.tags.join(","));
  return request<StateResponse>(`/state?${q}`, { signal });
};
export const createRun = (draft: ScenarioDraft, signal?: AbortSignal) =>
  request<RunCreated>("/runs", {
    method: "POST",
    body: JSON.stringify(draft),
    signal,
  });
export const getRuns = (signal?: AbortSignal) =>
  request<RunSummary[]>("/runs", { signal });
export const getRun = (id: string, signal?: AbortSignal) =>
  request<RunReport>(`/runs/${id}`, { signal });
export const getReport = async (
  id: string,
  format: "json" | "md",
  signal?: AbortSignal,
) => {
  return requestFile(`/runs/${id}/report.${format}`, { signal });
};
type BackendWhatif = WhatifResponse | {
  tPoint: string;
  elapsedMs?: number;
  baseline?: { sulfur?: { p10: number; p50: number; p90: number } };
  variant?: { sulfur?: { p10: number; p50: number; p90: number } };
  feasible?: boolean;
  costIndex?: number;
  violations?: string[];
};

type LegacySulfur = { p10: number; p50: number; p90: number };

function isWhatifResponse(value: BackendWhatif): value is WhatifResponse {
  const response = value as WhatifResponse;
  return Array.isArray(response.baseline) && Array.isArray(response.variants);
}

function legacyQuality(point: LegacySulfur | undefined) {
  const p10 = point?.p10 ?? 0;
  const p50 = point?.p50 ?? 0;
  const p90 = point?.p90 ?? 0;
  return {
    target: "sulfur" as const,
    p10,
    p50,
    p90,
    specRisk: Math.min(1, Math.max(0, (p90 - 8.8) / 2)),
    unit: "мг/кг",
  };
}

function normalizeWhatif(value: BackendWhatif, requestBody: WhatifRequest): WhatifResponse {
  if (isWhatifResponse(value)) return value;

  const baseline = [legacyQuality(value.baseline?.sulfur)];
  const variant = [legacyQuality(value.variant?.sulfur)];
  return {
    tPoint: value.tPoint,
    elapsedMs: value.elapsedMs ?? 0,
    baseline,
    variants: [{
      overrides: requestBody.overrides,
      quality: variant,
      costIndex: value.costIndex ?? 0,
      feasible: value.feasible ?? true,
      violations: value.violations ?? [],
    }],
  };
}

export const whatif = async (req: WhatifRequest, signal?: AbortSignal): Promise<WhatifResponse> => {
  const result = await request<BackendWhatif>("/whatif", {
    method: "POST",
    body: JSON.stringify(req),
    timeoutMs: 5000,
    signal,
  });
  return normalizeWhatif(result, req);
};
export const getModels = (signal?: AbortSignal) =>
  request<ModelArtifact[]>("/models", { signal });
export const getScenarios = (signal?: AbortSignal) =>
  request<ScenarioPreset[]>("/scenarios", { signal });
export const getControlledVariables = (signal?: AbortSignal) =>
  request<ControlledVariable[]>("/controlled-variables", { signal });

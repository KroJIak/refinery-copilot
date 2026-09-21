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
import { API_BASE as baseUrl } from "@/config/env";
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export async function request<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 15000, ...options } = init;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
    });
    if (!res.ok) {
      let body: {
        error?: {
          code?: string;
          message?: string;
          details?: Record<string, unknown>;
        };
      } = {};
      try {
        body = await res.json();
      } catch {
        body = {};
      }
      throw new ApiError(
        res.status,
        body.error?.code ?? "http_error",
        body.error?.message ?? res.statusText,
        body.error?.details ?? {},
      );
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
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
  const res = await fetch(`${baseUrl}/runs/${id}/report.${format}`, { signal });
  if (!res.ok)
    throw new ApiError(res.status, "report_unavailable", "Отчёт недоступен");
  return res;
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

function normalizeWhatif(value: BackendWhatif, requestBody: WhatifRequest): WhatifResponse {
  if (Array.isArray((value as WhatifResponse).baseline) && Array.isArray((value as WhatifResponse).variants)) return value as WhatifResponse;
  const legacy = value as Exclude<BackendWhatif, WhatifResponse>;
  const toQuality = (point: { p10: number; p50: number; p90: number } | undefined) => {
    const p10 = point?.p10 ?? 0;
    const p50 = point?.p50 ?? 0;
    const p90 = point?.p90 ?? 0;
    return { target: "sulfur" as const, p10, p50, p90, specRisk: Math.min(1, Math.max(0, (p90 - 8.8) / 2)), unit: "мг/кг" };
  };
  const baseline = [toQuality(legacy.baseline?.sulfur)];
  const variant = [toQuality(legacy.variant?.sulfur)];
  return { tPoint: value.tPoint, elapsedMs: value.elapsedMs ?? 0, baseline, variants: [{ overrides: requestBody.overrides, quality: variant, costIndex: legacy.costIndex ?? 0, feasible: legacy.feasible ?? true, violations: legacy.violations ?? [] }] };
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

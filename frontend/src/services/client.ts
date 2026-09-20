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
export const whatif = (req: WhatifRequest, signal?: AbortSignal) =>
  request<WhatifResponse>("/whatif", {
    method: "POST",
    body: JSON.stringify(req),
    timeoutMs: 5000,
    signal,
  });
export const getModels = (signal?: AbortSignal) =>
  request<ModelArtifact[]>("/models", { signal });
export const getScenarios = (signal?: AbortSignal) =>
  request<ScenarioPreset[]>("/scenarios", { signal });
export const getControlledVariables = (signal?: AbortSignal) =>
  request<ControlledVariable[]>("/controlled-variables", { signal });

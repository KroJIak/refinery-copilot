import { API_BASE } from '@/config/env';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type ApiErrorPayload = {
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
};

type ApiErrorBody = {
  error?: ApiErrorPayload;
  detail?: ApiErrorPayload | { error?: ApiErrorPayload };
};

function errorDetails(body: ApiErrorBody): ApiErrorPayload | undefined {
  if (body.error) return body.error;
  if (!body.detail) return undefined;
  if ('error' in body.detail) return body.detail.error;
  return body.detail as ApiErrorPayload;
}

async function parseError(response: Response): Promise<ApiError> {
  let body: ApiErrorBody = {};
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    // HTTP status remains sufficient when the server has no JSON error body.
  }
  const error = errorDetails(body);
  return new ApiError(
    response.status,
    error?.code ?? 'http_error',
    error?.message ?? response.statusText,
    error?.details ?? {},
  );
}

export async function request<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 15_000, signal, ...options } = init;
  const controller = new AbortController();
  const abort = () => controller.abort();

  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = window.setTimeout(abort, timeoutMs);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    });
    if (!response.ok) throw await parseError(response);
    return (await response.json()) as T;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export async function requestFile(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) throw await parseError(response);
  return response;
}

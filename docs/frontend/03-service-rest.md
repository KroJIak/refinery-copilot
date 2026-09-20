---
title: "frontend — REST-клиент"
tags: [refinery-copilot, frontend, rest, fetch, p1]
related:
  - "[[frontend/00-OVERVIEW]]"
  - "[[01-p1-rest-sse]]"
  - "[[02-types]]"
  - "[[05-mocks]]"
  - "[[06-state]]"
created: 2026-09-19
---

# 03 — REST-клиент (`src/services/client.ts`)

Тонкая fetch-обёртка над P1: без состояния, без бизнес-логики, все ответы типизированы из
[[02-types]]. Единственный потребитель клиента — стор ([[06-state]]) и мок-адаптер ([[05-mocks]]);
страницы клиента не импортируют (правило 1 [[frontend/00-OVERVIEW]]).

## Scope

Содержит: базовый URL, конфигурацию fetch (таймауты, abort), формат ошибки [[01-p1-rest-sse]] и
типизированное исключение, сигнатуры всех функций REST (getState/createRun/getRun/getRuns/
getReport/whatif/getModels/getHealth) и их маппинг в типы. НЕ содержит: SSE ([[04-service-sse]]),
кэширования (это стор), рендера, обработки бизнес-кодов вроде `models_not_loaded` на уровне UI.

## База и конфигурация

- `baseUrl = import.meta.env.VITE_API_BASE ?? '/api'`; в dev — proxy Vite, в проде — nginx (P7).
- Все запросы: `Content-Type: application/json`, время ISO 8601 UTC, кодировка UTF-8.
- Таймаут по умолчанию 15 с (whatif — 5 с: SLA ответа < 50 мс на сервере, [[01-p1-rest-sse]]).
- Каждый вызов принимает `AbortSignal` — отмену инициирует вызывающий (стор/React).

```ts
// src/api/errors.ts
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,      // из error.code, напр. 'models_not_loaded'
    message: string,                   // из error.message
    public readonly details: Record<string, unknown>,  // из error.details
  ) { super(message); }
}
```

> [!info] Формат тела ошибки ([[01-p1-rest-sse]] §2.1)
> Любой 4xx/5xx: `{"error": {"code": "...", "message": "...", "details": {...}}}`.
> Коды: `400` — неизвестный `kind` / неуправляемый override / > 8 вариантов what-if;
> `422` — ошибка pydantic-валидации; `404` — прогон/отчёт не найден; `500` — внутренняя;
> `503` — `models_not_loaded`, `data_missing` (registry пуст, parquet не найден).
> Клиент выбрасывает `ApiError` для любого статуса ≥ 400; сеть/таймаут — отдельный `NetworkError`.

```ts
// src/api/request.ts — внутренняя утилита, не экспортируется наружу
export async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T>;
```

## Функции клиента

```ts
// src/services/client.ts — все сигнатуры; возвращаемые типы из [[02-types]]
export function getHealth(signal?: AbortSignal): Promise<HealthResponse>;

export function getState(params: { tPoint?: string; tags?: string[] },
                         signal?: AbortSignal): Promise<StateResponse>;
// ?tPoint=ISO&tags=P8,T11 → {tPoint, tags: TagPoint[], freshness, lastRun?}

export function createRun(draft: ScenarioDraft, signal?: AbortSignal): Promise<RunCreated>;
// POST /api/runs → 202 {runId, status: 'started', eventsUrl}
// Далее события прогона читает ТОЛЬКО [[04-service-sse]] по eventsUrl.

export function getRuns(signal?: AbortSignal): Promise<RunSummary[]>;

export function getRun(runId: string, signal?: AbortSignal): Promise<RunReport>;

export function getReport(runId: string, format: 'json' | 'md',
                          signal?: AbortSignal): Promise<Response>;
// 'json' → RunReport (blob для скачивания), 'md' → text/markdown.
// Экспорт: браузер сохраняет файл напрямую, в стор не попадает.

export function whatif(req: WhatifRequest, signal?: AbortSignal): Promise<WhatifResponse>;
// WhatifRequest = {tPoint: string; overrides: Record<string, number>;
//                  variants: Record<string, number>[] /* ≤ 8, иначе 400 */}

export function getModels(signal?: AbortSignal): Promise<ModelArtifact[]>;
```

## Маппинг эндпоинтов → типов

| Метод и путь ([[01-p1-rest-sse]]) | Функция | Ответ | Ошибки |
| --- | --- | --- | --- |
| `GET /api/health` | `getHealth` | `HealthResponse` | — |
| `GET /api/state` | `getState` | `StateResponse` | 400, 503 |
| `POST /api/runs` | `createRun` | 202 `RunCreated` | 400, 503 |
| `GET /api/runs` | `getRuns` | `RunSummary[]` | — |
| `GET /api/runs/{run_id}` | `getRun` | `RunReport` | 404 |
| `GET /api/runs/{run_id}/report.{json,md}` | `getReport` | файл | 404 |
| `GET /api/runs/{run_id}/events` | **не здесь** — [[04-service-sse]] | SSE-стрим | 404 |
| `POST /api/whatif` | `whatif` | `WhatifResponse` | 400, 503 |
| `GET /api/models` | `getModels` | `ModelArtifact[]` | 503 |

Числовые поля ответов (`elapsedMs`, `p10/p50/p90`, `specRisk`, `costIndex`, `coverage`) —
потребительские значения из контракта; никаких констант домена в клиенте нет (правило 2
[[frontend/00-OVERVIEW]]).

## Правила клиента

> [!warning] Дизайн REST-слоя
> 1. Функции **чистые**: никакой памяти между вызовами — кэш и статус-машина живут в [[06-state]].
> 2. Один запрос = один `request<T>()`; ретраи на транспортном уровне не делаются (кроме
>    отрисовки ошибки в UI); ретраи SSE — в [[04-service-sse]].
> 3. `ApiError.code` — единственный дискриминатор для UI-логики (`models_not_loaded` → баннер
>    «модели не загружены», 404 → «прогон не найден»); парсить `message` текстом запрещено.
> 4. Тело ошибки не парсится в объекты домена — только в `ApiError` (`details` остаётся opaque).
> 5. Все параметры запроса — `camelCase` в query (`?tPoint=…&tags=…`) — как в примерах P1.

## Обработка ошибок: код → поведение UI

Клиент только выбрасывает `ApiError`; интерпретация — за стором/страницами. Справочник решений:

| `ApiError.status` / `code` | Типичный источник | Поведение UI |
| --- | --- | --- |
| 400 (unknown kind) | `createRun` с некорректным пресетом | баннер у кнопки запуска, сценарий не стартует |
| 400 (> 8 вариантов) | `whatif` | тост «максимум 8 вариантов», лишние отсекаются до запроса ([[06-state]]) |
| 422 | ошибка pydantic-валидации | подсветка конкретного поля из `details` |
| 404 | `getRun`/`getReport` несуществующего id | «прогон не найден» + возврат к списку прогонов |
| 500 | внутренняя ошибка | тост с `message`, без ретрая |
| 503 `models_not_loaded` | `createRun`/`whatif`/`getModels` | баннер «модели не загружены», повтор после `getHealth` |
| 503 `data_missing` | `getState` | баннер «данные недоступны», светофоры в статусе `missing` |
| NetworkError (таймаут/офлайн) | любой | статус `error` среза, кнопка «повторить» |

## Примеры вызовов (как это выглядит в коде)

```ts
// стор: загрузка состояния
try {
  const state = await api.getState({ tPoint, tags: ['P8', 'T11'] });
  set({ tPoint: state.tPoint, tags: state.tags, freshness: state.freshness });
} catch (e) {
  if (e instanceof ApiError && e.code === 'data_missing') { /* баннер 503 */ }
  throw e;
}

// компонент: экспорт отчёта (файл напрямую, мимо стора)
const res = await api.getReport(runId, 'md', signal);
const blob = await res.blob();
// → ссылка <a download={runId + '.md'} href={URL.createObjectURL(blob)}>
```

## Отмена и таймауты

- Каждая функция принимает `signal?: AbortSignal`; источник сигнала — вызывающий код
  (`AbortController` в useEffect страницы/стора). Таймаут по умолчанию реализуется в
  `request<T>()` через `AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])`.
- Таймауты по операциям: default 15 с; `whatif` 5 с (SLA сервера < 50 мс — долгий ответ = ошибка);
  `getReport` 30 с (файл); SSE вне этого клиента ([[04-service-sse]]).
- Повторные вызовы `getState` со теми же параметрами не дедуплицируются клиентом —
  частота запросов регулируется стором ([[06-state]]), это сознательное разделение ответственности.

## Переключение на моки

Клиент не знает о моках: выбор точки входа делает `src/mocks/index.ts` ([[05-mocks]]) — при
`VITE_USE_MOCKS=true` экспортируется тот же набор функций, но читающий фикстуры
из [[90-examples-and-mocks]]. Стор ([[06-state]]) импортирует «клиент» безусловно и не
проверяет флаг сам.

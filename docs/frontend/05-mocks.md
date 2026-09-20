---
title: "frontend — моки и мок-SSE"
tags: [refinery-copilot, frontend, mocks, fixtures, sse]
related:
  - "[[frontend/00-OVERVIEW]]"
  - "[[01-project-setup]]"
  - "[[03-service-rest]]"
  - "[[04-service-sse]]"
  - "[[90-examples-and-mocks]]"
  - "[[06-state]]"
created: 2026-09-19
---

# 05 — Моки и мок-SSE (`src/mocks/`)

Мок-режим — условие приёмки домена: `VITE_USE_MOCKS=true` поднимает всё приложение без backend
(правило 3 [[frontend/00-OVERVIEW]]). Источник фикстур — [[90-examples-and-mocks]]:
JSON-примеры всех REST-ответов и SSE-событий + 5 демо-сценариев.

## Scope

Содержит: каталог фикстур, mock-адаптер REST (тот же интерфейс, что [[03-service-rest]]),
мок-SSE-симулятор конвейера агентов с таймлайном ([[04-service-sse]], тот же интерфейс),
переключатель `VITE_USE_MOCKS`, три сценария прогона: успех / отказ / ошибка.
НЕ содержит: реальных вызовов сети, логики стор ([[06-state]]), правок канонических примеров.

## Каталог

```text
src/mocks/
├── fixtures/                    # формы A.7/A.4 из [[90-examples-and-mocks]]; типизированы satisfies
│   ├── normal.json              # сценарий normal → рекомендация (recommend)
│   ├── quality_risk.json           # сценарий quality_risk → рекомендация у границы серы
│   ├── bad_data.json            # сценарий bad_data → warn-логи, заливания, refusal по sensor_fault
│   ├── sour_crude.json          # сценарий sour_crude → рекомендация с активной оптимизацией
│   ├── refusal.json             # сценарий stale_lims → штатный отказ (RefusalReason)
│   ├── state.json               # GET /api/state: TagPoint[] + DataFreshness[] + lastRun
│   ├── models.json              # GET /api/models: ModelArtifact[]
│   ├── whatif.json              # POST /api/whatif: WhatifResponse (baseline + варианты)
│   └── health.json              # GET /api/health
├── mockRest.ts                  # мок-адаптер REST
├── mockSse.ts                   # мок-SSE-симулятор
└── index.ts                     # выбор реализации по VITE_USE_MOCKS
```

Каждая фикстура объявляется с `satisfies RunReport` / `satisfies Recommendation` и т.д. —
несоответствие контракту ломает сборку (чек-лист 4 в [[02-types]]).

## Переключатель

```ts
// src/mocks/index.ts
export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true';
export const api = USE_MOCKS ? mockApi : liveApi;   // оба реализуют один набор функций [[03-service-rest]] + [[04-service-sse]]
```

Стор ([[06-state]]) импортирует `api` из `@/mocks` и не проверяет флаг; флаг читается ровно в
одном месте. `npm run dev:mock` ([[01-project-setup]]) включает флаг без правки `.env`.

## Mock-адаптер REST

Мок-функции повторяют сигнатуры [[03-service-rest]] 1:1, читают фикстуры и добавляют
детерминированную имитацию:

```ts
export const mockApi = {
  getHealth(): Promise<HealthResponse>;                        // fixtures/health.json
  getState(p: { tPoint?: string; tags?: string[] }): Promise<StateResponse>;   // state.json (+фильтр tags)
  createRun(draft: ScenarioDraft): Promise<RunCreated>;        // runId = `mock-${kind}-${n}`,
                                                               // сразу готовит таймлайн для mockSse
  getRuns(): Promise<RunSummary[]>;                            // по запущенным мок-прогонам сессии
  getRun(runId: string): Promise<RunReport>;                   // финальный отчёт фикстуры сценария
  getReport(runId: string, format: 'json' | 'md'): Promise<Response>;  // Blob из той же фикстуры
  whatif(req: WhatifRequest): Promise<WhatifResponse>;         // whatif.json + сдвиг p50 по overrides
  getModels(): Promise<ModelArtifact[]>;                       // models.json
};
```

Имитация: искусственная задержка 100–400 мс (настраивается константой) — чтобы спиннеры и
скелетоны были видны; `whatif` отвечает < 50 мс, как SLA реального бекенда. Ошибки 4xx/5xx
эмулируются тем же `ApiError` ([[03-service-rest]]) — например, `overrides` неуправляемого тега
→ `ApiError(400, ...)`.

## Мок-SSE-симулятор

Тот же контракт, что реальный клиент: `subscribeRunEvents({url, handlers, signal})`, события
с `id` (монотонный seq), паузы по таймлайну. `mockSse` играет сценарий, выбранный `kind`
фикстуры, и игнорирует параметр `url` (кроме распознавания `runId`).

Таймлайн сценария **успех** (`normal` / `quality_risk` / `sour_crude`):

| t, c | Событие | Содержание |
| --- | --- | --- |
| 0.0 | `run_started` | `{runId, status:'running', kind, tPoint, seed:42}` |
| 0.2 | `agent_started` | stepIdx 0, role `data` |
| 0.9 | `log` | `warn`: «D10 мёртв (99,99 % сентинелов)» |
| 1.4 | `agent_finished` | полный `AgentStep` с `output`/`numberRefs` |
| 1.6–5.0 | цикл ×3 | `quality` → `reliability` → `optimization` (started/step/finished) |
| 5.4 | `step` | топ-вариантов от `optimization` (payload-объект) |
| 6.0 | `recommendation` | карточка из фикстуры, `decision:'recommend'` |
| 6.2 | `run_finished` | `{status:'completed', durationMs: 6200, reportUrl}` → поток закрыт |

Между событиями каждые ~15 с симулятор печатает комментарий-сердцебиение (соблюдает контракт [[04-service-sse]]).
Тайминги — константа `TIMELINE_MS`, суммарно ~6 с на прогон (достаточно для демо и приёмки «live-обновление видно»).

Таймлайн **отказа** (`stale_lims` / `bad_data`) — тот же конвейер до `optimization`, далее:

| t, c | Событие | Содержание |
| --- | --- | --- |
| 0.0–5.0 | как в сценарии успеха | `data` отдаёт freshness `stale`/`missing` (фикстура) |
| 5.6 | `step` | «допустимых вариантов нет» (payload от `optimization`) |
| 6.0 | `refusal` | карточка `decision:'refuse'`, `refusal.reasons = ['stale_lims','wide_interval']` |
| 6.2 | `run_finished` | `{status:'refused', durationMs, reportUrl}` |

Таймлайн **ошибки** (флаг `MOCK_FAIL_RUN=true` или отдельный пресет): `run_started` →
`agent_started`×3 → `run_failed` `{errorCode:'models_not_loaded', message, durationMs}` на ~3 с.

```ts
// src/mocks/mockSse.ts — сигнатура (совпадает с [[04-service-sse]])
export function subscribeRunEvents(source: SseSource): () => void;
// источник событий — таймлайн фикстуры сценария, выбранного по kind в createRun;
// signal из source отменяет проигрывание; экспорт DEFAULT для src/mocks/index.ts
```

## Сценарии мока

| Сценарий | kind | Исход | Что проверяет UI |
| --- | --- | --- | --- |
| Успех | `normal`, `quality_risk`, `sour_crude` | `recommend`: actions/effects/checks/confidence заполнены, `refusal: null` | карточка рекомендации, Парето-альтернативы, экспорт |
| Отказ | `stale_lims` (+ `bad_data`) | `refuse`: `refusal.reasons = ['stale_lims','wide_interval']` (+ `sensor_fault` в bad_data), details[] заполнены | refusal-блок карточки, светофоры freshness `stale`/`missing` |
| Ошибка | любой + флаг | `run_failed` после `agent_started` (например, после stepIdx 2): `{errorCode:'models_not_loaded', message, durationMs}` | статус-машина `failed`, банер ошибки, отсутствие ретраев |

> [!example] Приёмочные проверки мок-режима
> 1. Все 5 демо-сценариев запускаются кнопками пресетов ([[06-scenario]]) и доводят UI до финала.
> 2. Отказ виден: карточка в refusal-стейте, причины по [[01-enums]] отрисованы.
> 3. Обрыв/ошибка (`run_failed`) не оставляет «вечный спиннер»: статус-машина [[06-state]]
>    приходит в терминальное состояние.
> 4. Перезагрузка страницы на моках восстанавливает стартовый экран без backend.

## Правила

> [!warning] Дизайн моков
> 1. Фикстуры — **копии** примеров [[90-examples-and-mocks]], а не придуманные заново: правка
>    примера → правка фикстуры в том же PR.
> 2. Моки реализуют интерфейсы [[03-service-rest]]/[[04-service-sse]], а не «похожий» —
>    сведение с реальным backend не должно требовать правок выше `src/mocks/index.ts`.
> 3. Никаких случайных чисел в фикстурах:seed фиксирован, данные воспроизводимы
>    (правило детерминизма).
> 4. Моки не расширяют контракт: «удобное поле для UI» добавляется в api/data-models, потом
>    в фикстуру.

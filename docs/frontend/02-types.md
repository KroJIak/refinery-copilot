---
title: "frontend — TS-типы контракта"
tags: [refinery-copilot, frontend, typescript, types, p6]
related:
  - "[[frontend/00-OVERVIEW]]"
  - "[[01-timeseries]]"
  - "[[02-data-freshness]]"
  - "[[03-quality-assessment]]"
  - "[[04-recommendation]]"
  - "[[05-agent-step]]"
  - "[[06-scenario]]"
  - "[[07-run-report]]"
  - "[[08-model-artifact]]"
  - "[[01-enums]]"
  - "[[06-p6-openapi-ts-mocks]]"
  - "[[01-p1-rest-sse]]"
created: 2026-09-19
---

# 02 — TS-типы контракта

Каталог `src/types/`. **Типы не определяются здесь**: каждое поле сущности берётся из таблиц
маппинга канонического документа api/data-models (канонические поля `snake_case` → TS `camelCase`
через alias). Ниже — только TS-имена и файлы; значения полей, валидации и примеры — по ссылкам.

## Scope

Содержит: перечень файлов типов, зеркала 8 DTO со ссылками на канон, енумы как string literal
union, envelope-типы REST-ответов из [[01-p1-rest-sse]], правило регенерации из OpenAPI и
чек-лист синхронизации. НЕ содержит: новых форматов данных, переопределения полей, логики.

## Правила трансформации (из [[06-p6-openapi-ts-mocks]] §0)

| Канон | Frontend (TS) |
| --- | --- |
| `snake_case` поле | `camelCase` поле (alias-генерация) |
| `datetime` UTC | `string` (ISO 8601 UTC, `Z`) |
| `float \| None` | `number \| null` — поле присутствует всегда, пишется явно `null` |
| сентинелы {307, 251, 252, 240} | не существуют: за пределами пайплайна это `null` + `qualityFlag` |
| str-Enum | union строковых литералов (значения `lower_snake`) |
| NaN/Inf | запрещены в JSON — приходят как `null` |

## Файлы каталога

```text
src/types/
├── api.gen.ts     # кодоген openapi-typescript из OpenAPI ([[06-p6-openapi-ts-mocks]]) — НЕ правится руками
├── enums.ts       # union-типы енумов из [[01-enums]]
└── dto.ts         # ручные зеркала 8 DTO (см. чек-лист ниже); реэкспорт имён из api.gen.ts
```

## Зеркала DTO (8 сущностей)

Имена интерфейсов = имена канонических моделей; поля перечислены только TS-именами из таблиц
маппинга — определения, ограничения и примеры в каноническом документе.

| TS-интерфейс | Поля (camelCase, из таблиц маппинга) | Канон |
| --- | --- | --- |
| `TagPoint` | `tagCode, ts, value, qualityFlag, source, unit` | [[01-timeseries]] §A.1 |
| `DataFreshness` | `pointId, source, lastSampleTs, availableTs, ageHours, status, warnAfterH, staleAfterH` | [[02-data-freshness]] §A.2 |
| `ShapItem` | `feature, value, contribution` | [[03-quality-assessment]] §A.3 |
| `QualityAssessment` | `target, horizonH, unit, p10, p50, p90, intervalWidth, specRisk, conformalApplied, modelArtifactId, shapTopK, computedAt` | [[03-quality-assessment]] §A.3 |
| `Decision`, `StateItem`, `RiskItem`, `ActionItem`, `EffectItem`, `CheckItem`, `ConfidenceInterval`, `AlternativeItem`, `RefusalInfo`, `Recommendation` | `Recommendation`: `runId, createdAt, tPoint, decision, state, risks, actions?, effects?, checks?, confidence?, explanation, alternatives, refusal`; элементы — по таблице канона (`currentValue → recommendedValue`, `baselineP50/actionP50/marginToSpec`, `constraintId/limit/value/passed`, `paretoRank/costIndex`, `reasons/details`) | [[04-recommendation]] §A.4 |
| `NumberRef`, `AgentStep` | `AgentStep`: `runId, stepIdx, agentRole, startedAt, finishedAt, durationMs, inputDigest, inputSummary, output, notes, numberRefs, confidence`; `NumberRef`: `path, value, unit, label` | [[05-agent-step]] §A.5 |
| `Scenario` | `scenarioId, kind, tPoint, overrides, description, seed` | [[06-scenario]] §A.6 |
| `RunReport` | `runId, createdAt, status, scenario, dataHashes, versions, env, freshness, quality, agentsTrace, recommendation, durationMs, artifacts` | [[07-run-report]] §A.7 |
| `ModelArtifact` | `artifactId, target, algorithm, quantiles, modelUri, conformal, coverage, metrics, trainedOnRange, features, monotoneConstraints, createdAt, seed, coreVersion, active` | [[08-model-artifact]] §A.8 |

> [!warning] Инварианты карточки ([[04-recommendation]])
> `decision === 'recommend'` ⇒ `actions/effects/checks/confidence` непусты и `refusal === null`;
> `decision === 'refuse'` ⇒ `refusal.reasons` непуст. Типы выше это кодируют опциональностью
> (`actions?`) — UI обязан обрабатывать оба исхода (правило 7 [[frontend/00-OVERVIEW]]).

## Енумы — string literal union ([[01-enums]])

```ts
// src/types/enums.ts — значения в точности из api/enums/01-enums.md (B.1–B.8)
export type AgentRole = 'data' | 'quality' | 'reliability' | 'optimization' | 'orchestrator';
export type FreshnessStatus = 'ok' | 'warn' | 'stale' | 'missing';
export type RefusalReason =
  | 'stale_lims' | 'wide_interval' | 'out_of_training_domain'
  | 'no_feasible_variant' | 'sensor_fault';
export type RunStatus = 'started' | 'running' | 'completed' | 'refused' | 'failed';
export type ScenarioKind = 'normal' | 'quality_risk' | 'bad_data' | 'sour_crude' | 'stale_lims';
export type QualityTarget = 'sulfur' | 't95' | 'd15' | 'cetane';
export type QualityFlag = 'ok' | 'sentinel' | 'stuck' | 'outlier' | 'missing';
export type DataSource = 'lims' | 'pak' | 'vak' | 'kip';
```

Значения енумов **закрыты**: добавление значения — изменение контракта в [[01-enums]] с подъёмом
версии, отражается регенерацией типов, а не локальным расширением union.

## Envelope-типы REST ([[01-p1-rest-sse]])

Ответы, у которых нет канонического DTO (агрегаты эндпоинтов P1), живут в `dto.ts` и повторяют
примеры JSON протокола:

| TS-тип | Эндпоинт | Поля (camelCase) |
| --- | --- | --- |
| `HealthResponse` | `GET /api/health` | `status, contract, core, modelsLoaded` |
| `StateResponse` | `GET /api/state` | `tPoint, tags: TagPoint[], freshness: DataFreshness[], lastRun?: {runId, decision}` |
| `RunCreated` | `POST /api/runs` (202) | `runId, status, eventsUrl` |
| `RunSummary` | `GET /api/runs` | `runId, status, kind, tPoint, decision, createdAt` |
| `WhatifQualityPoint` | внутри `WhatifResponse` | `target, p10, p50, p90, specRisk, unit` |
| `WhatifVariant` | внутри `WhatifResponse` | `overrides, quality: WhatifQualityPoint[], costIndex, feasible, violations: string[]` |
| `WhatifResponse` | `POST /api/whatif` | `tPoint, elapsedMs, baseline: WhatifQualityPoint[], variants: WhatifVariant[]` |
| `ApiErrorBody` | любое 4xx/5xx | `error: {code, message, details}` — см. [[03-service-rest]] |

`POST /api/runs` принимает `Scenario` **без** `scenarioId` (сервер генерирует) — для запроса
используется тип `ScenarioDraft = Omit<Scenario, 'scenarioId'>`.

## Payload-типы SSE ([[01-p1-rest-sse]])

События прогона несут малые объекты — им тоже нужны имена в `dto.ts` (парсинг — [[04-service-sse]]):

| TS-тип | Событие | Поля (camelCase) |
| --- | --- | --- |
| `RunStartedPayload` | `run_started` | `runId, status, kind, tPoint, seed` |
| `StepPayload` | `step` | `runId, stepIdx, agentRole, label, payload: Record<string, unknown>` |
| `LogPayload` | `log` | `runId, stepIdx, level: 'info' \| 'warn', message, ts` |
| `RunFinishedPayload` | `run_finished` | `runId, status: 'completed' \| 'refused', durationMs, reportUrl` |
| `RunFailedPayload` | `run_failed` | `runId, errorCode, message, durationMs` |

## Только фронтовые типы

Единственные разрешённые типы, которых нет в контракте, — **UI-статусы** (канон [[01-enums]]
явно исключает статусы UI) и служебные производные:

| TS-тип | Где | Значения |
| --- | --- | --- |
| `AgentStepStatus` | `runSlice`, `AgentStep` | `'idle' \| 'running' \| 'done'` |
| `ScenarioDraft` | `createRun` | `Omit<Scenario, 'scenarioId'>` (сервер генерирует id) |
| `WhatifRequest` | `whatif` | `{tPoint, overrides, variants}` — форма запроса P1 |
| `ConnectionState` | [[04-service-sse]] | `'connecting' \| 'open' \| 'stale' \| 'closed'` |

Они живут в `dto.ts` с пометкой «UI-only» и не претендуют на контракт.

> [!warning] Антипаттерны
> 1. `interface` с переобъявленными полями DTO «на всякий случай» — запрещён: правится только
>    канон в api/data-models (правило 3 [[frontend/00-OVERVIEW]]).
> 2. Локальный enum `const O = {...} as const` для значений [[01-enums]] вместо union —
>    расползание источников; если нужны рантайм-списки (например, для <select>), они выводятся
>    из union: `const QUALITY_TARGETS = ['sulfur','t95','d15','cetane'] as const satisfies readonly QualityTarget[];`
> 3. `any` в парсинге ответов: `request<T>` в [[03-service-rest]] уже возвращает типизированное
>    значение; касты `as T` — только на границе кодогена.

## Регенерация из OpenAPI ([[06-p6-openapi-ts-mocks]])

Единственный канал обновления типов — кодоген; правка `dto.ts` руками без bump контракта запрещена.

```bash
make api-types
# = pydantic → openapi.json → npx openapi-typescript openapi.json -o frontend/src/types/api.gen.ts
```

`alias_generator=to_camel` даёт поля сразу camelCase; енумы → union литералов;
`datetime` → `string` (format `date-time`); `X | None` → `| null`.

> [!example] Чек-лист синхронизации (ручное зеркало)
> 1. После каждого bump `contract`-версии (см. `versions.contract` в [[07-run-report]]) запустить
>    `make api-types` и `npm run typecheck`.
> 2. Сверить `dto.ts` с `api.gen.ts`: имена интерфейсов и полей обязаны совпадать; расхождение —
>    баг контракта, правится в api/data-models, не во фронте.
> 3. Сверить union-типы `enums.ts` со значениями [[01-enums]] (посимвольно).
> 4. Мок-фикстуры ([[05-mocks]]) должны проходить те же типы — фикстура, не удовлетворяющая
>    `RunReport`/`Recommendation`, ломает сборку (`satisfies`-проверка в `src/mocks/`).
> 5. Новые поля контракта — только опциональные; ломающие изменения только через новую версию.

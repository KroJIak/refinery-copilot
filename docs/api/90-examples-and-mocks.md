---
title: "api — примеры JSON и мок-пакет для фронта"
tags: [refinery-copilot, api, examples, mocks, sse]
related:
  - "[[00-SUMMARY]]"
  - "[[01-enums]]"
  - "[[01-p1-rest-sse]]"
created: 2026-09-19
---

# 90-examples-and-mocks — стартовый пакет для независимой разработки UI

> [!tip] Контракт заморожен
> Файл самодостаточен: с ним фронт ведёт разработку **без backend** — фикстуры + мок-SSE-симулятор
> (`VITE_USE_MOCKS=true`). Все примеры валидны относительно [[00-SUMMARY]] §5 (camelCase в JSON,
> ISO 8601 UTC, `null` вместо NaN) и форм data-models. Полный спек — [[01-p1-rest-sse]].

## Scope

Этот файл описывает: полный JSON-пример каждого REST-ответа P1 (health, state, runs, run detail,
whatif, models, тело ошибки); скрипт мок-SSE (все 9 типов событий + heartbeat-кадр `: hb`, с `seq`);
расположение фикстур и порядок запуска фронта без бекенда. Не описывает: поля моделей
(`api/data-models/*`), реализацию моков на фронте ([[05-mocks]]), серверную часть P1.

## 1. Общие правила чтения примеров

- База `/api`, JSON UTF-8, время — строки ISO 8601 UTC с `Z`; поля `camelCase` (алиасы pydantic, P6).
- `null` — поле присутствует всегда, где тип допускает `| null`; NaN/Inf в JSON запрещены.
- Ошибки — единое тело (см. [[01-p1-rest-sse]]); время в примерах условное, `run_id` = `YYYYMMDD-HHMMSS-hex8 (UTC)`.
- Ссылки на формы: [[01-timeseries]], [[02-data-freshness]], [[04-recommendation]], [[06-scenario]], [[07-run-report]], [[08-model-artifact]].

## 2. REST-эндпоинты (P1)

### 2.1 `GET /api/health` — живость и версии

```json
{"status": "ok", "contract": "1.0.0", "core": "0.1.0", "modelsLoaded": 3}
```

`status` всегда `"ok"` (иначе — 503); `modelsLoaded` — сколько `active`-артефактов ([[08-model-artifact]]) поднято из registry. Healthcheck compose дергает его каждые 15 с (P7).

### 2.2 `GET /api/state?tPoint=2026-09-19T08:00:00Z&tags=24-2000.P8,T11` — текущее состояние

```json
{
  "tPoint": "2026-09-19T08:00:00Z",
  "tags": [
    {"tagCode": "24-2000.P8", "ts": "2026-09-19T08:00:00Z", "value": 341.2,
     "qualityFlag": "ok", "source": "kip", "unit": "°C"},
    {"tagCode": "T11", "ts": "2026-09-19T08:00:00Z", "value": 286.5,
     "qualityFlag": "ok", "source": "kip", "unit": "°C"},
    {"tagCode": "Q21", "ts": "2026-09-19T08:00:00Z", "value": null,
     "qualityFlag": "sentinel", "source": "pak", "unit": "мг/кг"}
  ],
  "freshness": [
    {"pointId": "hdu_product_sulfur", "source": "lims",
     "lastSampleTs": "2026-09-18T06:00:00Z", "availableTs": "2026-09-18T10:00:00Z",
     "ageHours": 44.0, "status": "stale", "warnAfterH": 28.0, "staleAfterH": 52.0},
    {"pointId": "blend_product_cn", "source": "pak",
     "lastSampleTs": "2026-09-19T06:30:00Z", "availableTs": "2026-09-19T06:30:00Z",
     "ageHours": 1.5, "status": "ok", "warnAfterH": 28.0, "staleAfterH": 52.0}
  ],
  "lastRun": {"runId": "20260919-080000-3f9c2a", "decision": "recommend"}
}
```

Формы: `tags` — [[01-timeseries]] (обрати внимание: сентинел → `value: null` + `qualityFlag: "sentinel"`),
`freshness` — [[02-data-freshness]]; `lastRun` опционален. Ошибки: 400 (плохой `tPoint`), 503.

### 2.3 `POST /api/runs` — запуск прогона

Запрос — [[06-scenario]] без `scenarioId` (его выдаёт система):

```json
{"kind": "quality_risk", "tPoint": "2026-06-15T08:00:00Z",
 "overrides": {"blend_share_kerosene": 0.12}, "seed": 42}
```

Ответ **202** (прогон асинхронный, прогресс — SSE):

```json
{"runId": "20260615-080000-b7e1d904", "status": "started",
 "eventsUrl": "/api/runs/20260615-080000-b7e1d904/events"}
```

Ошибки: 400 (неизвестный `kind`, override неуправляемого тега), 503 (`models_not_loaded`, `data_missing`).

### 2.4 `GET /api/runs` — список прогонов

```json
[
  {"runId": "20260919-080000-3f9c2a", "status": "completed", "kind": "quality_risk",
   "tPoint": "2026-06-15T08:00:00Z", "decision": "recommend", "createdAt": "2026-09-19T08:00:00Z"},
  {"runId": "20260918-174500-52ab0c11", "status": "refused", "kind": "stale_lims",
   "tPoint": "2026-09-18T17:00:00Z", "decision": "refuse", "createdAt": "2026-09-18T17:45:00Z"}
]
```

`refused` — штатный исход ([[01-enums]] §4.1): в списке выглядит как обычный прогон, не как ошибка.

### 2.5 `GET /api/runs/{run_id}` — полный RunReport

Форма — [[07-run-report]] (1:1 с `artifacts/runs/{run_id}.json`); рекомендация — [[04-recommendation]].

```json
{
  "runId": "20260919-080000-3f9c2a",
  "createdAt": "2026-09-19T08:00:00Z",
  "status": "completed",
  "scenario": {"scenarioId": "b41d9f02", "kind": "quality_risk", "tPoint": "2026-06-15T08:00:00Z",
    "overrides": {"blend_share_kerosene": 0.12},
    "description": "2026 прижат к границе по сере", "seed": 42},
  "dataHashes": {"data/processed/telemetry.parquet": "e3b0c4429804fc2a…",
    "data/processed/lims.parquet": "bd9a3c1f77e02d64…"},
  "versions": {"python": "3.12.6", "lightgbm": "4.5.0", "core": "0.1.0", "contract": "1.0.0"},
  "env": {"mode": "api", "llm_mode": "off"},
  "freshness": [
    {"pointId": "hdu_product_sulfur", "source": "lims",
     "lastSampleTs": "2026-06-14T06:00:00Z", "availableTs": "2026-06-14T10:00:00Z",
     "ageHours": 22.0, "status": "ok", "warnAfterH": 28.0, "staleAfterH": 52.0}
  ],
  "quality": [
    {"target": "sulfur", "horizonH": 2.0, "unit": "мг/кг",
     "p10": 8.9, "p50": 9.6, "p90": 10.4, "intervalWidth": 1.5, "specRisk": 0.38,
     "conformalApplied": true, "modelArtifactId": "sulfur-lgbm-a1b2c3d4",
     "shapTopK": [{"feature": "T5", "value": 371.0, "contribution": 0.42}],
     "computedAt": "2026-09-19T08:05:00Z"}
  ],
  "agentsTrace": [
    {"runId": "20260919-080000-3f9c2a", "stepIdx": 1, "agentRole": "quality",
     "startedAt": "2026-09-19T08:00:03Z", "finishedAt": "2026-09-19T08:00:05Z", "durationMs": 2100,
     "inputDigest": "9f2a1c4e8b7d0f31", "inputSummary": {"targets": ["sulfur", "t95"]},
     "output": {"sulfur": {"p50": 9.6, "p10": 8.9, "p90": 10.4}},
     "notes": ["Прогноз серы у верхней границы; конформ расширил интервал до 1,5."],
     "numberRefs": [{"path": "sulfur.p50", "value": 9.6, "unit": "мг/кг", "label": "Прогноз серы P50"}],
     "confidence": 0.71}
  ],
  "recommendation": {
    "runId": "20260919-080000-3f9c2a", "createdAt": "2026-09-19T08:05:01Z",
    "tPoint": "2026-09-19T08:00:00Z", "decision": "recommend",
    "state": [{"tag": "Q21", "value": 9.4, "unit": "мг/кг"}, {"tag": "T5", "value": 371.0, "unit": "°C"}],
    "risks": [{"target": "sulfur", "limit": "≤ 10 мг/кг", "limitValue": 10.0,
      "p50": 9.6, "p10": 8.9, "p90": 10.4, "specRisk": 0.38}],
    "actions": [{"tag": "24-2000.P8", "unit": "°C", "currentValue": 341.2,
      "recommendedValue": 339.5, "deltaPct": -0.5}],
    "effects": [{"target": "sulfur", "unit": "мг/кг", "baselineP50": 9.6,
      "actionP50": 9.1, "p10": 8.4, "p90": 9.8, "marginToSpec": 0.9}],
    "checks": [
      {"constraintId": "sulfur_max", "description": "сера ≤ 10 мг/кг", "limit": 10.0, "unit": "мг/кг", "value": 9.8, "passed": true},
      {"constraintId": "t95_max", "description": "T95 ≤ 360 °C", "limit": 360.0, "unit": "°C", "value": 355.1, "passed": true},
      {"constraintId": "cetane_min_summer", "description": "ЦЧ ≥ 51 (летнее)", "limit": 51.0, "unit": "пункт", "value": 52.3, "passed": true}
    ],
    "confidence": {"p10": 0.62, "p90": 0.88},
    "explanation": "Снижение T ГСС на 1,7 °C уменьшает серу ~0,5 мг/кг (санити ~0,3 мг/кг/°C) и снимает риск off-spec; запас по T95 и ЦЧ сохраняется.",
    "alternatives": [{"label": "Присадка 1,5 %", "actions": [{"tag": "blend_additive_pct", "unit": "%",
      "currentValue": 0.0, "recommendedValue": 1.5, "deltaPct": null}],
      "quality": [{"target": "cetane", "p10": 51.8, "p50": 52.3, "p90": 52.9}],
      "costIndex": 1.5, "paretoRank": 2}],
    "refusal": null
  },
  "durationMs": 12400,
  "artifacts": {"reportMd": "artifacts/runs/20260919-080000-3f9c2a.md",
    "reportJson": "artifacts/runs/20260919-080000-3f9c2a.json",
    "timeline": "artifacts/timeline/20260919-080000-3f9c2a.ndjson"}
}
```

Вариант отказа — тот же `RunReport`, где `recommendation.decision = "refuse"`,
`recommendation.refusal = {"reasons": ["stale_lims", "wide_interval"], "details": ["Возраст последнего ЛИМС 44 ч > 28 ч", "Интервал серы 8,9–10,4 мг/кг пересекает границу 10 мг/кг"]}`,
а `actions/effects/checks/confidence` отсутствуют (фикстура `refusal.json`). Инварианты — [[04-recommendation]].
`GET /api/runs/{run_id}/report.json` возвращает этот же объект файлом; `.md` — `text/markdown`.

### 2.6 `POST /api/whatif` — синхронный «что если» (< 50 мс)

Запрос: `{"tPoint": "2026-09-19T08:00:00Z",
 "overrides": {"24-2000.P8": 341.2},
 "variants": [{"24-2000.P8": 339.5}, {"24-2000.P8": 336.0, "blend_additive_pct": 1.5}]}` (вариантов ≤ 8).

Ответ:

```json
{"tPoint": "2026-09-19T08:00:00Z", "elapsedMs": 31,
 "baseline": [{"target": "sulfur", "p50": 9.6, "p10": 8.9, "p90": 10.4, "specRisk": 0.38, "unit": "мг/кг"}],
 "variants": [
   {"overrides": {"24-2000.P8": 339.5},
    "quality": [{"target": "sulfur", "p50": 9.1, "p10": 8.4, "p90": 9.8, "specRisk": 0.11, "unit": "мг/кг"}],
    "costIndex": 1.0, "feasible": true, "violations": []},
   {"overrides": {"24-2000.P8": 336.0, "blend_additive_pct": 1.5},
    "quality": [{"target": "sulfur", "p50": 8.7, "p10": 8.0, "p90": 9.4, "specRisk": 0.04, "unit": "мг/кг"}],
    "costIndex": 2.3, "feasible": false, "violations": ["t95_max: прогноз T95 361,2 > 360 °C"]}
 ]}
```

Ошибки: 400 (override неуправляемого тега, > 8 вариантов), 503. SSE не используется — ответ синхронный.

### 2.7 `GET /api/models` — реестр моделей

Форма элемента — [[08-model-artifact]]; массив по всем `QualityTarget`:

```json
[
  {"artifactId": "sulfur-lgbm-a1b2c3d4", "target": "sulfur", "algorithm": "lightgbm_quantile",
   "quantiles": [0.1, 0.5, 0.9], "modelUri": "artifacts/models/sulfur-lgbm-a1b2c3d4/model.txt",
   "conformal": {"method": "enbpi", "params": {"gamma": 0.05, "cv": "split"}}, "coverage": 0.83,
   "metrics": {"wape": 0.061, "mae": 0.52, "pinball_p50": 0.35},
   "trainedOnRange": {"start": "2023-01-01T00:00:00Z", "end": "2026-06-30T00:00:00Z"},
   "features": ["T5", "T11", "lims_age_h", "cat_age_days"],
   "monotoneConstraints": {"T5": 1},
   "createdAt": "2026-09-18T20:10:00Z", "seed": 42, "coreVersion": "0.1.0", "active": true}
]
```

Ошибка 503 — registry пуст (`models_not_loaded`); `active` ровно один на каждый `target` ([[01-enums]] §2.6).

### 2.8 Тело ошибки (единое для всех эндпоинтов)

```json
{"error": {"code": "whatif_too_many_variants", "message": "Не более 8 вариантов в what-if",
 "details": {"got": 11, "max": 8}}}
```

Коды: 400 — неизвестный `kind`, неуправляемый override, > 8 вариантов; 404 — нет прогона/артефакта;
422 — ошибка pydantic-валидации (`code: "validation_error"`); 500 — внутренняя; 503 — `models_not_loaded` /
`data_missing`.

## 3. Мок-SSE: `GET /api/runs/{run_id}/events`

`Content-Type: text/event-stream; charset=utf-8`; каждое событие несёт `id` = монотонный `seq`;
порядок задаёт core (P2): `run_started` → ×5 [`agent_started` → `step`/`log` → `agent_finished`] →
`recommendation` | `refusal` → `run_finished` | `run_failed`. Всего **9 событий**:
`run_started`, `agent_started`, `step`, `log`, `agent_finished`, `recommendation`, `refusal`,
`run_finished`, `run_failed`; heartbeat — не событие, а комментарий
`: hb <ISO>` каждые 15 с (EventSource его игнорирует, но держит соединение живым).

### 3.1 Скрипт эталонного прогона (фикстура `normal`, ~35 с)

| seq (id) | event | Задержка от предыдущего | data (сокращённо) |
| --- | --- | --- | --- |
| 1 | `run_started` | 0 c | `{runId, status:"running", kind:"quality_risk", tPoint, seed:42}` |
| 2 | `agent_started` | 0,3 c | `{runId, stepIdx:0, agentRole:"data", startedAt}` |
| 3 | `log` | 1,2 c | `{runId, stepIdx:0, level:"warn", message:"D10 мёртв (99,99 % сентинелов)", ts}` |
| 4 | `agent_finished` | 1,0 c | полный `AgentStep` data: `output.freshness`, `numberRefs`, `notes` ([[05-agent-step]]) |
| 5 | `agent_started` | 0,3 c | `stepIdx:1, agentRole:"quality"` |
| 6 | `step` | 1,5 c | `{runId, stepIdx:1, agentRole:"quality", label:"прогнозы", payload:{sulfur:{p50:9.6,p10:8.9,p90:10.4}}}` |
| 7 | `agent_finished` | 0,7 c | полный `AgentStep` quality ([[05-agent-step]] §пример) |
| 8 | `agent_started` | 0,3 c | `stepIdx:2, agentRole:"reliability"` |
| 9 | `agent_finished` | 1,2 c | полный `AgentStep` reliability |
| 10 | `agent_started` | 0,3 c | `stepIdx:3, agentRole:"optimization"` |
| 11 | `step` | 2,0 c | `{label:"топ-5 вариантов", payload:[…overrides + costIndex…]}` |
| 12 | `agent_finished` | 1,0 c | полный `AgentStep` optimization |
| 13 | `agent_started` | 0,3 c | `stepIdx:4, agentRole:"orchestrator"` |
| 14 | `agent_finished` | 1,5 c | полный `AgentStep` orchestrator |
| 15 | `recommendation` | 0,5 c | полный [[04-recommendation]] c `decision:"recommend"` (см. [[01-p1-rest-sse]]) |
| 16 | `run_finished` | 0,4 c | `{runId, status:"completed", durationMs:12400, reportUrl:"/api/runs/20260919-080000-3f9c2a/report.json"}` |
| — | `: hb 2026-09-19T08:00:15Z` | каждые 15 c между любыми событиями | комментарий, `id` не consumes |

Варианты финала: для `stale_lims`/`bad_data` на seq 15 идёт **`refusal`** (та же карточка с
`decision:"refuse"` + заполненным `refusal`, §2.5), затем `run_finished` c `status:"refused"`;
сценарий аварии — `run_failed` вместо пары «финал+run_finished»:
`{runId, errorCode:"models_not_loaded", message:"нет active-артефакта sulfur", durationMs:380}`.

### 3.2 Пример сырого кадра

```text
id: 7
event: agent_finished
data: {"runId":"20260919-080000-3f9c2a","stepIdx":1,"agentRole":"quality","startedAt":"2026-09-19T08:00:03Z","finishedAt":"2026-09-19T08:00:05Z","durationMs":2100,"inputDigest":"9f2a1c4e8b7d0f31","inputSummary":{"targets":["sulfur","t95"]},"output":{"sulfur":{"p50":9.6,"p10":8.9,"p90":10.4}},"notes":["Интервал расширен конформом."],"numberRefs":[{"path":"sulfur.p50","value":9.6,"unit":"мг/кг","label":"Прогноз серы P50"}],"confidence":0.71}
```

Правила потребления: дубли по `id` отбрасывать; при переподключении — `Last-Event-ID`, реплей из
журнала `artifacts/timeline/{run_id}.ndjson` (в мок-режиме — из памяти симулятора); после финального
события поток закрывается, `retry:` не выдаётся — один запрос = один прогон.

## 4. Где лежат фикстуры и как запустить фронт без бекенда

### 4.1 Фикстуры (P6, форма [[07-run-report]] / [[04-recommendation]])

```text
frontend/src/mocks/
  ├── fixtures/
  │   ├── normal.json       # сценарий normal: рекомендация, все проверки зелёные (см. [[01-p1-rest-sse]])
  │   ├── quality_risk.json    # риск у границы серы: spec_risk высокий, конформ расширен
  │   ├── bad_data.json     # сентинелы/залипания: QualityFlag ≠ ok, отказ sensor_fault
  │   └── refusal.json      # штатный отказ: decision="refuse", refusal.reasons заполнен
  └── mockSse.ts            # мок-SSE-симулятор: скрипт §3.1 с задержками, heartbeat 15 с
```

Пресет `sour_crude` переиспользует форму `normal.json` c другим `kind`/`overrides`; файлы правятся
вместе со схемами ([[06-p6-openapi-ts-mocks]]) — рассинхрон фикстур и `api.gen.ts` недопустим.

### 4.2 Запуск

```bash
# режим моков — backend не нужен
cd frontend && npm ci
VITE_USE_MOCKS=true npm run dev       # http://localhost:5173

# режим живого API: vite проксирует /api → localhost:8000
VITE_USE_MOCKS=false npm run dev      # + отдельно: make run (uvicorn :8000)
```

`VITE_USE_MOCKS` переключает слой `services` (`true` — моки, `false` — живой `rest`/`sse`),
типы одни и те же —
`frontend/src/types/api.gen.ts` из `make api-types` ([[00-SUMMARY]] §8). Контрольный чек-лист приёма мок-режима:

- [ ] `/state` рендерит светофоры [[02-data-freshness]] и теги [[01-timeseries]] (включая `null` + `qualityFlag: "sentinel"`);
- [ ] `POST /api/runs` в mock-режиме мгновенно возвращает 202 и открывает EventSource на скрипт §3.1;
- [ ] конвейер агентов собирается из `agent_started`/`step`/`log`/`agent_finished` (seq 2–14);
- [ ] карточка §2.5 рендерится из `recommendation` (seq 15); `refusal.json` даёт карточку отказа без красного статуса ошибки;
- [ ] heartbeat не рвёт прогресс-бар; reconnect c `Last-Event-ID` не дублирует события.

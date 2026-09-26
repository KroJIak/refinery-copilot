---
title: "Отчёт прогона — сборка RunReport и экспорт JSON + Markdown"
tags: [refinery-copilot, core-architecture, report, reproducibility]
related:
  - "[[07-run-report]]"
  - "[[09-agent-orchestrator]]"
  - "[[14-cli]]"
  - "[[13-scenarios]]"
  - "[[06-artifacts-catalog]]"
created: 2026-09-19
---

# 12 — Отчёт прогона (`report/run_report.py`)

Сборка `RunReport` (каноническая форма A.7 [[07-run-report]]) из результатов конвейера
[[09-agent-orchestrator]] и его рендер в артефакты: `artifacts/runs/{run_id}.json` (1:1 с DTO)
и `artifacts/runs/{run_id}.md` (человекочитаемый). Отчёт — главный аргумент воспроизводимости:
«система должна сохранять/показывать входные данные, оценки агентов и итоговую рекомендацию так,
чтобы логику решения можно было проверить».

## Scope

| | |
| --- | --- |
| **Содержит (covers)** | сборка всех полей `RunReport`: входы ([[06-scenario|Scenario]]), `agents_trace[]`, вердикт (рекомендация или отказ), `data_hashes`, `versions`, `env`, `seed`, `duration_ms`; рендер Markdown-версии; запись в `artifacts/runs/` и `artifacts/timeline/` (P3); правила именования и повторных прогонов |
| **НЕ содержит (does NOT cover)** | принятие решения ([[09-agent-orchestrator]], [[10-refusal]]); сборку карточки (источники — шаги агентов); раздачу отчётов по HTTP (backend/03-runs-routes.md); пайплайн обучения и `metrics.json` (data-pipeline) |

## Поля отчёта и их источники

| Поле [[07-run-report]] | Источник | Примечание |
| --- | --- | --- |
| `run_id` | генерируется при старте: `YYYYMMDD-HHMMSS-hex8 (UTC)` | hex8 — детерминированный хвост от seed + t_point |
| `status` | `RunStatus`: `completed` / `refused` / `failed` | отказ — штатный терминальный статус (автомат B.9) |
| `scenario` | вход прогона ([[06-scenario]]): `kind`, `t_point`, `overrides`, `seed`, `description` | seed фиксируется до первого шага |
| `data_hashes` | `datasets_manifest.json` (пишет data-pipeline, P4): sha256 прочитанных parquet | путь → sha256; из [[03-agent-data]] |
| `versions` | `python`, `lightgbm`, `core`, `contract` | фиксируется при сборке |
| `env` | `{mode, llm_mode, hostname}` | `mode`: cli/api; `llm_mode`: off/local/external |
| `freshness` | `DataFreshness[]` из [[03-agent-data]] | светофоры точек контроля |
| `quality` | `QualityAssessment[]` из [[04-agent-quality]] | квантили + `shap_top_k` |
| `agents_trace` | все пять `AgentStep` ([[05-agent-step]]) | включая шаг оркестратора |
| `recommendation` | карточка [[04-recommendation]] целиком | recommend **или** refuse |
| `duration_ms`, `artifacts` | метрика прогона; фактические пути артефактов | `{report_md, report_json, timeline}` |

## Сборка

```python
def build_run_report(result: RunResult, scenario: Scenario, ctx: RunContext) -> RunReport:
    """1. scenario + seed — из входа прогона.
    2. data_hashes — из datasets_manifest.json по фактически прочитанным датасетам.
    3. versions/env — из окружения процесса.
    4. agents_trace — как есть, все 5 шагов (порядок step_idx 0..4).
    5. recommendation — карточка или отказ; инварианты карточки проверяются здесь же:
         recommend ⇒ actions/effects/checks/confidence непусты и refusal is None
         refuse    ⇒ refusal.reasons непуст.
    6. Проверка: NaN/Inf в JSON запрещены → null (правило §0 контракта)."""
```

Сборка чистая: `report/` ничего не считает заново — только компонует и валидирует. Любое нарушение
инвариантов карточки — исключение сборки (`RunStatus.failed`), а не «починка на месте».

## Экспорт: JSON и Markdown

```python
def persist(report: RunReport, runs_dir: Path) -> dict[str, str]:
    """artifacts/runs/{run_id}.json  — сериализация DTO 1:1 (без изменений полей)
    artifacts/runs/{run_id}.md      — рендер Markdown (ниже)
    artifacts/timeline/{run_id}.ndjson — журнал событий SSE (пишется по мере прогона)
    Возвращает словарь artifacts={report_md, report_json, timeline} для поля artifacts."""
```

Файлы **не перезаписываются**: повторный прогон того же сценария создаёт новый `run_id`
(P3, api/protocols/03-p3-core-datastore.md) — история прогонов полная.

### Структура Markdown-версии

```markdown
# Прогон {run_id} — {kind}, t_point = {t_point}
- Статус: {status}; длительность {duration_ms} мс; seed {seed}
- Версии: python {…}, lightgbm {…}, core {…}, contract {…}; llm_mode = {off|local|external}
- Хэши данных: {path} → {sha256-16}

## Свежесть данных
| Точка | Источник | Возраст, ч | Статус |
…  # DataFreshness[]

## Оценка качества
| Цель | P10 | P50 | P90 | Запас до спецификации | Риск |
…  # QualityAssessment[]

## Трейс агентов
### 0. data ({duration} мс)
{notes}
{таблица number_refs}
…  # все 5 шагов

## Карточка рекомендации
{state → risks → actions (текущее → рекомендуемое) → effects → checks → confidence}
{explanation}
| Альтернатива | Ключевые действия | cost_index | pareto_rank |
…  # alternatives[] — или блок отказа: причины + детали

## Допущения
{список явно помеченных допущений прогона: p2/p98-диапазоны, лаг 0–3 ч, энергопрокси, цены присадки}
```

Раздел «Допущения» обязателен: «Все допущения по управляемым параметрам, ограничениям,
прокси-метрикам и обработке данных должны быть явно описаны».

## Воспроизводимость: что фиксирует отчёт

> [!important] Трактовка воспроизводимости
> «При одинаковом состоянии системы должны воспроизводиться одно и то же решение и одинаковые
> численные результаты» («увеличить расход на 2 %» ≡ «рекомендуется повышение расхода на 2 %»).
> Отчёт содержит всё, что определяет состояние: сценарий + seed, хэши данных, версии, полный трейс.

```python
# Проверка воспроизводимости (тест [[15-tests]]):
#   прогон сценария дважды с тем же seed → RunReport.diff() пуст
#   кроме полей времени (created_at, started_at/finished_at, duration_ms, run_id).
# Скрытые случайности запрещены: любые случайности — только под seed из [[06-scenario|Scenario]].
```

## Пример JSON-артефакта (сокращённый)

```json
{"run_id": "20260919-080000-3f9c2a", "created_at": "2026-09-19T08:00:00Z", "status": "completed",
 "scenario": {"scenario_id": "b41d9f02", "kind": "quality_risk", "t_point": "2026-06-15T08:00:00Z", "overrides": {}, "description": null, "seed": 42},
 "data_hashes": {"data/processed/telemetry.parquet": "e3b0c442…"},
 "versions": {"python": "3.12.6", "lightgbm": "4.5.0", "core": "0.1.0", "contract": "1.0.0"},
 "env": {"mode": "cli", "llm_mode": "off", "hostname": "demo-01"},
 "agents_trace": [{"step_idx": 0, "agent_role": "data"}, {"step_idx": 4, "agent_role": "orchestrator"}],
 "recommendation": {"run_id": "20260919-080000-3f9c2a", "decision": "recommend"},
 "duration_ms": 12400,
 "artifacts": {"report_md": "artifacts/runs/20260919-080000-3f9c2a.md",
               "report_json": "artifacts/runs/20260919-080000-3f9c2a.json",
               "timeline": "artifacts/timeline/20260919-080000-3f9c2a.ndjson"}}
```

## Ошибки сборки

| Условие | Поведение |
| --- | --- |
| Нарушен инвариант карточки (recommend без checks; refuse без reasons) | исключение сборки → `RunStatus.failed`, событие `run_failed` |
| NaN/Inf в числовых полях | молчаливая замена запрещена — исключение (правило «NaN/Inf в JSON запрещены», §0 контракта) |
| Нет `datasets_manifest.json` для прочитанных датасетов | исключение: прогон без `data_hashes` недействителен |
| `artifacts/` недоступен для записи | исключение с явной ошибкой; в CLI — код 3, в API-режиме — `run_failed` |

## Политика хранения

- Имена: `artifacts/runs/{run_id}.json|.md`, `artifacts/timeline/{run_id}.ndjson`;
  `run_id` = `YYYYMMDD-HHMMSS-hex8 (UTC)`.
- Только-добавление: перезапись артефактов запрещена; повторный прогон — новый `run_id` (P3).
- Состав: JSON — полный DTO; Markdown — то же содержимое для чтения; timeline — кадры событий
  для реплея SSE при реконнекте.

## Связи

- **[[14-cli]]**: CLI вызывает `build_run_report` + `persist` после каждого headless-прогона и
  печатает путь к артефактам; `make demo` оставляет прогон каждого сценария в `artifacts/runs/`.
- **backend/03-runs-routes.md**: `GET /api/runs/{id}/report.{md,json}` отдаёт эти файлы (P1),
  не пересобирая отчёт.
- **[[06-artifacts-catalog]]** (data-store): каталог `artifacts/runs/`, формат `run_id`, `timeline`.

## Правила дизайна

> [!warning] Ключевые правила
> 1. Отчёт — зеркало DTO [[07-run-report]]: JSON-артефакт и валидированный pydantic-объект
>    не различаются ни одним полем.
> 2. Сборка только из фактов шагов; report/ не вычисляет качество и не правит карточку.
> 3. Запись только в `artifacts/` (P3); `data/processed/` — read-only для рантайма.
> 4. Отказ попадает в отчёт полностью: причины, детали, трейс до точки отказа.
> 5. Markdown — для человека (оператор), JSON — для машины; содержимое согласовано.

---
title: "DTO AgentStep — трейс шага агента"
tags: [refinery-copilot, api-contract, data-model, dto]
related:
  - "[[01-enums]]"
  - "[[07-run-report]]"
created: 2026-09-19
---

# 05. AgentStep

> [!info] Scope
> Каноническое определение сущности **AgentStep** — записи трейса одного шага агента:
> роль, фаза конвейера (`step_idx`), вход/выход, метки времени, текстовые выводы (`notes`)
> и ссылки на числа (`number_refs`).
> Владелец истины: core — каркас агентов (`agents/base.py`). Потребители: api (SSE-события
> `agent_started`/`agent_finished`), frontend (конвейер агентов), data-store
> (`runs/*.json`).
>
> НЕ охватывает: внутренние структуры контекста агентов (core-architecture/01), логику
> конкретных ролей (03–07, /10), формат SSE-кадров (протокол P1).

## 1. Каноническая форма

Порядок шагов конвейера задаёт `step_idx`: `data = 0 → quality = 1 → reliability = 2 →
optimization = 3 → orchestrator = 4`.

| Поле | Тип | Обязателен | Default | Ограничения | Описание |
| --- | --- | --- | --- | --- | --- |
| `run_id` | `str` | да | — | формат `YYYYMMDD-HHMMSS-hex8 (UTC)` | прогон-владелец |
| `step_idx` | `int` | да | — | ≥ 0, уникален в прогоне | порядок шага (фаза конвейера) |
| `agent_role` | `AgentRole` | да | — | enum [[01-enums]] | `data` / `quality` / `reliability` / `optimization` / `orchestrator` |
| `started_at` | `datetime` | да | — | aware UTC | момент начала шага |
| `finished_at` | `datetime` | да | — | ≥ `started_at` | момент окончания |
| `duration_ms` | `int \| None` | да | `null` | ≥ 0 | длительность; `null` — шаг ещё идёт (событие `agent_started`) |
| `input_digest` | `str` | да | — | sha256, 16 hex-символов | хэш нормализованного входа (воспроизводимость) |
| `input_summary` | `object` | да | `{}` | JSON-объект | ключевые входы **без сырых рядов** |
| `output` | `object` | да | `{}` | JSON-объект | структурированный выход шага |
| `notes` | `list[str]` | да | `[]` | — | текстовые выводы агента |
| `number_refs` | `list[NumberRef]` | да | `[]` | — | `{path, value, unit, label}` — JSON-path числа внутри `output` |
| `confidence` | `float \| None` | нет | `null` | 0..1 | самооценка агента |

## 2. Представления по доменам

### 2.1. Frontend (TypeScript)

```ts
export type AgentRole = 'data' | 'quality' | 'reliability' | 'optimization' | 'orchestrator';

export interface NumberRef {
  path: string;      // JSON-path внутрь output, напр. "sulfur.p50"
  value: number;
  unit: string | null;
  label: string;     // человеческая подпись для карточки
}

export interface AgentStep {
  runId: string;
  stepIdx: number;
  agentRole: AgentRole;
  startedAt: string;  finishedAt: string;  durationMs: number | null;
  inputDigest: string;
  inputSummary: Record<string, unknown>;
  output: Record<string, unknown>;
  notes: string[];
  numberRefs: NumberRef[];
  confidence: number | null;
}
```

### 2.2. Backend (pydantic v2, `backend/src/app/schemas.py`)

```python
class NumberRef(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, allow_inf_nan=False)
    path: str = Field(min_length=1)
    value: float
    unit: str | None = None
    label: str = Field(min_length=1)

class AgentStep(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, allow_inf_nan=False)
    run_id: str
    step_idx: int = Field(ge=0)
    agent_role: AgentRole
    started_at: datetime
    finished_at: datetime
    duration_ms: int | None = Field(default=None, ge=0)
    input_digest: str = Field(pattern=r"[0-9a-f]{16}")
    input_summary: dict[str, Any] = Field(default_factory=dict)
    output: dict[str, Any] = Field(default_factory=dict)
    notes: list[str] = Field(default_factory=list)
    number_refs: list[NumberRef] = Field(default_factory=list)
    confidence: float | None = Field(default=None, ge=0, le=1)
```

### 2.3. Core (dataclass, `refinery_core`)

Каркас `agents/base.py`: агент — чистая функция контекста `run(ctx) -> AgentStep`;
`input_digest` считается по нормализованному JSON входа (детерминизм прогона).

```python
@dataclass(frozen=True, slots=True)
class NumberRef:
    path: str
    value: float
    unit: str | None
    label: str

@dataclass(frozen=True, slots=True)
class AgentStep:
    run_id: str
    step_idx: int
    agent_role: AgentRole
    started_at: datetime
    finished_at: datetime
    input_digest: str
    input_summary: Mapping[str, Any]
    output: Mapping[str, Any]
    notes: tuple[str, ...] = ()
    number_refs: tuple[NumberRef, ...] = ()
    duration_ms: int | None = None      # проставляет каркас по finished_at − started_at
    confidence: float | None = None
```

### 2.4. Data-store — JSON, Parquet не применимо

Шаги хранятся в `artifacts/runs/{run_id}.json` (массив `agents_trace[]` отчёта
[[07-run-report]]) и в журнале реплея `artifacts/timeline/{run_id}.ndjson` (кадры SSE,
протокол P3). Пересечение трейса с Parquet — нет: трейс — артефакт прогона.

> [!note] Правила трансформации
> 1. Событие `agent_started` несёт `AgentStep` без `output`/`number_refs` (пустые объекты/списки);
>    `agent_finished` — полный. Фронт отличает фазу по `duration_ms = null`.
> 2. `Mapping`/`tuple` core → `dict`/`list` DTO; datetime → ISO 8601 UTC; NaN/Inf внутри
>    `output` запрещены — нормализация на границе core.
> 3. `number_refs[i].path` должен разрешаться в число внутри `output` этого же шага
>    (проверка тестом core-architecture/15).

## 3. Таблица маппинга полей

| Каноническое | Frontend (TS) | Backend (Py) | Core (Py) | Data-store |
| --- | --- | --- | --- | --- |
| `run_id` / `step_idx` / `agent_role` | `runId` / `stepIdx` / `agentRole: AgentRole` | `str` / `int` (ge=0) / `AgentRole` | то же (dataclass) | ключ записи в `agents_trace[]` |
| `started_at` / `finished_at` / `duration_ms` | `startedAt` / `finishedAt: string` / `durationMs: number \| null` | `datetime` ×2 / `int \| None` | `datetime` ×2 / `int \| None` | ISO-строки в JSON |
| `input_digest` | `inputDigest: string` | `str` (16 hex) | `str` | строка в JSON |
| `input_summary` / `output` | `Record<string, unknown>` ×2 | `dict[str, Any]` ×2 | `Mapping[str, Any]` ×2 | JSON-объекты |
| `notes` / `number_refs` | `string[]` / `NumberRef[]` | `list[str]` / `list[NumberRef]` | `tuple[str, …]` / `tuple[NumberRef, …]` | JSON-массивы |
| `confidence` | `confidence: number \| null` | `float \| None` (0..1) | `float \| None` | число или null |

## 4. JSON-пример

```json
{"run_id": "20260919-080000-3f9c2a", "step_idx": 1, "agent_role": "quality",
 "started_at": "2026-09-19T08:00:03Z", "finished_at": "2026-09-19T08:00:05Z", "duration_ms": 2100,
 "input_digest": "9f2a1c4e8b7d0f31",
 "input_summary": {"targets": ["sulfur", "t95"]},
 "output": {"sulfur": {"p50": 9.6, "p10": 8.9, "p90": 10.4}},
 "notes": ["Прогноз серы у верхней границы; конформ расширил интервал до 1,5."],
 "number_refs": [{"path": "sulfur.p50", "value": 9.6, "unit": "мг/кг", "label": "Прогноз серы P50"}],
 "confidence": 0.71}
```

Пример для роли `data` (фаза 0, вход — дайджест прочитанных рядов):

```json
{"run_id": "20260919-080000-3f9c2a", "step_idx": 0, "agent_role": "data",
 "started_at": "2026-09-19T08:00:00Z", "finished_at": "2026-09-19T08:00:03Z", "duration_ms": 3000,
 "input_digest": "4b1d2e9a0c7f3856",
 "input_summary": {"tags": 26, "sources": ["kip", "lims", "pak"], "t_point": "2026-09-19T08:00:00Z"},
 "output": {"freshness": [{"point_id": "hdu_product_sulfur", "status": "stale"}], "anomalies": {"dead_tags": ["D10"]}},
 "notes": ["D10 мёртв (99,99 % сентинелов); ЛИМС серы устарел: возраст 44 ч."],
 "number_refs": [{"path": "freshness.0.age_hours", "value": 44.0, "unit": "ч", "label": "Возраст ЛИМС"}],
 "confidence": null}
```

## 5. Инварианты валидации

> [!warning] Проверяются валидатором DTO и тестами каркаса агентов
> 1. `step_idx ≥ 0` и уникален внутри `run_id`; порядок фаз 0–4 задаёт ядро, фронт только отображает.
> 2. `started_at ≤ finished_at`; `duration_ms = (finished_at − started_at) в мс` (допуск округления ≤ 1 мс).
> 3. `input_digest` — ровно 16 hex-символов (обрезанный sha256 нормализованного входа); одинаковый вход ⇒ одинаковый дайджест (детерминизм).
> 4. Каждый `number_refs[i].path` — валидный JSON-path в пределах `output` шага и указывает на число, а не на объект/строку.
> 5. NaN/Inf запрещены и в `output`, и в `number_refs[i].value`.
> 6. `confidence ∈ [0, 1]` либо `null`; `null` легален (агент не обязан самооцениваться).
> 7. `run_id` шага = `run_id` отчёта [[07-run-report]], в котором шаг лежит в `agents_trace[]` на позиции `step_idx`.
> 8. `agent_role` и `step_idx` согласованы с конвейером: data→quality→reliability→optimization→orchestrator.

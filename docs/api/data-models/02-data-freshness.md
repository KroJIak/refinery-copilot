---
title: "DTO DataFreshness — свежесть данных точек контроля"
tags: [refinery-copilot, api-contract, data-model, dto]
related:
  - "[[01-enums]]"
  - "[[04-recommendation]]"
created: 2026-09-19
---

# 02. DataFreshness

> [!info] Scope
> Каноническое определение сущности **DataFreshness** — записи о свежести данных одной
> точки контроля качества (`hdu_product_sulfur`, `blend_product_cn`, …): когда был
> последний замер, когда он стал доступен системе, возраст и статус-светофор.
> Владелец истины: data-pipeline (снимок `freshness.parquet`, P4). Потребители: core
> (триггер отказа `stale_lims`), backend, frontend (светофоры дашборда).
>
> НЕ охватывает: логику вычисления возраста и переоценку статусов (data-pipeline/
> core-architecture/03), решение об отказе (core-architecture/10), перечень точек
> контроля (data-store/04).

## 1. Каноническая форма

| Поле | Тип | Обязателен | Default | Ограничения | Описание |
| --- | --- | --- | --- | --- | --- |
| `point_id` | `str` | да | — | непустой | точка контроля (`hdu_product_sulfur`, `blend_product_cn`) |
| `source` | `DataSource` | да | — | enum [[01-enums]] | источник точки: `lims` / `pak` / `vak` |
| `last_sample_ts` | `datetime \| None` | да | `null` | ≤ `t_point` | метка последнего отбора пробы |
| `available_ts` | `datetime \| None` | да | `null` | = sample + 4 ч (ЛИМС) | когда результат доступен системе |
| `age_hours` | `float \| None` | да | `null` | ≥ 0 | возраст относительно `t_point` |
| `status` | `FreshnessStatus` | да | — | enum [[01-enums]], FSM ниже | `ok` / `warn` / `stale` / `missing` |
| `warn_after_h` | `float` | да | `28.0` | `< stale_after_h` | порог warn: ритм ЛИМС 24 ч + публикация ≤ 4 ч |
| `stale_after_h` | `float` | да | `52.0` | `> warn_after_h` | порог stale: кандидат на отказ |

> [!important] Анти-утечка
> Метка времени ЛИМС = момент **отбора пробы**; результат публикуется до 4 часов. Поэтому
> замер недоступен системе до `last_sample_ts + 4 ч` — сравнение `available_ts` с
> `t_point` исключает использование ещё не опубликованного замера при исторической валидации.
> В рантайме core пересчитывает `age_hours` и `status` на текущий `t_point`; DTO-снимок
> пишет пайплайн в `data/processed/freshness.parquet` (P4).

## 2. Представления по доменам

### 2.1. Frontend (TypeScript)

```ts
export type FreshnessStatus = 'ok' | 'warn' | 'stale' | 'missing';

export interface DataFreshness {
  pointId: string;
  source: 'lims' | 'pak' | 'vak';
  lastSampleTs: string | null;   // ISO 8601 UTC
  availableTs: string | null;
  ageHours: number | null;
  status: FreshnessStatus;
  warnAfterH: number;
  staleAfterH: number;
}
```

### 2.2. Backend (pydantic v2, `backend/src/app/schemas.py`)

```python
class FreshnessStatus(str, Enum):
    ok = "ok"; warn = "warn"; stale = "stale"; missing = "missing"

class DataFreshness(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    point_id: str = Field(min_length=1)
    source: DataSource
    last_sample_ts: datetime | None = None
    available_ts: datetime | None = None
    age_hours: float | None = Field(default=None, ge=0)
    status: FreshnessStatus
    warn_after_h: float = 28.0
    stale_after_h: float = 52.0

    @model_validator(mode="after")
    def _check(self):
        if self.warn_after_h >= self.stale_after_h:
            raise ValueError("warn_after_h must be < stale_after_h")
        return self
```

### 2.3. Core (dataclass, `refinery_core`)

```python
@dataclass(frozen=True, slots=True)
class DataFreshness:
    point_id: str
    source: DataSource
    last_sample_ts: datetime | None
    available_ts: datetime | None
    age_hours: float | None
    status: FreshnessStatus
    warn_after_h: float = 28.0
    stale_after_h: float = 52.0

    def recompute(self, t_point: datetime) -> "DataFreshness":
        """Переоценка age_hours/status на момент t_point (FSM §4.2)."""
```

### 2.4. Data-store (Parquet, P4)

`data/processed/freshness.parquet` — снимок по точкам контроля:

| Колонка | Arrow-тип | Правило |
| --- | --- | --- |
| `point_id` | `string` | — |
| `source` | `dictionary<string>` | значения enum'а |
| `last_sample_ts` / `available_ts` | `timestamp[ms, UTC]` | NaT = `null` |
| `age_hours` | `float64` | NaN = `null` |
| `status` | `dictionary<string>` | значения enum'а |
| `warn_after_h` / `stale_after_h` | `float64` | пороги снимка |

> [!note] Правила трансформации
> 1. Parquet → DTO: NaT → `null`, NaN → `null`, строки → enum.
> 2. DTO → Parquet: обратные преобразования; время только UTC.
> 3. В `RunReport` ([[07-run-report]]) свежесть живёт как `freshness: DataFreshness[]`,
>    в Parquet — только текущий снимок, история не накапливается.

## 3. Таблица маппинга полей

| Каноническое | Frontend (TS) | Backend (Py) | Core (Py) | Data-store |
| --- | --- | --- | --- | --- |
| `point_id` | `pointId: string` | `str` | `str` | `point_id: string` |
| `source` | `source: DataSource` | `DataSource` | `DataSource` | `source: dictionary<string>` |
| `last_sample_ts` / `available_ts` | `lastSampleTs` / `availableTs: string \| null` | `datetime \| None` | `datetime \| None` | `timestamp[ms, UTC]` ×2 |
| `age_hours` | `ageHours: number \| null` | `float \| None` (ge=0) | `float \| None` | `age_hours: float64` |
| `status` | `status: FreshnessStatus` | `FreshnessStatus` | `FreshnessStatus` | `status: dictionary<string>` |
| `warn_after_h` / `stale_after_h` | `warnAfterH` / `staleAfterH: number` | `float` (default 28/52) | `float` | `float64` ×2 |

## 4. JSON-пример

```json
{"point_id": "hdu_product_sulfur", "source": "lims", "last_sample_ts": "2026-09-18T06:00:00Z",
 "available_ts": "2026-09-18T10:00:00Z", "age_hours": 44.0, "status": "stale",
 "warn_after_h": 28.0, "stale_after_h": 52.0}
```

Все статусы (значения для светофоров):

```json
{"point_id": "blend_product_cn", "source": "pak", "last_sample_ts": "2026-09-19T05:30:00Z",
 "available_ts": "2026-09-19T05:30:00Z", "age_hours": 2.5, "status": "ok",
 "warn_after_h": 28.0, "stale_after_h": 52.0}
```

```json
{"point_id": "hdu_product_d15", "source": "pak", "last_sample_ts": "2026-09-17T12:00:00Z",
 "available_ts": "2026-09-17T12:00:00Z", "age_hours": 32.0, "status": "warn",
 "warn_after_h": 28.0, "stale_after_h": 52.0}
```

```json
{"point_id": "blend_product_d15", "source": "pak", "last_sample_ts": null,
 "available_ts": null, "age_hours": null, "status": "missing",
 "warn_after_h": 28.0, "stale_after_h": 52.0}
```

## 5. Инварианты валидации

> [!warning] Проверяются в pydantic-валидаторах, тестах пайплайна и core
> 1. `warn_after_h < stale_after_h`; дефолты 28/52 ч обоснованы ритмом ЛИМС 24 ч + публикация 4 ч.
> 2. `last_sample_ts ≤ t_point`; `age_hours = (t_point − last_sample_ts) в часах`, `age_hours ≥ 0`.
> 3. Для `source = lims`: `available_ts − last_sample_ts = 4 ч` (норматив анти-утечки: публикация ≤ 4 ч) и никакое значение ЛИМС не читается до `available_ts`.
> 4. `last_sample_ts is null` ⇔ `status = missing` и `age_hours is null`.
> 5. `status = stale` ⇒ `age_hours > stale_after_h`; `warn` ⇒ `age_hours > warn_after_h` (и ≤ stale).
> 6. FSM (§4.2): возврат в `ok` — только через новый замер; само по себе время статус из `stale` назад не переводит.
> 7. `status = stale` при целевой точке ЛИМС — прямая причина отказа `stale_lims` в [[04-recommendation]] (решение принимает core, поле DTO — только фиксирует факт).

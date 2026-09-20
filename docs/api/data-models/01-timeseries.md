---
title: "DTO TimeSeries / TagPoint — точка телеметрии и лабзамера"
tags: [refinery-copilot, api-contract, data-model, dto]
related:
  - "[[01-enums]]"
created: 2026-09-19
---

# 01. TimeSeries / TagPoint

> [!info] Scope
> Каноническое определение единственной сущности **TagPoint** — точки временного ряда
> (телеметрия КИП, ЛИМС, ПАК) **после чистки**: сентинелы уже превращены в `null`.
> Ещё одно имя той же сущности — **TimeSeries** = упорядоченный по `ts` список `TagPoint`
> одного `tag_code`; отдельного DTO для серии нет — передаётся массивом `TagPoint[]`.
> Владелец истины: data-pipeline (пишет Parquet, протокол P4). Потребители: data-store,
> core, backend, frontend (см. [[00-SUMMARY]] §3).
>
> НЕ охватывает: правила чистки и детекции залипаний (data-pipeline), физические схемы
> Parquet-датасетов (data-store), транспорт в SSE/REST (протоколы P1).

## 1. Каноническая форма

| Поле | Тип | Обязателен | Default | Ограничения | Описание |
| --- | --- | --- | --- | --- | --- |
| `tag_code` | `str` | да | — | непустой, паттерн `[A-Za-z0-9_.:\-]+` | код тега (`24-2000.P8`, `Q21`, `crude_feed_rate_tph`) |
| `ts` | `datetime` (aware UTC) | да | — | — | момент отсчёта |
| `value` | `float \| None` | да | `null` | не NaN/Inf | физическое значение; `null` = нет данных |
| `quality_flag` | `QualityFlag` | да | `ok` | enum [[01-enums]] | `ok` / `sentinel` / `stuck` / `outlier` / `missing` |
| `source` | `DataSource` | да | — | enum [[01-enums]] | `lims` / `pak` / `vak` / `kip` |
| `unit` | `str \| None` | нет | `null` | короткая строка | единица измерения: `°C`, `МПа`, `т/ч`, `мг/кг` |

> [!important] Сентинелы не существуют за пределами data-pipeline
> Значения-сентинелы `{307, 251, 252, 240}` превращаются пайплайном в `value = null` с
> `quality_flag = "sentinel"`. В API и далее по стеку они не встречаются: потребителю
> достаётся `null` + флаг. Сырые сентинелы остаются только в `data/raw/`.

## 2. Представления по доменам

### 2.1. Frontend (TypeScript)

```ts
export type QualityFlag = 'ok' | 'sentinel' | 'stuck' | 'outlier' | 'missing';
export type DataSource = 'lims' | 'pak' | 'vak' | 'kip';

export interface TagPoint {
  tagCode: string;
  ts: string;            // ISO 8601 UTC, формат date-time
  value: number | null;  // поле присутствует всегда; null = нет значения
  qualityFlag: QualityFlag;
  source: DataSource;
  unit: string | null;
}

// TimeSeries = массив точек одного тега, отсортированный по ts по возрастанию
export type TimeSeries = TagPoint[];
```

### 2.2. Backend (pydantic v2, `backend/src/app/schemas.py`)

```python
from datetime import datetime
from enum import Enum
from pydantic import BaseModel, ConfigDict, Field

class QualityFlag(str, Enum):
    ok = "ok"; sentinel = "sentinel"; stuck = "stuck"; outlier = "outlier"; missing = "missing"

class DataSource(str, Enum):
    lims = "lims"; pak = "pak"; vak = "vak"; kip = "kip"

class TagPoint(BaseModel):
    model_config = ConfigDict(
        alias_generator=lambda n: "".join(w.title() for w in n.split("_")),  # to_camel
        populate_by_name=True,
        allow_inf_nan=False,
    )
    tag_code: str = Field(pattern=r"[A-Za-z0-9_.:\-]+", min_length=1)
    ts: datetime                      # aware UTC
    value: float | None = None
    quality_flag: QualityFlag = QualityFlag.ok
    source: DataSource
    unit: str | None = None
```

### 2.3. Core (dataclass, `refinery_core`)

```python
from dataclasses import dataclass
from datetime import datetime
from refinery_core.types import QualityFlag, DataSource  # enum'ы — единственный источник в core

@dataclass(frozen=True, slots=True)
class TagPoint:
    tag_code: str
    ts: datetime
    value: float | None
    source: DataSource
    quality_flag: QualityFlag = QualityFlag.OK
    unit: str | None = None

    def to_dto(self) -> dict:  # правило трансформации: NaN/Inf → None до сборки DTO
        ...
```

### 2.4. Data-store (Parquet, пишет data-pipeline по P4)

Колонки `data/processed/{telemetry,lims,pak}.parquet`:

| Колонка | Arrow-тип | Правило |
| --- | --- | --- |
| `tag_code` | `dictionary<string>` | без префикса установки — в имени файла датасета |
| `ts` | `timestamp[ms, UTC]` | единый часовой пояс всех источников |
| `value` | `float64` | NaN = «нет значения» (эквивалент канонического `null`) |
| `quality_flag` | `dictionary<string>` | значения enum'а |
| `source` | `dictionary<string>` | значения enum'а |
| `unit` | `string` | пустая строка = `null` |

> [!note] Правила трансформации Parquet ↔ канон
> 1. Чтение (P3, Polars `scan_parquet`): NaN в `value` → `None`; строки флагов → enum.
> 2. Запись (P4): `None` → NaN; enum → строка; datetime → `timestamp[ms, UTC]`.
> 3. Партиционирование по году — см. data-store, `01-naming-conventions.md`.
> 4. В `data/raw/` схема иная (сырые сентинелы); эта каноническая форма начинается
>    только с `data/processed/`.

## 3. Таблица маппинга полей

| Каноническое | Frontend (TS) | Backend (Py) | Core (Py) | Data-store |
| --- | --- | --- | --- | --- |
| `tag_code` | `tagCode: string` | `str` (pattern) | `str` | `tag_code: dictionary<string>` |
| `ts` | `ts: string` (ISO 8601 UTC) | `datetime` | `datetime` | `ts: timestamp[ms, UTC]` |
| `value` | `value: number \| null` | `float \| None` (`allow_inf_nan=False`) | `float \| None` | `value: float64` (NaN = null) |
| `quality_flag` | `qualityFlag: QualityFlag` | `QualityFlag` | `QualityFlag` | `quality_flag: dictionary<string>` |
| `source` | `source: DataSource` | `DataSource` | `DataSource` | `source: dictionary<string>` |
| `unit` | `unit: string \| null` | `str \| None` | `str \| None` | `unit: string` ("" = null) |

## 4. JSON-пример

```json
{"tag_code": "24-2000.P8", "ts": "2026-09-19T08:00:00Z", "value": 341.2,
 "quality_flag": "ok", "source": "kip", "unit": "°C"}
```

```json
{"tag_code": "D10", "ts": "2026-09-19T08:00:00Z", "value": null,
 "quality_flag": "sentinel", "source": "kip", "unit": "т/ч"}
```

## 5. Инварианты валидации

> [!warning] Проверяются и в pydantic-валидаторах, и в тестах core
> 1. `value` — не NaN и не Inf (JSON запрещает их: вместо них всегда `null`).
> 2. `quality_flag in {sentinel, missing}` ⇒ `value is null`; `quality_flag == ok` ⇒ `value is not null`.
> 3. `ts` — aware-datetime в UTC; наивные datetime отклоняются.
> 4. `tag_code` соответствует паттерну `[A-Za-z0-9_.:\-]+`; суффиксы сентинелов валидатором не отбрасываются — их не должно быть в значении (см. п. 6).
> 5. `unit` либо `null`, либо короткая строка; конвертация единиц описывается вне DTO.
> 6. Значения `{307, 251, 252, 240}` физически невозможны в `value` после чистки — их появление означает баг пайплайна (тест data-pipeline/10).
> 7. `source` из enum [[01-enums]]; приоритет источников при расхождении (ЛИМС → ПАК → ВАК) — логика core, не поля DTO.

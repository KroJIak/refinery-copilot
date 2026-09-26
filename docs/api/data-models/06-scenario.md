---
title: "DTO Scenario — сценарий прогона"
tags: [refinery-copilot, api-contract, data-model, dto]
related:
  - "[[01-enums]]"
  - "[[07-run-report]]"
created: 2026-09-19
---

# 06. Scenario

> [!info] Scope
> Каноническое определение сущности **Scenario** — входа прогона: вид сценария, момент
> состояния процесса, переопределения входов и сид воспроизводимости.
> Владелец истины: core (+ пресеты в api). Потребители: backend (`POST /api/runs` — тело
> запроса), frontend (кнопки пресетов, контролы what-if), delivery-infra
> (`make demo --scenario`).
>
> НЕ охватывает: генерацию/исполнение сценариев (core-architecture/13-scenarios,
> /14-cli), пресеты фикстур фронта (api/90, frontend/05), транспорт (P1).

## 1. Каноническая форма

| Поле | Тип | Обязателен | Default | Ограничения | Описание |
| --- | --- | --- | --- | --- | --- |
| `scenario_id` | `str` | да | — | uuid4-hex, 8 символов | идентификатор |
| `kind` | `ScenarioKind` | да | `normal` | enum [[01-enums]] | вид сценария (таблица ниже) |
| `t_point` | `datetime` | да | — | aware UTC; внутри обученных данных | момент состояния процесса |
| `overrides` | `object` | да | `{}` | ключи — только управляемые теги; значения — числа | переопределения входов |
| `description` | `str \| None` | нет | `null` | короткий текст | человеческое описание |
| `seed` | `int` | да | `42` | ≥ 0 | сид воспроизводимости |

Пять пресетов `ScenarioKind`:

| `kind` | Смысл | Ожидаемый исход |
| --- | --- | --- |
| `normal` | нормальный режим | рекомендации не создаются без нужды |
| `quality_risk` | прижат к границе серы | рекомендация крутки |
| `bad_data` | сентинелы / залипания / мёртвые каналы | отказ или предупреждения по данным |
| `sour_crude` | сернистая нефть | рекомендация режима гидроочистки/блендинга |
| `stale_lims` | гарантированный отказ по свежести | штатный отказ `stale_lims` |

> [!important] Управляемые теги в `overrides`
> Только официально подтверждённые управляемые переменные:
> гидроочистка `24-2000.P8` (T ГСС), `24-2000.T11` (расход сырья), `24-2000.F19`
> (давление на входе Р-202); АВТ `crude_feed_rate_tph`, `avt_furnace_outlet_temp_c`,
> `avt_column_pressure_mpa_abs`; блендинг — доли компонентов (в сумме = 100 %) и
> `blend_additive_pct` (≤ 3 %). Override неуправляемого тега отклоняется с 400 (P1).

## 2. Представления по доменам

### 2.1. Frontend (TypeScript)

```ts
export type ScenarioKind = 'normal' | 'quality_risk' | 'bad_data' | 'sour_crude' | 'stale_lims';

export interface Scenario {
  scenarioId: string;
  kind: ScenarioKind;
  tPoint: string;                    // ISO 8601 UTC
  overrides: Record<string, number>; // только управляемые теги
  description: string | null;
  seed: number;
}
```

### 2.2. Backend (pydantic v2, `backend/src/app/schemas.py`)

```python
class Scenario(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, allow_inf_nan=False)
    scenario_id: str = Field(pattern=r"[0-9a-f]{8}")
    kind: ScenarioKind = ScenarioKind.normal
    t_point: datetime
    overrides: dict[str, float] = Field(default_factory=dict)
    description: str | None = None
    seed: int = Field(default=42, ge=0)

    @model_validator(mode="after")
    def _controlled_only(self):
        unknown = set(self.overrides) - CONTROLLED_TAGS  # справочник управляемых из core
        if unknown:
            raise ValueError(f"неуправляемые теги в overrides: {sorted(unknown)}")
        return self
```

В теле `POST /api/runs` поле `scenario_id` не передаётся (генерирует ядро) — принимается
`Scenario` без него (протокол P1).

### 2.3. Core (dataclass, `refinery_core`)

```python
@dataclass(frozen=True, slots=True)
class Scenario:
    scenario_id: str
    kind: ScenarioKind
    t_point: datetime
    overrides: Mapping[str, float]
    seed: int = 42
    description: str | None = None

    # Исполнение: start_run(scenario) — P2 (события — asyncio.Queue через subscribe_events);
    # один seed → одно решение.
```

### 2.4. Data-store — JSON, Parquet не применимо

Сценарий хранится внутри `artifacts/runs/{run_id}.json` (поле `scenario` отчёта
[[07-run-report]]) и в пресетах `core-architecture/13-scenarios`; отдельного
Parquet-датасета нет.

> [!note] Правила трансформации
> 1. DTO → core: `dict` → `Mapping`, строки времени → aware-datetime UTC.
> 2. `overrides` не нормализуются молча: неизвестный ключ — ошибка валидации, а не игнорирование.
> 3. `seed` протаскивается без изменений в отчёт прогона (воспроизводимость «один seed → одно решение»).

## 3. Таблица маппинга полей

| Каноническое | Frontend (TS) | Backend (Py) | Core (Py) | Data-store |
| --- | --- | --- | --- | --- |
| `scenario_id` / `kind` | `scenarioId: string` / `kind: ScenarioKind` | `str` / `ScenarioKind` | то же | — (внутри `runs/*.json`) |
| `t_point` | `tPoint: string` | `datetime` | `datetime` | — |
| `overrides` | `overrides: Record<string, number>` | `dict[str, float]` (валидация ключей) | `Mapping[str, float]` | — |
| `description` / `seed` | `description` / `seed` | `str \| None` / `int` (ge=0) | `str \| None` / `int` | — |

## 4. JSON-пример

```json
{"scenario_id": "b41d9f02", "kind": "quality_risk", "t_point": "2026-06-15T08:00:00Z",
 "overrides": {"blend_share_kerosene": 0.12}, "description": "2026 прижат к границе по сере", "seed": 42}
```

Пресет `stale_lims` (гарантированный отказ):

```json
{"scenario_id": "c7a0e513", "kind": "stale_lims", "t_point": "2026-05-20T08:00:00Z",
 "overrides": {}, "description": "ЛИМС серы устарел больше порога", "seed": 42}
```

## 5. Инварианты валидации

> [!warning] Проверяются валидатором DTO и тестами core
> 1. `scenario_id` — 8 hex-символов; уникальность гарантируется генерацией ядра (uuid4-hex8).
> 2. `kind` — только значения enum [[01-enums]]; неизвестный `kind` → HTTP 400 (P1).
> 3. Ключи `overrides` — только управляемые теги; сумма долей бленда = 100 %; `blend_additive_pct ≤ 3`.
> 4. Значения `overrides` — конечные числа (не NaN/Inf); диапазоны круток — модельные p2/p98, помечены как допущение (правило модельных границ).
> 5. `t_point` — aware UTC и внутри диапазона обученности моделей ([[08-model-artifact]], `trained_on_range`); вне диапазона ядро обязано отказать (`out_of_training_domain`), а не затыкаться.
> 6. `seed ≥ 0`; фиксируется в отчёте [[07-run-report]] — при одинаковом состоянии и seed решение и числа совпадают.
> 7. Пресет `stale_lims` обязан приводить к штатному отказу — приёмочный тест `make demo`.

---
title: "DTO QualityAssessment — квантильный прогноз качества"
tags: [refinery-copilot, api-contract, data-model, dto]
related:
  - "[[01-enums]]"
  - "[[08-model-artifact]]"
created: 2026-09-19
---

# 03. QualityAssessment

> [!info] Scope
> Каноническое определение сущности **QualityAssessment** — квантильного прогноза одного
> показателя качества (сера, T95, ЦЧ, плотность): точка **P50**, интервал **P10–P90**
> (конформ MAPIE), риск off-spec и топ-факторы SHAP.
> Владелец истины: core — агент качества (роль `quality`). Потребители: optimization,
> orchestrator, backend, frontend (см. [[00-SUMMARY]] §3).
>
> НЕ охватывает: сами модели и признаки ([[08-model-artifact]]), генерацию круток
> (core-architecture/07), сборку карточки [[04-recommendation]].

## 1. Каноническая форма

| Поле | Тип | Обязателен | Default | Ограничения | Описание |
| --- | --- | --- | --- | --- | --- |
| `target` | `QualityTarget` | да | — | enum [[01-enums]] | `sulfur` / `t95` / `d15` / `cetane` |
| `horizon_h` | `float` | да | `1.0` | 0–3 ч[^dop] | горизонт прогноза |
| `unit` | `str` | да | — | по цели | `мг/кг` (sulfur), `°C` (t95), `кг/м³` (d15), `пункт` (cetane) |
| `p10` / `p50` / `p90` | `float` | да | — | `p10 ≤ p50 ≤ p90` | квантили прогноза; P50 — центральная оценка |
| `interval_width` | `float` | да | — | `= p90 − p10` | ширина интервала; признак отказа `wide_interval` |
| `spec_risk` | `float` | да | — | 0..1 | P(выход за спецификацию) при базовом режиме |
| `conformal_applied` | `bool` | да | `false` | — | применена конформ-калибровка MAPIE |
| `model_artifact_id` | `str` | да | — | id → [[08-model-artifact]] | какой моделью артефакт считал прогноз |
| `shap_top_k` | `list[ShapItem]` | да | `[]` | `k ≤ 5` | `{feature, value, contribution}` — топ-факторы |
| `computed_at` | `datetime` | да | — | aware UTC | момент расчёта |

[^dop]: Задержка «воздействие → качество» 0–3 ч — по результатам анализа истории данных; горизонт прогноза 0–3 ч.

> [!important] Приоритет источников значения
> Контрольный факт — лаборатория. При расхождении источников истинность значения:
> **ЛИМС → ПАК → ВАК → модель** (приоритет зафиксирован по результатам анализа истории данных). Сам DTO
> источник не хранит — приоритет разрешает core при выборе значения для сверки
> `p50` с последним измерением; DTO фиксирует только прогнозные квантили.

## 2. Представления по доменам

### 2.1. Frontend (TypeScript)

```ts
export type QualityTarget = 'sulfur' | 't95' | 'd15' | 'cetane';

export interface ShapItem { feature: string; value: number; contribution: number; }

export interface QualityAssessment {
  target: QualityTarget;
  horizonH: number;      // 0–3 ч
  unit: string;
  p10: number; p50: number; p90: number;
  intervalWidth: number; // = p90 − p10
  specRisk: number;      // 0..1
  conformalApplied: boolean;
  modelArtifactId: string;
  shapTopK: ShapItem[];
  computedAt: string;    // ISO 8601 UTC
}
```

### 2.2. Backend (pydantic v2, `backend/src/app/schemas.py`)

```python
class ShapItem(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, allow_inf_nan=False)
    feature: str
    value: float
    contribution: float

class QualityAssessment(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, allow_inf_nan=False)
    target: QualityTarget
    horizon_h: float = Field(default=1.0, ge=0, le=3)
    unit: str = Field(min_length=1)
    p10: float
    p50: float
    p90: float
    interval_width: float
    spec_risk: float = Field(ge=0, le=1)
    conformal_applied: bool = False
    model_artifact_id: str = Field(min_length=1)
    shap_top_k: list[ShapItem] = Field(default_factory=list, max_length=5)
    computed_at: datetime

    @model_validator(mode="after")
    def _quantiles(self):
        if not (self.p10 <= self.p50 <= self.p90):
            raise ValueError("p10 <= p50 <= p90 violated")
        if abs(self.interval_width - (self.p90 - self.p10)) > 1e-9:
            raise ValueError("interval_width != p90 - p10")
        return self
```

### 2.3. Core (dataclass, `refinery_core`)

```python
@dataclass(frozen=True, slots=True)
class ShapItem:
    feature: str
    value: float
    contribution: float

@dataclass(frozen=True, slots=True)
class QualityAssessment:
    target: QualityTarget
    horizon_h: float
    unit: str
    p10: float
    p50: float
    p90: float
    interval_width: float
    spec_risk: float
    conformal_applied: bool
    model_artifact_id: str
    shap_top_k: tuple[ShapItem, ...] = ()
    computed_at: datetime  # проставляет агент качества

    def to_dto(self) -> dict:  # NaN/Inf → None запрещены контрактом; квантили валидируются
        ...
```

### 2.4. Data-store (Parquet) — не применимо

Сущность живёт в `artifacts/runs/{run_id}.json` (поле `quality` отчёта [[07-run-report]])
и в SSE-событиях; отдельного Parquet-датасета нет. Метрики самих моделей (WAPE/MAE/pinball/
coverage) — в `artifacts/metrics.json` и манифесте [[08-model-artifact]], а не здесь.

> [!note] Правила трансформации
> 1. Core-объект → DTO: `tuple` → `list`; datetime → ISO 8601 UTC; поля snake_case → camelCase.
> 2. NaN/Inf в любом числовом поле запрещены: конформ-калибровка обязана выдать конечные квантили, иначе агент качества возвращает отказ.
> 3. Обратного преобразования DTO → Parquet нет: оценка — производный артефакт прогона.

## 3. Таблица маппинга полей

| Каноническое | Frontend (TS) | Backend (Py) | Core (Py) | Data-store |
| --- | --- | --- | --- | --- |
| `target` / `unit` / `horizon_h` | `target: QualityTarget` / `unit: string` / `horizonH: number` | `QualityTarget` / `str` / `float` (0–3) | то же (dataclass) | — (в `runs/*.json`) |
| `p10` / `p50` / `p90` | `number` | `float` (валидация p10≤p50≤p90) | `float` | — |
| `interval_width` / `spec_risk` | `intervalWidth` / `specRisk: number` | `float` (width=p90−p10; risk 0..1) | `float` | — |
| `conformal_applied` / `model_artifact_id` | `conformalApplied: boolean` / `modelArtifactId: string` | `bool` / `str` | `bool` / `str` | — |
| `shap_top_k` | `shapTopK: ShapItem[]` | `list[ShapItem]` (≤5) | `tuple[ShapItem, …]` | — |
| `computed_at` | `computedAt: string` | `datetime` | `datetime` | — |

## 4. JSON-пример

```json
{"target": "sulfur", "horizon_h": 2.0, "unit": "мг/кг", "p10": 8.9, "p50": 9.6, "p90": 10.4,
 "interval_width": 1.5, "spec_risk": 0.38, "conformal_applied": true,
 "model_artifact_id": "sulfur-lgbm-a1b2c3d4",
 "shap_top_k": [{"feature": "T5", "value": 371.0, "contribution": 0.42}],
 "computed_at": "2026-09-19T08:05:00Z"}
```

Пример по плотности (данные ПАК D15 есть только с 03.2025):

```json
{"target": "d15", "horizon_h": 1.0, "unit": "кг/м³", "p10": 836.1, "p50": 838.4, "p90": 840.9,
 "interval_width": 4.8, "spec_risk": 0.0, "conformal_applied": true,
 "model_artifact_id": "d15-lgbm-9f31ce07", "shap_top_k": [],
 "computed_at": "2026-09-19T08:05:00Z"}
```

## 5. Инварианты валидации

> [!warning] Проверяются в pydantic-валидаторах и тестах агента качества
> 1. `p10 ≤ p50 ≤ p90`; NaN/Inf запрещены во всех числовых полях.
> 2. `interval_width = p90 − p10` (с точностью до погрешности округления).
> 3. `spec_risk ∈ [0, 1]`; `0 ≤ horizon_h ≤ 3`.
> 4. `shap_top_k` — не более 5 элементов; сортировка по убыванию `|contribution|` — соглашение агента, пустой список легален (SHAP недоступен).
> 5. `model_artifact_id` существует в реестре моделей ([[08-model-artifact]]) и `active` на момент прогона; иначе оценка невалидна.
> 6. `unit` соответствует `target` (sulfur → `мг/кг`, t95 → `°C`, d15 → `кг/м³`, cetane → `пункт`).
> 7. `conformal_applied = false` при `p90 − p10` выходящем за обученную ширину — сигнал качества модели, не ошибка контракта; решает core ([[04-recommendation]], причина `wide_interval`).
> 8. Оценка по `d15` при отсутствии данных (до 03.2025) не строится — вместо неё отказ, а не заглушка.

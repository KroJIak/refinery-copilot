---
title: "DTO Recommendation — карточка рекомендации оператору"
tags: [refinery-copilot, api-contract, data-model, dto]
related:
  - "[[01-enums]]"
  - "[[07-run-report]]"
created: 2026-09-19
---

# 04. Recommendation — карточка рекомендации

> [!info] Scope
> Каноническое определение сущности **Recommendation** — итоговой карточки для оператора:
> **состояние → риск → действие «тег: с → до» → эффект → проверенные ограничения →
> уверенность → объяснение**. Альтернативный первоклассный исход —
> **отказ** с перечнем `RefusalReason`.
> Владелец истины: core — оркестратор (роль `orchestrator`). Потребители: api (SSE-событие
> `recommendation`/`refusal`), backend, frontend (карточка рекомендации), data-store
> (`artifacts/runs/{run_id}.json`).
>
> НЕ охватывает: правила принятия решения «рекомендовать/отказаться»
> (core-architecture/09, /10), рендер карточки (frontend/08), тексты нарратора (90-narrator).

## 1. Каноническая форма

| Поле | Тип | Обязателен | Default | Ограничения | Описание |
| --- | --- | --- | --- | --- | --- |
| `run_id` | `str` | да | — | формат `YYYYMMDD-HHMMSS-hex8 (UTC)` | прогон-владелец |
| `created_at` | `datetime` | да | — | aware UTC | момент сборки карточки |
| `t_point` | `datetime` | да | — | aware UTC | точка состояния процесса |
| `decision` | `Decision` | да | — | `recommend` \| `refuse` | вид исхода |
| `state` | `list[StateItem]` | да | `[]` | ≤ 12 позиций | снимок состояния: `{tag, value, unit}` |
| `risks` | `list[RiskItem]` | да | `[]` | по каждой цели | `{target, limit, limit_value, p50, p10, p90, spec_risk}` |
| `actions` | `list[ActionItem]` | да* | `[]` | *обязателен при recommend | `{tag, unit, current_value, recommended_value, delta_pct}` — только управляемые теги |
| `effects` | `list[EffectItem]` | да* | `[]` | *обязателен при recommend | `{target, unit, baseline_p50, action_p50, p10, p90, margin_to_spec}` |
| `checks` | `list[CheckItem]` | да* | `[]` | *обязателен при recommend | `{constraint_id, description, limit, unit, value, passed}` |
| `confidence` | `ConfidenceInterval` | да* | — | `{p10, p90}`, 0..1, p10 ≤ p90 | *при recommend: интервал вероятности прохождения всех проверок |
| `explanation` | `str` | да | — | непустой | почему выбран вариант / почему отказ; чем лучше альтернатив |
| `alternatives` | `list[AlternativeItem]` | нет | `[]` | Парето-варианты | `{label, actions, quality, cost_index, pareto_rank}` |
| `refusal` | `RefusalInfo \| None` | да | `null` | обязателен при refuse | `{reasons: list[RefusalReason], details: list[str]}` |

> [!note] Жёсткие ограничения, проверяемые в `checks`
> Сера ≤ 10 мг/кг; T95 ≤ 360 °C; ЦЧ ≥ 51 летнее / ≥ 49 зимнее; плотность 820–845 (летнее) /
> 800–845 (зимнее); доли бленда = 100 %; присадка ≤ 3 %; модельные
> диапазоны p2/p98 — с пометкой «допущение» (правило модельных границ).

## 2. Представления по доменам

### 2.1. Frontend (TypeScript)

```ts
export type Decision = 'recommend' | 'refuse';
export type QualityTarget = 'sulfur' | 't95' | 'd15' | 'cetane';
export type RefusalReason = 'stale_lims' | 'wide_interval' | 'out_of_training_domain'
  | 'no_feasible_variant' | 'sensor_fault';

export interface StateItem { tag: string; value: number | null; unit: string | null; }
export interface RiskItem { target: QualityTarget; limit: string; limitValue: number;
  p50: number; p10: number; p90: number; specRisk: number; }
export interface ActionItem { tag: string; unit: string | null;
  currentValue: number; recommendedValue: number; deltaPct: number | null; }
export interface EffectItem { target: QualityTarget; unit: string; baselineP50: number;
  actionP50: number; p10: number; p90: number; marginToSpec: number; }
export interface CheckItem { constraintId: string; description: string;
  limit: number | string; unit: string | null; value: number; passed: boolean; }
export interface ConfidenceInterval { p10: number; p90: number; }
export interface AlternativeItem { label: string; actions: ActionItem[];
  quality: { target: QualityTarget; p10: number; p50: number; p90: number }[];
  costIndex: number; paretoRank: number; }
export interface RefusalInfo { reasons: RefusalReason[]; details: string[]; }

export interface Recommendation {
  runId: string; createdAt: string; tPoint: string; decision: Decision;
  state: StateItem[]; risks: RiskItem[];
  actions?: ActionItem[]; effects?: EffectItem[]; checks?: CheckItem[];
  confidence?: ConfidenceInterval;
  explanation: string; alternatives: AlternativeItem[]; refusal: RefusalInfo | null;
}
```

### 2.2. Backend (pydantic v2, `backend/src/app/schemas.py`)

```python
Decision = Literal["recommend", "refuse"]

class ConfidenceInterval(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    p10: float = Field(ge=0, le=1)
    p90: float = Field(ge=0, le=1)

class Recommendation(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, allow_inf_nan=False)
    run_id: str
    created_at: datetime
    t_point: datetime
    decision: Decision
    state: list[StateItem] = Field(default_factory=list, max_length=12)
    risks: list[RiskItem] = Field(default_factory=list)
    actions: list[ActionItem] = Field(default_factory=list)
    effects: list[EffectItem] = Field(default_factory=list)
    checks: list[CheckItem] = Field(default_factory=list)
    confidence: ConfidenceInterval | None = None
    explanation: str = Field(min_length=1)
    alternatives: list[AlternativeItem] = Field(default_factory=list)
    refusal: RefusalInfo | None = None

    @model_validator(mode="after")
    def _decision_invariants(self):
        if self.decision == "recommend":
            if not (self.actions and self.effects and self.checks and self.confidence):
                raise ValueError("recommend требует непустые actions/effects/checks/confidence")
            if self.refusal is not None or not all(c.passed for c in self.checks):
                raise ValueError("recommend недопустим при refusal или непройденных checks")
        else:
            if self.refusal is None or not self.refusal.reasons:
                raise ValueError("refuse требует непустой refusal.reasons")
        return self
```

### 2.3. Core (dataclass, `refinery_core`)

Оркестратор собирает карточку из результатов агентов; enum `DecisionKind` живёт в
`refinery_core/types.py`. Инвариант ниже — инвариант сборки, продублирован валидатором DTO.

```python
@dataclass(frozen=True, slots=True)
class Recommendation:
    run_id: str
    created_at: datetime
    t_point: datetime
    decision: DecisionKind                  # recommend | refuse
    state: tuple[StateItem, ...]
    risks: tuple[RiskItem, ...]
    actions: tuple[ActionItem, ...]
    effects: tuple[EffectItem, ...]
    checks: tuple[CheckItem, ...]
    confidence: ConfidenceInterval | None
    explanation: str
    alternatives: tuple[AlternativeItem, ...] = ()
    refusal: RefusalInfo | None = None

    def validate_invariants(self) -> None:
        # recommend ⇒ actions/effects/checks/confidence непусты, refusal is None,
        #            все checks.passed == True;
        # refuse    ⇒ refusal.reasons непуст.
```

### 2.4. Data-store — JSON-артефакт, Parquet не применимо

Карточка живёт целиком в `artifacts/runs/{run_id}.json` (поле `recommendation` отчёта
[[07-run-report]], соответствие 1:1) и уходит в SSE-событие `recommendation` | `refusal`
(протокол P1). Переписывание артефакта запрещено: повторный прогон создаёт новый `run_id`.

> [!note] Правила трансформации
> 1. Core-кортежи → DTO-списки; datetime → ISO 8601 UTC; snake_case → camelCase (alias).
> 2. Числа в тексте `explanation` — только из расчёта (`number_refs` шага оркестратора
>    [[05-agent-step]]); нарратор не порождает значений.
> 3. В TS `actions/effects/checks/confidence` объявлены опциональными — для переходного
>    состояния конвейера; валидатор backend гарантирует их непустоту при `recommend`.

## 3. Таблица маппинга полей

| Каноническое | Frontend (TS) | Backend (Py) | Core (Py) | Data-store |
| --- | --- | --- | --- | --- |
| `decision` | `decision: Decision` | `Literal["recommend", "refuse"]` | enum `DecisionKind` | — |
| `state` / `risks` | `StateItem[]` / `RiskItem[]` | `list[...]` pydantic-элементов | `tuple[...]` dataclass | — |
| `actions[i]`: `current_value → recommended_value` | `currentValue → recommendedValue: number` | `float → float` | `float → float` | — |
| `effects` / `checks` | `EffectItem[]` / `CheckItem[]` | `list[...]` | `tuple[...]` | — |
| `confidence` | `confidence: ConfidenceInterval` | `ConfidenceInterval \| None` | `ConfidenceInterval \| None` | — |
| `explanation` / `alternatives` | `explanation: string` / `AlternativeItem[]` | `str` / `list[AlternativeItem]` | `str` / `tuple` | — |
| `refusal` | `refusal: RefusalInfo \| null` | `RefusalInfo \| None` | `RefusalInfo \| None` | — |
| `run_id` / `created_at` / `t_point` | `runId` / `createdAt` / `tPoint: string` | `str` / `datetime` ×2 | `str` / `datetime` ×2 | `artifacts/runs/{run_id}.json` |

## 4. JSON-пример

Вариант «рекомендация» (`decision = "recommend"`):

```json
{"run_id": "20260919-080000-3f9c2a", "created_at": "2026-09-19T08:05:01Z",
 "t_point": "2026-09-19T08:00:00Z", "decision": "recommend",
 "state": [{"tag": "Q21", "value": 9.4, "unit": "мг/кг"}, {"tag": "T5", "value": 371.0, "unit": "°C"}],
 "risks": [{"target": "sulfur", "limit": "≤ 10 мг/кг", "limit_value": 10.0, "p50": 9.6, "p10": 8.9, "p90": 10.4, "spec_risk": 0.38}],
 "actions": [{"tag": "24-2000.P8", "unit": "°C", "current_value": 341.2, "recommended_value": 339.5, "delta_pct": -0.5}],
 "effects": [{"target": "sulfur", "unit": "мг/кг", "baseline_p50": 9.6, "action_p50": 9.1, "p10": 8.4, "p90": 9.8, "margin_to_spec": 0.9}],
 "checks": [{"constraint_id": "sulfur_max", "description": "сера ≤ 10 мг/кг", "limit": 10.0, "unit": "мг/кг", "value": 9.8, "passed": true},
            {"constraint_id": "t95_max", "description": "T95 ≤ 360 °C", "limit": 360.0, "unit": "°C", "value": 355.1, "passed": true},
            {"constraint_id": "cetane_min_summer", "description": "ЦЧ ≥ 51 (летнее)", "limit": 51.0, "unit": "пункт", "value": 52.3, "passed": true}],
 "confidence": {"p10": 0.62, "p90": 0.88},
 "explanation": "Снижение T ГСС на 1,7 °C уменьшает серу ~0,5 мг/кг (санити ~0,3 мг/кг/°C) и снимает риск off-spec; запас по T95 и ЦЧ сохраняется.",
 "alternatives": [{"label": "Присадка 1,5 %", "actions": [{"tag": "blend_additive_pct", "unit": "%", "current_value": 0.0, "recommended_value": 1.5, "delta_pct": null}],
                   "quality": [{"target": "cetane", "p10": 51.8, "p50": 52.3, "p90": 52.9}], "cost_index": 1.5, "pareto_rank": 2}],
 "refusal": null}
```

Вариант «отказ» — тот же набор полей, вместо `actions/effects/checks/confidence` заполнен `refusal`:

```json
{"run_id": "20260919-080000-3f9c2a", "decision": "refuse",
 "refusal": {"reasons": ["stale_lims", "wide_interval"],
             "details": ["Возраст последнего ЛИМС 44 ч > 28 ч",
                         "Интервал серы 8,9–10,4 мг/кг пересекает границу 10 мг/кг"]},
 "explanation": "Надёжной рекомендации нет: последнее лабораторное значение устарело, а доступные варианты либо нарушают ограничение по качеству, либо выходят за заданный модельный диапазон."}
```

## 5. Инварианты валидации

> [!warning] Инварианты исхода — ядро контракта (проверяются валидатором и тестами core)
> 1. `decision = "recommend"` ⇒ `actions`, `effects`, `checks`, `confidence` непусты **и все** `checks[].passed = true` **и** `refusal is null`. **Рекомендация без пройденных жёстких ограничений недопустима.**
> 2. `decision = "refuse"` ⇒ `refusal` не `null` и `refusal.reasons` непуст; `details[i]` раскрывает `reasons[i]` человеческим текстом.
> 3. `confidence`: `0 ≤ p10 ≤ p90 ≤ 1`.
> 4. Все `actions[].tag` — только управляемые переменные (`24-2000.P8/T11/F19`, АВТ-переменные, доли бленда, присадка); изменение неуправляемого тега — ошибка сборки.
> 5. `effects[i].margin_to_spec` согласован с соответствующим `checks[]`: эффект, приводящий к нарушению, не может пройти проверку.
> 6. `checks` покрывает обязательный минимум нормативных проверок: сера ≤ 10 мг/кг, доли = 100 %, присадка ≤ 3 %, плюс T95/ЦЧ/плотность и модельные p2/p98 (с пометкой допущения).
> 7. `explanation` непуст у обоих исходов; отказ формулируется как штатный ответ, а не ошибка.
> 8. `run_id` карточки = `run_id` отчёта [[07-run-report]]; `risks[i].p10/p50/p90` — квантили из [[03-quality-assessment]] той же цели.

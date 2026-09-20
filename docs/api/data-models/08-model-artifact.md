---
title: "DTO ModelArtifact — манифест модели реестра"
tags: [refinery-copilot, api-contract, data-model, dto]
related:
  - "[[01-enums]]"
  - "[[03-quality-assessment]]"
created: 2026-09-19
---

# 08. ModelArtifact

> [!info] Scope
> Каноническое определение сущности **ModelArtifact** — манифеста обученной модели
> (алгоритм, признаки, гиперпараметры, диапазон обученности, квантили, конформ-параметры,
> метрики time-split валидации, хэши) в реестре моделей.
> Владелец истины: data-pipeline (обучает и публикует, P5). Потребители: core (registry —
> только загрузка, обучение в рантайме запрещено), backend (`GET /api/models`),
> frontend (страница «Модели»).
>
> НЕ охватывает: сам файл весов `model.txt` (бинарник LightGBM), процедуру обучения
> (data-pipeline/06–09), расчёт SHAP (core-architecture/11).

## 1. Каноническая форма

| Поле | Тип | Обязателен | Default | Ограничения | Описание |
| --- | --- | --- | --- | --- | --- |
| `artifact_id` | `str` | да | — | `{target}-{algo}-{hex8}` | идентификатор; **одна** `active` на `target` |
| `target` | `QualityTarget` | да | — | enum [[01-enums]] | целевая величина: `sulfur` / `t95` / `d15` / `cetane` |
| `algorithm` | `str` | да | `lightgbm_quantile` | непустой | алгоритм обучения |
| `quantiles` | `list[float]` | да | `[0.1, 0.5, 0.9]` | отсортированы по возрастанию, 0..1 | квантили прогноза |
| `model_uri` | `str` | да | — | относительный путь | `artifacts/models/{artifact_id}/model.txt` |
| `hyperparams` | `object` | да | `{}` | JSON-объект | гиперпараметры LightGBM (objective, leaves, lr, …) |
| `conformal` | `object` | да | `{}` | JSON-объект | MAPIE (EnbPI/ACI): метод и параметры |
| `coverage` | `float` | да | — | 0..1 | покрытие интервала P10–P90 на holdout |
| `metrics` | `object` | да | `{}` | из `metrics.json` | WAPE / MAE / pinball_p50 time-split валидации |
| `trained_on_range` | `TrainedRange` | да | — | `{start, end}`, start ≤ end | диапазон обученности (анти-«вне домена») |
| `features` | `list[str]` | да | `[]` | без дубликатов | имена признаков в порядке обучения |
| `monotone_constraints` | `object` | да | `{}` | признак → ±1 | физические монотонности (напр. `T5 → +1` для серы) |
| `data_hashes` | `object` | да | `{}` | путь → sha256 | хэши обучающих датасетов |
| `created_at` | `datetime` | да | — | aware UTC | время обучения |
| `seed` | `int` | да | `42` | ≥ 0 | сид обучения (воспроизводимость) |
| `core_version` | `str` | да | — | semver-подобная | версия ядра; мажорное расхождение ⇒ артефакт игнорируется |
| `active` | `bool` | да | `true` | одна на `target` | выбран registry для рантайма (P5) |

## 2. Представления по доменам

### 2.1. Frontend (TypeScript)

```ts
export type QualityTarget = 'sulfur' | 't95' | 'd15' | 'cetane';

export interface TrainedRange { start: string; end: string; }  // ISO 8601 UTC

export interface ModelArtifact {
  artifactId: string;
  target: QualityTarget;
  algorithm: string;
  quantiles: number[];
  modelUri: string;
  hyperparams: Record<string, unknown>;
  conformal: Record<string, unknown>;
  coverage: number;                     // 0..1
  metrics: Record<string, number>;
  trainedOnRange: TrainedRange;
  features: string[];
  monotoneConstraints: Record<string, number>;  // -1 | 0 | 1
  dataHashes: Record<string, string>;
  createdAt: string;
  seed: number;
  coreVersion: string;
  active: boolean;
}
```

### 2.2. Backend (pydantic v2, `backend/src/app/schemas.py`)

```python
class TrainedRange(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    start: datetime
    end: datetime

class ModelArtifact(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, allow_inf_nan=False)
    artifact_id: str = Field(pattern=r"[a-z0-9_]+\-[a-z0-9_]+\-[0-9a-f]{8}")
    target: QualityTarget
    algorithm: str = "lightgbm_quantile"
    quantiles: list[float] = Field(default_factory=lambda: [0.1, 0.5, 0.9])
    model_uri: str = Field(min_length=1)
    hyperparams: dict[str, Any] = Field(default_factory=dict)
    conformal: dict[str, Any] = Field(default_factory=dict)
    coverage: float = Field(ge=0, le=1)
    metrics: dict[str, float] = Field(default_factory=dict)
    trained_on_range: TrainedRange
    features: list[str] = Field(default_factory=list)
    monotone_constraints: dict[str, int] = Field(default_factory=dict)
    data_hashes: dict[str, str] = Field(default_factory=dict)
    created_at: datetime
    seed: int = Field(default=42, ge=0)
    core_version: str = Field(min_length=1)
    active: bool = True
```

### 2.3. Core (dataclass, `refinery_core/registry.py`)

Ядро **только загружает** артефакт (P5): читает `registry.json`, берёт `active` на каждый
`QualityTarget`, проверяет sha256 `model.txt`, поднимает модели в память.

```python
@dataclass(frozen=True, slots=True)
class TrainedRange:
    start: datetime
    end: datetime

@dataclass(frozen=True, slots=True)
class ModelArtifact:
    artifact_id: str
    target: QualityTarget
    algorithm: str
    quantiles: tuple[float, ...]
    model_uri: Path
    trained_on_range: TrainedRange
    features: tuple[str, ...]
    coverage: float
    seed: int
    core_version: str
    active: bool
    created_at: datetime
    hyperparams: Mapping[str, Any] = field(default_factory=dict)
    conformal: Mapping[str, Any] = field(default_factory=dict)
    metrics: Mapping[str, float] = field(default_factory=dict)
    monotone_constraints: Mapping[str, int] = field(default_factory=dict)
    data_hashes: Mapping[str, str] = field(default_factory=dict)
```

### 2.4. Data-store — файлы реестра (пишет data-pipeline, P5)

```text
artifacts/models/registry.json                # индекс: [{artifact_id, target, active, created_at}]
artifacts/models/sulfur-lgbm-a1b2c3d4/
  ├── manifest.json                           # полная каноническая форма (этот DTO) + data_hashes
  └── model.txt                               # LightGBM, 3 квантильные модели; sha256 проверяет core
```

> [!note] Правила трансформации
> 1. `manifest.json` ↔ DTO — соответствие 1:1 (snake_case в файле, camelCase по проводу).
> 2. `model_uri` в core — `Path` (относительный, корень `artifacts/`), по проводу — строка.
> 3. `metrics` при публикации копируются из `artifacts/metrics.json` по ключу `target`; расхождение — ошибка публикации, не рантайма.
> 4. `registry.json` — индекс-выжимка; полная форма живёт только в `manifest.json`.

## 3. Таблица маппинга полей

| Каноническое | Frontend (TS) | Backend (Py) | Core (Py) | Data-store |
| --- | --- | --- | --- | --- |
| `artifact_id` / `target` / `algorithm` | `artifactId` / `target` / `algorithm` | `str` / `QualityTarget` / `str` | то же | каталог `artifacts/models/{artifact_id}/` |
| `quantiles` / `model_uri` | `quantiles: number[]` / `modelUri: string` | `list[float]` / `str` | `tuple[float, …]` / `Path` | `manifest.json` / файл `model.txt` |
| `hyperparams` / `conformal` | `Record<string, unknown>` ×2 | `dict[str, Any]` ×2 | `Mapping[str, Any]` ×2 | `manifest.json` |
| `coverage` / `metrics` | `coverage: number` / `Record<string, number>` | `float` (0..1) / `dict[str, float]` | `float` / `Mapping[str, float]` | `manifest.json` / `metrics.json` |
| `trained_on_range` | `trainedOnRange: {start, end}` | `TrainedRange` | `TrainedRange` | `manifest.json` |
| `features` / `monotone_constraints` | `features: string[]` / `Record<string, number>` | `list[str]` / `dict[str, int]` | `tuple[str, …]` / `Mapping[str, int]` | `manifest.json` |
| `data_hashes` / `created_at` / `seed` / `core_version` / `active` | `dataHashes` / `createdAt` / `seed` / `coreVersion` / `active: boolean` | `dict[str, str]` / `datetime` / `int` / `str` / `bool` | то же | `manifest.json`; `active` — и в `registry.json` |

## 4. JSON-пример

```json
{"artifact_id": "sulfur-lgbm-a1b2c3d4", "target": "sulfur", "algorithm": "lightgbm_quantile",
 "quantiles": [0.1, 0.5, 0.9], "model_uri": "artifacts/models/sulfur-lgbm-a1b2c3d4/model.txt",
 "hyperparams": {"objective": "quantile", "num_leaves": 31, "learning_rate": 0.05, "n_estimators": 400},
 "conformal": {"method": "enbpi", "params": {"gamma": 0.05, "cv": "split"}}, "coverage": 0.83,
 "metrics": {"wape": 0.061, "mae": 0.52, "pinball_p50": 0.35},
 "trained_on_range": {"start": "2023-01-01T00:00:00Z", "end": "2026-06-30T00:00:00Z"},
 "features": ["T5", "T11", "lims_age_h", "cat_age_days"], "monotone_constraints": {"T5": 1},
 "data_hashes": {"data/processed/quality_datasets/sulfur.parquet": "e3b0c442…"},
 "created_at": "2026-09-18T20:10:00Z", "seed": 42, "core_version": "0.1.0", "active": true}
```

## 5. Инварианты валидации

> [!warning] Проверяются при публикации (P5-производитель) и при загрузке (core, P5-потребитель)
> 1. `artifact_id` = `{target}-{algo}-{hex8}` и каталог `model_uri` носит то же имя; `target` в id совпадает с полем `target`.
> 2. `quantiles` — отсортированы по возрастанию, все в (0, 1); фиксированный набор `[0.1, 0.5, 0.9]` = контракт квантилей карточки [[03-quality-assessment]].
> 3. Ровно один артефакт с `active = true` на каждый `QualityTarget` в `registry.json`; отсутствие ⇒ `models_not_loaded` → HTTP 503.
> 4. sha256 файла `model.txt` совпадает с хэшем из `manifest.json` — иначе артефакт не загружается.
> 5. Мажорная версия `core_version` совпадает с рантаймом; мажорное расхождение ⇒ артефакт игнорируется (P5).
> 6. `trained_on_range.start ≤ end`; `t_point` прогона вне диапазона — основание отказа `out_of_training_domain`, а не молчаливый прогноз.
> 7. `monotone_constraints` содержит только признаки из `features`, значения ∈ {−1, 0, 1}.
> 8. `coverage ∈ [0, 1]`; `metrics` — конечные числа из time-split валидации (сплит по времени с gap ≥ 3 ч, без перемешивания).
> 9. `seed` фиксирует обучение: повторный прогон пайплайна на тех же `data_hashes` воспроизводит артефакт.

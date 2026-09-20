---
title: "data-pipeline 10 — Тесты пайплайна (core/tests/data/)"
tags: [refinery-copilot, data-pipeline, tests, pytest, anti-leak]
related:
  - "[[02-clean-sentinels]]"
  - "[[03-sync-freshness]]"
  - "[[05-features]]"
  - "[[08-validation-timesplit]]"
  - "[[05-seeds-reproducibility]]"
created: 2026-09-19
---

# 10 — Тесты пайплайна данных

Каталог: `core/tests/data/`. Назначение: pytest-гарантии четырёх свойств, на которых держится
доверие ко всем моделям проекта: (1) чистка не теряет валидные точки, (2) анти-утечка —
ни один признак не использует будущее ЛИМС, (3) воспроизводимость обучения с сидом,
(4) стабильность схем Parquet. Тесты быстрые — на фикстурах и слайсах данных, не на всей
истории (полный прогон — `make data && make train && make test`, delivery-infra/01).

## Scope

**Содержит (covers):** тесты модулей [[01-ingest-csv]]–[[05-features]] и
[[06-train-quantile]]–[[09-publish-registry]]; фикстуры данных; property-based проверки.

**НЕ содержит (does NOT cover):** тесты агентов ядра (ограничения, отказ, Парето —
core-architecture/15), интеграционные тесты API (backend/08).

## 1. Карта «модуль → тесты»

```mermaid
flowchart LR
    subgraph T["core/tests/data/"]
        A["test_clean.py"]
        B["test_sync_leak.py"]
        C["test_features_leak.py"]
        D["test_train_determinism.py"]
        E["test_schema.py"]
        F["test_validate_folds.py"]
    end
    01["01 ingest"] --> A
    02["02 clean"] --> A
    03["03 sync"] --> B
    05["05 features"] --> C
    06["06 train"] --> D
    08["08 validate"] --> F
    E -.-> "все Parquet-писатели (P4)"
```

| Файл | Проверяет | Главный риск, который ловит |
| --- | --- | --- |
| `test_clean.py` | сентинелы → флаги, ничего лишнего | чистка съела валидные точки или пропустила сентинел |
| `test_sync_leak.py` | `available_ts = sample_ts + ≤4 ч` | утечка будущего ЛИМС в пары (X, y) |
| `test_features_leak.py` | признаки смотрят только назад | лаг/окно после `t_point` |
| `test_train_determinism.py` | seed → битовый повтор | скрытая случайность, гонки |
| `test_schema.py` | схемы Parquet стабильны | тихое изменение колонок/типов (ломает читателей P3) |
| `test_validate_folds.py` | gap ≥ 3 ч, ts монотонный | перемешанный сплит (запрещено правилом валидации по времени) |

## 2. Чистка не теряет валидные точки (`test_clean.py`)

Контракт [[02-clean-sentinels]]: сентинелы {307, 251, 252, 240} — маска **первой ступени**;
`quality_flag` ∈ {ok, sentinel, stuck, outlier, missing}; удаление — только по маске.

```python
def test_sentinels_flagged_not_dropped(synthetic_frame):
    """Каждая точка с 307/251/252/240 → quality_flag='sentinel', value→null;
    длина ряда не меняется — точки не удаляются, а помечаются."""

def test_no_valid_values_marked_sentinel(synthetic_frame):
    """Ни одно значение вне {307, 251, 252, 240} не попало в sentinel (п. 4.9 = валидно)."""

def test_q21_plateau_24_9_flagged_outlier(q21_slice):
    """Плато Q21 = 24.9 (зашкал анализатора, 144 т./сутки) → outlier, не значение серы."""

def test_cleaning_preserves_counts(synthetic_frame):
    """n_ok + n_sentinel + n_stuck + n_outlier + n_missing == n_rows (ничего не потеряно)."""

def test_hampel_keeps_real_steps(synthetic_frame):
    """Детектор выбросов не глотает реальные ступени режима (±20 °C при смене исполнения ДТ)."""
```

> [!note] Почему «не удалять, а помечать»
> Сентинелы вписаны в поток **вместо** пропусков длинными сериями (у Q21 — 2,97 %,
> у Q20 — 11,65 %; серии до 4 441 точек ≈ 31 сутки[^data]). Удаление строк сломало бы
> ровную 10-минутную сетку и светофоры качества; пометка сохраняет каркас времени.

## 3. Анти-утечка: ни один признак не использует будущее (`test_sync_leak.py`, `test_features_leak.py`)

Требование анти-утечки: «При исторической валидации результат ЛИМС доступен
системе только через ≤ 4 ч после метки — иначе утечка будущего»[^lims].

```python
def test_lims_available_ts_offset(lims_sample):
    """available_ts == sample_ts + 4 ч (ЛИМС); freshness.parquet согласован (P4, [[02-data-freshness]])."""

def test_training_pairs_no_future_lims(pipeline_pairs):
    """Для каждой пары (X(t), y): ts метки + 4 ч ≤ available-момент, по которому пара построена;
    иначе — ValueError при построении (не тихий пропуск)."""

def test_features_use_only_past_window(feature_request):
    """Все окна/лаги признаков лежат в [t_point − 3 ч, t_point]; ни один — после."""

def test_pak_used_only_from_history(pak_slice):
    """ПАК/ВАК-признаки при ретро-прогнозе берутся до t_point, контрольный факт — ЛИМС позже."""

def test_vak_formula_terms_exist(vak_features):
    """ВАК-признаки не содержат член LIMS:24-2000.Pipeline.* (точки нет — открытый вопрос № 1)."""
```

Property-based (hypothesis): для случайного `t_point` сборка признаков идемпотентна и
не читает строки с `ts > t_point` — проверка по маске исходного Parquet.

## 4. Воспроизводимость обучения с сидом (`test_train_determinism.py`)

Договор delivery-infra/05: «фиксированные seed'ы… повторяемость “один seed → одно решение”».

```python
def test_same_seed_same_boosters(fixed_slice, seed=42):
    """Два прогона train_target() с одним сидом → идентичные model.txt (sha256 равен)."""

def test_artifact_id_stable(fixed_slice):
    """Один и тот же бандл даёт один artifact_id (sha256(model.txt)[:8])."""

def test_registry_atomic_write(tmp_registry):
    """update_registry() не оставляет полуобновлённый registry.json (tmp + rename)."""

def test_metrics_reproducible(fixed_slice):
    """metrics.json из [[08-validation-timesplit]] битово повторяется при том же сиде/данных."""
```

## 5. Схемы Parquet стабильны (`test_schema.py`)

Изменение схемы датасета — только новой версией каталога (v1→v2); поля не добавляются
молча (правило data-store/00: «каждый документ датасета — контракт писатель ↔ читатель»).

```python
@pytest.mark.parametrize("dataset", ["telemetry", "lims", "pak", "freshness"])
def test_parquet_schema_contract(dataset, snapshot):
    """Колонки, типы (ts: timestamp[ms, UTC]; value: float64; flags: dictionary) — снапшот-тест."""

def test_quality_flag_domain(dataset):
    """quality_flag/source — только значения енумов B.7/B.8, иначе writer падает."""

def test_nan_only_in_value_column(dataset):
    """NaN допустим только в value (float64) — ключи/время/флаги never-null."""

def test_manifest_updated_after_write(tmp_processed):
    """Каждая запись обновляет datasets_manifest.json (sha256, диапазон дат, версия пайплайна)."""
```

## 6. Разрезы валидации легальны (`test_validate_folds.py`)

```python
def test_all_folds_have_gap(cv_config):
    """В каждом фолде TimeSeriesSplit gap ≥ 18 точек (3 ч) — константа VALIDATION_GAP."""

def test_ts_monotonic_required(sample_frame_shuffled):
    """Валидатор ([[08-validation-timesplit]]) падает на немонотонном ts — перемешивание исключено."""

def test_holdout_never_in_train(split_plan):
    """train+calibration диапазоны не пересекают holdout_start = 2026-07-01."""

def test_cfpp_offset_train_only(train_cal_split):
    """Смещение CFPP ≈ −11 °C считается только на train — не на калибровке/holdout."""
```

## 7. Запуск и правила

```bash
make test            # uv run pytest core/tests -q  (пайплайн + ядро)
uv run pytest core/tests/data -q   # только домен данных
```

1. Тесты — часть контракта: падение теста = пайплайн не выпускает артефакт
   ([[09-publish-registry]] стоит после зелёного `make test`).
2. Фикстуры — синтетические ряды с известными дефектами (сентинелы, залипания, плато 24.9),
   а не срезы сырых данных: тест обязан быть воспроизводимым и быстрым.
3. Никакой сети и внешних файлов вне `data/`/`artifacts/` в тестах.
4. Снапшот-схемы обновляются осознанно — вместе с bump-версией каталога (v1→v2).

---

[^data]: По истории данных: «сентинелы… почти всегда длинными сериями»; «Q21 — 2.97 % (307)… max run 4 441 точки ≈ 31 сутки»; «плато ровно 24.9 блоками по 144 точки/сутки».
[^lims]: Правило задержки публикации ЛИМС: «ЛИМС: метка времени = момент отбора пробы; до публикации результата проходит до 4 часов… иначе утечка будущего».
[^tz]: Правило валидации по времени: «Проверяйте систему на данных, отделённых по времени. Случайное перемешивание строк при train/test split для временных рядов не допускается…» (тест `test_validate_folds.py` — исполняемая форма этой цитаты).

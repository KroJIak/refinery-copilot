---
title: "Сиды и воспроизводимость — один seed → одно решение и одинаковые числа"
tags: [refinery-copilot, delivery-infra, reproducibility, seeds, p7]
related:
  - "[[delivery-infra/00-OVERVIEW]]"
  - "[[03-uv-environment]]"
  - "[[06-release-checklist]]"
  - "[[15-tests]]"
created: 2026-09-19
---

# 05 — Сиды и воспроизводимость

## Scope

> [!info] Содержит
> Фиксацию сидов python/numpy/lightgbm; версии из `uv.lock` как часть отчёта; sha256
> данных и артефактов; чек-лист детерминизма; процедуру проверки повторного прогона.

> [!warning] НЕ содержит
> Метрик качества моделей («не содержит сами метрики
> качества»); самих тестов детерминизма (core-architecture/15, data-pipeline/10 — здесь
> только требование к ним).

## Правило воспроизводимости

> [!quote] Правило продукта
> «Дословно один и тот же текст ответа **не обязателен**. При одинаковом состоянии системы
> должны воспроизводиться **одно и то же решение и одинаковые численные результаты**»
> («увеличить расход на 2 %» ≡ «рекомендуется повышение расхода на 2 %»).

Практический вывод из того же раздела: фиксированные seed'ы, детерминированный пайплайн,
а для LLM — температура 0 и/или заготовленные шаблоны формулировок.

## Что фиксируется

| Слой | Механизм | Где видно |
| --- | --- | --- |
| Python `random` | `random.seed(SEED)` в начале прогона | `RunReport.seed` |
| NumPy | `np.random.seed(SEED)` / `default_rng(SEED)` | то же |
| LightGBM | `seed=SEED`, `deterministic=True`, `force_row_wise=True`, `num_threads=1` | `manifest.json` артефакта |
| Сплиты данных | только по времени, без перемешивания, gap ≥ 3 ч | сид не нужен — сплит детерминирован |
| Версии | `python`, `lightgbm`, `mapie`, `shap`, `core` из lock | `RunReport.versions` |
| Данные | sha256 всех прочитанных файлов | `RunReport.data_hashes` |

```python
# refinery_core/config.py — единая точка посева (фрагмент)
def apply_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
```

Параметры обучения LightGBM детерминированы явно — многопоточная гистограмма не даёт
бит-в-бит повтора, поэтому в `train` включается однопоточный режим (демо-масштаб данных
это позволяет):

```yaml
# core/config/train.yaml (фрагмент)
lgbm:
  objective: quantile
  seed: ${SEED}
  deterministic: true
  force_row_wise: true
  num_threads: 1        # ценой скорости — бит-в-бит повторяемость обучения
```

## Чек-лист детерминизма

> [!warning] Запрещённые источники недетерминизма
> 1. Скрытая случайность: любая выборка/перестановка — только через `rng` с сидом прогона.
> 2. Параллелизм с гонками: порядок событий агентов задаёт оркестратор, не планировщик
>    потоков (P2: прогон в одном worker-потоке).
> 3. «Сейчас» в вычислениях: `datetime.now()` вне меток времени аудита; `t_point` приходит
>    из `Scenario`, не из часов.
> 4. Сетевые сущности в расчёте: LLM — только текст поверх фактов, `temperature=0`
>    или шаблоны; при `LLM_MODE=off` недетерминизма нет вовсе.
> 5. Итерации по `set`/`dict` с влиянием на порядок вычислений — сортировать явно.

Проверяется тестами ядра: «один seed → одинаковый вывод» (core-architecture/15) и
«детерминизм пайплайна» (data-pipeline/10) — инфраструктура предоставляет для них `SEED`
и чистое окружение.

## sha256 данных и артефактов

Хэши данных пишет data-pipeline в `datasets_manifest.json` (P4) — из них собирается
`RunReport.data_hashes`; реестр моделей проверяет sha256 `model.txt` при загрузке (P5).
Проверка руками:

```bash
# хэши текущих данных
sha256sum data/processed/*.parquet

# сверка с манифестом, который читает ядро
cat data/processed/datasets_manifest.json | jq '.[] | {path, sha256}'

# хэш весов модели — registry сверяет его при загрузке (P5)
sha256sum artifacts/models/sulfur-lgbm-*/model.txt
```

Любое изменение данных ⇒ другой sha256 ⇒ `data_hashes` в отчётах другой — это нормальный,
фиксируемый факт, а не сбой: сравнивать прогон с прогоном можно только при совпадающих
хэшах входа.

## Проверка повторного прогона

Процедура «тот же seed → то же решение»:

```bash
# 1) Первый прогон фиксированной точки (seed по умолчанию 42)
make demo
cp artifacts/runs/<run_id_1>.json /tmp/run1.json

# 2) Полностью повторить прогон той же точки
make demo
cp artifacts/runs/<run_id_2>.json /tmp/run2.json

# 3) Нормализовать нестабильные поля и сравнить
jq 'del(.run_id, .created_at, .duration_ms,
        .agents_trace[].started_at, .agents_trace[].finished_at,
        .agents_trace[].duration_ms)' /tmp/run1.json > /tmp/run1.norm.json
jq 'del(.run_id, .created_at, .duration_ms,
        .agents_trace[].started_at, .agents_trace[].finished_at,
        .agents_trace[].duration_ms)' /tmp/run2.json > /tmp/run2.norm.json
diff /tmp/run1.norm.json /tmp/run2.norm.json && echo "OK: воспроизводится"
```

Условия корректной проверки:

- прогоны делаются при **одинаковых** `data_hashes` (данные не перекачивались) и одном
  `uv.lock` — иначе расхождение ожидаемо;
- `run_id`, временные метки и `duration_ms` — аудиторские поля, из сравнения исключаются;
- должно совпасть всё остальное: **решение** (`decision: recommend|refuse`) и **все числа**
  (квантили, `checks`, `confidence`, `alternatives`) — это и есть критерий воспроизводимости;
- текст `explanation` при `LLM_MODE=off` собирается шаблоном и тоже обязан совпасть;
  при `local|external` сверяются только числа (допустимо иное, но эквивалентное
  по смыслу окружение — см. цитату выше).

> [!note] Место в жизненном цикле
> Детерминизм закладывается с первого дня (сид в конфиге), а эта процедура
> целиком включается в чек-лист релиза [[06-release-checklist]].

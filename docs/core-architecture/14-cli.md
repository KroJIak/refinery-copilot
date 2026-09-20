---
title: "CLI — headless-прогоны сценариев: make demo / python -m refinery_core.demo"
tags: [refinery-copilot, core-architecture, cli, demo]
related:
  - "[[13-scenarios]]"
  - "[[12-run-report]]"
  - "[[09-agent-orchestrator]]"
  - "[[01-makefile-targets]]"
created: 2026-09-19
---

# 14 — CLI (`cli.py` / `demo.py`)

Точка входа ядра без сети и без сайта: проверяемость через `make demo` (CLI → консоль/JSON-отчёт).
CLI прогоняет демонстрационные сценарии [[13-scenarios]] headless —
пять агентов [[09-agent-orchestrator]] от входных данных до финальной рекомендации или отказа —
печатает результат в консоль и сохраняет артефакты [[12-run-report]].

## Scope

| | |
| --- | --- |
| **Содержит (covers)** | команды `demo` / `run` и выбор сценария; headless-прогон без сети; консольный вывод (человекочитаемый и `--format json`); запись отчётов в `artifacts/runs/`; коды выхода; чтение env (SEED, DATA_DIR, MODEL_REGISTRY_DIR, LLM_MODE); запрет: никакого FastAPI и логики агентов |
| **НЕ содержит (does NOT cover)** | пресеты сценариев ([[13-scenarios]]); логику решения ([[09-agent-orchestrator]], [[10-refusal]]); сборку отчёта ([[12-run-report]]); HTTP/SSE (backend-домен); цели Makefile как таковые (delivery-infra/01-makefile-targets.md — здесь только контракт вызова) |

## Запуск

```bash
# Демо-цель: make demo = 4 демо-сценария с обязательным отказом (bad_data)
make demo

# Эквивалент напрямую (uv-окружение, Python 3.12):
uv run python -m refinery_core.demo                     # все 4 сценария подряд
uv run python -m refinery_core.demo --scenario normal   # один сценарий
uv run python -m refinery_core.demo --scenario bad_data --format json
uv run python -m refinery_core.run --t-point "2026-06-15T08:00:00Z" --overrides blend_share_kerosene=0.12
```

Порядок целей кодирует конвейер: `make data` → `make train` → `make demo` — инжест и обучение
обязательны до прогона, иначе CLI завершится кодом 2 (`models_not_loaded` / `data_missing`,
P5-поведение api/protocols/05-p5-pipeline-core.md).

## Аргументы

| Аргумент | Значение по умолчанию | Описание |
| --- | --- | --- |
| `--scenario {normal,quality_risk,bad_data,sour_crude,stale_lims}` | все 4 демо-сценария | выбор пресета [[13-scenarios]]; `all` — по порядку |
| `--t-point ISO` | из пресета | переопределение момента состояния (внутри `trained_on_range`) |
| `--overrides k=v[,...]` | из пресета | переопределения управляемых; валидация как у [[06-scenario|Scenario]] |
| `--seed N` | из пресета (42) | сид прогона; попадает в отчёт |
| `--format {text,json}` | `text` | формат консольного вывода |
| `--out DIR` | `artifacts/runs/` | каталог артефактов прогона |
| `--llm-mode {off,local,external}` | `LLM_MODE` из env (по умолчанию `off`) | тумблер нарратора [[90-narrator-llm]] |

Env-переменные читаются из `.env`/окружения (delivery-infra/04-env-vars.md): `SEED`, `DATA_DIR`,
`MODEL_REGISTRY_DIR`, `LLM_MODE=off|local|external`. Секретов в репо нет; по умолчанию всё
работает offline.

## Консольный вывод (text)

```text
Прогон 20260919-080000-3f9c2a · сценарий quality_risk · t_point 2026-06-15T08:00Z · seed 42
  [0/4] data          ok   210 мс   свежесть: ЛИМС ok (2.1 ч), ПАК ok · аномалий нет
  [1/4] quality       ok   980 мс   сера P50 9.6 (P10 8.9–P90 10.4), spec_risk 0.38
  [2/4] reliability   ok   340 мс   T5 = 371 °C: запас до p98 10 °C · индекс тяжести 0.4
  [3/4] optimization  ok  1500 мс   288 вариантов → 41 допустим · Парето-фронт 6 точек
  [4/4] orchestrator  ok   500 мс   решение: recommend (confidence P10–P90: 0.62–0.88)
Карточка: P8 341.2 → 339.5 °C · сера 9.6 → 9.1 мг/кг · cost_index 3.2 · проверки 7/7
Отчёт: artifacts/runs/20260919-080000-3f9c2a.md (+ .json)
Код выхода: 0
```

Для отказа (`bad_data`) блок карточки заменяется блоком отказа:

```text
  [0/4] data          warn 180 мс   сентинелы в Q21, W4 · ЛИМС устарел: 60 ч > 52 ч
  → ОТКАЗ (stale_lims, sensor_fault)
    «Надёжной рекомендации нет: последнее лабораторное значение устарело, …»
Код выхода: 0   # отказ — штатный исход прогона
```

## Коды выхода

| Код | Условие |
| --- | --- |
| `0` | все выбранные сценарии завершились и **совпали с ожидаемым классом исхода** ([[13-scenarios]]): рекомендация там, где ожидалась, штатный отказ там, где ожидался |
| `1` | прогоны прошли, но исход не совпал с ожидаемым классом (например, `normal` вернул отказ) — сигнал для тестов/CI |
| `2` | окружение не готово: `models_not_loaded` (реестр пуст/хэш не сошёлся) или `data_missing` (parquet не найден) |
| `3` | авария прогона (`RunStatus.failed`): исключение агента/сборки отчёта |

Отказ рекомендации — **не** ошибка: «Умение корректно отказаться — часть качественного решения»,
поэтому `bad_data` с ожидаемым отказом даёт код 0.

## Каркас

```python
# refinery_core/demo.py
def main(argv: list[str] | None = None) -> int:
    """args = parse_args(argv)
    settings = Settings.from_env()                  # DATA_DIR, MODEL_REGISTRY_DIR, LLM_MODE, SEED
    registry = ModelRegistry.load(settings.models_dir)   # P5; ошибки → код 2
    scenarios = resolve_scenarios(args)             # пресеты [[13-scenarios]]
    results = []
    for scenario in scenarios:
        sink = ConsoleSink(format=args.format)      # события [[09-agent-orchestrator]] → консоль
        result = run_pipeline(scenario, registry, sink)
        artifacts = persist(build_run_report(result, scenario, result.ctx), Path(args.out))
        print_report_footer(artifacts)
        results.append((scenario, result.status))
    return exit_code(results, expected={kind: EXPECTED_OUTCOME[kind] for kind in scenarios})
```

Принципы: без сети; без импортов fastapi; каждая случайность — под сид из [[06-scenario|Scenario]] и
попадает в отчёт; `timeline/*.ndjson` пишется по мере событий, как и в API-режиме —
CLI и бэкенд прогоняют **один и тот же** конвейер, различается только sink событий.

## JSON-вывод (`--format json`)

```json
{"runs": [{"run_id": "20260919-080100-a1b2c3d4", "scenario": "quality_risk", "status": "completed",
           "decision": "recommend", "exit_hint": 0,
           "artifacts": {"report_json": "artifacts/runs/20260919-080100-a1b2c3d4.json",
                          "report_md": "artifacts/runs/20260919-080100-a1b2c3d4.md"}}],
 "summary": {"total": 1, "matched_expected": 1, "exit_code": 0}}
```

`exit_hint` — вклад прогона в итоговый код выхода; `summary.exit_code` — то, что CLI возвращает
процессу (используется тестами [[15-tests]] и CI).

## ConsoleSink: события в консоль

```python
class ConsoleSink(EventSink):
    """Тот же CoreEvent-поток, что и в API-режиме ([[09-agent-orchestrator]]):
    run_started → agent_started / step / log / agent_finished ×4 → recommendation | refusal → run_finished.
    format=text: однострочные статусы агентов + финальная карточка/отказ;
    format=json: накопление payload'ов, печать одного документа в конце прогона."""
```

## CLI vs API-режим

| | CLI (`demo`/`run`) | API (backend, P2) |
| --- | --- | --- |
| Sink событий | консоль | `asyncio.Queue` → SSE-эндпоинт |
| Отчёт | `persist` в `artifacts/runs/` | тот же `persist` + `GET /runs/{id}/report.{md,json}` |
| Нарратор | `--llm-mode` / `LLM_MODE` ([[90-narrator-llm]]) | env сервиса (`LLM_MODE`) |
| Воспроизводимость | один seed → одинаковые числа | та же гарантия |
| Модели/данные | реестр P5 + Parquet P3 | те же, прогрев в lifespan |

## Связи

- **delivery-infra/01-makefile-targets.md**: цель `demo` оборачивает ровно эту команду; порядок
  `data → train → demo` задан там.
- **[[12-run-report]]**: каждый прогон оставляет `.md` + `.json` + `timeline` в `artifacts/runs/`.
- **[[15-tests]]**: коды выхода и совпадение исходов с ожиданиями переиспользуются тестами.
- **api/90-examples-and-mocks.md**: вывод CLI по 4 сценариям — источник проверенных фикстур для фронта.

## Правила дизайна

> [!warning] Ключевые правила
> 1. CLI — тонкая обёртка: парсинг аргументов + sink + код выхода; бизнес-логики нет.
> 2. Отказ — код 0 при совпадении с ожиданием; несовпадение ожидания — код 1 (годно для CI).
> 3. Готовность окружения проверяется до первого прогона (модели, данные) — отдельный код 2.
> 4. Один и тот же `run_pipeline` и в CLI, и в API-режиме: демо = то, что видит оператор в браузере.

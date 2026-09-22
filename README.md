# refinery-copilot
An AI copilot that monitors refinery telemetry and lab data to give diesel unit operators safe, explainable recommendations — refusing any action that violates product quality limits.

Проект разработан в рамках хакатона «Нефтекод».

## Запуск расчёта (без сайта)

Нужны Python 3.12, uv и уже лежащие локально модели в `artifacts/models/` плюс `data/processed/quality_datasets/sulfur.parquet`.

```bash
uv sync --group dev
make demo
```

Четыре сценария подряд: норма, риск серы, плохие данные (отказ), сернистая нефть. Карточка в терминале, отчёты в `artifacts/runs/` (md и json). Повтор с тем же seed даёт те же числа.

Один сценарий: `uv run python -m refinery_core.cli demo --scenario bad_data`

## Сайт

```bash
make web
```

Одна команда поднимает расчёт и страницу. Адрес сайта: http://127.0.0.1:5173. Ctrl+C останавливает оба процесса.

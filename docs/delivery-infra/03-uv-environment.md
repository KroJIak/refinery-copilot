---
title: "uv-окружение — pyproject, lock, группы зависимостей, Python 3.12"
tags: [refinery-copilot, delivery-infra, uv, python, dependencies, p7]
related:
  - "[[delivery-infra/00-OVERVIEW]]"
  - "[[01-makefile-targets]]"
  - "[[05-seeds-reproducibility]]"
created: 2026-09-19
---

# 03 — uv-окружение

## Scope

> [!info] Содержит
> Структуру `pyproject.toml` (воркспейс core + backend), состав групп зависимостей
> `core` / `api` / `dev`; Python 3.12; `uv.lock` в репо и его роль в воспроизводимости;
> кэш uv; команды синхронизации локально и в образах.

> [!warning] НЕ содержит
> Обоснование выбора библиотек доменами; multi-stage сборку
> образов (backend/07, frontend/01); версии конкретных пакетов — источник истины `uv.lock`.

uv выбран стеком проекта («uv + docker-compose»): один
lock-файл покрывает и локальный запуск, и сборку образов — правило 3 домена
([[delivery-infra/00-OVERVIEW]]): «одинаковые версии локально и в Docker».

## pyproject.toml

```toml
[project]
name = "refinery-copilot"
version = "0.1.0"
requires-python = ">=3.12,<3.13"     # ровно 3.12: локаль, образы и CI
dependencies = [
    "pydantic>=2.7",
    "python-dotenv>=1.0",
]

[project.optional-dependencies]      # альтернатива группам, если нужен pip-путь
```

Каноничнее — группы зависимостей (PEP 735, нативно для uv); они не ставятся «случайно»
в прод-образе:

```toml
[dependency-groups]
core = [
    # data-pipeline + core-architecture: инжест, обучение, инференс
    "polars>=1",            # scan_parquet lazy, чтение P3
    "pandas>=2.2",
    "numpy>=1.26",
    "lightgbm>=4.4",        # quantile P10/P50/P90
    "mapie>=1.0",           # конформ-калибровка EnbPI/ACI
    "shap>=0.46",           # TreeExplainer, top-k факторов
    "scipy>=1.13",          # Hampel, PCA
    "scikit-learn>=1.5",    # TimeSeriesSplit
    "openpyxl>=3.1",        # XLSX-выгрузки ЛИМС/ПАК
    "markdown>=3.6",        # рендер отчёта .md
]
api = [
    # backend: HTTP-обёртка ядра (P2)
    "fastapi>=0.111",
    "uvicorn[standard]>=0.30",
    "sse-starlette>=2.1",
]
dev = [
    "pytest>=8",
    "pytest-cov>=5",
    "ruff>=0.5",
]
```

Правила групп:

- `core` — всё, что нужно ядру и пайплайну; ставится всегда (образ api включает, ядро без
  api должно запускаться: `make demo` не требует fastapi).
- `api` — только транспорт; ядро никогда его не импортирует (правило зависимостей).
- `dev` — качество кода; в прод-образы не попадает (`--no-dev`).
- Общие pydantic-модели (Часть A контракта) живут в `core` — их импортируют и ядро, и backend.

## uv.lock — источник истины версий

`uv.lock` коммитится в репо и остаётся **одним на весь проект**:

```bash
# Обновление зависимостей — осознанная операция, не побочный эффект
uv lock --upgrade          # поднять версии во всём lock
uv lock --upgrade-package lightgbm   # точечно
```

Что из этого следует:

- любой `uv sync` восстанавливает **ровно** зафиксированные версии — на машине разработчика,
  в образе и на целевой машине ([[05-seeds-reproducibility]]: версии из lock попадают в
  `RunReport.versions`);
- нельзя редактировать версии вручную или добавлять `pip install` в обход `uv add`;
- изменение `pyproject.toml` без перегенерации lock ловится на `uv sync --frozen`.

## Команды синхронизации

```bash
# Локально: полный дев-стек (core + api + dev)
uv sync --group dev

# Только ядро (проверка demo без web-зависимостей)
uv sync --group core

# Прод-режим: строго по lock, без dev-группы
uv sync --frozen --no-dev

# Добавление зависимости (обновляет и pyproject, и uv.lock одной командой)
uv add --group api sse-starlette
uv remove --group core duckdb
```

`--frozen` — обязательный флаг везде, где lock не должен обновляться: CI, Dockerfile,
[[06-release-checklist]].

## Кэш

```bash
# Каталог кэша по умолчанию: ~/.cache/uv (Linux) — общесистемный, переиспользуется
# всеми проектами; вынести на отдельный диск при необходимости:
export UV_CACHE_DIR=/data/uv-cache

# Размер и чистка (кэш безопасно удалять в любой момент):
uv cache prune        # убрать устаревшие записи
uv cache clean        # полная очистка

# Образы: кэш не нужен в финальном слое
uv sync --frozen --no-dev --no-cache   # в Dockerfile этапа runtime
```

В Docker сборка опирается на слои: `COPY pyproject.toml uv.lock ./` → `RUN uv sync --frozen`
→ `COPY src ...` — переустановка зависимостей только при изменении lock, а не любого файла
исходников. В CI кэш каталога `~/.cache/uv` ключуется по хэшу `uv.lock`.

## Python 3.12

```bash
uv python install 3.12    # uv сам ставит нужный интерпретатор, системный не трогает
uv python pin 3.12        # записывает .python-version в репо
```

`.python-version` с `3.12` коммитится: любой `uv run` подхватит ровно его; в образах
базовый тег `python:3.12-slim`. Отдельные виртуальные окружения
на `core`/`backend` не нужны — воркспейс один:

```toml
# если backend выделен в отдельный пакет в том же репо
[tool.uv.workspace]
members = ["core", "backend"]
```

## Сводка: кто где синхронизируется

| Контекст | Команда | Lock | dev-группа |
| --- | --- | --- | --- |
| Разработка | `make .venv` → `uv sync --group dev` | frozen по факту lock | да |
| Образ api | `RUN uv sync --frozen --no-dev` | обязательно frozen | нет |
| CI | `uv sync --frozen --group dev` + `uv run pytest` | frozen | да |
| Целевая машина | `make data` (первый вызов создаст `.venv`) | frozen | да |

> [!note] Связь с воспроизводимостью
> Lock-файл — первый уровень воспроизводимости ([[05-seeds-reproducibility]]): одинаковые
> версии python/lightgbm/mapie/shap на любой машине, без сети в рантайме — все колёса
> запекаются в образ или `.venv` заранее.

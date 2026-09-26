---
title: "backend — 07. Dockerfile сервиса api"
tags: [refinery-copilot, backend, docker, delivery]
related:
  - "[[03-uv-environment]]"
  - "[[02-docker-compose]]"
  - "[[07-p7-infra]]"
  - "[[06-models-health]]"
created: 2026-09-19
---

# Dockerfile сервиса api

Файл: `backend/Dockerfile`. Multi-stage образ `python:3.12-slim` + uv; non-root;
healthcheck `GET /api/health`. Compose-сервис `api:8000` собирается из этого файла
(конфигурация compose — домен [[02-docker-compose]]).

> [!quote] Правило инфраструктуры (P7)
> «Одинаковые версии локально и в Docker: образы собираются строго из того же `uv.lock».
> Никаких `pip install` и «свежих» зависимостей в образе.

## Scope

| Охват (covers) | Не охват (does NOT cover) |
| --- | --- |
| `backend/Dockerfile`: stages builder → runtime, uv sync `--frozen` | `docker-compose.yml` (сервис `web`, nginx, порты UI) — [[02-docker-compose]] |
| non-root пользователь, healthcheck, параметры uvicorn | `uv.lock` и workspace pyproject — [[03-uv-environment]] |
| Volumes `data:ro` / `artifacts` и требование read-only входа | Цели `make up/down` — [[01-makefile-targets]] |

## Структура образа

```dockerfile
# --- stage 1: builder — зависимости из lock-файла ---
FROM python:3.12-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
COPY core/ core/
COPY backend/ backend/
RUN uv sync --frozen --no-dev --package app          # строго из uv.lock, без dev-группы

# --- stage 2: runtime — тонкий образ без тулчейна сборки ---
FROM python:3.12-slim
RUN groupadd -r app && useradd -r -g app app         # non-root
WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/backend /app/backend
COPY --from=builder /app/core /app/core
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
USER app
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2).status == 200 else 1)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Решения по стадиям:

| Решение | Почему |
| --- | --- |
| `python:3.12-slim` обе стадии | минимальная поверхность; ядро — LightGBM/Polars, колёса есть под slim |
| `uv sync --frozen --no-dev` | версия = `uv.lock` байт-в-байт; pytest/ruff в образ не попадают |
| Копия `.venv` из builder | финальный образ без uv-кэшей и исходников dev-зависимостей |
| `HEALTHCHECK` на `/api/health` | см. [[06-models-health]]: 200 = процесс жив; `degraded` тоже 200 — контейнер не рестартует, пока `make train` не выполнен |
| Проверка через stdlib | в slim нет curl; не тянем пакет ради healthcheck |
| `PYTHONUNBUFFERED=1` | логи uvicorn видны в `docker logs` сразу |

## Non-root и файловые права

Процесс работает под пользователем `app`; каталоги хоста монтируются compose-ом.

| Точка монтирования | Режим | Кто пишет |
| --- | --- | --- |
| `./data → /app/data` | `:ro` | никто (чтение ядра, P3) |
| `./artifacts → /app/artifacts` | rw — но **только** подкаталоги `runs/` и `timeline/` | ядро: `{run_id}.{json,md}`, `{run_id}.ndjson` (P3); sink в [[02-core-bridge]] — timeline |
| `./artifacts/models` | `:ro` | никто в рантайме (модели пишет только пайплайн, P5) |

> [!warning] Об ограничении записи
> Философия P3 — «рантайм read-only по `data/processed/`», запись разрешена только в
> `artifacts/`. Если volume `artifacts` подключить целиком `:ro`, прогон из API не сможет
> сохранить отчёты и журнал реплея — это ломает [[03-runs-routes]] и [[04-sse-stream]].
> Поэтому: `data: ro`; `artifacts: rw`, но uid владельца каталога на хосте — `app`
> (см. `Makefile`, цель `make up` создаёт `artifacts/{runs,timeline}` с правами `100999`).

Требования к образу:

1. Никаких секретов в слоях (`.env` копируется **не** в образ — приходит через
   `env_file` compose, [[04-env-vars]]).
2. Финальный слой не содержит кэшей pip/uv (`--no-cache`, `UV_LINK_MODE=copy`).
3. `USER app` после установки прав — проверяется `docker exec api whoami`.

## Сервис api в compose (фрагмент для сверки с P7)

Полный compose ведёт delivery-infra; здесь — только контрактные строки сервиса `api`:

```yaml
services:
  api:
    build: ./backend
    ports:
      - "8000:8000"
    env_file: .env                      # SEED, DATA_DIR, LLM_MODE, LOG_LEVEL…
    volumes:
      - ./data:/app/data:ro             # телеметрия/ЛИМС/ПАК — только чтение
      - ./artifacts:/app/artifacts      # runs/, timeline/ пишет ядро+sink (P3)
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health')"]
      interval: 15s
      timeout: 3s
      retries: 3
    depends_on: []                      # api ни от кого не зависит: данные готовит make data
```

Потребитель healthcheck: `web` (nginx) стартует с `depends_on: {api: {condition:
service_healthy}}` — пока `/api/health` не отвечает 200, фронт не поднимается
([[02-docker-compose]]).

## Локальный запуск против Docker

| | `make run` (локально) | `make up` (compose) |
| --- | --- | --- |
| Окружение | `uv run uvicorn app.main:app` ([[03-uv-environment]]) | этот образ |
| Версии | тот же `uv.lock` | тот же `uv.lock` (stages) |
| Пути | относительные из корня репо (`Settings`, [[01-app-config]]) | монтирования `data/`, `artifacts/` |
| Проверка | `curl -N localhost:8000/api/…` | healthcheck + `docker logs api` |

## `.dockerignore` (backend/)

Сборочный контекст минимален — иначе в образ попадают артефакты прогонов и dev-мусор:

```text
.venv/
__pycache__/
.pytest_cache/
.ruff_cache/
tests/
*.md            # документация не нужна в runtime-слое
.env            # секреты и пути — только через compose env_file
```

## Типовые проблемы и диагностика

| Симптом | Причина | Действие |
| --- | --- | --- |
| контейнер `restarting` в compose | healthcheck 5xx/обрыв | процесс не поднялся: `docker logs api`, проверить `Settings`/пути |
| `api` healthy, но UI «жёлтый» | `status: degraded` — нет `data/` или моделей | выполнить `make data` / `make train` на хосте |
| SSE приходит пачкой в конце | буферизация на прокси | `X-Accel-Buffering: no` уже в ответе ([[04-sse-stream]]); проверить nginx-конфиг `web` |
| `PermissionError` в `artifacts/runs/` | volume смонтирован без прав uid `app` | `make up` создаёт подкаталоги с правами; см. раздел Non-root |
| медленный старт > start-period | прогрев реестра (P5) | увеличен `--start-period=10s`; дальше не лечится — прогрев обязан быть быстрым |

## Приёмочные критерии

1. `docker build ./backend` воспроизводим: два билда подряд дают одинаковый lock-набор
   (`uv sync --frozen` падает при расхождении `pyproject` ↔ `uv.lock`).
2. `docker run` без смонтированных каталогов стартует; `/api/health` → `degraded`
   (`dataOk: false`), контейнер healthy — не рестартует.
3. `whoami` в контейнере — `app`; попытка записи в `/app/data` падает (read-only).
4. После `make data && make train && make up`: `GET :8000/api/health` → `ok`,
   `modelsLoaded: 4`; прогон из UI пишет `artifacts/runs/`.
5. Размер финального образа ≤ 1.5 ГБ (нет dev-зависимостей и кэшей).

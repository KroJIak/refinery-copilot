---
title: "backend — 01. Конфигурация и фабрика приложения"
tags: [refinery-copilot, backend, config, pydantic-settings]
related:
  - "[[backend/00-OVERVIEW]]"
  - "[[01-p1-rest-sse]]"
  - "[[04-env-vars]]"
  - "[[90-narrator-llm]]"
created: 2026-09-19
---

# Конфигурация и фабрика приложения

Назначение: единая точка, где создаются `FastAPI`, `Settings` и lifespan (прогрев реестра
моделей), и где ошибки ядра превращаются в контрактные HTTP-коды. Файл: `backend/src/app/config.py`
+ `backend/src/app/main.py`.

## Scope

| Охват (covers) | Не охват (does NOT cover) |
| --- | --- |
| `Settings` (pydantic-settings): пути `data/` и `artifacts/`, сид, тумблер LLM, режимы debug, CORS | Роуты и сервисы — [[03-runs-routes]], [[02-core-bridge]] |
| Фабрика `create_app()` и lifespan: загрузка/прогрев реестра моделей до первого запроса | Загрузка моделей — `refinery_core` ([[02-model-registry]], P5) |
| Центральный маппинг ошибок ядра (`CoreError`-семейство) → HTTP 400/404/409/503 | Тексты сообщений для UI — слова контракта P1 |
| `.env.example`: полный перечень переменных окружения сервиса | docker-compose-ENV — [[02-docker-compose]], [[07-docker]] |

## Settings

pydantic v2 `BaseSettings`; env читается без префикса — имена совпадают с
[[04-env-vars]] (один и тот же `.env` для CLI, ядра и сервиса).

```python
LLMMode = Literal["off", "local", "external"]  # mirror core narrator toggle

class Settings(BaseSettings):
    # пути (P3/P5: ядро читает данные и пишет артефакты; backend только проверяет доступность)
    data_dir: Path = Path("data")                    # env DATA_DIR
    artifacts_dir: Path = Path("artifacts")          # env ARTIFACTS_DIR
    model_registry_dir: Path | None = None           # env MODEL_REGISTRY_DIR; None → artifacts_dir/models

    # воспроизводимость
    seed: int = 42                                   # env SEED; проталкивается в Scenario по умолчанию

    # тумблер LLM-нарратора: off | local | external
    llm_mode: LLMMode = "off"                        # env LLM_MODE
    llm_base_url: str | None = None                  # env LLM_BASE_URL; обязателен при external
    llm_timeout_s: float = 10.0                      # env LLM_TIMEOUT_S

    # режимы отладки
    debug: bool = False                              # env DEBUG: /docs, подробные 500-ответы
    log_level: str = "INFO"                          # env LOG_LEVEL

    # транспорт
    cors_origins: list[str] = ["http://localhost:5173"]  # env CORS_ORIGINS (Vite-дев-сервер)
    api_host: str = "0.0.0.0"                        # env API_HOST
    api_port: int = 8000                             # env API_PORT

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")
```

> [!note] Тумблер LLM — транзит, не логика
> backend не решает, как формулировать текст: `LLM_MODE`/`LLM_BASE_URL` передаются в ядро
> при создании `CoreService` ([[90-narrator-llm]]). По умолчанию `off`
> — закрытый контур on-premise. `external` без
> `llm_base_url` — ошибка конфигурации на старте (fail-fast в lifespan).
> Сид в ответы не подставляется backend'ом: Scenario.seed уже в DTO [[06-scenario]].

## Фабрика приложения и lifespan

```python
def create_app(settings: Settings | None = None) -> FastAPI:
    """Собирает FastAPI: CORS, роутеры, обработчики ошибок, lifespan."""

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[AppState]: ...
    # 1) Settings → CoreService (registry+settings в __init__, см. P2)
    # 2) прогрев реестра моделей: refinery_core registry loads active artifacts (P5)
    # 3) CoreBridge + RunManager кладутся в app.state
    # 4) fail-fast: models_not_loaded / data_missing логируются, но сервер стартует — health покажет 503

app = create_app()  # backend/src/app/main.py — точка входа uvicorn
```

- **CORS**: только `cors_origins` (Vite `:5173`); прод идёт через nginx same-origin
  ([[02-docker-compose]]), поэтому `allow_origins=["*"]` запрещён.
- **Прогрев реестра** делается один раз в lifespan ([[05-p5-pipeline-core]]):
  `GET /models` и `POST /whatif` после старта не платят за чтение диска.
- Роутеры подключаются в порядке документов: runs → sse → state/whatif → models/health.

## Маппинг ошибок ядра в HTTP

Единый обработчик — ни один роутер не собирает ответы об ошибках вручную.
Тело ошибки — контрактное ([[01-p1-rest-sse]]):
`{"error": {"code": "...", "message": "...", "details": {...}}}`.

```python
class CoreError(Exception):
    code: str                       # models_not_loaded | data_missing | unknown_kind | …
    http_status: int                # см. таблицу ниже

def install_error_handlers(app: FastAPI) -> None: ...
    # CoreError            → HTTP по .http_status + контрактное тело
    # RequestValidationError → 422 → нормализуется в 400 {code: "validation_error"}
    # Exception            → 500 {code: "internal"}; details только при debug=true
```

| Ошибка ядра / валидации | HTTP | Когда |
| --- | --- | --- |
| `validation_error` | 400 | pydantic-отклонение Scenario/WhatifRequest; неизвестный `kind` |
| `unmanaged_override` | 400 | override неуправляемого тега ([[06-scenario]]) |
| `run_not_found` / `report_not_found` | 404 | нет `artifacts/runs/{run_id}.*` |
| `whatif_busy` | 409 | слот what-if-воркера занят ([[05-state-whatif]]) |
| `models_not_loaded` | 503 | registry пуст / sha256 не сошёлся (P5) |
| `data_missing` | 503 | parquet не найден / каталоги недоступны |
| `internal` | 500 | непойманное исключение; `run_failed` уходит и в SSE ([[04-sse-stream]]) |

> [!warning] Правило маппинга
> Ядро не знает про HTTP и не импортирует fastapi ([[02-p2-backend-core]]):
> оно возвращает ошибки своего типа — их перевод в коды ответа живёт только здесь.
> Новая ошибка ядра ⇒ сначала поле/enum в core, затем строка в этой таблице.

## `.env.example`

Кладётся в корень репо (домен delivery-infra), backend лишь перечисляет свои ключи;
дефолты совпадают с `Settings`.

```bash
# --- пути и воспроизводимость ---
SEED=42
DATA_DIR=data
ARTIFACTS_DIR=artifacts
# MODEL_REGISTRY_DIR=            # пусто → ${ARTIFACTS_DIR}/models

# --- LLM-нарратор (ядро), тумблер закрытого контура ---
LLM_MODE=off                     # off | local | external
# LLM_BASE_URL=                  # обязателен при LLM_MODE=external
# LLM_TIMEOUT_S=10

# --- сервис ---
API_HOST=0.0.0.0
API_PORT=8000
LOG_LEVEL=INFO
DEBUG=false
CORS_ORIGINS=http://localhost:5173
```

> [!example] Приёмочные критерии
> 1. `uvicorn app.main:app` стартует с пустым `.env` (все дефолты), `DEBUG=true` открывает `/docs`.
> 2. При `LLM_MODE=external` без `LLM_BASE_URL` — отказ старта с внятной ошибкой в логе.
> 3. `GET /api/health` до `make train` показывает `modelsLoaded: 0` + `status: degraded`
>    ([[06-models-health]]), а `POST /api/runs` отвечает 503 `models_not_loaded`.
> 4. Ни один роутер не содержит числовых литералов конфигурации — всё через `Settings`.

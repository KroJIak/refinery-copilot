---
title: "P2: backend ↔ core — in-process контракт"
tags: [refinery-copilot, api, protocol, core, asyncio]
related:
  - "[[01-p1-rest-sse]]"
  - "[[09-agent-orchestrator]]"
created: 2026-09-19
---

# P2: backend ↔ core (in-process)

> [!info] Статус
> Протокол пары **backend ↔ core-architecture**. Сеть не используется: backend импортирует `refinery_core`.
> Реализуется `core/src/refinery_core/service.py` (ядро) и `services/core-bridge` + `run-manager`
> (backend); потребляется роутами из [[01-p1-rest-sse]].

## Scope

| | |
| --- | --- |
| **Covers** | сигнатуры `CoreService` (`start_run`, `subscribe_events`, `get_report`, `read_state`, `whatif`, `list_models`); модель `CoreEvent` и очередь событий; жизненный цикл воркера; гарантии (один прогон = один поток, непотеря событий — буфер + таймлайн-файл); границы ответственности; маппинг ошибок ядра → HTTP-коды P1 |
| **Does NOT cover** | HTTP/SSE-кадры ([[01-p1-rest-sse]]); логика агентов и отказов ([[09-agent-orchestrator]], [[10-refusal]]); чтение Parquet и запись артефактов ([[03-p3-core-datastore]]); загрузка моделей ([[05-p5-pipeline-core]]) |

---

## 1. Обзор

```text
backend (FastAPI)                                core (refinery_core)
┌───────────────────────────┐   P2 in-process    ┌──────────────────────────────┐
│ routes → core-bridge ─────┼─ start_run/run_...─► CoreService                    │
│ run-manager (реестр       │◄── CoreEvent ×N ───│   worker-поток: 5 агентов    │
│  активных прогонов)       │   asyncio.Queue    │   registry (P5) · отчёт (P3) │
│ sse-stream ◄─ Queue → SSE │                    └──────────────────────────────┘
└───────────────────────────┘   ядро не знает про HTTP; backend не считает
```

- Backend — тонкая HTTP-обёртка: транспорт и оркестрация вызовов, **без логики рекомендаций**
  ([[09-agent-orchestrator]]).
- Ядро — синхронное, детерминированное, **без сети**; прогон идёт в выделенном worker-потоке
  (`anyio.to_thread`), события доставляются в asyncio-очередь через `loop.call_soon_threadsafe`.
- pydantic-модели — **одни и те же классы**: backend
  импортирует их из core, дублирования схем нет (источник контракта — [[00-SUMMARY]]).

## 2. `CoreService` — единственная точка входа ядра

```python
# core/src/refinery_core/service.py
class CoreService:
    """registry + settings — в __init__; модели загружаются один раз при старте (P5)."""

    def start_run(self, scenario: Scenario) -> str:
        """Неблокирующе: создаёт run_id, очередь событий и worker-поток; возвращает run_id."""

    def subscribe_events(self, run_id: str) -> asyncio.Queue[CoreEvent]:
        """Очередь событий прогона: сначала реплей из таймлайна, затем live."""

    def get_report(self, run_id: str) -> RunReport:
        """RunReport из artifacts/runs/{run_id}.json; ошибки см. §6."""

    def read_state(self) -> StateAggregate:
        """Срез текущего состояния — данные для GET /api/state ([[01-p1-rest-sse]] §4.2):
        срез тегов (TagPoint[]) + DataFreshness[] + последняя Recommendation (если есть)."""

    def whatif(self, overrides: WhatifRequest) -> WhatifResult:
        """Синхронно, < 50 мс: QualityAssessment по каждой цели для baseline и вариантов
        + feasibility/violations (элементы карточки Recommendation без записи артефактов)."""

    def list_models(self) -> list[ModelArtifact]:
        """Активные артефакты реестра (P5) для страницы «Модели»."""
```

| Метод | Блокирует? | Поток | Замечания |
| --- | --- | --- | --- |
| `start_run(scenario) → run_id` | нет | event-loop | валидность сценария проверяет pydantic; тяжёлая работа — в worker-потоке |
| `subscribe_events(run_id) → Queue[CoreEvent]` | нет | event-loop | очередь своя на прогон; поздний подписчик получает реплей из журнала, см. §3 и §5.2 |
| `get_report(run_id) → RunReport` | да (короткий файловый I/O) | поток FastAPI | история — артефакты, не память; повторный прогон создаёт новый `run_id` (P3) |
| `read_state() → StateAggregate` | да (короткий файловый I/O) | поток FastAPI | срез тегов + DataFreshness + последняя Recommendation — сырьё ответа `GET /api/state` ([[01-p1-rest-sse]] §4.2) |
| `whatif(overrides) → WhatifResult` | да, < 50 мс | поток (threadpool) | только чтение моделей — безопасно параллельно с прогоном |
| `list_models() → list[ModelArtifact]` | да, из памяти | поток | реестр неизменяем после загрузки |

CLI-режим ([[14-cli]]) использует тот же `CoreService`, но вместо очереди подписывается
своим sink-принтером — транспорт событий абстрагирован интерфейсом подписки.

## 3. Событийная модель

```python
@dataclass(frozen=True)
class CoreEvent:
    seq: int            # монотонный счётчик внутри прогона, начинается с 1
    run_id: str
    kind: SseKind       # run_started … run_failed — тот же набор, что в [[01-p1-rest-sse]] §5.2
    payload: dict       # JSON-ready: camelCase не нужен — это внутренняя форма ядра (snake_case)
    ts: datetime        # aware UTC
```

Доставка: worker-поток публикует события через `loop.call_soon_threadsafe(queue.put_nowait, ev)`
в очередь конкретного прогона. Backend (`core-bridge`):

1. после `start_run` берёт `subscribe_events(run_id)`;
2. в отдельной asyncio-задаче читает очередь и транслирует `CoreEvent → SSE-кадр`
   (переводит поля в camelCase, добавляет `ts`, см. [[01-p1-rest-sse]] §5.1);
3. **не интерпретирует** payload'ы — трансляция механическая, вся логика только в ядре.

`seq` — единственный порядок: backend не сортирует, не перенумеровывает, не буферизует заново.
Порядок событий задаёт оркестратор: `run_started` → (агенты) → `recommendation`|`refusal` →
`run_finished`|`run_failed`.

## 4. Жизненный цикл воркера

```mermaid
sequenceDiagram
    participant BE as backend (core-bridge)
    participant S as CoreService
    participant W as worker-поток (anyio.to_thread)
    participant T as artifacts/timeline/{run_id}.ndjson
    BE->>S: start_run(scenario)
    S->>S: run_id = YYYYMMDD-HHMMSS-hex8 (UTC); создать очередь
    S-->>BE: run_id (не блокирует)
    S->>W: запуск в отдельном потоке
    W->>T: каждое событие — сначала append в журнал
    W-->>S: CoreEvent ×N (call_soon_threadsafe → Queue)
    S-->>BE: подписчик читает Queue
    alt рекомендация собрана
        W->>W: artifacts/runs/{run_id}.{json,md} (P3)
        W-->>S: recommendation, run_finished
    else штатный отказ
        W-->>S: refusal, run_finished(status="refused")
    else исключение / нет моделей
        W-->>S: run_failed{errorCode} (публикуется даже при падении потока)
    end
    S->>S: очередь закрывается и удаляется после финального события
```

Состояния прогона — FSM `RunStatus` (`started → running → completed | refused | failed`,
[[07-run-report]]): терминальные исходы `completed`/`refused` — штатные, `failed` — авария.

## 5. Гарантии

> [!warning] Контрактные гарантии ядра (проверяются тестами [[15-tests]])
> 1. **Один прогон = один поток.** Сценарий выполняется целиком в выделенном worker-потоке;
>    состояние прогона локально в потоке, shared mutable state между прогонами отсутствует.
>    Повторный прогон того же сценария — новый `run_id`, файлы не перезаписываются (P3).
> 2. **События не теряются.** (а) очередь на прогон, `maxsize=1000`, постановка `put_nowait`
>    из потока; (б) каждое событие **синхронно дописывается** в
>    `artifacts/timeline/{run_id}.ndjson` **до** постановки в очередь — журнал первичен;
>    (в) поздний подписчик/реплей после разрыва получает недостающее из журнала
>    ([[01-p1-rest-sse]] §5.4); (г) очередь удаляется только после финального события и
>    закрытия подписчиков.
> 3. **Детерминизм.** Все случайности фиксируются `seed` из `Scenario`; один seed → одинаковый
>    вывод и одинаковый журнал событий ([[05-seeds-reproducibility]]).
> 4. **Отказ ≠ исключение для транспорта.** Штатный отказ оркестратора доезжает до фронта как
>    `refusal` + `run_finished`; `run_failed` — только реальные аварии (нет моделей, упало исключение).
> 5. **Финальность.** После `run_finished`/`run_failed` новых событий в прогоне не бывает;
>    поток закрыт; повторный `subscribe_events` отдаёт реплей журнала.

## 6. Границы ответственности и маппинг ошибок

| Ядро (`refinery_core`) | Backend (`app`) |
| --- | --- |
| **Не знает про HTTP/SSE**: не импортирует `fastapi`/`sse-starlette`, не знает про кадры и заголовки | Транслирует `CoreEvent` → SSE-кадры; владеет `RunManager` (реестр активных прогонов в памяти) и правилом 409 |
| Владеет всей логикой: агенты, ограничения, Парето, отказ, карточка рекомендации, отчёт | Валидирует HTTP-вход (pydantic-схемы из core); не дублирует логику рекомендаций |
| Читает Parquet и пишет артефакты сам (P3, read-only по `data/processed/`) | **Не читает `data/` напрямую** — доступ к данным только через ядро |
| Загружает модели из реестра (P5); никогда не обучает в рантайме | Проверяет готовность моделей при старте (lifespan) → 503, если пусто |

| Исключение ядра | HTTP P1 | `error.code` |
| --- | --- | --- |
| pydantic `ValidationError` (сценарий/overrides/whatif) | 400 / 422 | `validation_error`, `unmanaged_override`, `unknown_scenario_kind` |
| `RunNotFoundError` | 404 | `run_not_found` |
| `RunAlreadyActiveError` (дубль активного прогона в RunManager) | 409 | `run_already_active` |
| `ModelsNotLoadedError` (registry пуст, хэш не сошёлся) | 503 | `models_not_loaded` |
| `DataMissingError` (`data/processed/` не найден) | 503 | `data_missing` |
| неперехваченное в worker-потоке | 500 + `run_failed` в SSE | `internal_error` |

## 7. Пример интеграции (backend `core-bridge`)

```python
# backend/src/app/services/core_bridge.py — схема, не реализация
from refinery_core import CoreService  # P2: импорт ядра, сеть не используется

core = CoreService.from_settings(settings)          # lifespan: загрузка реестра (P5)

async def start_run(body: RunCreate) -> RunAccepted:
    run_id = core.start_run(body.to_scenario())     # → str, не блокирует
    return RunAccepted(runId=run_id, eventsUrl=f"/api/runs/{run_id}/events")

async def stream_events(run_id: str, last_seq: int):
    queue: asyncio.Queue[CoreEvent] = core.subscribe_events(run_id)
    for ev in replay_from_timeline(run_id, after=last_seq):   # журнал — источник реплея
        yield to_sse_frame(ev)
    while (ev := await queue.get()).kind not in ("run_finished", "run_failed"):
        if ev.seq > last_seq:
            yield to_sse_frame(ev)
    yield to_sse_frame(ev)                          # финальное событие, затем close
```

Подписка на несуществующий прогон — `RunNotFoundError` (→ 404 в P1); на завершённый — только
реплей журнала без live-хвоста.

> [!example] Чек-лист соответствия
> 1. Все шесть сигнатур `CoreService` (`start_run`, `subscribe_events`, `get_report`, `read_state`, `whatif`, `list_models`) зафиксированы; очередь событий — `asyncio.Queue[CoreEvent]` на прогон.
> 2. Гарантии §5 — контрактные требования: один прогон = один поток; события не теряются (буфер + таймлайн-файл).
> 3. Границы: core без HTTP, backend без вычислений (§6).
> 4. Ошибки ядра маппятся 1:1 в коды P1 ([[01-p1-rest-sse]] §2.2).

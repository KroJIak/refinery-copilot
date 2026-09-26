---
title: "frontend — SSE-клиент"
tags: [refinery-copilot, frontend, sse, eventsource, p1]
related:
  - "[[frontend/00-OVERVIEW]]"
  - "[[01-p1-rest-sse]]"
  - "[[05-mocks]]"
  - "[[06-state]]"
  - "[[05-agent-step]]"
created: 2026-09-19
---

# 04 — SSE-клиент (`src/services/sse.ts`)

Обёртка над браузерным `EventSource` для стрима `/api/runs/{run_id}/events` ([[01-p1-rest-sse]]).
Клиент парсит 10 событий прогона, фильтрует дубли по `id` и транслирует их в колбэки, которые
подключаются к стору ([[06-state]], срез `run`). Рендер конвейера — не его забота.

## Scope

Содержит: подписку/отписку, `Last-Event-ID`, дедупликацию по `seq`, heartbeat/reconnect-логику,
таблицу парсинга всех 10 событий, callback-адаптер в стор. НЕ содержит: запуск прогонов
(это `createRun` из [[03-service-rest]]), хранение состояния, визуализацию.

## События прогона (10 типов из [[01-p1-rest-sse]])

Порядок внутри прогона строгий: `run_started` → [`agent_started` → `step*`/`log*` →
`agent_finished`] × 5 агентов → `recommendation` | `refusal` → `run_finished` | `run_failed`.
Каждое событие несёт `id` = монотонный `seq`. `heartbeat` — **комментарий** SSE `: hb <ISO>`
каждые 15 с (не событие и не несёт `id`).

| # | Событие | Payload (data-JSON) | TS-тип payload | Куда в стор ([[06-state]]) |
| --- | --- | --- | --- | --- |
| 1 | `run_started` | `{runId, status:'running', kind, tPoint, seed}` | `RunStartedPayload` | `run.status='running'` |
| 2 | `agent_started` | `AgentStep` без `output`/`numberRefs` | `AgentStep` | `run.steps[stepIdx]='running'` |
| 3 | `step` | `{runId, stepIdx, agentRole, label, payload}` | `StepPayload` | `run.stepArtifacts[stepIdx]` |
| 4 | `log` | `{runId, stepIdx, level:'info'\|'warn', message, ts}` | `LogPayload` | `run.logs[]` |
| 5 | `agent_finished` | `AgentStep` полный (с `output`, `numberRefs`, `notes`) | `AgentStep` | `run.steps[stepIdx]='done'`, трейс |
| 6 | `recommendation` | `Recommendation`, `decision='recommend'` | `Recommendation` | `run.card`, `run.status='completed'`-готовность |
| 7 | `refusal` | `Recommendation`, `decision='refuse'`, заполнен `refusal` | `Recommendation` | `run.card` (ветка отказа) |
| 8 | `run_finished` | `{runId, status:'completed'\|'refused', durationMs, reportUrl}` | `RunFinishedPayload` | `run.status`, `run.reportUrl` |
| 9 | `run_failed` | `{runId, errorCode, message, durationMs}` | `RunFailedPayload` | `run.status='failed'`, ошибка в UI |
| 10 | `heartbeat` | комментарий `: hb <ISO>`, без `data` | — | никуда: держит соединение (см. ниже) |

## Сигнатуры

```ts
// src/services/sse.ts
export type RunEventHandlers = {
  onRunStarted?(p: RunStartedPayload): void;
  onAgentStarted?(s: AgentStep): void;
  onStep?(p: StepPayload): void;
  onLog?(p: LogPayload): void;
  onAgentFinished?(s: AgentStep): void;
  onRecommendation?(card: Recommendation): void;
  onRefusal?(card: Recommendation): void;
  onRunFinished?(p: RunFinishedPayload): void;
  onRunFailed?(p: RunFailedPayload): void;
  onConnectionChange?(state: 'connecting' | 'open' | 'stale' | 'closed'): void;
};

export type SseSource = { url: string; handlers: RunEventHandlers; signal?: AbortSignal };

export function subscribeRunEvents(source: SseSource): () => void;
// возвращает отписку; идемпотентна
```

URL события берётся из `RunCreated.eventsUrl` ([[03-service-rest]]) и резолвится относительно
`VITE_API_BASE` — компонентам события ни разу не собираются руками.

## Подключение, Last-Event-ID, дедупликация

```ts
// псевдокод ядра клиента
const es = new EventSource(url);            // браузер сам шлёт Last-Event-ID при реконнекте
for (const name of EVENT_NAMES /* 9 именованных */) {
  es.addEventListener(name, (ev: MessageEvent) => {
    if (seen.has(ev.lastEventId)) return;   // дубли по seq отбрасываются — гарантия P1
    seen.add(ev.lastEventId);
    lastEventAt = Date.now();
    dispatch(name, JSON.parse(ev.data), handlers);
  });
}
```

> [!warning] Гарантии P1, на которые опирается клиент
> 1. Один запрос = один прогон: после финального события (`run_finished`/`run_failed`) сервер
>    закрывает поток и `retry:` не выдаёт → клиент **не переподключается** после финала и
>    вызывает `es.close()`.
> 2. Переподключение — `Last-Event-ID` + реплей с сервера из журнала
>    `artifacts/timeline/{run_id}.ndjson`; дубли по `id` отбрасываются (см. выше).
> 3. `event:`-кадр пуст у events без имени — сервер всегда задаёт имя, парсим только 9 имён.

## Heartbeat и reconnect

- Комментарий `: hb` браузер не эмитит ни в `onmessage`, ни в `addEventListener` — его нельзя
  «распарсить». Роль heartbeat — держать живыми proxy/nginx на пути (P7: `proxy_buffering off`,
  длинный `proxy_read_timeout`).
- **Liveness-детектор**: таймер (период проверки 5 с, порог тишины 45 с = 3× интервал hb):
  если `Date.now() - lastEventAt > порог` и прогон не финален → `onConnectionChange('stale')`,
  затем `es.close()` и принудительный `new EventSource(url)` — браузер пошлёт `Last-Event-ID`,
  сервер доиграет пропущенное реплеем.
- **Backoff на ошибки**: `onerror` → `onConnectionChange('connecting')`; автоматический
  реконнект `EventSource` использовать как есть (он экспоненциально не растёт, но со штатным
  `retry` сервера достаточно); при повторных ошибках подряд — закрыть и пересоздать соединение
  с задержкой `min(1с × 2^n, 30с)`, `n` сбрасывается при `onopen`.
- Отмена: `signal.addEventListener('abort', () => es.close())`; после `run_failed`/`abort`
  переподключений нет.

## Разбор кадра (пример)

```text
id: 7
event: agent_finished
data: {"runId":"20260919-080000-3f9c2a","stepIdx":1,"agentRole":"quality",
       "startedAt":"…","finishedAt":"…","durationMs":2100,
       "inputDigest":"9f2a1c4e8b7d0f31","inputSummary":{"targets":["sulfur"]},
       "output":{"sulfur":{"p50":9.6,"p10":8.9,"p90":10.4}},
       "numberRefs":[{"path":"sulfur.p50","value":9.6,"unit":"мг/кг","label":"Прогноз серы P50"}],
       "notes":["Интервал расширен конформом."],"confidence":0.71}
```

Клиент: `addEventListener('agent_finished', ev)` → `ev.lastEventId === '7'` (ключ дедупликации),
`JSON.parse(ev.data)` → `AgentStep` ([[05-agent-step]]). Поля payload **не нормализуются** —
объект передаётся в стор как есть (правило «все числа из контракта», [[frontend/00-OVERVIEW]]).

## Подключение из React (хук-обёртка)

```ts
// src/features/run/useRunEvents.ts — сигнатура
export function useRunEvents(): void;
// внутри: читает runId/eventsUrl из runSlice, subscribeRunEvents в useEffect,
// отписка при анмаунте и после терминального события; handlers подключены к экшенам среза
```

## Пограничные случаи

| Случай | Поведение клиента |
| --- | --- |
| `404` на открытие стрима (прогон не найден) | один `onerror`, `es.close()`, стор ставит `failed` c `errorCode='not_found'` |
| Обрыв сети до финала | авто-реконнект + `Last-Event-ID` → реплей; дубли отбрасываются по `id` |
| Тишина > 45 с без финала | `onConnectionChange('stale')` → принудительный пересоздаваемый коннект |
| Событие вне прогона / неизвестное имя | игнорируется (unknown event) — контракт расширяется только через P1 |
| Финал получен, затем ещё кадры (гонка) | отсекаются: после `run_finished`/`run_failed` слушатели сняты |

## Адресация и моки

- Базовый URL: `${VITE_API_BASE}/runs/{runId}/events` — та же база, что у [[03-service-rest]].
- При `VITE_USE_MOCKS=true` вместо сети подписчик получает события от мок-SSE-симулятора
  ([[05-mocks]]) с тем же интерфейсом `subscribeRunEvents` — стор и компоненты не различают
  источник (правило 4 [[frontend/00-OVERVIEW]]).

## Жизненный цикл на стороне UI

```text
createRun() → 202 {eventsUrl}  →  subscribeRunEvents({url: eventsUrl, handlers})
   run_started → agent_started/step/log/agent_finished ×5
   → recommendation | refusal → run_finished | run_failed → es.close(), отписка
Обрыв вкладки/сети до финала → Last-Event-ID реплей при возврате, дубли отфильтрованы
```

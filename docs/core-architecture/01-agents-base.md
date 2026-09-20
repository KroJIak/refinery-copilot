---
title: "agents/base.py — каркас агентов ядра"
tags: [refinery-copilot, core-architecture, agents, base, agent-step]
related:
  - "[[core-architecture/00-OVERVIEW]]"
created: 2026-09-19
---

# 01 — Базовый класс агента (`agents/base.py`)

## Scope

Документ описывает **каркас**, на котором работают все пять агентов ядра: протокол
`run(ctx) -> AgentStep`, контекст прогона, дайджест входа, тайминги, регистрацию ролей
[[01-enums|AgentRole]] и обработку ошибок.

**Покрывает:** `agents/base.py`, `RunContext`, порядок шагов, трейс [[05-agent-step]],
политику «ошибка агента не валит прогон».
**Не покрывает:** логику конкретных агентов ([[03-agent-data]]…[[07-agent-optimization]],
[[09-agent-orchestrator]]), транспорт событий (P2, [[02-p2-backend-core]]), HTTP и обучение.

> [!quote] Правило каркаса
> «Агент — чистая функция контекста: вход → `AgentStep`; без глобального состояния и без сети.»

## Протокол агента

Единственный метод агента — `run`: принимает неизменяемый контекст прогона, возвращает
один шаг трейса. Никаких побочных эффектов, кроме записи в `ctx.state` (накопитель выходов
предыдущих агентов); сеть и обращение к файлам — только через внедрённые зависимости
(`registry`, `store`), поэтому агенты тестируются на фикстурах.

```python
class BaseAgent(ABC):
    role: ClassVar[AgentRole]                    # data | quality | reliability | optimization | orchestrator

    @abstractmethod
    def _run(self, ctx: RunContext) -> dict:
        """Логика агента: возвращает output для AgentStep. Псевдокод уровня сигнатуры."""

    def run(self, ctx: RunContext) -> AgentStep:  # обёртка: тайминги + digest + ошибки (ниже)
        ...
```

## Контекст прогона

```python
@dataclass(frozen=True)
class RunContext:
    run_id: str                    # YYYYMMDD-HHMMSS-hex8 (UTC), см. [[07-run-report]]
    scenario: Scenario             # [[06-scenario]]: kind, t_point, overrides, seed
    t_point: datetime              # точка состояния процесса, UTC
    seed: int                      # вся случайность прогона — отсюда
    registry: ModelRegistry        # только чтение моделей, [[02-model-registry]]
    settings: CoreSettings         # пороги свежести, веса индекса тяжести, константы гистерезиса
    state: RunState                # накопленные выходы: slices, freshness, quality, severity, variants
```

`RunContext` создаётся один раз на прогон ([[09-agent-orchestrator]]); агенты не пересоздают
и не мутируют чужие части `state`. Сид един для всех шагов — производные генераторы
(`random.Random(ctx.seed + step_idx)`) фиксируются в трейсе.

## Трейс шага: [[05-agent-step]]

Каждый шаг прогона — первоклассный артефакт: он попадает в `agents_trace[]` отчёта
[[07-run-report]] и в SSE-события `agent_started` / `agent_finished` ([[02-p2-backend-core]]).
Поля шага каноничны — определяются только в api (`api/data-models/05-agent-step.md`):

| Поле | Что кладёт каркас |
| --- | --- |
| `run_id`, `step_idx` | прогон и порядок роли: `data=0, quality=1, reliability=2, optimization=3, orchestrator=4` |
| `agent_role` | `self.role` |
| `started_at` / `finished_at` / `duration_ms` | UTC-метки; длительность — по монотонным часам |
| `input_digest` | sha256 нормализованного входа → 16 hex |
| `input_summary` | ключевые входы без сырых рядов (ids точек, окна, размер среза) |
| `output` | структурированный выход агента |
| `notes`, `number_refs` | текстовые выводы и `{path, value, unit, label}` — ссылки на числа |
| `confidence` | самооценка агента (0..1), `null` если не применимо |

Дайджест входа — основа воспроизводимости (детерминизм: одинаковый вход ⇒ одинаковый выход):

```python
def input_digest(payload: dict) -> str:
    """sha256 канонического JSON: sorted keys, без NaN/Inf, числа с округлением до 1e-6.
    Возвращает первые 16 hex. Одинаковый вход ⇒ одинаковый digest в любом прогоне."""
```

## Регистрация ролей и порядок конвейера

Роли фиксированы перечислением [[01-enums|AgentRole]] (`data, quality, reliability, optimization,
orchestrator`); порядок конвейера задан кортежем и совпадает с `step_idx`:

```python
PIPELINE: tuple[AgentRole, ...] = (
    AgentRole.DATA, AgentRole.QUALITY, AgentRole.RELIABILITY,
    AgentRole.OPTIMIZATION, AgentRole.ORCHESTRATOR,
)

AGENTS: Mapping[AgentRole, type[BaseAgent]] = {
    AgentRole.DATA: DataAgent, AgentRole.QUALITY: QualityAgent,
    AgentRole.RELIABILITY: ReliabilityAgent, AgentRole.OPTIMIZATION: OptimizationAgent,
    AgentRole.ORCHESTRATOR: OrchestratorAgent,
}   # новая роль — только через добавление в enum; енумы закрыты
```

Оркестратор — тоже роль [[01-enums|AgentRole]]: он получает `step_idx=4` и свой `AgentStep`, поэтому
«полный трейс входов/оценок/решения» покрывает и сборку карточки.

## Обработка ошибок: ошибка агента ≠ падение прогона

Принцип безопасности: отказ — **штатный результат**, а не исключение. Каркас ловит любую ошибку
агента, фиксирует её в трейсе и продолжает конвейер; решение «рекомендовать / отказаться»
остаётся за оркестратором. Аварийный статус `failed` ([[01-enums|RunStatus]]) зарезервирован для
неисправностей самого каркаса (нет моделей в реестре, недоступен data-store до старта).

```python
def run(self, ctx: RunContext) -> AgentStep:
    step = AgentStep(run_id=ctx.run_id, step_idx=STEP_IDX[self.role],
                     agent_role=self.role, started_at=utc_now())
    step.input_digest = input_digest(ctx.state.inputs_for(self.role))
    try:
        step.output, step.confidence = self._run(ctx)
    except AgentError as err:                     # штатная причина отказа: данные, модель, границы
        step.notes.append(f"ошибка агента: {err}")
        step.output = {"error": str(err)}
    except Exception as err:                      # непредвиденный баг — тоже не валит прогон
        step.notes.append(f"непредвиденная ошибка: {err}")
        step.output = {"error": str(err)}
    finally:
        step.finished_at = utc_now()
    return step
```

Оркестратор собирает роли с ошибками и отказывается, подбирая причины [[01-enums|RefusalReason]]
консервативно (безопасность важнее экономики):

| Ошибка | Причина отказа [[01-enums|RefusalReason]] | Обоснование |
| --- | --- | --- |
| агент `data`: срез не собрался, ключевые каналы мертвы/залипли | `sensor_fault` | `sensor_fault` — ключевые теги мертвы/залипли |
| агент `data`: свежесть ЛИМС за порогом | `stale_lims` | «`stale_lims` — ЛИМС устарел» |
| агент `quality`: инференс не выполнен | `wide_interval` | отсутствие прогноза = бесконечная неопределённость; спецификацию подтвердить нельзя |
| агент `reliability`: тяжесть не оценена | `out_of_training_domain` | нельзя подтвердить, что режим в надёжной области |
| агент `optimization`: поиск не выполнен / 0 допустимых | `no_feasible_variant` | «все варианты отбракованы жёсткими ограничениями» |

> [!quote] Правило безопасности
> «при нехватке данных или отсутствии допустимого варианта система должна отказаться
> от рискованной рекомендации и объяснить причину».

> [!quote] Правило приоритетов
> «Безопасность важнее экономики: конфликт целей разрешается в пользу ограничений;
> отказ — штатный результат, не исключение.»

Полный текст карточки отказа и приоритеты причин — [[10-refusal]]; показ в UI — домен frontend.
Прогон в этом случае завершается статусом `refused` ([[01-enums|RunStatus]]), а не `failed`.

## Чего каркас не делает

- Не знает про HTTP/SSE: трансляцию `AgentStep → CoreEvent` выполняет `service.py`
  ([[02-p2-backend-core]]); base.py не импортирует fastapi и не владеет очередью.
- Не обучает и не изменяет модели: только чтение через [[02-model-registry]] (P5).
- Не решает за оркестратора: ошибка агента лишь фиксируется; «рекомендовать / отказаться» —
  единоличное решение роли `orchestrator` ([[09-agent-orchestrator]]).

## Приёмочные проверки каркаса (для [[15-tests]])

1. Падение любого агента даёт `AgentStep` с заметкой об ошибке и **не** прерывает прогон;
   итог — карточка `refuse` с непустым `refusal.reasons`.
2. Одинаковый `RunContext` ⇒ одинаковые `input_digest` и `output` всех шагов (детерминизм).
3. Все 5 ролей из [[01-enums|AgentRole]] зарегистрированы; неизвестная роль — ошибка конфигурации ядра.

[^1]: Протокол P3: `input_digest` — хэш нормализованного входа (воспроизводимость), sha256, 16 hex.
[^2]: Статусы `refused` (штатный отказ) и `failed` (ошибка) различаются явно.
[^3]: `AgentStep` — владелец истины core-architecture.

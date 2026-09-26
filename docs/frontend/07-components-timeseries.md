---
title: "Компонент тайм-серий — ECharts-обёртка для 189 тыс. точек"
tags: [refinery-copilot, frontend, components, echarts, timeseries]
related:
  - "[[01-project-setup]]"
  - "[[02-types]]"
  - "[[03-service-rest]]"
  - "[[11-page-dashboard]]"
created: 2026-09-19
---

# 07 — Компонент тайм-серий (`TimeSeriesChart`)

Обёртка над Apache ECharts (`echarts-for-react`, Canvas-рендер) для телеметрии 24-2000 и АВТ:
ряд ~189 217 точек с шагом 10 мин за 2023–2026. Компонент **только рисует** — расчёт и
доставку данных делают [[03-service-rest]] + [[06-state]]; данные — зеркала DTO из [[02-types]].

> [!warning] Правило производительности домена
> «Все 189k точек в DOM» — запрещено (правило 5 [[frontend/00-OVERVIEW]]): на вход всегда
> подаётся полный ряд, но в `setOption` уходит LTTB-прореженная выборка; детализация — через
> `dataZoom` с локальным пересэмплированием окна.

## Scope

| Содержит (covers) | НЕ содержит (does NOT cover) |
| --- | --- |
| LTTB-сэмплирование 189k → ~5–10k точек + пере-сэмплирование окна при зуме | расчёт самих рядов, кэширование (react-query, [[06-state]]) |
| `dataZoom` (inside + slider), синхронизация нескольких графиков | выбор тегов/диапазонов (делают страницы) |
| Цветовые пороги по ограничениям (сера ≤ 10, T95 ≤ 360, p2/p98-зоны) | вердикты «pass/violate» (движок ограничений, ядро) |
| Линии спецификации (`markLine`), зоны аномалий/сентинелов (`markArea`) | SSE-логика (см. [[04-service-sse]]) |
| Метки факта ЛИМС поверх модельного прогноза (`markPoint` + scatter) | аннотации отчётов MD |
| Рендер `quality_flag`: разрывы `null`, штриховка сентинел/залипаний | чистка данных (data-pipeline) |

## API компонента

```ts
import type { TagPoint, DataFreshness } from '../types/api.gen';

export interface SeriesInput {
  tagCode: string;              // 'Q21', '24-2000.P8', 'crude_feed_rate_tph'
  unit: string | null;
  points: TagPoint[];           // полный ряд (данные не режем до прореживания)
  kind: 'telemetry' | 'forecast' | 'lims_fact';   // стиль линии
  p10?: TagPoint[]; p90?: TagPoint[];             // лента неопределённости для forecast
}

export interface ThresholdSpec {
  kind: 'spec_max' | 'spec_min' | 'band';       // markLine / коридор p2–p98
  value: number | [number, number];
  label: string;                                // 'сера ≤ 10 мг/кг', 'модельная зона p2–p98'
  breachColor?: string;                         // цвет значения за порогом
}

export interface TimeSeriesChartProps {
  series: SeriesInput[];
  thresholds?: ThresholdSpec[];
  sentinelAreas?: { from: string; to: string; reason: 'sentinel' | 'stuck' | 'outlier' }[];
  limsFacts?: { ts: string; value: number; label?: string }[];   // метки ЛИМС-факта
  freshness?: DataFreshness[];                  // бейджи свежести в шапке графика
  height?: number;                              // default 320
  lttbTarget?: number;                          // default 8000 точек на серию
  syncGroup?: string;                           // id группы dataZoom/tooltip
  onPointClick?: (tagCode: string, ts: string) => void;
}
```

## Поток данных

```mermaid
flowchart LR
    RQ["react-query<br/>useTagSeries"] -->|TagPoint[]| LTTB["lttbDownsample<br/>to lttbTarget"]
    LTTB --> OPT["buildOption(series,<br/>thresholds, areas, facts)"]
    TH["ThresholdSpec[]<br/>из /api/state + спецификации"] --> OPT
    OPT -->|setOption| EC["EChartsReact<br/>Canvas"]
    EC -->|dataZoom event| RE["re-sample окна<br/>полный ряд → LTTB"]
    RE --> EC
```

1. Страница берёт ряд через [[06-state]] (кэш react-query над `GET /api/state?tags=…`, [[03-service-rest]]).
2. Полный массив `TagPoint[]` проходит `lttbDownsample(points, lttbTarget)` — Largest-Triangle-Three-Buckets.
3. `buildOption()` собирает опции; ECharts получает только прореженное.
4. Пользователь зумит → событие `datazoom` → пересэмплирование **только видимого окна** из полного ряда (де-баббл 80 мс).

## Конфигурация ECharts

| Опция | Значение | Зачем |
| --- | --- | --- |
| `series.sampling` | `'lttb'` | второй рубеж прореживания на стороне ECharts |
| `series.large` / `progressive` | `true` / `2000` | отрисовка без блокировки потока |
| `dataZoom` | `[{ type: 'inside' }, { type: 'slider' }]` | зум колесом + слайдер-миникарта |
| `tooltip.axisPointer` | `'cross'`, `trigger: 'axis'` | чтение значений «как в SCADA» |
| `xAxis.type` | `'time'`, UTC-метки ISO | единый часовой пояс источников |
| `connect: null` | `syncGroup` | курсор/зум синхронны у графиков страницы |
| `animation` | `false` | 189k-ряды не анимируем |

## Цветовые пороги и ограничения

Пороги берутся из спецификации продуктовых ограничений и `checks[]` карточки [[04-recommendation]]:

| Величина | markLine / band | Цвет за порогом |
| --- | --- | --- |
| Сера (Q21, ПАК, ЛИМС) | ≤ 10 мг/кг | красный — сегмент выше порога перекрашивается отдельной серией-маской |
| T95 (ВАК/модель) | ≤ 360 °C | красный |
| Цетановое число | ≥ 51 летнее / ≥ 49 зимнее | красный ниже порога |
| Плотность D15 | 820–845 (800–845 зимнее) | красный вне коридора |
| Управляемые (P8/T11/F19, АВТ) | полоса p2–p98 истории[^p298] | жёлтая зона-допущение + подпись «модельный диапазон» |

Сегменты нарушений — отдельные `series` c `markArea`-порогом: линия остаётся нейтральной,
выход за границу красится, чтобы «риск» был виден без чтения чисел.

## Метки ЛИМС-факта и сентинелов

- **ЛИМС поверх прогноза**: `kind: 'lims_fact'` — редкие точки-маркеры (n ≈ 1 462 замера серы за 3,6 года),
  рисуются поверх ленты P10–P90 прогноза; расхождение факта и прогноза видно сразу.
  Анти-утечка не проблема фронтов — бэкенд отдаёт факт только с `ts ≥ available_ts` (≤ 4 ч после отбора[^lims]).
- **Сентинелы {307, 251, 252, 240}**: приходят как `value: null` + `quality_flag: 'sentinel'` (правило контракта);
  `connectNulls: false` → честные разрывы линии, а `sentinelAreas` штрихует зоны `markArea` с подписью причины.
- **Залипания** (`stuck`): та же штриховка; канонический пример — плато Q21 = 24,9 (зашкал анализатора).
- `freshness` — бейджи ok/warn/stale/missing в правом верхнем углу (цвета статусов [[01-enums]]).

## Производительность

- Держать в памяти **один** полный ряд на тег (react-query кэш, `staleTime: 5 мин`); LTTB — чистая функция,
  `useMemo` по `(points, lttbTarget)`.
- Пересэмплирование окна — без ре-фетча: прореживаем из уже скачанного массива.
- Несколько `TimeSeriesChart` на странице объединять `syncGroup`; тултип — `appendToBody`, чтобы не перерисовывать канву.

## Пример использования

```tsx
<TimeSeriesChart
  syncGroup="dashboard"
  series={[{ tagCode: 'Q21', unit: 'мг/кг', points: sulfur, kind: 'telemetry' },
           { tagCode: 'sulfur_fc', unit: 'мг/кг', points: forecast, p10: lo, p90: hi, kind: 'forecast' }]}
  thresholds={[{ kind: 'spec_max', value: 10, label: 'сера ≤ 10 мг/кг' }]}
  limsFacts={limsSulfur}
  sentinelAreas={[{ from: '2026-04-20T00:00:00Z', to: '2026-04-22T00:00:00Z', reason: 'stuck' }]}
  onPointClick={(tag, ts) => openTagDetail(tag, ts)}
/>
```

## Аннотации прогона на тайм-серии

Опциональный режим для дашборда: вертикальные метки событий активного прогона ([[04-service-sse]])
поверх ряда — где «начался агент данных», где появился прогноз.

```ts
export interface RunAnnotation {
  ts: string;               // момент события (t_point прогона)
  label: string;            // 'agent_finished: quality' | 'recommendation'
  level: 'info' | 'warn' | 'result';
}
// props: runAnnotations?: RunAnnotation[] → markLine вертикальные, цвет по level
```

Отличие от `limsFacts`: аннотации прогона — события системы, ЛИМС — факт лаборатории;
стили разные (пунктир vs треугольник), чтобы не смешивать «что было» и «что посчитали».

## Пустые состояния и ошибки

| Ситуация | Рендер |
| --- | --- |
| `points: []` | рамка с текстом «нет данных за период» + бейдж свежести источника, не пустая канва |
| все точки `quality_flag != 'ok'` | ряд серым, tooltip «канал недостоверен (сентинелы/залипания)» |
| `p10`/`p90` без `kind: 'forecast'` | лента не рисуется; расхождение пропсов — warning в консоли (баг интеграции) |
| ретрай react-query | прежние данные остаются на месте с бейджем «данные от HH:MM» — канва не мигает |

## Доступность и клавиатура

- Слайдер `dataZoom` фокусируем: стрелки ←/→ двигают окно на 1 шаг сетки (10 мин), Shift+ — на сутки.
- Значения в tooltip дублируются в скрытом live-region (`aria-live: polite`) для скринридеров.
- Не полагаемся только на цвет: пороговые серии получают и подпись порога на `markLine`.

[^p298]: Диапазоны p2/p98 управляемых захватывают пуски/остановы,
поэтому рисуются как жёлтая зона-допущение, а не паспортные пределы.
[^lims]: Метка ЛИМС = момент отбора, результат доступен системе через ≤ 4 ч.

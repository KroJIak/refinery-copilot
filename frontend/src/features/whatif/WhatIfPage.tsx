import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import ReactECharts from 'echarts-for-react';
import { useAppStore } from '@/store/store';
import type { ControlledVariable, WhatifQualityPoint, WhatifVariant } from '@/types';
import './WhatIfPage.css';

const targetLabels: Record<string, string> = { sulfur: 'Сера', t95: 'T95', d15: 'Плотность D15', cetane: 'Цетановое число' };
const fmt = (value: number, max = 2) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: max }).format(value);
const targetMargins: Record<string, (point: WhatifQualityPoint) => number> = {
  sulfur: (point) => 10 - point.p90,
  t95: (point) => 360 - point.p90,
  cetane: (point) => point.p10 - 51,
  d15: (point) => Math.min(point.p10 - 820, 845 - point.p90),
};
function minimumMargin(variant: WhatifVariant) {
  const values = variant.quality.map((point) => targetMargins[point.target]?.(point)).filter((value): value is number => value !== undefined);
  return values.length ? Math.min(...values) : 0;
}

export function WhatIfPage() {
  const store = useAppStore();
  const [query, setQuery] = useSearchParams();
  const [overrides, setOverrides] = useState<Record<string, number> | null>(null);
  const initialized = useRef<string | null>(null);
  const immediate = useRef(true);
  const variables = store.controlledVariables;
  const preset = store.scenarios.find((item) => item.kind === store.kind);
  const baseline = useMemo(() => {
    const latest = new Map(store.tags.slice().sort((a,b) => a.ts.localeCompare(b.ts)).map((tag) => [tag.tagCode, tag]));
    const values: Record<string, number> = {};
    variables.forEach((variable) => { const value = latest.get(variable.key)?.value; if (value != null) values[variable.key] = value; });
    Object.entries(preset?.overrides ?? {}).forEach(([key, value]) => { if (variables.some((item) => item.key === key)) values[key] = value; });
    return values;
  }, [preset, store.tags, variables]);

  useEffect(() => {
    const tp = query.get('tp');
    if (tp && !Number.isNaN(Date.parse(tp)) && store.tPoint !== tp && !store.loading) void store.loadState({ tPoint: tp });
  }, [query, store.loadState, store.loading, store.tPoint]);
  useEffect(() => {
    if (!store.tPoint || !variables.length || !Object.keys(baseline).length || initialized.current === store.tPoint) return;
    const next = { ...baseline, ...store.whatifDraft };
    query.get('o')?.split(',').forEach((pair) => { const split = pair.lastIndexOf(':'); const key = pair.slice(0, split); const value = Number(pair.slice(split + 1)); if (split > 0 && Number.isFinite(value) && variables.some((v) => v.key === key)) next[key] = value; });
    initialized.current = store.tPoint;
    setOverrides(next);
  }, [baseline, query, store.tPoint, store.whatifDraft, variables]);
  useEffect(() => {
    if (!overrides || !store.tPoint) return;
    const timer = window.setTimeout(() => {
      void store.evaluateWhatif(overrides);
      setQuery({ tp: store.tPoint!, o: Object.entries(overrides).map(([key, value]) => `${key}:${value}`).join(',') }, { replace: true });
    }, immediate.current ? 0 : 150);
    immediate.current = false;
    return () => window.clearTimeout(timer);
  }, [overrides, store.evaluateWhatif, store.tPoint, setQuery]);

  function change(variable: ControlledVariable, raw: number) {
    if (!overrides || !Number.isFinite(raw)) return;
    const next: Record<string, number> = { ...overrides, [variable.key]: raw };
    if (variable.key === 'blend_additive_pct') next[variable.key] = Math.max(0, Math.min(3, raw));
    if (variable.key === 'blend_share_kerosene' || variable.key === 'blend_share_gasoil') {
      const other = variable.key === 'blend_share_kerosene' ? 'blend_share_gasoil' : 'blend_share_kerosene';
      const share = Math.max(0, Math.min(1, raw));
      next[variable.key] = share;
      if (share + (next[other] ?? 0) > 1) next[other] = 1 - share;
    }
    setOverrides(next);
  }
  const current = store.whatifResult?.variants[0];
  const quality = current?.quality ?? store.whatifResult?.baseline ?? [];
  const violations = current?.violations ?? [];
  const actions = store.card?.decision === 'recommend' && store.card.tPoint === store.tPoint ? store.card.actions : undefined;
  const setImmediate = (next: Record<string, number>) => { immediate.current = true; setOverrides(next); };
  const applyModel = () => { const next = { ...baseline }; actions?.forEach((action) => { if (variables.some((v) => v.key === action.tag)) next[action.tag] = action.recommendedValue; }); setImmediate(next); };
  const applyPreset = async (kind: typeof store.scenarios[number]['kind']) => {
    if (kind === store.kind) { setImmediate({ ...baseline }); return; }
    const nextPreset = store.scenarios.find((item) => item.kind === kind);
    if (!nextPreset) return;
    initialized.current = null;
    immediate.current = true;
    store.setWhatifDraft({});
    setOverrides(null);
    setQuery({ tp: nextPreset.tPoint }, { replace: true });
    await store.selectScenario(kind);
  };
  const comparePresets = () => {
    if (!overrides) return;
    const variants = store.scenarios
      .filter((item) => ['normal', 'quality_risk', 'sour_crude'].includes(item.kind))
      .map((item) => ({ ...baseline, ...item.overrides }));
    void store.evaluateWhatif(overrides, [overrides, ...variants].slice(0, 8));
  };
  const remaining = overrides?.blend_share_kerosene !== undefined && overrides?.blend_share_gasoil !== undefined ? 1 - overrides.blend_share_kerosene - overrides.blend_share_gasoil : null;
  return <main className="whatif-page">
    <header className="whatif-head"><div><h1>Что если</h1><p>{store.tPoint ? `Снимок процесса · ${new Date(store.tPoint).toLocaleString('ru-RU', { timeZone: 'UTC' })} UTC` : 'Загрузка текущего состояния…'}</p></div><span className="whatif-button" aria-live="polite">{store.whatifLoading ? 'Расчёт…' : store.whatifResult ? `Расчёт ${store.whatifResult.elapsedMs} мс` : 'Нет расчёта'}</span></header>
    {store.whatifError && <div role="alert" className="whatif-verdict bad">{store.whatifError}</div>}
    <div className="whatif-layout"><section className="whatif-card"><div className="whatif-card-title"><h2>Управляемые переменные</h2><div className="whatif-presets" aria-label="Пресеты What-if">{store.scenarios.filter((item) => ['normal', 'quality_risk', 'sour_crude'].includes(item.kind)).map((item) => <button key={item.kind} className={`whatif-preset ${item.kind === store.kind ? 'active' : ''}`} aria-pressed={item.kind === store.kind} title={item.description} disabled={store.loading} onClick={() => void applyPreset(item.kind)}>{item.label}</button>)}</div></div>{!variables.length && <p className="model-note">Загрузка реестра управляемых переменных…</p>}{(['hdu', 'avt', 'blend'] as const).map((group) => <div className="whatif-group" key={group}><div className="whatif-group-title">{group === 'hdu' ? 'Гидроочистка' : group === 'avt' ? 'АВТ' : 'Блендинг'}</div>{variables.filter((v) => v.group === group).map((v) => {
      const value = overrides?.[v.key]; const factor = v.key.startsWith('blend_share_') ? 100 : 1; const unit = factor === 100 ? '%' : v.unit;
      const invalid = violations.some((violation) => violation.includes(v.key)); const warn = value !== undefined && (value < v.p2 || value > v.p98);
      return <div className={`whatif-control ${invalid ? 'invalid' : ''}`} key={v.key}><div className="whatif-label"><label htmlFor={`range-${v.key}`}>{v.label}</label><span className="whatif-value">{value === undefined ? 'Нет данных' : <input className="whatif-number" aria-label={`${v.label}, точное значение`} type="number" step={v.step * factor} value={Number((value * factor).toFixed(5))} onChange={(e) => { if (e.target.value !== '') change(v, Number(e.target.value) / factor); }} />} {unit}</span></div><input id={`range-${v.key}`} className="whatif-range" type="range" min={v.p2} max={v.p98} step={v.step} value={value ?? v.p2} disabled={value === undefined} onChange={(e) => change(v, Number(e.target.value))} aria-invalid={invalid} /><div className="whatif-range-meta"><span>{fmt(v.p2 * factor)}</span><span>{fmt(v.p98 * factor)}</span></div>{warn && <div className="whatif-hint">Вне модельного диапазона</div>}{invalid && <div role="status" className="whatif-hint">{violations.filter((item) => item.includes(v.key)).join(' · ')}</div>}</div>;
    })}{group === 'blend' && <p className="model-note">Очищенный ДТ: {remaining === null ? 'нет данных' : `${fmt(remaining * 100)} %`} · остаток до 100 %</p>}</div>)}<p className="model-note">Модельный диапазон истории, не паспортные пределы оборудования.</p></section>
<section className="whatif-card"><h2>Прогноз качества</h2>{current && <Forecast quality={quality} baseline={store.whatifResult?.baseline ?? []} />}<h2>Ограничения</h2>{current ? <div className={`whatif-verdict ${current.feasible ? '' : 'bad'}`} role="status">{current.feasible ? '✓ Вариант допустим' : `✕ Нарушает ограничений: ${violations.length}`}<small>{violations.length ? violations.join(' · ') : 'Ограничения не нарушены'}</small></div> : <div className="model-note">Ожидание первого расчёта</div>}<div className="whatif-quality" style={{ opacity: store.whatifLoading ? .65 : 1 }}>{quality.map((point) => <QualityCard key={point.target} point={point} baseline={store.whatifResult?.baseline.find((p) => p.target === point.target)} />)}</div>{current && <div className="cost-box">Стоимость: {fmt(current.costIndex)}<small>Условный индекс, не рыночная цена · присадка ×100 к цене ДТ</small></div>}<div className="whatif-buttons"><button className="whatif-button" disabled={!overrides} onClick={() => setImmediate({ ...baseline })}>Как в сценарии</button><button className="whatif-button primary" title={!actions?.length ? 'Сначала получите рекомендацию на Обзоре' : undefined} disabled={!actions?.length} onClick={applyModel}>Как предлагает модель</button><button className="whatif-button" disabled={!overrides || store.whatifLoading} onClick={comparePresets}>Сравнить пресеты</button></div>{store.whatifResult && store.whatifResult.variants.length > 1 && <Pareto variants={store.whatifResult.variants} onSelect={(variant) => setImmediate(variant.overrides)} />}{store.card && <p><Link to="/recommendation">Показать полный фронт →</Link></p>}<p className="model-note">Модельная оценка; история не подтверждает действий, которых в ней не было.</p></section>
    </div>
  </main>;
}

function QualityCard({ point, baseline }: { point: WhatifQualityPoint; baseline?: WhatifQualityPoint }) {
  return <article className="quality-item"><h3>{targetLabels[point.target]} · {point.unit}</h3><div className="quality-numbers"><span className="quality-p50">{fmt(point.p50)}</span></div><p className="quality-range">Интервал {fmt(point.p10)}–{fmt(point.p90)}</p>{baseline && <div className="quality-range">Базовая линия {fmt(baseline.p50)}</div>}<div className="quality-risk">Риск спецификации {fmt(point.specRisk * 100)} %</div></article>;
}
function Forecast({ quality, baseline }: { quality: WhatifQualityPoint[]; baseline: WhatifQualityPoint[] }) {
  if (!quality.length) return <p className="model-note">Нет прогноза качества.</p>;
  return <div className="whatif-forecasts">{quality.map((point) => {
    const base = baseline.find((item) => item.target === point.target);
    const threshold = point.target === 'sulfur' ? 10 : point.target === 't95' ? 360 : point.target === 'cetane' ? 51 : undefined;
    const min = Math.min(point.p10, base?.p50 ?? point.p10, threshold ?? point.p10);
    const max = Math.max(point.p90, base?.p50 ?? point.p90, threshold ?? point.p90);
    const padding = Math.max((max - min) * .22, .1);
    return <article className="whatif-forecast" key={point.target}><h3>{targetLabels[point.target]} · {point.unit}</h3><ReactECharts style={{ height: 126 }} option={{ animation: false, grid: { left: 42, right: 12, top: 12, bottom: 25 }, xAxis: { type: 'category', data: ['P10', 'P50', 'P90'], axisLabel: { color: '#8b8b95', fontSize: 10 } }, yAxis: { type: 'value', min: min - padding, max: max + padding, scale: true, axisLabel: { color: '#8b8b95', fontSize: 10 }, splitLine: { lineStyle: { color: '#303036' } } }, tooltip: { trigger: 'axis' }, series: [{ name: 'Нижняя граница', type: 'line', stack: 'band', data: [point.p10, point.p10, point.p10], symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 } }, { name: 'P10–P90', type: 'line', stack: 'band', data: [point.p90 - point.p10, point.p90 - point.p10, point.p90 - point.p10], symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { color: '#2f9d65', opacity: .35 } }, { name: 'Текущий P50', type: 'line', data: [point.p50, point.p50, point.p50], symbol: 'circle', symbolSize: 6, lineStyle: { color: '#52d98a', width: 3 }, itemStyle: { color: '#52d98a' }, markLine: { symbol: 'none', data: [...(base ? [{ yAxis: base.p50, name: 'База' }] : []), ...(threshold === undefined ? [] : [{ yAxis: threshold, name: 'Норма' }])], lineStyle: { color: '#a7a7b0', type: 'dashed' }, label: { color: '#c9c9cf', fontSize: 10 } } }] }} /></article>;
  })}</div>;
}

function Pareto({ variants, onSelect }: { variants: WhatifVariant[]; onSelect: (variant: WhatifVariant) => void }) {
  const points = variants.map((variant, index) => ({ variant, index, margin: minimumMargin(variant) }));
  const feasible = points.filter((item) => item.variant.feasible);
  const front = feasible.slice().sort((a, b) => a.variant.costIndex - b.variant.costIndex).filter((item, index, sorted) => index === 0 || item.margin > Math.max(...sorted.slice(0, index).map((previous) => previous.margin)));
  const knee = front.length ? front.reduce((best, item) => (item.margin / Math.max(1, item.variant.costIndex) > best.margin / Math.max(1, best.variant.costIndex) ? item : best)) : undefined;
  return <section className="whatif-pareto" aria-label="Миниатюра Парето"><div className="whatif-pareto-head"><h2>Парето: запас качества ↔ стоимость</h2><span>Кликните точку, чтобы подставить ручки</span></div><ReactECharts style={{ height: 225 }} onEvents={{ click: (event: { dataIndex?: number; seriesName?: string }) => { if (event.seriesName !== 'Точки') return; const point = points[event.dataIndex ?? -1]; if (point) onSelect(point.variant); } }} option={{ animation: false, grid: { left: 48, right: 18, top: 18, bottom: 38 }, tooltip: { formatter: (params: { dataIndex?: number }) => { const point = points[params.dataIndex ?? -1]; return point ? 'Вариант ' + (point.index + 1) + '<br/>Стоимость: ' + fmt(point.variant.costIndex) + '<br/>Мин. запас: ' + fmt(point.margin) + '<br/>' + (point.variant.feasible ? 'допустим' : 'отбракован') : ''; } }, xAxis: { type: 'value', name: 'Стоимость', nameTextStyle: { color: '#9f9fa8' }, axisLabel: { color: '#9f9fa8' }, splitLine: { lineStyle: { color: '#303036' } } }, yAxis: { type: 'value', name: 'Мин. запас', nameTextStyle: { color: '#9f9fa8' }, axisLabel: { color: '#9f9fa8' }, splitLine: { lineStyle: { color: '#303036' } } }, series: [{ name: 'Фронт', type: 'line', data: front.map((point) => [point.variant.costIndex, point.margin]), symbol: 'none', lineStyle: { color: '#7da8ff', width: 2 } }, { name: 'Точки', type: 'scatter', data: points.map((point) => ({ value: [point.variant.costIndex, point.margin], itemStyle: { color: point.variant.feasible ? '#52d98a' : '#ff6970' } })), symbolSize: 11 }, ...(knee ? [{ name: 'Knee', type: 'scatter', data: [[knee.variant.costIndex, knee.margin]], symbolSize: 18, itemStyle: { color: '#f4c857', borderColor: '#fff0a0', borderWidth: 2 }, z: 4 }] : [])] }} /></section>;
}

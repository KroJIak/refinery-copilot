import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { IconCircleCheck, IconCircleX, IconAdjustmentsHorizontal } from '@tabler/icons-react';
import { useAppStore } from '@/store/store';
import { violationMessage } from './messages';
import type { ControlledVariable, WhatifQualityPoint } from '@/types';
import './WhatIfPage.css';

const targetLabels: Record<string, string> = { sulfur: 'Сера', t95: 'T95', d15: 'Плотность D15', cetane: 'Цетановое число' };
const format = (value: number, maximumFractionDigits = 2) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits }).format(value);

export function WhatIfPage() {
  const store = useAppStore();
  const [query] = useSearchParams();
  const [overrides, setOverrides] = useState<Record<string, number> | null>(null);
  const initialized = useRef<string | null>(null);
  const [custom, setCustom] = useState(false);
  const immediate = useRef(true);
  const evaluationTimer = useRef<number | null>(null);
  const variables = store.controlledVariables;
  const preset = store.scenarios.find((item) => item.kind === store.kind);
  const baseline = useMemo(() => {
    const latest = new Map(store.tags.slice().sort((a, b) => a.ts.localeCompare(b.ts)).map((tag) => [tag.tagCode, tag]));
    const values: Record<string, number> = {};
    variables.forEach((variable) => {
      const value = latest.get(variable.key)?.value;
      if (value != null) values[variable.key] = value;
      else if (variable.key.startsWith("blend_")) values[variable.key] = 0;
    });
    Object.entries(preset?.overrides ?? {}).forEach(([key, value]) => {
      if (variables.some((variable) => variable.key === key)) values[key] = value;
    });
    return values;
  }, [preset, store.tags, variables]);

  useEffect(() => {
    if (!store.tPoint || !variables.length || !Object.keys(baseline).length || initialized.current === store.tPoint) return;
    const next = { ...baseline };
    if (initialized.current === null) {
      Object.assign(next, store.whatifDraft);
      query.get('o')?.split(',').forEach((pair) => {
        const split = pair.lastIndexOf(':');
        const key = pair.slice(0, split);
        const value = Number(pair.slice(split + 1));
        if (split > 0 && Number.isFinite(value) && variables.some((variable) => variable.key === key)) next[key] = value;
      });
    }
    initialized.current = store.tPoint;
    setCustom(variables.some((variable) => Math.abs((next[variable.key] ?? 0) - (baseline[variable.key] ?? 0)) > 1e-6));
    setOverrides(next);
  }, [baseline, query, store.tPoint, store.whatifDraft, variables]);

  useLayoutEffect(() => {
    if (!overrides || !store.tPoint) return;
    evaluationTimer.current = window.setTimeout(() => {
      void store.evaluateWhatif(overrides);
    }, immediate.current ? 0 : 150);
    immediate.current = false;
    return () => {
      if (evaluationTimer.current !== null) window.clearTimeout(evaluationTimer.current);
      evaluationTimer.current = null;
    };
  }, [overrides, store.evaluateWhatif, store.tPoint]);

  const change = (variable: ControlledVariable, raw: number) => {
    if (!overrides || !Number.isFinite(raw)) return;
    const next = { ...overrides, [variable.key]: raw };
    if (variable.key === 'blend_additive_pct') next[variable.key] = Math.max(0, Math.min(3, raw));
    if (variable.key === 'blend_share_kerosene' || variable.key === 'blend_share_gasoil') {
      const other = variable.key === 'blend_share_kerosene' ? 'blend_share_gasoil' : 'blend_share_kerosene';
      next[variable.key] = Math.max(0, Math.min(1, raw));
      if ((next[variable.key] ?? 0) + (next[other] ?? 0) > 1) next[other] = 1 - (next[variable.key] ?? 0);
    }
    setCustom(true);
    setOverrides(next);
  };

  const applyPreset = async (kind: typeof store.scenarios[number]['kind']) => {
    if (kind === store.kind) {
      immediate.current = true;
      setCustom(false);
      setOverrides({ ...baseline });
      return;
    }
    const nextPreset = store.scenarios.find((item) => item.kind === kind);
    if (!nextPreset) return;
    initialized.current = null;
    setCustom(false);
    immediate.current = true;
    store.setWhatifDraft({});
    await store.selectScenario(kind);
  };

  const current = store.whatifResult?.variants[0];
  const quality = current?.quality ?? store.whatifResult?.baseline ?? [];
  const violations = current?.violations ?? [];
  const remaining = overrides?.blend_share_kerosene !== undefined && overrides?.blend_share_gasoil !== undefined
    ? 1 - overrides.blend_share_kerosene - overrides.blend_share_gasoil
    : null;

  return <main className="whatif-page">
    <header className="whatif-head">
      <div><h1>Что если</h1><p>{store.tPoint ? `Снимок процесса · ${new Date(store.tPoint).toLocaleString('ru-RU', { timeZone: 'UTC' })} UTC` : 'Загрузка снимка процесса…'}</p></div>
      <span className="whatif-button" aria-live="polite">{store.whatifLoading ? 'Считаем…' : store.whatifResult ? 'Готово' : 'Ждём расчёт'}</span>
    </header>
    {store.whatifError && <div role="alert" className="whatif-verdict bad">{store.whatifError}</div>}
    <div className="whatif-layout">
      <section className="whatif-card">
        <div className="whatif-card-title"><h2>Управляемые переменные</h2><div className="whatif-presets" aria-label="Сценарии «Что если»">{store.scenarios.filter((item) => ['normal', 'quality_risk', 'sour_crude'].includes(item.kind)).map((item) => <button key={item.kind} className={`whatif-preset ${!custom && item.kind === store.kind ? 'active' : ''}`} aria-pressed={!custom && item.kind === store.kind} title={item.description} disabled={store.loading} onClick={() => void applyPreset(item.kind)}>{item.label}</button>)}</div></div>
        {!variables.length && <p className="model-note">Загрузка управляемых переменных…</p>}
        {(['hdu', 'avt', 'blend'] as const).map((group) => <div className="whatif-group" key={group}>
          <div className="whatif-group-title">{group === 'hdu' ? 'Гидроочистка' : group === 'avt' ? 'АВТ' : 'Блендинг'}</div>
          {variables.filter((variable) => variable.group === group).map((variable) => <Control key={variable.key} variable={variable} value={overrides?.[variable.key]} invalid={violations.some((violation) => violation.includes(variable.key))} onChange={change} />)}
          {group === 'blend' && <p className="model-note">Очищенный дизель: {remaining === null ? 'нет данных' : `${format(remaining * 100)} %`} · остаток до 100 %</p>}
        </div>)}
        <p className="model-note">Рабочий диапазон основан на истории. Это не паспортные пределы оборудования.</p>
      </section>
      <section className="whatif-card whatif-result-card">
        <div className="whatif-result-heading"><IconAdjustmentsHorizontal aria-hidden="true" /><div><h2>Результат расчёта</h2><p>Числа обновляются после изменения параметров.</p></div></div>
        {current ? <div className={`whatif-verdict ${current.feasible ? '' : 'bad'}`} role="status">{current.feasible ? <IconCircleCheck aria-hidden="true" /> : <IconCircleX aria-hidden="true" />}<span>{current.feasible ? 'Вариант допустим' : 'Есть нарушения ограничений'}</span><small>{violations.length ? violations.map(violationMessage).join(' · ') : 'Ограничения не нарушены'}</small></div> : <div className="model-note">Ожидание первого расчёта</div>}
        <div className="whatif-quality">{quality.map((point) => <QualityCard key={point.target} point={point} />)}</div>
        {current && <div className="cost-box">Условная стоимость: {format(current.costIndex)}<small>Индекс для сравнения вариантов.</small></div>}
        {store.card && <p><Link to="/recommendation">Открыть карточку рекомендации</Link></p>}
        <p className="model-note">Модельная оценка не управляет установкой и требует подтверждения технологом.</p>
      </section>
    </div>
  </main>;
}

function Control({ variable, value, invalid, onChange }: { variable: ControlledVariable; value: number | undefined; invalid: boolean; onChange: (variable: ControlledVariable, value: number) => void }) {
  const factor = variable.key.startsWith('blend_share_') ? 100 : 1;
  const unit = factor === 100 ? '%' : variable.unit;
  const warn = value !== undefined && (value < variable.p2 || value > variable.p98);
  return <div className={`whatif-control ${invalid ? 'invalid' : ''}`}>
    <div className="whatif-label"><label htmlFor={`range-${variable.key}`}>{variable.label}</label><span className="whatif-value">{value === undefined ? 'Нет данных' : <input className="whatif-number" aria-label={`${variable.label}, точное значение`} type="number" step={variable.step * factor} value={Number((value * factor).toFixed(5))} onChange={(event) => { if (event.target.value !== '') onChange(variable, Number(event.target.value) / factor); }} />} {unit}</span></div>
    <input id={`range-${variable.key}`} className="whatif-range" type="range" min={variable.p2} max={variable.p98} step={variable.step} value={value ?? variable.p2} disabled={value === undefined} onChange={(event) => onChange(variable, Number(event.target.value))} aria-invalid={invalid} />
    <div className="whatif-range-meta"><span>{format(variable.p2 * factor)}</span><span>{format(variable.p98 * factor)}</span></div>
    {warn && <div className="whatif-hint">Значение вне рабочего диапазона истории</div>}
  </div>;
}

function QualityCard({ point }: { point: WhatifQualityPoint }) {
  const spec = point.target === 'sulfur' ? 'Не более 10 мг/кг' : point.target === 't95' ? 'Не более 360 °C' : point.target === 'cetane' ? 'Не менее 51' : 'По рабочему диапазону';
  return <article className="quality-item"><h3>{targetLabels[point.target]} · {point.unit}</h3><div className="quality-numbers"><span className="quality-p50">{format(point.p50)}</span></div><p className="quality-range">Ожидаемый диапазон: {format(point.p10)}–{format(point.p90)}</p><p className="quality-risk">{spec}</p></article>;
}

import { useEffect, useMemo, useState } from 'react';
import { IconX } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { useAppStore } from '@/store/store';
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';
import type { TagPoint } from '@/types';
import { ProcessDiagram } from './ProcessDiagram';
import { sensors } from './sensors';
import './MnemonicPage.css';

const statusLabels = { ok: 'в норме', warn: 'близко к границе', stale: 'нарушение', missing: 'нет данных / не доверяем' };
const freshnessLabels = { ok: 'в норме', warn: 'внимание', stale: 'устарели', missing: 'нет данных' };
const format = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });

export function MnemonicPage() {
  const { tPoint, tags, freshness, controlledVariables, loadState, loading, error, setWhatifDraft, bootstrap } = useAppStore();
  const [selected, setSelected] = useState<string | null>(null);
  const [influence, setInfluence] = useState('off');
  const latest = useMemo(() => new Map(tags.slice().sort((a,b) => a.ts.localeCompare(b.ts)).map((tag) => [tag.tagCode, tag])), [tags]);
  const selectedTag = selected ? latest.get(selected) : undefined;
  const definition = sensors.find((sensor) => sensor.tag === selected);
  const selectedSeries = tags.filter((tag) => tag.tagCode === selected).sort((a,b) => a.ts.localeCompare(b.ts));
  const selectedFreshness = selectedTag ? freshness.find((entry) => entry.source === selectedTag.source) : undefined;
  useEffect(() => { void bootstrap(); }, [bootstrap]);
  useEffect(() => { const listener = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelected(null); }; window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener); }, []);
  function status(tag: TagPoint | undefined) {
    const fresh = freshness.find((entry) => entry.source === tag?.source);
    if (!tag || tag.value == null || ['sentinel','stuck','missing'].includes(tag.qualityFlag) || fresh?.status === 'missing' || fresh?.status === 'stale') return 'missing';
    if (tag.qualityFlag === 'outlier') return 'stale';
    const range = controlledVariables.find((v) => v.key === tag.tagCode);
    if (range && (tag.value < range.p2 || tag.value > range.p98)) return 'stale';
    if (fresh?.status === 'warn' || range && (tag.value < range.p2 + (range.p98 - range.p2) * .1 || tag.value > range.p98 - (range.p98 - range.p2) * .1)) return 'warn';
    return 'ok';
  }
  const range = controlledVariables.find((v) => v.key === selected);
  return <main className="mnemonic-page">
    <header className="mnemonic-head"><div><h1>Мнемосхема</h1><p>Упрощённая схема, не чертёж установки</p></div><div className="mnemonic-actions"><label>Путь влияния <select className="mnemonic-select" value={influence} onChange={(e) => setInfluence(e.target.value)}><option value="off">выкл</option><option value="24-2000.T11">Температура входа</option><option value="24-2000.F26">Расход</option><option value="24-2000.F19">Давление</option><option value="avt">АВТ</option><option value="blend_additive_pct">Присадка</option></select></label><button className="mnemonic-button" onClick={() => void loadState({ tPoint: tPoint ?? undefined })}>Обновить</button></div></header>
    {error && <p role="alert">{error}</p>}
    {loading && !tags.length && <p>Загрузка состояния установки…</p>}
    <section className="mnemonic-viewport">
      <ProcessDiagram sensors={sensors} latest={latest} selected={selected} influence={influence} getState={status} onSelect={(tag) => setSelected(selected === tag ? null : tag)} onBackgroundClick={() => setSelected(null)} />
      {selected && definition && <aside className="mnemonic-panel"><div className="mnemonic-panel-head"><h2>{definition.label}<small> — {controlledVariables.find((v) => v.key === selected)?.label ?? selected}</small></h2><button className="mnemonic-close" onClick={() => setSelected(null)} aria-label="Закрыть датчик"><IconX aria-hidden="true" /></button></div><div className="mnemonic-value">{selectedTag?.value == null ? 'Нет данных' : format(selectedTag.value)} <small>{selectedTag?.unit}</small></div><span className={`mnemonic-status ${status(selectedTag)}`}>{statusLabels[status(selectedTag)]}</span>{selectedTag && <TimeSeriesChart height={190} series={[{ tagCode: selected, label: definition.label, unit: selectedTag.unit ?? '', points: selectedSeries, kind: selectedTag.source === 'lims' ? 'lims_fact' : 'telemetry' }]} thresholds={range ? [{ kind: 'band', value: [range.p2, range.p98], label: 'Модельный диапазон' }] : []} />}{selectedFreshness && <small>Свежесть {selectedFreshness.source.toUpperCase()}: {selectedFreshness.ageHours === null ? 'нет данных' : format(selectedFreshness.ageHours) + ' ч'} · {freshnessLabels[selectedFreshness.status]}</small>}{definition.managed && selectedTag?.value != null && <Link className="mnemonic-change" onClick={() => setWhatifDraft({ [selected]: selectedTag.value! })} to={`/whatif?tp=${encodeURIComponent(tPoint ?? '')}&o=${encodeURIComponent(selected + ':' + selectedTag.value)}&focus=${encodeURIComponent(selected)}`}>Изменить в «Что если» →</Link>}</aside>}
    </section>
    <div className="mnemonic-legend"><span><i className="legend-dot ok"/> норма</span><span><i className="legend-dot warn"/> близко к границе</span><span><i className="legend-dot stale"/> нарушение</span><span><i className="legend-dot missing"/> нет данных / не верим</span><span>Y — управляемые · ЛК — лаборатория</span></div>
  </main>;
}

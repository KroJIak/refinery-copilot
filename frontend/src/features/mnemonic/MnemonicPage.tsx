import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import { useAppStore } from '@/store/store';
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';
import type { TagPoint } from '@/types';
import { equipment, sensors } from './sensors';
import './MnemonicPage.css';

const statusLabels = { ok: 'в норме', warn: 'близко к границе', stale: 'нарушение', missing: 'нет данных / не верим' };
const format = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });

export function MnemonicPage() {
  const { tPoint, tags, freshness, controlledVariables, loadState, loading, error, setWhatifDraft } = useAppStore();
  const [selected, setSelected] = useState<string | null>(null);
  const [influence, setInfluence] = useState('off');
  const latest = useMemo(() => new Map(tags.slice().sort((a,b) => a.ts.localeCompare(b.ts)).map((tag) => [tag.tagCode, tag])), [tags]);
  const selectedTag = selected ? latest.get(selected) : undefined;
  const definition = sensors.find((sensor) => sensor.tag === selected);
  const selectedSeries = tags.filter((tag) => tag.tagCode === selected).sort((a,b) => a.ts.localeCompare(b.ts));
  const selectedFreshness = selectedTag ? freshness.find((entry) => entry.source === selectedTag.source) : undefined;
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
  const focusX = influence === 'avt' ? 220 : influence === 'blend_additive_pct' ? 1050 : 710;
  return <main className="mnemonic-page">
    <header className="mnemonic-head"><div><h1>Мнемосхема</h1><p>Упрощённая схема, не чертёж установки</p></div><div className="mnemonic-actions"><label>Путь влияния <select className="mnemonic-select" value={influence} onChange={(e) => setInfluence(e.target.value)}><option value="off">выкл</option><option value="24-2000.P8">P8</option><option value="24-2000.T11">T11</option><option value="24-2000.F19">F19</option><option value="avt">АВТ</option><option value="blend_additive_pct">Присадка</option></select></label><button className="mnemonic-button" onClick={() => void loadState({ tPoint: tPoint ?? undefined })}>Обновить</button></div></header>
    {error && <p role="alert">{error}</p>}
    {loading && !tags.length && <p>Загрузка состояния установки…</p>}
    <section className="mnemonic-card mnemonic-viewport">
      {/* Static SVG avoids a heavyweight graph editor; the library supplies bounded cursor zoom and pan. */}
      <TransformWrapper minScale={.65} maxScale={2.5} initialScale={1} centerOnInit panning={{ excluded: ['sensor-hit'] }} doubleClick={{ mode: 'reset' }}>
        {({ zoomIn, zoomOut, resetTransform }) => <><div className="mnemonic-zoom"><button onClick={() => zoomIn()} aria-label="Увеличить схему">+</button><button onClick={() => zoomOut()} aria-label="Уменьшить схему">−</button><button onClick={() => resetTransform()}>Вписать</button></div><TransformComponent wrapperStyle={{ width: '100%', height: 510 }} contentStyle={{ width: '100%' }}><svg className="mnemonic-svg" viewBox="0 0 1380 520" onClick={() => setSelected(null)} role="img" aria-label="Технологическая цепочка АВТ, гидроочистки и блендинга">
          <defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="#777780" /></marker></defs>
          <text x="290" y="70" className="mnemonic-section-title">АВТ</text><text x="740" y="70" className="mnemonic-section-title">ГИДРООЧИСТКА 24-2000</text><text x="1150" y="70" className="mnemonic-section-title">БЛЕНДИНГ</text>
          <path className="mnemonic-path" d="M50 260 H1320" />
          <path className="mnemonic-path" d="M1020 160 V220 M1110 160 V220 M1200 160 V205 H1080 V220" />
          {influence !== 'off' && <path d={`M${focusX} 278 H1260`} fill="none" stroke="#2f6bff" strokeWidth="5" />}
          {equipment.map((item) => <g key={item.label}><rect className="mnemonic-node" x={item.x} y={item.column ? 205 : 225} width={item.width} height={item.column ? 110 : 70} rx={item.column ? 24 : 12}/>{item.column && <path d={`M${item.x} 240 H${item.x+item.width} M${item.x} 275 H${item.x+item.width}`} stroke="#666670" fill="none"/>}<text className="mnemonic-label" x={item.x + item.width / 2} y={item.column ? 335 : 264}>{item.label}</text></g>)}
          {sensors.map((sensor) => { const point = latest.get(sensor.tag); const state = status(point); const shapeClass = `sensor-dot ${state} ${sensor.managed ? 'managed' : ''} ${selected === sensor.tag ? 'selected' : ''}`; return <g className="sensor-hit" key={sensor.tag} role="button" aria-label={`${sensor.label}, ${statusLabels[state]}`} tabIndex={0} onClick={(event) => { event.stopPropagation(); setSelected(selected === sensor.tag ? null : sensor.tag); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(selected === sensor.tag ? null : sensor.tag); } }}><title>{sensor.label}: {point?.value == null ? 'нет данных' : format(point.value) + ' ' + (point.unit ?? '')} · {point?.ts ?? ''}{sensor.tag === 'D10' ? ' · мёртвый канал' : ''}</title>{sensor.lab ? <rect className={shapeClass} x={sensor.x - 10} y={sensor.y - 10} width="20" height="20" rx="3"/> : <circle className={shapeClass} cx={sensor.x} cy={sensor.y} r="10"/>}<text className="sensor-text" x={sensor.x} y={sensor.y - 19}>{sensor.label}{sensor.managed ? ' Y' : ''}</text></g>; })}
          <text x="554" y="475" className="mnemonic-caption-svg">АВТ → ГО: вероятно, промежуточный резервуар · гипотеза по данным</text>
        </svg></TransformComponent></>}
      </TransformWrapper>
      {selected && definition && <aside className="mnemonic-panel"><div className="mnemonic-panel-head"><h2>{definition.label}<small> — {controlledVariables.find((v) => v.key === selected)?.label ?? selected}</small></h2><button className="mnemonic-close" onClick={() => setSelected(null)} aria-label="Закрыть датчик">×</button></div><div className="mnemonic-value">{selectedTag?.value == null ? 'Нет данных' : format(selectedTag.value)} <small>{selectedTag?.unit}</small></div><span className={`mnemonic-status ${status(selectedTag)}`}>{statusLabels[status(selectedTag)]}</span>{selectedTag && <TimeSeriesChart height={190} series={[{ tagCode: selected, label: definition.label, unit: selectedTag.unit ?? '', points: selectedSeries, kind: selectedTag.source === 'lims' ? 'lims_fact' : 'telemetry' }]} thresholds={range ? [{ kind: 'band', value: [range.p2, range.p98], label: 'Модельный диапазон' }] : []} />}{selectedFreshness && <small>Свежесть {selectedFreshness.source.toUpperCase()}: {selectedFreshness.ageHours === null ? 'нет данных' : format(selectedFreshness.ageHours) + ' ч'} · {selectedFreshness.status}</small>}{definition.managed && selectedTag?.value != null && <Link className="mnemonic-change" onClick={() => setWhatifDraft({ [selected]: selectedTag.value! })} to={`/whatif?tp=${encodeURIComponent(tPoint ?? '')}&o=${encodeURIComponent(selected + ':' + selectedTag.value)}&focus=${encodeURIComponent(selected)}`}>Изменить в What-if →</Link>}</aside>}
    </section>
    <div className="mnemonic-legend"><span><i className="legend-dot ok"/> норма</span><span><i className="legend-dot warn"/> близко к границе</span><span><i className="legend-dot stale"/> нарушение</span><span><i className="legend-dot missing"/> нет данных / не верим</span><span>Y — управляемые · ЛК — лаборатория</span></div>
  </main>;
}

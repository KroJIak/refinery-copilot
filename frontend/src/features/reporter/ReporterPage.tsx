import { useMemo, useState } from 'react';
import { useAppStore } from '@/store/store';
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';
import { archivalCoverage, coverageWindow } from './coverageFacts';
import './ReporterPage.css';

const flagLabel: Record<string, string> = { sentinel: 'сентинел', stuck: 'залипание', outlier: 'зашкал', missing: 'нет данных' };
const statusLabel: Record<string, string> = { ok: 'свежие', warn: 'внимание', stale: 'устарели', missing: 'нет данных' };
const date = (value: string | null) => value ? new Date(value).toLocaleString('ru-RU', { timeZone: 'UTC' }) + ' UTC' : 'нет данных';
const coverageOffset = (value: string) => (Date.parse(value) - Date.parse(coverageWindow.from)) / (Date.parse(coverageWindow.to) - Date.parse(coverageWindow.from)) * 100;

export function ReporterPage() {
  const { tags, freshness, tPoint, loadState, loading, error } = useAppStore();
  const [selected, setSelected] = useState<string | null>(null);
  const problems = useMemo(() => Array.from(new Map(tags.filter((tag) => tag.qualityFlag !== 'ok').map((tag) => [tag.tagCode, tag])).values()), [tags]);
  const selectedTag = tags.filter((tag) => tag.tagCode === selected).at(-1);
  const selectedSeries = tags.filter((tag) => tag.tagCode === selected);
  return <main className="reporter-page">
    <header className="reporter-head"><div><h1>Отчёты о данных</h1><p>{date(tPoint)} · {freshness.length} источников · {problems.length} проблемных тегов</p></div><button className="model-download" onClick={() => void loadState({ tPoint: tPoint ?? undefined })}>Обновить</button></header>
    {error && <div role="alert" className="reporter-empty">{error}</div>}
    {loading && !tags.length && <div className="model-skeleton" aria-label="Загрузка данных" />}
    <section className="reporter-card"><h2>Свежесть источников</h2><div className="freshness-grid">{freshness.map((item) => <details className={`freshness-item ${item.status}`} key={`${item.pointId}-${item.source}`}><summary><span className="freshness-top"><strong>{item.source.toUpperCase()} · {item.pointId}</strong><span className="freshness-light" aria-label={statusLabel[item.status]} /></span><small>{statusLabel[item.status]} · {item.ageHours == null ? 'нет данных' : `${item.ageHours.toLocaleString('ru-RU')} ч`}</small></summary><small>Последний отбор: {date(item.lastSampleTs)}<br />Доступно системе: {date(item.availableTs)}<br />Предупреждение после {item.warnAfterH} ч · устаревание после {item.staleAfterH} ч</small></details>)}</div>{!freshness.length && !loading && <div className="reporter-empty">Данные свежести не загружены.</div>}</section>
    <section className="reporter-card" style={{ marginTop: 16 }}><h2>Проблемные теги</h2>{problems.length ? <div style={{ overflowX: 'auto' }}><table className="reporter-table"><thead><tr><th>Тег</th><th>Проблема</th><th>Доля точек с флагом</th><th>Обработка</th><th /></tr></thead><tbody>{problems.map((tag) => {
      const all = tags.filter((p) => p.tagCode === tag.tagCode);
      const share = all.filter((p) => p.qualityFlag !== 'ok').length / all.length;
      return <tr key={tag.tagCode}><td>{tag.tagCode}</td><td><span className={`flag-badge ${tag.qualityFlag}`}>{flagLabel[tag.qualityFlag]}</span></td><td>{(share * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} % среза</td><td>{tag.value == null ? 'Маска в null' : 'Пометка качества ряда'}</td><td><button className="model-download" onClick={() => setSelected(selected === tag.tagCode ? null : tag.tagCode)}>График</button></td></tr>;
    })}</tbody></table></div> : !loading && <p className="reporter-note">На выбранном срезе находок нет.</p>}
    {selectedTag && <div className="reporter-detail"><div className="reporter-head"><h3>{selectedTag.tagCode} · {selectedTag.unit ?? '—'}</h3><button className="model-download" aria-label="Закрыть график" onClick={() => setSelected(null)}>×</button></div><TimeSeriesChart height={220} series={[{ tagCode: selectedTag.tagCode, label: selectedTag.tagCode, unit: selectedTag.unit ?? '', points: selectedSeries, kind: selectedTag.source === 'lims' ? 'lims_fact' : 'telemetry' }]} /></div>}</section>
    <section className="reporter-card reporter-coverage" style={{ marginTop: 16 }}><h2>Покрытие источников</h2><p className="reporter-coverage__years" aria-hidden="true"><span>2023</span><span>2024</span><span>2025</span><span>2026</span></p><div className="coverage-list">{archivalCoverage.map((source) => { const start = coverageOffset(source.from); const end = coverageOffset(source.to); return <div className="coverage-row" key={source.id}><strong>{source.label}</strong><div className={`coverage-track coverage-track--${source.pattern}`} aria-label={`${source.label}: ${source.note}`}><i style={{ left: `${start}%`, width: `${end - start}%` }} /></div><small>{source.note}</small></div>; })}</div><p className="reporter-note">Это подтверждённое покрытие архива, а не диапазон текущего короткого среза. Коды КИП в справочнике и данных расходятся; страница это не исправляет.</p></section>
  </main>;
}

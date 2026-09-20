import { useMemo, useState } from 'react';
import { useAppStore } from '@/store/store';
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';
import './ReporterPage.css';

const flagLabel: Record<string, string> = { sentinel: 'сентинел', stuck: 'залипание', outlier: 'зашкал', missing: 'нет данных' };
const statusLabel: Record<string, string> = { ok: 'свежие', warn: 'внимание', stale: 'устарели', missing: 'нет данных' };
const date = (value: string | null) => value ? new Date(value).toLocaleString('ru-RU', { timeZone: 'UTC' }) + ' UTC' : 'нет данных';

export function ReporterPage() {
  const { tags, freshness, tPoint, loadState, loading, error } = useAppStore();
  const [selected, setSelected] = useState<string | null>(null);
  const problems = useMemo(() => Array.from(new Map(tags.filter((tag) => tag.qualityFlag !== 'ok').map((tag) => [tag.tagCode, tag])).values()), [tags]);
  const selectedTag = tags.filter((tag) => tag.tagCode === selected).at(-1);
  const selectedSeries = tags.filter((tag) => tag.tagCode === selected);
  const coverage = useMemo(() => ['kip', 'pak', 'lims', 'vak'].map((source) => {
    const points = tags.filter((tag) => tag.source === source).sort((a,b) => a.ts.localeCompare(b.ts));
    return { source, from: points[0]?.ts, to: points.at(-1)?.ts, count: points.length };
  }), [tags]);
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
    <section className="reporter-card" style={{ marginTop: 16 }}><h2>Покрытие загруженного среза</h2><table className="reporter-table"><thead><tr><th>Источник</th><th>Начало</th><th>Конец</th><th>Точек</th></tr></thead><tbody>{coverage.map((source) => <tr key={source.source}><td>{source.source.toUpperCase()}</td><td>{date(source.from ?? null)}</td><td>{date(source.to ?? null)}</td><td>{source.count}</td></tr>)}</tbody></table><p className="reporter-note">Архивное покрытие ПАК D15 начинается с марта 2025. Более ранний пустой участок не означает неисправность. Коды КИП в справочнике и данных расходятся; страница это не исправляет.</p></section>
  </main>;
}

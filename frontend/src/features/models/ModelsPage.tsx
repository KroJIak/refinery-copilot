import { useEffect, useState } from 'react';
import { useAppStore } from '@/store/store';
import { Tooltip } from '@/components/ui/Tooltip';
import type { ModelArtifact } from '@/types';
import './ModelsPage.css';

const targetNames: Record<string, string> = { sulfur: 'Сера', t95: 'T95', d15: 'Плотность D15', cetane: 'Цетановое число' };
const info: Record<string, string> = {
  mae: 'Средняя ошибка прогноза в тех же единицах, что и сама величина. Чем меньше число, тем ближе угадывание к лаборатории.',
  coverage: 'Как часто настоящая цифра оказывается внутри обещанного облака. Для облака на восемьдесят процентов честный результат около нуля целых восьми.',
  winkler: 'Штраф сразу за широкое облако и за промахи мимо него. Чем меньше число, тем облако и узкое, и честное.',
  training: 'Модель училась на часах между этими датами. Текущий час снаружи этого окна значит цифрам стоит верить осторожнее.',
};
const n = (value: number | undefined) => value === undefined ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value);
const date = (value: string) => new Date(value).toLocaleDateString('ru-RU', { timeZone: 'UTC' });
function Info({ name }: { name: string }) { return <Tooltip content={info[name]}><button type="button" className="model-info" aria-label={`О метрике ${name}`}>ⓘ</button></Tooltip>; }

export function ModelsPage() {
  const { models, modelsLoading, modelsError, ensureModels, tPoint, health } = useAppStore();
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { void ensureModels(); }, [ensureModels]);
  const download = (model: ModelArtifact) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(model, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${model.artifactId}.json`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const inRange = (model: ModelArtifact) => !tPoint || (Date.parse(tPoint) >= Date.parse(model.trainedOnRange.start) && Date.parse(tPoint) <= Date.parse(model.trainedOnRange.end));
  return <main className="models-page"><header className="models-head"><div><h1>Модели</h1><p>Паспорта моделей · метрики на временном holdout</p></div></header>
    {modelsLoading && [1,2,3,4].map((i) => <div className="model-skeleton" key={i} />)}
    {modelsError && <div role="alert" className="models-error">Реестр моделей не загружен: {modelsError}<br />Сделайте make data → make train</div>}
    {!modelsLoading && !modelsError && !models.length && <div className="models-placeholder">Модели не обучены. Сделайте make data → make train.</div>}
    {models.map((model) => <ModelCard key={model.artifactId} model={model} expanded={open === model.artifactId} outOfRange={!inRange(model)} versionMismatch={!!health && model.coreVersion !== health.core} onToggle={() => setOpen(open === model.artifactId ? null : model.artifactId)} onDownload={() => download(model)} />)}
    {!!models.length && Object.keys(targetNames).filter((target) => !models.some((model) => model.target === target)).map((target) => <div className="model-card models-placeholder" key={target}>{targetNames[target]} · модель не обучена</div>)}
    <p className="models-note">Holdout — хвост периода, временное разделение с зазором не менее 3 часов. Coverage оценивает честность интервала, а MAE показывает ошибку в единицах цели.</p>
  </main>;
}

function ModelCard({ model, expanded, outOfRange, versionMismatch, onToggle, onDownload }: { model: ModelArtifact; expanded: boolean; outOfRange: boolean; versionMismatch: boolean; onToggle: () => void; onDownload: () => void }) {
  return <article className="model-card"><div className="model-summary"><div><button className="model-title-button" onClick={onToggle} aria-expanded={expanded}>{model.artifactId} {expanded ? '⌃' : '⌄'}</button><div className="model-target">{targetNames[model.target]}</div>{outOfRange && <div className="model-warning">⚠ Вне диапазона обученности</div>}{versionMismatch && <div className="model-warning">Реестр и API из разных сборок</div>}</div>
    <div className="model-metric"><label>MAE <Info name="mae" /></label><strong>{n(model.metrics.mae)}</strong></div>
    <div className="model-metric"><label>Coverage <Info name="coverage" /></label><strong className={Math.abs(model.coverage - .8) <= .05 ? 'model-coverage-good' : 'model-coverage-warn'}>{n(model.coverage)}</strong></div>
    {model.metrics.winkler !== undefined && <div className="model-metric"><label>Winkler <Info name="winkler" /></label><strong>{n(model.metrics.winkler)}</strong></div>}
    <span className={`model-active ${model.active ? '' : 'inactive'}`}>{model.active ? 'активна' : 'не активна'}</span><button className="model-download" onClick={onDownload}>Скачать manifest</button></div>
    <div className="model-training">Обучение <Info name="training" /> <span>{date(model.trainedOnRange.start)} — {date(model.trainedOnRange.end)}</span> · {model.algorithm}</div>
    {expanded && <div className="model-details"><div>Квантили <code>{model.quantiles.join(' / ')}</code></div><div>Конформ <code>{JSON.stringify(model.conformal)}</code></div><div>Признаки <code>{model.features.length ? model.features.join(', ') : 'нет данных'}</code></div><div>Монотонности <code>{JSON.stringify(model.monotoneConstraints)}</code></div><div>Seed <code>{model.seed}</code> · создана {date(model.createdAt)}</div><div>Версия ядра {model.coreVersion}</div><div>Остальные метрики <code>{Object.entries(model.metrics).filter(([key]) => key !== 'mae' && key !== 'winkler').map(([key, value]) => `${key}: ${n(value)}`).join(' · ') || '—'}</code></div><details><summary>Хэши данных</summary><pre>{JSON.stringify(model.dataHashes, null, 2)}</pre></details></div>}</article>;
}

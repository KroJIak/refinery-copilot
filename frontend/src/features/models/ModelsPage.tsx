import { useEffect } from 'react';
import { IconInfoCircle, IconAlertTriangle } from '@tabler/icons-react';
import { useAppStore } from '@/store/store';
import { Tooltip } from '@/components/ui/Tooltip';
import type { ModelArtifact } from '@/types';
import './ModelsPage.css';

const targetNames: Record<string, string> = { sulfur: 'Сера', t95: 'Температура выкипания' };
const info: Record<string, string> = {
  mae: 'Средняя ошибка прогноза в тех же единицах, что и сама величина. Чем меньше число, тем ближе прогноз к лабораторному результату.',
  coverage: 'Как часто настоящий результат оказывается внутри обещанного диапазона. Для диапазона в 80% честный результат близок к 0,8.',
  winkler: 'Общая оценка ширины диапазона и промахов мимо него. Чем меньше число, тем диапазон уже и точнее.',
  training: 'Период, на котором модель училась. Если текущая дата вне этого окна, прогнозу нужно доверять осторожнее.',
};
const n = (value: number | undefined) => value === undefined ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value);

function MetricInfo({ name }: { name: string }) {
  return <Tooltip content={info[name]}><button type="button" className="model-info" aria-label={`О метрике ${name}`}><IconInfoCircle aria-hidden="true" /></button></Tooltip>;
}

export function ModelsPage() {
  const { models, modelsLoading, modelsError, ensureModels, tPoint, health } = useAppStore();
  useEffect(() => { void ensureModels(); }, [ensureModels]);
  const download = (model: ModelArtifact) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(model, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${model.artifactId}.json`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const inRange = (model: ModelArtifact) => !tPoint || (Date.parse(tPoint) >= Date.parse(model.trainedOnRange.start) && Date.parse(tPoint) <= Date.parse(model.trainedOnRange.end));
  return <main className="models-page"><header className="models-head"><div><h1>Модели</h1><p>Паспорта моделей · метрики на проверочном периоде</p></div></header>
    {modelsLoading && [1, 2, 3, 4].map((i) => <div className="model-skeleton" key={i} />)}
    {modelsError && <div role="alert" className="models-error"><IconAlertTriangle aria-hidden="true" /> Реестр моделей не загружен. Повторите попытку позже.</div>}
    {!modelsLoading && !modelsError && !models.length && <div className="models-placeholder">Модели ещё не обучены. Загрузите исторические данные и повторите обучение.</div>}
    {models.map((model) => <ModelCard key={model.artifactId} model={model} outOfRange={!inRange(model)} versionMismatch={!!health && model.coreVersion !== health.core} onDownload={() => download(model)} />)}
    {!!models.length && Object.keys(targetNames).filter((target) => !models.some((model) => model.target === target)).map((target) => <div className="model-card models-placeholder" key={target}>{targetNames[target]} · модель не обучена</div>)}
    <p className="models-note">Проверочный период — последние пробы, отложенные и не показанные модели при обучении. Покрытие показывает, как часто лабораторный результат попадает в обещанный диапазон. Средняя ошибка — расстояние прогноза до лабораторного результата.</p>
  </main>;
}

function ModelCard({ model, outOfRange, versionMismatch, onDownload }: { model: ModelArtifact; outOfRange: boolean; versionMismatch: boolean; onDownload: () => void }) {
  return <article className="model-card"><div className="model-summary"><div><h2 className="model-title">{targetNames[model.target] ?? model.artifactId} <small>({model.algorithm})</small></h2>{outOfRange && <div className="model-warning"><IconAlertTriangle aria-hidden="true" /> Вне периода обучения</div>}{versionMismatch && <div className="model-warning"><IconAlertTriangle aria-hidden="true" /> Версия реестра и сервиса различается</div>}</div>
    <div className="model-metric"><label>Средняя ошибка <MetricInfo name="mae" /></label><strong>{n(model.metrics.mae)}</strong></div>
    <div className="model-metric"><label>Покрытие диапазона <MetricInfo name="coverage" /></label><strong className={Math.abs(model.coverage - .8) <= .05 ? 'model-coverage-good' : 'model-coverage-warn'}>{n(model.coverage)}</strong></div>
    <div className="model-metric">{model.metrics.winkler !== undefined && <><label>Точность диапазона <MetricInfo name="winkler" /></label><strong>{n(model.metrics.winkler)}</strong></>}</div>
    <span className={`model-active ${model.active ? '' : 'inactive'}`}>{model.active ? 'активна' : 'не активна'}</span><button className="model-download" onClick={onDownload}>Скачать паспорт</button></div></article>;
}

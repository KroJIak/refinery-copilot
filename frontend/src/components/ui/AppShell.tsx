import { useEffect, type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { USE_MOCKS } from '@/config/env';
import { useAppStore } from '@/store';
import { ErrorBoundary } from './ErrorBoundary';
import { Tooltip } from './Tooltip';
import './AppShell.css';

const navigation = [
  { label: 'Обзор', to: '/' },
  { label: 'Сценарии', to: '/recommendation' },
  { label: 'Что если', to: '/whatif' },
  { label: 'Мнемосхема', to: '/mnemonic' },
  { label: 'Модели', to: '/models' },
  { label: 'Отчёты', to: '/data' },
] as const;

function formatAge(ageHours: number | null): string {
  if (ageHours === null) return '—';
  return Number.isInteger(ageHours) ? String(ageHours) : ageHours.toFixed(1);
}

function FreshnessPill({ source, onClick }: { source: 'lims' | 'pak'; onClick: () => void }) {
  const entries = useAppStore((store) => store.freshness);
  const entry = entries.find((item) => item.source === source && /sulfur|sulphur|sulph|s\.s|сера/i.test(item.pointId)) ?? entries.find((item) => item.source === source);
  return <Tooltip content={entry ? `Возраст ${entry.ageHours ?? '—'} ч · предупреждение после ${entry.warnAfterH} ч · устаревание после ${entry.staleAfterH} ч` : 'Данные о свежести отсутствуют'}><button className="freshness-pill" data-status={entry?.status ?? 'missing'} onClick={onClick}>
    {source === 'lims' ? 'ЛИМС' : 'ПАК'} {entry ? `${formatAge(entry.ageHours)} ч` : '—'}
  </button></Tooltip>;
}

export function AppShell({ children }: { children?: ReactNode }) {
  const bootstrap = useAppStore((store) => store.bootstrap);
  const error = useAppStore((store) => store.error);
  const runId = useAppStore((store) => store.runId);
  const navigate = useNavigate();

  useEffect(() => { void bootstrap(); }, [bootstrap]);

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">К содержимому</a>
    <header className="app-header">
      <div className="app-brand-group">
        <NavLink className="app-brand" to="/" aria-label="Refinery Copilot, обзор">Refinery Copilot</NavLink>
        {USE_MOCKS && <span className="mock-badge">демо-режим</span>}
      </div>
      <div className="app-freshness">
        <FreshnessPill source="lims" onClick={() => navigate('/data')} />
        <FreshnessPill source="pak" onClick={() => navigate('/data')} />
      </div>
    </header>
    <div className="app-body">
      <aside className="app-sidebar" aria-label="Основная навигация">
        <nav className="app-nav">
          {navigation.map((item) => <NavLink key={item.to} to={item.to === '/recommendation' && runId ? `/recommendation/${runId}` : item.to} end={item.to === '/'}>{item.label}</NavLink>)}
        </nav>
      </aside>
      <main id="main-content" className="app-main">
        {error && <div className="error-banner global-error" role="alert"><span>{error}</span><button className="text-button" onClick={() => { useAppStore.setState({ error: null }); void bootstrap(); }}>Повторить</button></div>}
        <ErrorBoundary>{children ?? <Outlet />}</ErrorBoundary>
      </main>
    </div>
  </div>;
}

import { Component, type ErrorInfo, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Ошибка экрана Refinery Copilot', error, info.componentStack); }
  render() {
    if (this.state.failed) return <section className="panel empty-state" role="alert">
      <h1>Не удалось открыть экран</h1>
      <p>Попробуйте перезагрузить страницу. Сохранённые результаты прогонов останутся в истории.</p>
      <button className="primary-button" onClick={() => window.location.reload()}>Перезагрузить</button>
    </section>;
    return this.props.children;
  }
}

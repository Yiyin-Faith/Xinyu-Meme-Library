import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String((error as { message?: string })?.message || error) };
  }
  render() {
    if (this.state.error) return <main className="loading-screen" role="alert"><strong>表情库暂时没有打开</strong><p>{this.state.error}</p><p>本地数据不会被清除。</p><button className="primary-button" onClick={() => location.reload()}>重新打开</button></main>;
    return this.props.children;
  }
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>);

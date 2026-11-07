import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Component } from 'react';
import { Logo } from './Logo.jsx';

/**
 * Catches render errors so a single faulty component cannot blank the whole
 * playground.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled UI error:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="grid min-h-dvh place-items-center bg-canvas px-6 text-center">
        <div className="max-w-md">
          <Logo size={40} className="mx-auto" />
          <div className="mx-auto mt-6 grid size-12 place-items-center rounded-2xl bg-bad/10 ring-1 ring-bad/25">
            <AlertTriangle size={22} className="text-bad" aria-hidden="true" />
          </div>
          <h1 className="mt-5 text-lg font-semibold text-ink">The playground crashed</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-dim">
            An unexpected error occurred while rendering. Reload the page to continue —
            your conversation history is stored locally.
          </p>
          <pre className="scrollbar-slim mt-4 max-h-40 overflow-auto rounded-xl border border-line bg-surface p-3 text-left font-mono text-[11px] text-bad/90">
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white transition hover:bg-accent-deep"
          >
            <RotateCcw size={14} aria-hidden="true" />
            Reload
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;

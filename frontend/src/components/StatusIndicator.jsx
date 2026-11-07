import { Activity, ChevronUp, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const TONE = {
  connected: { dot: 'bg-ok', text: 'text-ok', label: 'Connected' },
  connecting: { dot: 'bg-warn animate-pulse', text: 'text-warn', label: 'Connecting' },
  error: { dot: 'bg-bad', text: 'text-bad', label: 'Error' },
  disconnected: { dot: 'bg-ink-faint', text: 'text-ink-faint', label: 'Disconnected' },
  unknown: { dot: 'bg-ink-faint', text: 'text-ink-faint', label: 'Unknown' },
};

function statusOf(value) {
  return TONE[value] || TONE.unknown;
}

/**
 * Compact connection indicator for the chat header.
 *
 * Four small dots reflect the live state of the backend, the Chrome
 * extension, the AI Mode tab and the Google login.  Clicking opens a panel
 * with the details.  Every value comes from the real API endpoints.
 */
export function StatusIndicator({ status, onRefresh }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const extension = status.extensionStatus || {};

  const items = [
    { key: 'backend', label: 'Backend', state: status.backend, hint: status.error || status.apiBaseUrl },
    { key: 'extension', label: 'Chrome extension', state: status.extension, hint: extension.session_id ? `session ${String(extension.session_id).slice(0, 8)}` : 'not attached' },
    { key: 'tab', label: 'AI Mode tab', state: status.tab, hint: extension.page_url || 'no tab open' },
    { key: 'login', label: 'Google login', state: status.login, hint: extension.captcha_detected ? 'captcha detected' : extension.logged_in ? 'signed in' : 'sign-in required' },
  ];

  const worst = items.some((item) => item.state === 'error')
    ? 'error'
    : items.every((item) => item.state === 'connected')
      ? 'connected'
      : items.some((item) => item.state === 'connecting')
        ? 'connecting'
        : 'disconnected';

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Connection status"
        className="flex items-center gap-1.5 rounded-full border border-line bg-canvas px-2.5 py-1.5 transition hover:border-line hover:bg-hover"
      >
        <span className={`size-1.5 rounded-full ${statusOf(worst).dot}`} aria-hidden="true" />
        {items.map((item) => (
          <span
            key={item.key}
            title={`${item.label}: ${statusOf(item.state).label}`}
            className={`size-1.5 rounded-full ${statusOf(item.state).dot}`}
            aria-hidden="true"
          />
        ))}
        <ChevronUp
          size={12}
          className={`ml-0.5 text-ink-faint transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
          aria-hidden="true"
        />
        <span className="sr-only">Connection status</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Connection details"
          className="animate-pop absolute right-0 z-50 mt-2 w-[290px] rounded-xl border border-line bg-surface p-3 shadow-2xl shadow-black/50"
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
              Connection
            </p>
            <button
              type="button"
              onClick={() => {
                onRefresh?.();
                setOpen(false);
              }}
              title="Refresh status"
              aria-label="Refresh status"
              className="rounded-md p-1 text-ink-faint transition hover:bg-hover hover:text-ink"
            >
              <RefreshCw size={12.5} aria-hidden="true" />
            </button>
          </div>

          <ul className="space-y-2.5">
            {items.map((item) => {
              const tone = statusOf(item.state);
              return (
                <li key={item.key} className="flex items-start gap-2.5">
                  <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[12.5px] text-ink-dim">{item.label}</span>
                      <span className={`shrink-0 text-[11px] ${tone.text}`}>{tone.label}</span>
                    </div>
                    {item.hint && (
                      <p className="mt-0.5 truncate font-mono text-[10px] text-ink-faint" title={item.hint}>
                        {item.hint}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-3 flex items-center gap-1.5 border-t border-line pt-2.5 text-[10.5px] text-ink-faint">
            <Activity size={11} aria-hidden="true" />
            <span>
              {status.lastCheckedAt
                ? `Checked ${new Date(status.lastCheckedAt).toLocaleTimeString()}`
                : 'Waiting for the first check…'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

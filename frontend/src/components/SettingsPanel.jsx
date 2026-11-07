import { Activity, KeyRound, Save, X, Zap } from 'lucide-react';
import { useState } from 'react';

const FIELD =
  'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[12.5px] text-ink placeholder:text-ink-faint transition focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/15';

/**
 * Settings overlay.
 *
 * The API key is entered at runtime and kept in `sessionStorage` — it is
 * never part of the JavaScript bundle.  The extension pairing token is not
 * touched here at all.
 */
export function SettingsPanel({
  open,
  onClose,
  baseUrl,
  onBaseUrlChange,
  model,
  onModelChange,
  apiKey,
  onApiKeyChange,
  streaming,
  onStreamingChange,
  diagnostics,
  onRunDiagnostics,
  onSave,
}) {
  const [draftUrl, setDraftUrl] = useState(baseUrl);
  const [draftModel, setDraftModel] = useState(model);
  const [draftKey, setDraftKey] = useState(apiKey);

  if (!open) return null;

  const apply = () => {
    onBaseUrlChange(draftUrl.trim());
    onModelChange(draftModel.trim() || 'google-ai-mode');
    onApiKeyChange(draftKey.trim());
    onSave?.();
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(event) => event.stopPropagation()}
        className="animate-pop flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-2xl shadow-black/60 sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Settings</h2>
            <p className="mt-0.5 text-[12.5px] text-ink-faint">
              Runtime configuration for this browser session.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="rounded-lg p-1.5 text-ink-faint transition hover:bg-hover hover:text-ink"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="scrollbar-slim min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <div>
            <label
              htmlFor="base-url"
              className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-faint"
            >
              API base URL
            </label>
            <input
              id="base-url"
              type="text"
              value={draftUrl}
              onChange={(event) => setDraftUrl(event.target.value)}
              placeholder="http://127.0.0.1:8000"
              spellCheck={false}
              className={`mt-1.5 font-mono ${FIELD}`}
            />
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-faint">
              Where the FastAPI backend is reachable from this browser.
            </p>
          </div>

          <div>
            <label
              htmlFor="model"
              className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-faint"
            >
              Model
            </label>
            <input
              id="model"
              type="text"
              value={draftModel}
              onChange={(event) => setDraftModel(event.target.value)}
              placeholder="google-ai-mode"
              spellCheck={false}
              className={`mt-1.5 font-mono ${FIELD}`}
            />
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-faint">
              Must be one of the backend&apos;s <span className="font-mono">SUPPORTED_MODELS</span>.
            </p>
          </div>

          <div>
            <label
              htmlFor="api-key"
              className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-faint"
            >
              <KeyRound size={11} aria-hidden="true" />
              REST API key (optional)
            </label>
            <input
              id="api-key"
              type="password"
              value={draftKey}
              onChange={(event) => setDraftKey(event.target.value)}
              placeholder="Only needed when REQUIRE_API_KEY=true"
              spellCheck={false}
              className={`mt-1.5 font-mono ${FIELD}`}
            />
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-faint">
              Kept in <span className="font-mono">sessionStorage</span> only. The extension
              pairing token is never used by this page.
            </p>
          </div>

          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-line bg-canvas/50 px-3.5 py-3">
            <span className="flex items-center gap-2 text-[13px] text-ink-dim">
              <Zap size={14} className="text-accent-soft" aria-hidden="true" />
              Stream responses (SSE)
            </span>
            <input
              type="checkbox"
              checked={streaming}
              onChange={(event) => onStreamingChange(event.target.checked)}
              className="size-4 accent-[#6366F1]"
            />
          </label>

          <div className="rounded-xl border border-line bg-canvas/50 px-3.5 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-[13px] text-ink-dim">
                <Activity size={14} className="text-accent-soft" aria-hidden="true" />
                Connection diagnostics
              </span>
              <button
                type="button"
                onClick={onRunDiagnostics}
                className="rounded-lg border border-line px-2.5 py-1 text-[12px] text-ink-dim transition hover:border-accent/40 hover:text-ink"
              >
                Run
              </button>
            </div>
            {diagnostics ? (
              <pre className="scrollbar-slim mt-3 max-h-52 overflow-auto rounded-lg border border-line bg-canvas p-3 font-mono text-[10.5px] leading-relaxed text-ink-dim">
                {diagnostics}
              </pre>
            ) : (
              <p className="mt-2 text-[11.5px] leading-relaxed text-ink-faint">
                Inspects the live Google AI Mode page through the extension. Useful when
                Google changes the layout.
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3.5 py-2 text-[13px] text-ink-dim transition hover:bg-hover hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[13px] font-medium text-white transition hover:bg-accent-deep"
          >
            <Save size={13.5} aria-hidden="true" />
            Save settings
          </button>
        </div>
      </div>
    </div>
  );
}

export default SettingsPanel;

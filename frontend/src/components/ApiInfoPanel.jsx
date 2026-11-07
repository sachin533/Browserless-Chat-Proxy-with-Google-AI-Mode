import { Check, Copy, ExternalLink, Terminal } from 'lucide-react';
import { useState } from 'react';

function Row({ label, value, mono, title, tone }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="border-b border-line-soft py-2.5 last:border-b-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
        {label}
      </p>
      <p
        title={title || (typeof value === 'string' ? value : undefined)}
        className={`mt-1 truncate text-[12.5px] ${mono ? 'font-mono text-[11.5px]' : ''} ${
          tone || 'text-ink-dim'
        }`}
      >
        {String(value)}
      </p>
    </div>
  );
}

/**
 * The request inspector content.
 *
 * Shows everything the backend reported about the most recent request plus a
 * ready to run cURL command.
 */
export function ApiInfoPanel({ meta, model, baseUrl, onCopy, onToast }) {
  const [copied, setCopied] = useState(false);

  const endpoint = `${baseUrl}/v1/chat/completions`;

  const curl = [
    `curl -X POST ${endpoint} \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"model":"${model}","messages":[{"role":"user","content":"Hello"}],"stream":false}'`,
  ].join('\n');

  const handleCopy = async () => {
    await onCopy(curl);
    setCopied(true);
    onToast?.('cURL command copied to the clipboard.', 'success');
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto scrollbar-slim px-4 py-5">
      <div className="flex items-center gap-2">
        <Terminal size={15} className="text-accent-soft" aria-hidden="true" />
        <h2 className="text-[13.5px] font-semibold text-ink">Request inspector</h2>
      </div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-ink-faint">
        Details reported by the backend for the most recent request.
      </p>

      <div className="mt-4 rounded-xl border border-line bg-canvas/60 px-3">
        <Row label="Endpoint" value={endpoint} mono title={endpoint} />
        <Row label="Method" value="POST" mono />
        <Row label="Model" value={meta?.model || model} mono />
        <Row
          label="Duration"
          value={
            meta?.durationMs !== null && meta?.durationMs !== undefined
              ? `${meta.durationMs} ms`
              : null
          }
          mono
        />
        <Row
          label="Request id"
          value={meta?.requestId}
          mono
          title={meta?.requestId}
        />
        <Row label="Source URL" value={meta?.sourceUrl} mono title={meta?.sourceUrl} />
        <Row label="Finish reason" value={meta?.finishReason} mono />
        <Row
          label="Transport"
          value={meta?.streamed ? 'Server-Sent Events' : 'JSON (non streaming)'}
        />
        {meta?.usage && (
          <Row
            label="Usage (estimated)"
            value={`${meta.usage.total_tokens} total · ${meta.usage.completion_tokens} completion`}
          />
        )}
      </div>

      {!meta && (
        <p className="mt-4 rounded-xl border border-dashed border-line px-3 py-4 text-center text-[12px] text-ink-faint">
          Send a prompt to see the request details.
        </p>
      )}

      {meta?.sourceUrl && (
        <a
          href={meta.sourceUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-accent-soft transition hover:text-ink"
        >
          <ExternalLink size={12} aria-hidden="true" />
          Open the page that produced this answer
        </a>
      )}

      <div className="mt-6">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
            Equivalent request
          </p>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ink-faint transition hover:bg-hover hover:text-ink"
          >
            {copied ? (
              <>
                <Check size={11} aria-hidden="true" /> Copied
              </>
            ) : (
              <>
                <Copy size={11} aria-hidden="true" /> Copy
              </>
            )}
          </button>
        </div>
        <pre className="scrollbar-slim mt-2 overflow-x-auto rounded-xl border border-line bg-canvas p-3 font-mono text-[11px] leading-relaxed text-ink-dim">
          {curl}
        </pre>
      </div>

      <p className="mt-6 text-[11px] leading-relaxed text-ink-faint">
        Token usage is a character based estimate — the browser pipeline cannot
        report the model's real token counts.
      </p>
    </div>
  );
}

export default ApiInfoPanel;

import { AlertTriangle, Check, Copy, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Markdown } from './Markdown.jsx';

/** Animated dots shown while the answer is being produced. */
export function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 py-1" aria-label="Waiting for Google AI Mode">
      <span className="flex items-center gap-1">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="size-1.5 rounded-full bg-accent-soft"
            style={{
              animation: 'gaim-dot 1.1s ease-in-out infinite',
              animationDelay: `${index * 0.16}s`,
            }}
          />
        ))}
      </span>
      <span className="text-[13px] text-ink-faint">Thinking…</span>
    </div>
  );
}

/**
 * A single chat message.
 *
 * User messages are right aligned and tinted, assistant messages use the
 * reading column and render Markdown.
 */
export function MessageBubble({ message, onRetry, onCopy }) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';
  const isError = message.status === 'error';
  const isPending = message.status === 'pending';

  const handleCopy = async () => {
    await onCopy(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  /* ---------------------------------------------------------------- */
  /* User                                                              */
  /* ---------------------------------------------------------------- */
  if (isUser) {
    return (
      <div className="flex animate-fade-up justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[14.5px] leading-relaxed text-white shadow-lg shadow-accent/15 sm:max-w-[75%]">
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Error                                                             */
  /* ---------------------------------------------------------------- */
  if (isError) {
    return (
      <div className="flex animate-fade-up gap-3">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-bad/12 ring-1 ring-bad/25">
          <AlertTriangle size={14} className="text-bad" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md border border-bad/25 bg-bad/[0.06] px-4 py-3">
          <p className="text-[13.5px] font-medium text-bad">Something went wrong</p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink-dim">
            {message.error?.message}
          </p>
          {message.error?.code && (
            <p className="mt-1.5 font-mono text-[10.5px] text-ink-faint">
              {message.error.code}
              {message.error?.status ? ` · http ${message.error.status}` : ''}
            </p>
          )}
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-bad/30 px-2.5 py-1.5 text-[12px] font-medium text-bad transition hover:bg-bad/12"
            >
              <RotateCcw size={13} aria-hidden="true" />
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Assistant                                                         */
  /* ---------------------------------------------------------------- */
  const hasContent = Boolean(message.content);

  return (
    <div className="group flex animate-fade-up gap-3">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-accent/12 ring-1 ring-accent/25">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 3.5c.7 3.9 2.4 5.6 6.3 6.3-3.9.7-5.6 2.4-6.3 6.3-.7-3.9-2.4-5.6-6.3-6.3 3.9-.7 5.6-2.4 6.3-6.3Z"
            fill="#818CF8"
          />
        </svg>
      </span>

      <div className="min-w-0 flex-1">
        {hasContent ? (
          <div className="max-w-none text-[14.5px] text-ink-dim">
            <Markdown text={message.content} />
            {isPending && (
              <span className="animate-caret ml-0.5 text-accent-soft" aria-hidden="true">
                ▋
              </span>
            )}
          </div>
        ) : (
          <ThinkingIndicator />
        )}

        {hasContent && (
          <div className="mt-2 flex items-center gap-1 opacity-0 transition duration-150 focus-within:opacity-100 group-hover:opacity-100">
            <button
              type="button"
              onClick={handleCopy}
              title="Copy response"
              aria-label="Copy response"
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11.5px] text-ink-faint transition hover:bg-hover hover:text-ink"
            >
              {copied ? (
                <>
                  <Check size={12} aria-hidden="true" /> Copied
                </>
              ) : (
                <>
                  <Copy size={12} aria-hidden="true" /> Copy
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default MessageBubble;

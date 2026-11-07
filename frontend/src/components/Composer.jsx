import { ArrowUp, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const MAX_PROMPT_CHARS = 8000;

/**
 * The prompt input.
 *
 * Enter sends, Shift+Enter inserts a newline, and the textarea grows with
 * the content up to a maximum height.
 */
export function Composer({ onSend, onCancel, isLoading, disabled, disabledHint }) {
  const [value, setValue] = useState('');
  const textareaRef = useRef(null);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 240)}px`;
  }, [value]);

  useEffect(() => {
    if (!isLoading && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isLoading]);

  const submit = () => {
    const text = value.trim();
    if (!text || isLoading || disabled) return;
    onSend(text);
    setValue('');
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const remaining = MAX_PROMPT_CHARS - value.length;

  return (
    <div className="shrink-0 px-4 pb-4 pt-1 sm:px-6">
      <div className="mx-auto max-w-[850px]">
        {disabledHint && (
          <div className="mb-2.5 flex items-start gap-2 rounded-lg border border-warn/20 bg-warn/[0.07] px-3 py-2">
            <span className="mt-1 size-1.5 shrink-0 rounded-full bg-warn" aria-hidden="true" />
            <p className="text-[12px] leading-relaxed text-warn">{disabledHint}</p>
          </div>
        )}

        <div
          className={`rounded-2xl border bg-surface transition-colors duration-200 focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/10 ${
            disabled ? 'border-line opacity-60' : 'border-line'
          }`}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={disabled}
            placeholder="Ask Google AI Mode anything..."
            aria-label="Prompt"
            className="scrollbar-slim max-h-[240px] w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[14.5px] leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none disabled:cursor-not-allowed"
          />

          <div className="flex items-center justify-between gap-3 px-2.5 pb-2.5 pt-1">
            <span
              className={`select-none pl-1.5 text-[11px] tabular-nums transition-colors ${
                remaining < 0
                  ? 'text-bad'
                  : remaining < 500
                    ? 'text-warn'
                    : 'text-ink-faint'
              }`}
            >
              {value.length > 0 ? `${value.length} / ${MAX_PROMPT_CHARS}` : ''}
            </span>

            {isLoading ? (
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-elevated px-3 py-2 text-[12.5px] font-medium text-ink-dim transition hover:border-bad/40 hover:text-bad"
              >
                <Square size={11} aria-hidden="true" />
                Stop generating
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={disabled || !value.trim()}
                aria-label="Send message"
                className="grid size-9 place-items-center rounded-xl bg-accent text-white transition-all duration-200 hover:bg-accent-deep disabled:cursor-not-allowed disabled:bg-elevated disabled:text-ink-faint"
              >
                <ArrowUp size={17} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        <p className="mt-2.5 text-center text-[11px] text-ink-faint">
          Powered by Google AI Mode through your browser session.
        </p>
      </div>
    </div>
  );
}

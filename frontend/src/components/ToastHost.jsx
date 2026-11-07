import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

const TONES = {
  success: {
    ring: 'border-ok/25 bg-ok/[0.08]',
    Icon: CheckCircle2,
    iconClass: 'text-ok',
  },
  error: {
    ring: 'border-bad/25 bg-bad/[0.08]',
    Icon: AlertTriangle,
    iconClass: 'text-bad',
  },
  info: {
    ring: 'border-accent/25 bg-accent/[0.08]',
    Icon: Info,
    iconClass: 'text-accent-soft',
  },
};

/**
 * Transient notifications.
 *
 * `toasts` is a list of `{ id, tone, message }` objects owned by the parent.
 */
export function ToastHost({ toasts, onDismiss }) {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[70] flex w-[min(360px,calc(100vw-2.5rem))] flex-col gap-2">
      {toasts.map((toast) => {
        const tone = TONES[toast.tone] || TONES.info;
        const { Icon } = tone;
        return (
          <div
            key={toast.id}
            role="status"
            className={`animate-pop pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-3 shadow-xl shadow-black/40 backdrop-blur ${tone.ring}`}
          >
            <Icon size={15} className={`mt-0.5 shrink-0 ${tone.iconClass}`} aria-hidden="true" />
            <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-ink">
              {toast.message}
            </p>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss notification"
              className="shrink-0 rounded p-0.5 text-ink-faint transition hover:text-ink"
            >
              <X size={13} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default ToastHost;

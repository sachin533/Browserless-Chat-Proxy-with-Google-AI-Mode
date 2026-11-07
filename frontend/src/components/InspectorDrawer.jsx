import { X } from 'lucide-react';
import { useEffect } from 'react';

/**
 * Slide-over panel used for the request inspector.
 *
 * It overlays the chat on small screens and docks to the right on wide
 * ones, so the conversation never loses its width on a laptop.
 */
export function InspectorDrawer({ open, onClose, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] xl:hidden"
        onClick={onClose}
        role="presentation"
      />
      <aside
        role="dialog"
        aria-label="Request inspector"
        className="animate-slide-right fixed inset-y-0 right-0 z-50 flex w-full max-w-[380px] flex-col border-l border-line bg-surface shadow-2xl shadow-black/60 xl:static xl:z-auto xl:w-[360px] xl:shrink-0 xl:shadow-none xl:animate-fade-in"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-ink-faint transition hover:bg-hover hover:text-ink xl:hidden"
        >
          <X size={16} aria-hidden="true" />
        </button>
        {children}
      </aside>
    </>
  );
}

export default InspectorDrawer;

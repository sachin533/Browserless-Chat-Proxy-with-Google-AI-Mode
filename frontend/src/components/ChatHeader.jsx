import { Menu, PanelRight, Settings, Trash2 } from 'lucide-react';
import { Logo } from './Logo.jsx';
import { StatusIndicator } from './StatusIndicator.jsx';

/**
 * Chat header: title, product label, live status and actions.
 */
export function ChatHeader({
  title,
  status,
  onOpenSidebar,
  onToggleInspector,
  onOpenSettings,
  onClearChat,
  canClear,
  inspectorOpen,
}) {
  return (
    <header className="z-20 flex shrink-0 items-center gap-3 border-b border-line bg-surface/70 px-4 py-2.5 backdrop-blur-xl sm:px-5">
      <button
        type="button"
        onClick={onOpenSidebar}
        aria-label="Open sidebar"
        className="rounded-lg p-2 text-ink-dim transition hover:bg-hover hover:text-ink lg:hidden"
      >
        <Menu size={18} aria-hidden="true" />
      </button>

      <Logo size={22} className="lg:hidden" />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-[13.5px] font-semibold tracking-tight text-ink">
            {title}
          </h1>
          <span className="hidden shrink-0 rounded-md border border-line bg-canvas px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-ink-faint sm:inline">
            Google AI Mode
          </span>
        </div>
      </div>

      <StatusIndicator status={status} />

      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={onOpenSettings}
          title="Settings"
          aria-label="Open settings"
          className="rounded-lg p-2 text-ink-dim transition hover:bg-hover hover:text-ink"
        >
          <Settings size={17} aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={onClearChat}
          disabled={!canClear}
          title="Clear conversation"
          aria-label="Clear conversation"
          className="rounded-lg p-2 text-ink-dim transition hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-35"
        >
          <Trash2 size={17} aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={onToggleInspector}
          title="Toggle request inspector"
          aria-label="Toggle request inspector"
          className={`rounded-lg p-2 transition ${
            inspectorOpen
              ? 'bg-accent/15 text-accent-soft'
              : 'text-ink-dim hover:bg-hover hover:text-ink'
          }`}
        >
          <PanelRight size={17} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

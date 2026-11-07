import {
  Check,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Logo } from './Logo.jsx';

const STATUS_TONE = {
  connected: 'bg-ok',
  connecting: 'bg-warn',
  error: 'bg-bad',
  disconnected: 'bg-ink-faint',
  unknown: 'bg-ink-faint',
};

function relativeTime(timestamp) {
  if (!timestamp) return '';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 45) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * The application sidebar.
 *
 * On desktop it can be collapsed to a slim icon rail.  On small screens it
 * slides in as a drawer.
 */
export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNewChat,
  onDelete,
  onRename,
  onOpenSettings,
  apiBaseUrl,
  backendStatus,
  isOpen,
  onClose,
  collapsed,
  onToggleCollapse,
}) {
  const [query, setQuery] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [draftTitle, setDraftTitle] = useState('');
  const renameRef = useRef(null);

  useEffect(() => {
    if (renamingId && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [renamingId]);

  const search = query.trim().toLowerCase();
  const filtered = search
    ? conversations.filter((conversation) =>
        conversation.title.toLowerCase().includes(search),
      )
    : conversations;

  const startRename = (conversation) => {
    setRenamingId(conversation.id);
    setDraftTitle(conversation.title);
  };

  const commitRename = () => {
    if (renamingId && draftTitle.trim()) {
      onRename(renamingId, draftTitle);
    }
    setRenamingId(null);
    setDraftTitle('');
  };

  /* ------------------------------------------------------------------ */
  /* Collapsed rail (desktop)                                            */
  /* ------------------------------------------------------------------ */
  if (collapsed) {
    return (
      <aside className="z-30 flex w-[68px] shrink-0 flex-col items-center gap-2 border-r border-line bg-surface py-4">
        <button
          type="button"
          onClick={onToggleCollapse}
          title="Expand sidebar"
          aria-label="Expand sidebar"
          className="grid size-9 place-items-center rounded-xl transition hover:bg-hover"
        >
          <Logo size={26} />
        </button>

        <button
          type="button"
          onClick={onNewChat}
          title="New chat"
          aria-label="New chat"
          className="grid size-9 place-items-center rounded-xl text-ink-dim transition hover:bg-hover hover:text-ink"
        >
          <Plus size={18} aria-hidden="true" />
        </button>

        <nav className="scrollbar-slim mt-1 flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto px-2">
          {conversations.slice(0, 40).map((conversation) => {
            const isActive = conversation.id === activeId;
            return (
              <button
                key={conversation.id}
                type="button"
                onClick={() => onSelect(conversation.id)}
                title={conversation.title}
                aria-label={conversation.title}
                className={`grid size-9 place-items-center rounded-xl transition ${
                  isActive
                    ? 'bg-accent/15 text-accent-soft'
                    : 'text-ink-faint hover:bg-hover hover:text-ink-dim'
                }`}
              >
                <MessageSquare size={16} aria-hidden="true" />
              </button>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={onOpenSettings}
          title="Settings"
          aria-label="Settings"
          className="grid size-9 place-items-center rounded-xl text-ink-faint transition hover:bg-hover hover:text-ink"
        >
          <Settings size={17} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onToggleCollapse}
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
          className="grid size-9 place-items-center rounded-xl text-ink-faint transition hover:bg-hover hover:text-ink"
        >
          <PanelLeftOpen size={17} aria-hidden="true" />
        </button>
      </aside>
    );
  }

  /* ------------------------------------------------------------------ */
  /* Full sidebar                                                        */
  /* ------------------------------------------------------------------ */
  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] lg:hidden"
          onClick={onClose}
          role="presentation"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[250px] shrink-0 flex-col border-r border-line bg-surface transition-transform duration-300 ease-out lg:static lg:z-auto lg:translate-x-0 ${
          isOpen ? 'translate-x-0 shadow-2xl shadow-black/50' : '-translate-x-full'
        }`}
      >
        {/* Brand */}
        <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
          <Logo size={26} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-semibold tracking-tight text-ink">
              Google AI Mode
            </p>
            <p className="truncate text-[11px] text-ink-faint">Playground</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sidebar"
            className="rounded-lg p-1.5 text-ink-faint transition hover:bg-hover hover:text-ink lg:hidden"
          >
            <X size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onToggleCollapse}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            className="hidden rounded-lg p-1.5 text-ink-faint transition hover:bg-hover hover:text-ink lg:block"
          >
            <PanelLeftClose size={16} aria-hidden="true" />
          </button>
        </div>

        {/* New chat */}
        <div className="px-3 pb-3">
          <button
            type="button"
            onClick={onNewChat}
            className="flex w-full items-center gap-2 rounded-xl border border-line bg-elevated px-3 py-2 text-[13px] font-medium text-ink transition hover:border-accent/40 hover:bg-hover"
          >
            <Plus size={15} className="text-accent-soft" aria-hidden="true" />
            New chat
          </button>
        </div>

        {/* Search */}
        <div className="px-3 pb-2">
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search conversations"
              aria-label="Search conversations"
              className="w-full rounded-lg border border-line bg-canvas py-1.5 pl-8 pr-2.5 text-[12.5px] text-ink placeholder:text-ink-faint transition focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/15"
            />
          </div>
        </div>

        {/* History */}
        <nav className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {filtered.length === 0 ? (
            <p className="px-2 py-6 text-center text-[12px] text-ink-faint">
              {search ? 'No matching conversations.' : 'No conversations yet.'}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {filtered.map((conversation) => {
                const isActive = conversation.id === activeId;
                const isRenaming = renamingId === conversation.id;

                return (
                  <li key={conversation.id} className="group relative">
                    {isRenaming ? (
                      <div className="flex items-center gap-1.5 rounded-lg bg-elevated px-2 py-1.5">
                        <input
                          ref={renameRef}
                          value={draftTitle}
                          onChange={(event) => setDraftTitle(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') commitRename();
                            if (event.key === 'Escape') setRenamingId(null);
                          }}
                          onBlur={commitRename}
                          aria-label="Conversation title"
                          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none"
                        />
                        <button
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={commitRename}
                          aria-label="Save title"
                          className="rounded p-1 text-accent-soft transition hover:bg-hover"
                        >
                          <Check size={13} aria-hidden="true" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => onSelect(conversation.id)}
                          className={`flex w-full items-center gap-2 rounded-lg py-2 pl-2.5 pr-14 text-left transition ${
                            isActive
                              ? 'bg-accent/12 text-ink'
                              : 'text-ink-dim hover:bg-hover hover:text-ink'
                          }`}
                        >
                          <MessageSquare
                            size={14}
                            className={`shrink-0 ${
                              isActive ? 'text-accent-soft' : 'text-ink-faint'
                            }`}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] leading-tight">
                              {conversation.title}
                            </span>
                            <span className="mt-0.5 block text-[10.5px] text-ink-faint">
                              {conversation.messages.length}{' '}
                              {conversation.messages.length === 1 ? 'message' : 'messages'}
                              {' · '}
                              {relativeTime(
                                conversation.updatedAt || conversation.createdAt,
                              )}
                            </span>
                          </span>
                        </button>

                        <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => startRename(conversation)}
                            title="Rename conversation"
                            aria-label={`Rename ${conversation.title}`}
                            className="rounded-md p-1.5 text-ink-faint transition hover:bg-elevated hover:text-ink"
                          >
                            <Pencil size={12.5} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDelete(conversation.id)}
                            title="Delete conversation"
                            aria-label={`Delete ${conversation.title}`}
                            className="rounded-md p-1.5 text-ink-faint transition hover:bg-bad/15 hover:text-bad"
                          >
                            <Trash2 size={12.5} aria-hidden="true" />
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        {/* Footer */}
        <div className="border-t border-line p-3">
          <div className="mb-2 flex items-center gap-2 rounded-lg px-1 py-1">
            <span
              className={`size-1.5 shrink-0 rounded-full ${
                STATUS_TONE[backendStatus] || STATUS_TONE.unknown
              }`}
              aria-hidden="true"
            />
            <span
              className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-faint"
              title={apiBaseUrl}
            >
              {apiBaseUrl}
            </span>
          </div>
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-[13px] text-ink-dim transition hover:bg-hover hover:text-ink"
          >
            <Settings size={15} aria-hidden="true" />
            Settings
          </button>
        </div>
      </aside>
    </>
  );
}

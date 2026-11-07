import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchDiagnostics } from './api/client.js';
import { ApiInfoPanel } from './components/ApiInfoPanel.jsx';
import { ChatHeader } from './components/ChatHeader.jsx';
import { Composer } from './components/Composer.jsx';
import { EmptyState } from './components/EmptyState.jsx';
import { InspectorDrawer } from './components/InspectorDrawer.jsx';
import { MessageList } from './components/MessageList.jsx';
import { SettingsPanel } from './components/SettingsPanel.jsx';
import { Sidebar } from './components/Sidebar.jsx';
import { ToastHost } from './components/ToastHost.jsx';
import { useAppSettings } from './hooks/useAppSettings.js';
import { useChat } from './hooks/useChat.js';
import { useConnection } from './hooks/useConnection.js';
import { useConversations } from './hooks/useConversations.js';

let toastId = 0;

export default function App() {
  const {
    settings,
    update: updateSettings,
    apiKey,
    updateApiKey,
    baseUrl,
    model,
    streaming,
  } = useAppSettings();

  const {
    conversations,
    activeId,
    activeConversation,
    setActiveId,
    newConversation,
    appendMessage,
    updateMessage,
    removeMessage,
    clearConversation,
    renameConversation,
    deleteConversation,
  } = useConversations();

  const connection = useConnection({ baseUrl });
  const { isLoading, send, retry, cancel } = useChat({
    activeId,
    appendMessage,
    updateMessage,
    removeMessage,
    baseUrl,
    model,
  });

  const [toasts, setToasts] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState(null);

  const messages = activeConversation?.messages ?? [];

  /* ---------------------------------------------------------------- */
  /* Toasts                                                            */
  /* ---------------------------------------------------------------- */
  const dismissToast = useCallback((id) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback(
    (message, tone = 'info', duration = 4200) => {
      toastId += 1;
      const id = toastId;
      setToasts((previous) => [...previous, { id, message, tone }]);
      if (duration > 0) {
        setTimeout(() => dismissToast(id), duration);
      }
      return id;
    },
    [dismissToast],
  );

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */
  const history = useMemo(
    () =>
      messages
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .filter((message) => message.status !== 'error' && message.status !== 'cancelled')
        .map((message) => ({ role: message.role, content: message.content })),
    [messages],
  );

  const handleSend = useCallback(
    async (text) => {
      const result = await send(text, { history, apiKey, stream: streaming });
      if (result?.error) {
        pushToast(result.error.message || 'The request failed.', 'error', 6000);
      }
    },
    [apiKey, history, pushToast, send, streaming],
  );

  const handleRetry = useCallback(async () => {
    const result = await retry(messages, { apiKey, stream: streaming });
    if (result?.error) {
      pushToast(result.error.message || 'The retry failed.', 'error', 6000);
    }
  }, [apiKey, messages, pushToast, retry, streaming]);

  const handleCopy = useCallback(
    async (text) => {
      try {
        await navigator.clipboard.writeText(text);
        pushToast('Copied to the clipboard.', 'success', 2000);
      } catch {
        pushToast('The clipboard is not available in this browser.', 'error');
      }
    },
    [pushToast],
  );

  const handleNewChat = useCallback(() => {
    newConversation();
    setSidebarOpen(false);
  }, [newConversation]);

  const handleClearChat = useCallback(() => {
    if (!activeId) return;
    clearConversation(activeId);
    pushToast('Conversation cleared.', 'info', 2200);
  }, [activeId, clearConversation, pushToast]);

  const handleSelectConversation = useCallback(
    (id) => {
      setActiveId(id);
      setSidebarOpen(false);
    },
    [setActiveId],
  );

  const handleDeleteConversation = useCallback(
    (id) => {
      deleteConversation(id);
      pushToast('Conversation deleted.', 'info', 2200);
    },
    [deleteConversation, pushToast],
  );

  const handleRenameConversation = useCallback(
    (id, title) => {
      renameConversation(id, title);
    },
    [renameConversation],
  );

  const handleRunDiagnostics = useCallback(async () => {
    try {
      const result = await fetchDiagnostics({ baseUrl });
      const payload = result?.diagnostics ?? result;
      setDiagnostics(
        typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
      );
    } catch (error) {
      setDiagnostics(`Could not run the diagnostics: ${error.message}`);
    }
  }, [baseUrl]);

  const handleSaveSettings = useCallback(() => {
    pushToast('Settings saved.', 'success', 2200);
    setSettingsOpen(false);
  }, [pushToast]);

  /* ---------------------------------------------------------------- */
  /* Derived state                                                     */
  /* ---------------------------------------------------------------- */
  const lastMeta = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'assistant' && messages[index].meta) {
        return messages[index].meta;
      }
    }
    return null;
  }, [messages]);

  const composerHint = useMemo(() => {
    if (connection.backend !== 'connected') {
      return `The backend at ${baseUrl} is not reachable. Start it with "uvicorn app.main:app --port 8000".`;
    }
    if (connection.extension !== 'connected') {
      return 'The Chrome extension is not connected. Open its popup and press Reconnect.';
    }
    if (connection.tab !== 'connected') {
      return 'No usable Google AI Mode tab is open. Open https://www.google.com/search?udm=50 and keep it open.';
    }
    if (connection.login !== 'connected') {
      return 'The Google AI Mode tab is not signed in. Sign in to Google in that tab.';
    }
    return null;
  }, [baseUrl, connection]);

  const isReady = connection.backend === 'connected';

  /* ---------------------------------------------------------------- */
  /* Keyboard shortcuts                                                */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const handler = (event) => {
      const target = event.target;
      const typing =
        target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.querySelector('textarea[aria-label="Prompt"]')?.focus();
        return;
      }
      if (!typing && event.key === '/' && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        document.querySelector('textarea[aria-label="Prompt"]')?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas text-ink">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={handleSelectConversation}
        onNewChat={handleNewChat}
        onDelete={handleDeleteConversation}
        onRename={handleRenameConversation}
        onOpenSettings={() => setSettingsOpen(true)}
        apiBaseUrl={baseUrl}
        backendStatus={connection.backend}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={settings.sidebarCollapsed}
        onToggleCollapse={() => updateSettings({ sidebarCollapsed: !settings.sidebarCollapsed })}
      />

      <main className="flex min-w-0 flex-1 flex-col bg-chat">
        <ChatHeader
          title={activeConversation?.title || 'New chat'}
          status={connection}
          onOpenSidebar={() => setSidebarOpen(true)}
          onToggleInspector={() => setInspectorOpen((open) => !open)}
          onOpenSettings={() => setSettingsOpen(true)}
          onClearChat={handleClearChat}
          canClear={messages.length > 0}
          inspectorOpen={inspectorOpen}
        />

        {messages.length === 0 ? (
          <EmptyState
            onExample={(example) => handleSend(example)}
            disabled={isLoading || !isReady}
          />
        ) : (
          <MessageList
            messages={messages}
            isLoading={isLoading}
            onRetry={handleRetry}
            onCopy={handleCopy}
          />
        )}

        <Composer
          onSend={handleSend}
          onCancel={cancel}
          isLoading={isLoading}
          disabled={false}
          disabledHint={composerHint}
        />
      </main>

      <InspectorDrawer open={inspectorOpen} onClose={() => setInspectorOpen(false)}>
        <ApiInfoPanel
          meta={lastMeta}
          model={model}
          baseUrl={baseUrl}
          onCopy={handleCopy}
          onToast={pushToast}
        />
      </InspectorDrawer>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        baseUrl={settings.baseUrl}
        onBaseUrlChange={(value) => updateSettings({ baseUrl: value })}
        model={settings.model}
        onModelChange={(value) => updateSettings({ model: value })}
        apiKey={apiKey}
        onApiKeyChange={updateApiKey}
        streaming={streaming}
        onStreamingChange={(value) => updateSettings({ streaming: value })}
        diagnostics={diagnostics}
        onRunDiagnostics={handleRunDiagnostics}
        onSave={handleSaveSettings}
      />

      <ToastHost toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

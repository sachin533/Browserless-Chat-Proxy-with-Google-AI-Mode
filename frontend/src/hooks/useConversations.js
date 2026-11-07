import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'gaim.conversations';

let idCounter = 0;
export function createId(prefix = 'id') {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}

/** Build a short, human readable title from the first user message. */
export function deriveTitle(text) {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'New conversation';
  return clean.length > 48 ? `${clean.slice(0, 48)}…` : clean;
}

function loadStored() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((item) => item && Array.isArray(item.messages));
  } catch {
    return null;
  }
}

function persist(conversations) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  } catch {
    /* storage may be full or unavailable - the app still works */
  }
}

/**
 * Conversation history with localStorage persistence.
 *
 * Every conversation holds a list of messages:
 * `{ id, role, content, status, error, meta, createdAt }`
 */
export function useConversations() {
  const stored = loadStored();
  const [conversations, setConversations] = useState(() => {
    if (stored && stored.length > 0) return stored;
    const first = {
      id: createId('conv'),
      title: 'New conversation',
      createdAt: Date.now(),
      messages: [],
    };
    return [first];
  });
  const [activeId, setActiveId] = useState(() => {
    if (stored && stored.length > 0) return stored[0].id;
    return null;
  });

  useEffect(() => {
    if (!activeId && conversations.length > 0) {
      setActiveId(conversations[0].id);
    }
  }, [activeId, conversations]);

  useEffect(() => {
    persist(conversations);
  }, [conversations]);

  const activeConversation =
    conversations.find((conversation) => conversation.id === activeId) || conversations[0];

  const newConversation = useCallback(() => {
    const conversation = {
      id: createId('conv'),
      title: 'New conversation',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };
    setConversations((previous) => [conversation, ...previous]);
    setActiveId(conversation.id);
    return conversation.id;
  }, []);

  const appendMessage = useCallback((conversationId, message) => {
    setConversations((previous) =>
      previous.map((conversation) => {
        if (conversation.id !== conversationId) return conversation;
        const messages = [...conversation.messages, message];
        const title =
          conversation.title === 'New conversation' && message.role === 'user'
            ? deriveTitle(message.content)
            : conversation.title;
        return { ...conversation, title, messages, updatedAt: Date.now() };
      }),
    );
  }, []);

  const updateMessage = useCallback((conversationId, messageId, patch) => {
    setConversations((previous) =>
      previous.map((conversation) => {
        if (conversation.id !== conversationId) return conversation;
        return {
          ...conversation,
          updatedAt: Date.now(),
          messages: conversation.messages.map((message) =>
            message.id === messageId ? { ...message, ...patch } : message,
          ),
        };
      }),
    );
  }, []);

  const removeMessage = useCallback((conversationId, messageId) => {
    setConversations((previous) =>
      previous.map((conversation) => {
        if (conversation.id !== conversationId) return conversation;
        return {
          ...conversation,
          messages: conversation.messages.filter((message) => message.id !== messageId),
        };
      }),
    );
  }, []);

  const clearConversation = useCallback((conversationId) => {
    setConversations((previous) =>
      previous.map((conversation) =>
        conversation.id === conversationId
          ? { ...conversation, title: 'New conversation', messages: [], updatedAt: Date.now() }
          : conversation,
      ),
    );
  }, []);

  const renameConversation = useCallback((conversationId, title) => {
    const clean = (title || '').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    setConversations((previous) =>
      previous.map((conversation) =>
        conversation.id === conversationId
          ? { ...conversation, title: clean, updatedAt: Date.now() }
          : conversation,
      ),
    );
  }, []);

  const deleteConversation = useCallback((conversationId) => {
    setConversations((previous) => {
      const remaining = previous.filter((conversation) => conversation.id !== conversationId);
      return remaining.length > 0
        ? remaining
        : [
            {
              id: createId('conv'),
              title: 'New conversation',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              messages: [],
            },
          ];
    });
    setActiveId((current) => (current === conversationId ? null : current));
  }, []);

  return {
    conversations,
    activeId: activeConversation?.id ?? null,
    activeConversation,
    setActiveId,
    newConversation,
    appendMessage,
    updateMessage,
    removeMessage,
    clearConversation,
    renameConversation,
    deleteConversation,
  };
}

import { useCallback, useRef, useState } from 'react';
import {
  MODEL,
  STREAMING_ENABLED,
  sendChatCompletion,
  sendChatCompletionStream,
} from '../api/client.js';
import { createId } from './useConversations.js';

/**
 * Sends prompts to the backend and keeps the conversation in sync.
 *
 * A single request may be in flight at a time - the browser tab can only
 * handle one prompt, so the UI must not queue requests either.  A ref guard
 * prevents a double click from starting two requests before React has
 * re-rendered.
 */
export function useChat({
  activeId,
  appendMessage,
  updateMessage,
  removeMessage,
  baseUrl,
  model: defaultModel,
}) {
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef(null);
  const inFlightRef = useRef(false);

  const send = useCallback(
    async (prompt, options = {}) => {
      const text = (prompt || '').trim();
      if (!text || !activeId) return null;
      if (inFlightRef.current) return null;

      inFlightRef.current = true;
      setIsLoading(true);

      const userMessage = {
        id: createId('msg'),
        role: 'user',
        content: text,
        status: 'sent',
        createdAt: Date.now(),
      };
      appendMessage(activeId, userMessage);

      const assistantId = createId('msg');
      appendMessage(activeId, {
        id: assistantId,
        role: 'assistant',
        content: '',
        status: 'pending',
        createdAt: Date.now(),
        meta: null,
        error: null,
      });

      const controller = new AbortController();
      abortRef.current = controller;

      const history = [...(options.history || []), { role: 'user', content: text }];
      const useStreaming = options.stream ?? STREAMING_ENABLED;

      try {
        const result = useStreaming
          ? await sendChatCompletionStream({
              messages: history,
              model: options.model || defaultModel || MODEL,
              apiKey: options.apiKey,
              signal: controller.signal,
              baseUrl: options.baseUrl || baseUrl,
              onDelta: (_delta, accumulated) => {
                updateMessage(activeId, assistantId, { content: accumulated });
              },
            })
          : await sendChatCompletion({
              messages: history,
              model: options.model || defaultModel || MODEL,
              apiKey: options.apiKey,
              signal: controller.signal,
              baseUrl: options.baseUrl || baseUrl,
            });

        updateMessage(activeId, assistantId, {
          content: result.content ?? '',
          status: 'done',
          meta: result.meta,
          error: null,
        });
        return result;
      } catch (error) {
        const aborted = error?.name === 'AbortError';
        updateMessage(activeId, assistantId, {
          status: aborted ? 'cancelled' : 'error',
          error: aborted
            ? 'The request was cancelled.'
            : {
                message: error?.message || 'The request failed.',
                code: error?.code || 'unknown_error',
                type: error?.type || 'api_error',
                status: error?.status || 0,
              },
        });
        if (!aborted) {
          return { error };
        }
        return null;
      } finally {
        abortRef.current = null;
        inFlightRef.current = false;
        setIsLoading(false);
      }
    },
    [activeId, appendMessage, baseUrl, defaultModel, updateMessage],
  );

  /**
   * Re-run the last prompt of a conversation.
   *
   * The failed exchange (user message + failed assistant message) is removed
   * first so the retry replaces it instead of duplicating it in the
   * transcript.
   */
  const retry = useCallback(
    async (messages = [], options = {}) => {
      if (inFlightRef.current || !activeId) return null;

      const lastUser = [...messages].reverse().find((message) => message.role === 'user');
      if (!lastUser) return null;

      const failedAssistant = [...messages]
        .reverse()
        .find((message) => message.role === 'assistant' && message.status === 'error');
      if (failedAssistant) {
        removeMessage(activeId, failedAssistant.id);
      }
      // Drop the original prompt - `send` adds it again.
      removeMessage(activeId, lastUser.id);

      const userIndex = messages.findIndex((message) => message.id === lastUser.id);
      const history = messages
        .slice(0, userIndex)
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .filter((message) => message.status !== 'error' && message.status !== 'cancelled')
        .map((message) => ({ role: message.role, content: message.content }));

      return send(lastUser.content, { ...options, history });
    },
    [activeId, removeMessage, send],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { isLoading, send, retry, cancel };
}

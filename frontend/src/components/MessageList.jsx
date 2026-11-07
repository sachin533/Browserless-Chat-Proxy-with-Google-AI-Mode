import { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble.jsx';

/**
 * The scrolling conversation area.
 *
 * The reading column is capped at 850 px and centred.  Auto-scroll keeps the
 * newest message in view but never fights the user who scrolled up.
 */
export function MessageList({ messages, isLoading, onRetry, onCopy }) {
  const containerRef = useRef(null);
  const bottomRef = useRef(null);
  const pinnedRef = useRef(true);

  const handleScroll = () => {
    const element = containerRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    pinnedRef.current = distance < 140;
  };

  useEffect(() => {
    if (pinnedRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages, isLoading]);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6"
    >
      <div className="mx-auto flex max-w-[850px] flex-col gap-6">
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            onRetry={message.status === 'error' ? onRetry : undefined}
            onCopy={onCopy}
          />
        ))}
        <div ref={bottomRef} className="h-px" />
      </div>
    </div>
  );
}

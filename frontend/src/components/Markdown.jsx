/**
 * A tiny, dependency free Markdown renderer.
 *
 * It is deliberately limited to what an AI answer needs - headings, lists,
 * code blocks, inline code, bold/italic, links and quotes.  Everything is
 * rendered as React elements (never `dangerouslySetInnerHTML`), so untrusted
 * answer text cannot inject markup.
 */

const INLINE_PATTERN =
  /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\))/g;

const LIST_ITEM_PATTERN = /^\s*(?:[-*+]|\d+[.)])\s+/;
const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;
const FENCE_PATTERN = /^\s*```(\w*)\s*$/;
const QUOTE_PATTERN = /^\s*>\s?/;
const RULE_PATTERN = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;

function isBlockStart(line) {
  return (
    LIST_ITEM_PATTERN.test(line) ||
    HEADING_PATTERN.test(line) ||
    FENCE_PATTERN.test(line) ||
    QUOTE_PATTERN.test(line) ||
    RULE_PATTERN.test(line)
  );
}

/** Render the inline markers of a single line. */
function renderInline(text, keyBase) {
  const nodes = [];
  let lastIndex = 0;
  let match;
  INLINE_PATTERN.lastIndex = 0;

  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${keyBase}-${match.index}`;

    if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(
        <strong key={key} className="font-semibold text-ink">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('`')) {
      nodes.push(
        <code
          key={key}
          className="rounded-md border border-line bg-elevated px-1.5 py-0.5 font-mono text-[0.86em] text-accent-soft"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('[')) {
      const link = /\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(token);
      nodes.push(
        <a
          key={key}
          href={link[2]}
          target="_blank"
          rel="noreferrer noopener"
          className="text-accent-soft underline decoration-accent/40 underline-offset-2 transition hover:decoration-accent"
        >
          {link[1]}
        </a>,
      );
    } else {
      nodes.push(
        <em key={key} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

/** Split a markdown document into block descriptors. */
function parseBlocks(text) {
  const lines = String(text || '').split('\n');
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    const fence = FENCE_PATTERN.exec(line);
    if (fence) {
      const language = fence[1] || '';
      const code = [];
      index += 1;
      while (index < lines.length && !FENCE_PATTERN.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1; // consume the closing fence
      blocks.push({ type: 'code', language, code: code.join('\n') });
      continue;
    }

    const heading = HEADING_PATTERN.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      index += 1;
      continue;
    }

    if (RULE_PATTERN.test(line)) {
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }

    if (QUOTE_PATTERN.test(line)) {
      const quote = [];
      while (index < lines.length && QUOTE_PATTERN.test(lines[index])) {
        quote.push(lines[index].replace(QUOTE_PATTERN, ''));
        index += 1;
      }
      blocks.push({ type: 'quote', text: quote.join('\n') });
      continue;
    }

    if (LIST_ITEM_PATTERN.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items = [];
      while (index < lines.length && LIST_ITEM_PATTERN.test(lines[index])) {
        let item = lines[index].replace(LIST_ITEM_PATTERN, '');
        index += 1;
        while (
          index < lines.length &&
          lines[index].trim() &&
          !isBlockStart(lines[index])
        ) {
          item += ` ${lines[index].trim()}`;
          index += 1;
        }
        items.push(item);
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const paragraph = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !isBlockStart(lines[index])
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
  }

  return blocks;
}

const HEADING_CLASS = {
  h2: 'text-xl font-semibold tracking-tight text-ink mt-7 mb-2.5 first:mt-0',
  h3: 'text-lg font-semibold tracking-tight text-ink mt-6 mb-2 first:mt-0',
  h4: 'text-[15px] font-semibold text-ink mt-5 mb-1.5 first:mt-0',
  h5: 'text-sm font-semibold text-ink mt-4 mb-1 first:mt-0',
  h6: 'text-sm font-medium text-ink-dim mt-4 mb-1 first:mt-0',
};

/**
 * Render an answer as formatted Markdown.
 */
export function Markdown({ text }) {
  const blocks = parseBlocks(text);

  return (
    <div className="space-y-3">
      {blocks.map((block, index) => {
        const key = `block-${index}`;

        if (block.type === 'code') {
          return (
            <div
              key={key}
              className="overflow-hidden rounded-xl border border-line bg-canvas"
            >
              {block.language && (
                <div className="border-b border-line px-3.5 py-1.5 font-mono text-[10.5px] uppercase tracking-wider text-ink-faint">
                  {block.language}
                </div>
              )}
              <pre className="scrollbar-slim overflow-x-auto px-3.5 py-3 font-mono text-[12.5px] leading-relaxed text-ink-dim">
                <code>{block.code}</code>
              </pre>
            </div>
          );
        }

        if (block.type === 'heading') {
          const Tag = `h${Math.min(block.level + 1, 6)}`;
          return (
            <Tag key={key} className={HEADING_CLASS[Tag] || HEADING_CLASS.h4}>
              {renderInline(block.text, key)}
            </Tag>
          );
        }

        if (block.type === 'rule') {
          return <hr key={key} className="my-5 border-line" />;
        }

        if (block.type === 'quote') {
          return (
            <blockquote
              key={key}
              className="border-l-2 border-accent/50 pl-4 text-ink-dim italic"
            >
              {renderInline(block.text, key)}
            </blockquote>
          );
        }

        if (block.type === 'list') {
          const Tag = block.ordered ? 'ol' : 'ul';
          return (
            <Tag
              key={key}
              className={`ml-1 space-y-1.5 ${
                block.ordered ? 'list-decimal' : 'list-disc'
              } marker:text-ink-faint`}
            >
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`} className="pl-1 leading-relaxed">
                  {renderInline(item, `${key}-${itemIndex}`)}
                </li>
              ))}
            </Tag>
          );
        }

        return (
          <p key={key} className="whitespace-pre-wrap leading-relaxed">
            {renderInline(block.text, key)}
          </p>
        );
      })}
    </div>
  );
}

export default Markdown;

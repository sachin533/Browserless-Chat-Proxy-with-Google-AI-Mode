import { BookOpen, Code2, Compass, Sparkles } from 'lucide-react';

const EXAMPLES = [
  {
    icon: Code2,
    title: 'Explain Java concepts.',
    description: 'Classes, objects, inheritance and polymorphism in plain English.',
    prompt:
      'Explain Java OOP concepts (classes, objects, inheritance, polymorphism) in simple terms.',
  },
  {
    icon: Sparkles,
    title: 'Write and debug code.',
    description: 'Get a working snippet and learn how to debug it.',
    prompt:
      'Write a Python function that reverses a string, then explain how I would debug it.',
  },
  {
    icon: Compass,
    title: 'Research a technical topic.',
    description: 'Compare two approaches and weigh the trade-offs.',
    prompt:
      'Research the trade-offs between REST and GraphQL for a small public read-heavy API.',
  },
  {
    icon: BookOpen,
    title: 'Explain complex concepts simply.',
    description: 'Dense topics broken down into something readable.',
    prompt:
      'Explain how a TCP connection is established, in simple terms a beginner would follow.',
  },
];

/**
 * The welcome screen shown for an empty conversation.
 */
export function EmptyState({ onExample, disabled }) {
  return (
    <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-4 py-8 sm:px-6">
      <div className="mx-auto flex max-w-[850px] flex-col items-center pt-6 text-center sm:pt-12">
        <span className="grid size-12 place-items-center rounded-2xl bg-accent/10 ring-1 ring-accent/20">
          <Sparkles size={22} className="text-accent-soft" aria-hidden="true" />
        </span>

        <h2 className="mt-6 text-[26px] font-semibold tracking-tight text-ink sm:text-[30px]">
          What can I help you explore?
        </h2>
        <p className="mt-2.5 max-w-md text-[14.5px] leading-relaxed text-ink-dim">
          Ask anything and get answers powered by Google AI Mode.
        </p>

        <div className="mt-10 grid w-full gap-3 sm:grid-cols-2">
          {EXAMPLES.map((example) => {
            const Icon = example.icon;
            return (
              <button
                key={example.title}
                type="button"
                onClick={() => onExample(example.prompt)}
                disabled={disabled}
                className="group flex items-start gap-3 rounded-2xl border border-line bg-surface p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
              >
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-accent/10 ring-1 ring-accent/20 transition group-hover:bg-accent/15">
                  <Icon size={15} className="text-accent-soft" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-medium text-ink">
                    {example.title}
                  </span>
                  <span className="mt-1 block text-[12.5px] leading-relaxed text-ink-faint">
                    {example.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

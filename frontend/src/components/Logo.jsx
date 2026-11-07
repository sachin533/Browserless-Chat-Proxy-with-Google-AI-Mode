/**
 * The Google AI Mode mark.
 *
 * Drawn inline so it scales crisply and inherits the accent colours without
 * shipping a binary asset.
 */
export function Logo({ size = 28, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="gaim-logo-gradient" x1="0" y1="0" x2="32" y2="32">
          <stop stopColor="#6366F1" />
          <stop offset="1" stopColor="#8B5CF6" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#gaim-logo-gradient)" />
      <path
        d="M16 7.5c.55 3.1 1.9 4.45 5 5-3.1.55-4.45 1.9-5 5-.55-3.1-1.9-4.45-5-5 3.1-.55 4.45-1.9 5-5Z"
        fill="white"
        fillOpacity="0.95"
      />
      <path
        d="M22.6 18.2c.32 1.8 1.1 2.58 2.9 2.9-1.8.32-2.58 1.1-2.9 2.9-.32-1.8-1.1-2.58-2.9-2.9 1.8-.32 2.58-1.1 2.9-2.9Z"
        fill="white"
        fillOpacity="0.7"
      />
    </svg>
  );
}

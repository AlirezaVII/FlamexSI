/**
 * Falmex mark — "Freefall": a flame's Earth shape (buoyancy stretches it into a teardrop)
 * with the sphere it becomes in microgravity carved into its core. Uses currentColor.
 * Source files: brand/logo/.
 */
export function LogoMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 256 256" aria-hidden className={className}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M128.00 12.00 C134.20 72.80 190.00 72.80 190.00 172.00 A62 62 0 0 1 66.00 172.00 C66.00 72.80 121.80 72.80 128.00 12.00 Z M101.00 170.00 a27 27 0 1 0 54.00 0 a27 27 0 1 0 -54.00 0 Z"
      />
    </svg>
  );
}

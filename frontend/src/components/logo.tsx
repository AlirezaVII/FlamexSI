import Image from "next/image";

/**
 * The FlamexSI logo (raster artwork, see brand/logo/). Two cut-outs of the same artwork:
 * - "glow":  transparent background, soft glows kept — for dark surfaces
 * - "badge": the artwork on its own navy disc
 * - "light": the artwork re-inked on a pale disc (blue linework, same flame) — light surfaces
 * `variant="auto"` follows the app theme (light/dark, incl. the system setting) in CSS,
 * so the right one is visible from the first paint.
 * The artwork is AI-generated, so every logo carries a visible "AI" mark (NASA Space Apps
 * rules: AI-generated images must show a visible watermark).
 */
export function BrandLogo({
  size = 28,
  variant = "auto",
  className = "",
}: {
  size?: number;
  variant?: "auto" | "glow" | "badge" | "light";
  className?: string;
}) {
  const src = (v: "glow" | "badge" | "light") =>
    `/brand/falmex-logo-${v}-${size > 64 ? 256 : 128}.png`;
  const img = (v: "glow" | "badge" | "light", extra = "") => (
    <Image
      src={src(v)}
      alt="FlamexSI logo (AI-generated)"
      width={size}
      height={size}
      unoptimized
      priority
      className={`${extra} ${className}`}
      style={{ width: size, height: size }}
    />
  );
  return (
    <span className="ai-logo" title="AI-generated logo" style={{ width: size, height: size }}>
      {variant !== "auto" ? img(variant) : (
        <>
          {img("light", "logo-on-light")}
          {img("glow", "logo-on-dark")}
        </>
      )}
      <span className="ai-mark" aria-hidden>AI</span>
    </span>
  );
}

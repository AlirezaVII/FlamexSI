import { ViewTransition } from "react";

/**
 * A template re-mounts on every navigation, so the page content enters and exits here.
 * The animation depends on the direction along the pipeline (set by PipelineLink) and on
 * the screen: depth on wide screens, a push on phones (see globals.css).
 */
const BY_TYPE = {
  "nav-forward": "nav-forward",
  "nav-back": "nav-back",
  "nav-lateral": "nav-lateral",
  default: "none",
};

export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter={BY_TYPE} exit={BY_TYPE} default="none">
      {/* opaque and isolated: a moving screen must not show the one behind it, and the
          overview's fixed space photo stays between this background and the content */}
      <div className="isolate w-full flex-1 bg-bg">
        <div className="mx-auto w-full max-w-6xl px-4 py-8">{children}</div>
      </div>
    </ViewTransition>
  );
}

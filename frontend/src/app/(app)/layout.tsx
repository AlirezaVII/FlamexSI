import { Nav } from "@/components/nav";
import { SmoothScroll } from "@/components/smooth-scroll";

/** The app shell: pipeline sidebar (desktop) or pipeline tab bar (mobile), then the page. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell flex min-h-screen flex-col pb-28 lg:pb-0">
      <SmoothScroll />
      <Nav />
      <main className="flex w-full flex-1 flex-col">
        {children}
      </main>
      <footer className="border-t border-line px-4 py-4 text-center text-xs text-muted">
        Falmex · NASA Space Apps 2026 · Findings are statistical associations
        and require expert review.
      </footer>
    </div>
  );
}

import { Nav } from "@/components/nav";

/** The app: explore, compare, discover, findings, insights, data. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col pb-16 md:pb-0">
      <Nav />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {children}
      </main>
      <footer className="border-t border-line px-4 py-4 text-center text-xs text-muted">
        Falmex · NASA Space Apps 2026 · Findings are statistical associations
        and require expert review.
      </footer>
    </div>
  );
}

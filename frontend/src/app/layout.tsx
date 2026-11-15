import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Nav } from "@/components/nav";
import { themeInitScript } from "@/components/theme-toggle";
import { WorkspaceProvider } from "@/lib/workspace";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Falmex — Microgravity Combustion Insights",
  description:
    "Explore, compare and validate findings from NASA microgravity combustion experiments.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="flex min-h-full flex-col pb-16 md:pb-0">
        <WorkspaceProvider>
          <Nav />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
            {children}
          </main>
          <footer className="border-t border-line px-4 py-4 text-center text-xs text-muted">
            Falmex · NASA Space Apps 2026 · Findings are statistical
            associations and require expert review.
          </footer>
        </WorkspaceProvider>
      </body>
    </html>
  );
}

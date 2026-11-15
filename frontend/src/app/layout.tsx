import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import { ProgressBar } from "@/components/progress-bar";
import { Splash } from "@/components/splash";
import { splashInitScript, themeInitScript } from "@/lib/boot-scripts";
import { WorkspaceProvider } from "@/lib/workspace";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Display face for titles. The file lives in the repo (src/fonts, OFL licence) and is
// served from our own server — no request to any font CDN.
const ebGaramond = localFont({
  src: "../fonts/eb-garamond-500-latin.woff2",
  weight: "500",
  style: "normal",
  variable: "--font-eb-garamond",
  display: "swap",
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
      className={`${geistSans.variable} ${geistMono.variable} ${ebGaramond.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: themeInitScript + splashInitScript,
          }}
        />
      </head>
      <body className="min-h-full">
        <WorkspaceProvider>
          <Splash />
          <ProgressBar />
          {children}
        </WorkspaceProvider>
      </body>
    </html>
  );
}

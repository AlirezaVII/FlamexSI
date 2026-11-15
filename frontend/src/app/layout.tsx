import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import { ProgressBar } from "@/components/progress-bar";
import { PwaRegistration } from "@/components/pwa-registration";
import { Splash } from "@/components/splash";
import {
  sidebarInitScript,
  splashInitScript,
  themeInitScript,
} from "@/lib/boot-scripts";
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
  title: "FlamexSI — Microgravity Combustion Findings",
  description:
    "Explore, compare and validate findings from NASA microgravity combustion experiments.",
  applicationName: "FlamexSI",
  // NASA Space Apps rules: AI use is stated in text and metadata
  other: {
    "ai-disclosure":
      "Logo artwork is AI-generated (marked AI). Ask FlamexSI answers with Google Gemini from FlamexSI's verified results. Parts of the code and documentation were written with an AI coding assistant, directed and reviewed by Team NovaForge. All data is NASA PSI flight data; no data is AI-generated.",
  },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/falmex-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/falmex-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/falmex-apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "FlamexSI",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#12141f" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${ebGaramond.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: themeInitScript + splashInitScript + sidebarInitScript,
          }}
        />
      </head>
      <body className="min-h-full">
        <WorkspaceProvider>
          <Splash />
          <ProgressBar />
          <PwaRegistration />
          {children}
        </WorkspaceProvider>
      </body>
    </html>
  );
}

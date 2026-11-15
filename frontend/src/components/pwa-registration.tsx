"use client";

import { useEffect } from "react";

/** Register the installable app shell without caching navigations or scientific API data. */
export function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Installation remains optional; the online application stays fully functional.
    });
  }, []);

  return null;
}

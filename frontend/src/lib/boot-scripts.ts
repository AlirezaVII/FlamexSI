// Tiny scripts inlined into <head> so they run before first paint.
// Kept out of "use client" modules: exports from those become client references on the
// server and would not be plain strings here.

export const THEME_KEY = "falmex.theme";
export const SIDEBAR_KEY = "falmex.sidebar";

/** Apply the saved light/dark choice before paint, so the page never flashes. */
export const themeInitScript = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;}catch(e){}})();`;

/**
 * Show the loading screen only on a real page load: a reload, or arriving from outside
 * the site. A document load caused by moving around inside FlamexSI (Next.js falls back to
 * a full navigation e.g. right after a new deploy) or by back/forward skips it.
 */
export const splashInitScript = `(function(){try{var n=performance.getEntriesByType("navigation")[0];var t=n?n.type:"navigate";var r=document.referrer;var inside=false;try{inside=!!r&&new URL(r).origin===location.origin;}catch(e){}if(t==="back_forward"||(t==="navigate"&&inside))document.documentElement.dataset.splash="gone";}catch(e){}})();`;

/** Restore a collapsed desktop sidebar before paint, so the layout never jumps. */
export const sidebarInitScript = `(function(){try{if(localStorage.getItem("${SIDEBAR_KEY}")==="collapsed")document.documentElement.dataset.sidebar="collapsed";}catch(e){}})();`;

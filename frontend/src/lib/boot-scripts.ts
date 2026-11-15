// Tiny scripts inlined into <head> so they run before first paint.
// Kept out of "use client" modules: exports from those become client references on the
// server and would not be plain strings here.

export const THEME_KEY = "falmex.theme";

/** Apply the saved light/dark choice before paint, so the page never flashes. */
export const themeInitScript = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;}catch(e){}})();`;

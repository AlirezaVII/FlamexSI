# FlamexSI

## Deploy rule: every commit also updates Vercel

There are two deployments, and both must show the same commit:

1. **Droplet (backend + full app):** pushing to `main` runs CI and deploys automatically
   (`.github/workflows/ci.yml` → `deploy/deploy.sh`). Live at http://129.212.254.115:3000.
2. **Vercel (frontend):** https://flamexsi.vercel.app. It is **not** connected to git, so a push
   does not update it. After every commit that is pushed to `main`, redeploy it by hand:

   ```bash
   cd frontend
   vercel deploy --prod --yes \
     --build-env FALMEX_BACKEND_URL=http://129.212.254.115:3000 \
     --build-env NEXT_PUBLIC_API_URL=
   ```

   `NEXT_PUBLIC_API_URL` is deliberately empty: the browser then calls `/api/...` on the
   Vercel domain, and Next's rewrites (`next.config.ts`) proxy it to the droplet. The backend
   cannot run on Vercel (it needs DuckDB and persistent files).

   Wait for the push's CI deploy to finish first, so the Vercel frontend never calls a
   backend that does not have its endpoints yet. Then check `https://flamexsi.vercel.app/health`
   and one page.

## Working on the code

- Tests: `cd backend && .venv/bin/ruff check . && .venv/bin/pytest`;
  `cd frontend && npm run lint && npm run typecheck && npm run build`.
- Port 8000 on the dev Mac is taken by Docker; run the local API on another port.

## Rule: full-screen canvases and the landing-page 3D (learned the hard way, 2026-11-12)

The landing planets once "appeared for a moment, then vanished" on every Retina screen.
Cause: the WebGL `<canvas>` was positioned with `position: fixed; inset: 0` but had **no CSS
width/height**. A canvas is a replaced element, so it showed at its pixel size — at
`devicePixelRatio` 2 that is twice the viewport, and Earth was drawn off screen.

- Every canvas that fills a box or the screen gets an explicit `width: 100%; height: 100%`
  (or fixed CSS size). `inset: 0` alone is not enough for a canvas.
- Test visual/WebGL work at **deviceScaleFactor 2 on a real GPU**, not only in default
  headless Chromium (DPR 1, software WebGL). Bugs like this are invisible there.
  Example: launch Brave/Chrome with `--use-angle=metal --enable-gpu --ignore-gpu-blocklist`
  and a page with `deviceScaleFactor: 2`.
- three.js (r163+) needs **WebGL2**. `createSpace()` probes WebGL2 first and falls back to
  the 2D canvas planets (`planets2d.ts`); keep that fallback working.
- Slow links (~2–3 s per request) are normal. Keep the first paint
  independent of JavaScript and textures: the hero carries an inlined pre-rendered Earth
  (`earth-disc.webp` as a data URI) that crossfades into the live globe; tiny `*-lo.webp`
  maps load first and the sharp maps stream in after. Never hide the planets until *all*
  maps have loaded.
- Note: Vercel is now also connected to git; those automatic git deployments show
  "Blocked" (commit authors are not team members on the Hobby plan). The CLI deploy above is
  still what goes live.

## Challenge-data day: checklist (from the 2026-11-12 dry run with NASA PSI-68 / FLEX-2)

- **Getting PSI files:** `https://psi.nasa.gov/geode-py/ws/studies` lists investigations;
  `POST /geode-py/ws/files/v2` with `{"folder":"","fileType":"study","studyId":"PSI-68","version":"1"}`
  lists files; `GET /geode-py/ws/studies/<ID>/download?file=<plain file name>&version=1&redirect=false`
  returns a signed S3 URL. Combustion IDs: PSI-10, 20–26, 39, 68, 69, 98–102, 106–107, 159.
- **Summary tables** (one row per experiment, like the PSI-69 "Experimental table") work
  end to end in seconds: upload → quality → open discovery (PSI-69: 119 tested, 18 validated).
- **Raw instrument logs** (FLEX-2 `*_Chamber_Readings.txt`, radiometer, test-point settings)
  load correctly but are time series of ONE test: every sample is counted as an
  "experiment". Build a per-test summary table first (one row per test point) before
  discovery; never run discovery on raw time series.
- **Units in column names** like `(PSIA)` / `(Deg C)` are stripped, not converted: add
  aliases + units in `backend/falmex/config/variables.yaml`.
- **Upload size:** Vercel caps request bodies at 4.5 MB → upload big files at
  http://129.212.254.115:3000/data. The droplet proxy accepts up to 100 MB.

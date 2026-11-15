# Falmex

## Deploy rule: every commit also updates Vercel

There are two deployments, and both must show the same commit:

1. **Droplet (backend + full app):** pushing to `main` runs CI and deploys automatically
   (`.github/workflows/ci.yml` → `deploy/deploy.sh`). Live at http://129.212.254.115:3000.
2. **Vercel (frontend):** https://falmex.vercel.app. It is **not** connected to git, so a push
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
   backend that does not have its endpoints yet. Then check `https://falmex.vercel.app/health`
   and one page.

## Working on the code

- Tests: `cd backend && .venv/bin/ruff check . && .venv/bin/pytest`;
  `cd frontend && npm run lint && npm run typecheck && npm run build`.
- Port 8000 on the dev Mac is taken by Docker; run the local API on another port.
- `docs/TEAM_GUIDE.fa.md` explains the architecture to the team (in Persian).

# Deploying Falmex

Every push to `main` runs the CI checks. When they all pass, the `deploy` job builds the web app,
bundles it with the backend and ships it to the droplet. Live at **http://129.212.254.115:3000**.

```
push to main ─▶ backend tests ┐
               frontend checks ┴▶ build bundle ─▶ ssh (restricted key) ─▶ deploy.sh ─▶ smoke test
```

## On the droplet

Everything lives in `/home/deploy/falmex`, run as the unprivileged `deploy` user. Nothing outside
that folder is touched (the droplet also runs other services).

| Path | What |
|---|---|
| `web/` | Next.js standalone server, public on port **3000**. It proxies `/api` and `/health` to the backend. |
| `backend/` + `venv/` | FastAPI backend on **127.0.0.1:8010** (not reachable from outside) |
| `data/` | Datasets, raw files, DuckDB. Never touched by deploys. |
| `.env` | `GEMINI_API_KEY` and other settings. Never touched by deploys. |
| `run.sh` | Watchdog: cron runs it every minute and at reboot, and it starts whatever is not running. |
| `deploy.sh` | Receives a bundle, swaps it in, health-checks it, and rolls back automatically on failure. |
| `logs/` | `backend.log`, `web.log` |

**Memory safety:** the droplet has about 1 GB of RAM shared with other services. Both Falmex
processes run with `oom_score_adj=1000` and `nice 10`, so under memory pressure the kernel kills
Falmex first, never the other services. The watchdog brings it back within a minute.

**Why cron and not systemd:** the `deploy` user has no root access and user-level systemd services
do not survive logout without root (`loginctl enable-linger`). The droplet's other bot uses the
same cron watchdog pattern.

## The CI key

GitHub holds `FALMEX_DEPLOY_KEY` (secret), `FALMEX_DEPLOY_KNOWN_HOSTS` (secret, pins the server's
host key) and `FALMEX_DEPLOY_HOST` (variable). On the server, the matching public key in
`~deploy/.ssh/authorized_keys` is locked to one command:

```
restrict,command="/home/deploy/falmex/deploy.sh" ssh-ed25519 … falmex-github-actions
```

So a leaked key can only redeploy Falmex. It gets no shell and no access to anything else.

`deploy.sh` is the forced command, so deploys do **not** update it. After changing
`deploy/deploy.sh`, copy it to the server manually.

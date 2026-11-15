# Falmex

**AI-assisted discovery engine for NASA microgravity combustion data.**
NASA Space Apps Challenge 2026 — *Flame in Freefall: AI-Powered Fire Safety Insights from
Microgravity Combustion Data.*

NASA has run flame experiments in microgravity for decades. The results are hard to find,
compare and understand. Falmex ingests experiment data, finds relationships between
experiment conditions and flame behavior, **checks whether they hold up on data the engine
never saw**, and explains them with every claim traced back to the NASA experiments behind it.

> Status: infrastructure phase. The engine runs end-to-end on **synthetic** data. The analysis
> methods are chosen after the challenge data is released.

## How it works

```
NASA files ─▶ Ingest ─▶ Clean & standardize ─▶ Store ─▶ Query / Explore / Compare
                                                 │
                                                 ▼
                     Discover (train split) ─▶ Validate (holdout + permutation)
                                                 │
                                                 ▼
                           Rank ─▶ AI interpretation (Gemini) ─▶ Dashboard
```

| Layer | Where | Notes |
|---|---|---|
| Ingest | `backend/falmex/ingest/` | CSV, TSV, Excel, JSON, Parquet. Images/video stored as assets. Add a format with one `@register` function. |
| Schema | `backend/falmex/config/variables.yaml` | The only place that knows column names, aliases, units and roles. Adjust this for NASA's data, not the code. |
| Pipeline | `backend/falmex/pipeline.py` | Maps columns, converts units, coerces types, drops empty/duplicate rows. Every step is reported. |
| Storage | `backend/falmex/storage.py` | Raw files stored unchanged (content-addressed), Parquet datasets, DuckDB for metadata and queries. |
| Analysis | `backend/falmex/analysis/` | Pluggable analyzers (`@register_analyzer`). Defaults: rank correlation, group differences. |
| Validation | `backend/falmex/validation.py` | Experiment-level 70/30 split, holdout replication, permutation test, FDR correction. Pluggable. |
| Findings | `backend/falmex/findings.py` | A finding = claim + statistics + validation + evidence (experiment IDs, source files) + rank. |
| AI | `backend/falmex/ai/` | Gemini (default) or `mock`. The AI only explains computed findings and never creates them. |
| API | `backend/falmex/api.py` | FastAPI. Interactive docs at `/docs`. |
| Dashboard | `frontend/` | Next.js: Explore, Compare, Discover, Insights, Data, and a finding detail page. |

### Finding statuses

| Status | Meaning |
|---|---|
| **validated** | Significant after FDR correction, replicated on held-out experiments, and beat random shuffles |
| **candidate** | Significant, but validation was inconclusive (e.g. too little held-out data) |
| **rejected** | Looked significant, but failed validation, so it is likely a chance pattern |
| **not_significant** | No evidence of a relationship |

## Run it

Requirements: Python 3.11+, Node 22+. Copy `.env.example` to `.env` and set `GEMINI_API_KEY`
(or set `FALMEX_LLM_PROVIDER=mock` to run without a key).

```bash
# backend
cd backend
python -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/uvicorn falmex.api:app --reload --port 8000

# frontend (new terminal)
cd frontend
npm install
npm run dev            # http://localhost:3000
```

Or with Docker: `docker compose up --build` (set `FALMEX_API_PORT` if 8000 is taken).

Then open **Data → Generate synthetic experiments → Discover → Run discovery**.

## Tests

```bash
cd backend && .venv/bin/ruff check . && .venv/bin/pytest
cd frontend && npm run lint && npm run typecheck && npm run build
```

The engine tests plant known relationships in synthetic data and check that the engine
**validates the real ones and does not validate pure noise**. CI runs everything on every push
and PR (`.github/workflows/ci.yml`). No API keys are needed in CI.

## When the NASA data arrives

1. Map NASA's columns, units and roles in `variables.yaml`.
2. Add a reader in `ingest/` if the format is new.
3. Pick analyzers and validators that fit the data (add new ones with the decorators).
4. Re-run discovery. The dashboard, evidence, ranking and AI layer work unchanged.

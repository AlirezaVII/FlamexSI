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
NASA files ─▶ stored unchanged ─▶ standardize ─▶ quality checks ─▶ standard + original variables
                                                                            │
     Explore (find & filter) · Compare (what differs) ◀────────────────────┤
                                                                            ▼
  discovery goal (generated from the data) ─▶ statistical analysis on 70% ─▶ FINDINGS
       ─▶ validation on the unseen 30% + random shuffles + bootstrap ─▶ third-variable checks
       ─▶ evidence & limitations ─▶ AI explanation (explains only) ─▶ deep analysis (on demand)
       ─▶ expert review ─▶ INSIGHT (created by a person, never from synthetic data)
```

Each part has one job: **Explore** finds and filters experiments, **Compare** shows what
differs between them, **Discover** finds findings, **validation** checks them on unseen data,
and **Insights** holds only findings a researcher reviewed and interpreted.

| Layer | Where | Notes |
|---|---|---|
| Ingest | `backend/falmex/ingest/` | CSV, TSV, Excel, JSON, Parquet. Images/video stored as assets. Add a format with one `@register` function. |
| Schema | `backend/falmex/config/variables.yaml` | The only place that knows column names, aliases, units and roles. Adjust this for NASA's data, not the code. |
| Pipeline | `backend/falmex/pipeline.py` | Maps columns, converts units, coerces types, drops empty/duplicate rows. Every step is reported. |
| Storage | `backend/falmex/storage.py` | Raw files stored unchanged (content-addressed), Parquet datasets, DuckDB for metadata and queries. |
| Analysis | `backend/falmex/analysis/` | Pluggable analyzers (`@register_analyzer`). Defaults: rank correlation, group differences. |
| Validation | `backend/falmex/validation.py` | Experiment-level 70/30 split, holdout replication, permutation test, FDR correction. Pluggable. |
| Findings | `backend/falmex/findings.py` | A finding = association + statistics + validation + uncertainty + evidence + limitations + checks. Insights are separate and human-made. Ranking is a weighted framework (strength, data, validation, stability on unseen data, not-chance, relevance, independence); weights are neutral by default. |
| Question engine | `backend/falmex/questions.py` | Generates discovery goals from the columns a dataset actually has; nothing is hard-coded to extinction or oxygen. |
| Deep analysis | `backend/falmex/deep.py` | Pluggable probes (`@register_probe`) that generate follow-up questions from a finding and the data: third variables, subgroups, range, independent sources. |
| AI | `backend/falmex/ai/` | Gemini (default) or `mock`. The AI only explains computed findings and never creates them. |
| API | `backend/falmex/api.py` | FastAPI. Interactive docs at `/docs`. |
| Landing page | `frontend/src/app/(landing)/` | `/`: the story page. A scroll journey Earth → orbit → Moon → Mars with real planets rendered from NASA surface maps (`public/textures`, credits there); the hero Earth turns with the cursor and can be dragged. |
| App | `frontend/src/app/(app)/` | `/overview`, Explore, Compare, Discover, Findings, Insights, Data, and a finding detail page. |

### Finding statuses

| Status | Meaning |
|---|---|
| **validated** | Significant after FDR correction, confirmed on held-out experiments, and beat random shuffles. Still an association, not a cause. |
| **candidate** | Significant, but validation was inconclusive (e.g. too little held-out data) |
| **rejected** | An initial signal that failed validation, so it is likely a chance pattern |
| **not_significant** | No supported relationship found by *this analysis on this data*. This does not show there is no effect. |

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

The tests plant known relationships in synthetic data and check that the engine **validates
the real ones, validates nothing in pure noise, and exposes a spurious variable** (one that
only tracks oxygen) through the third-variable check. CI runs everything on every push
and PR (`.github/workflows/ci.yml`). No API keys are needed in CI.

## When the NASA data arrives

1. Look at **Data → Data quality**: which variables exist, how complete they are, what was
   converted, and what is unusable. Build the scientific question from that.
2. Map NASA's columns, units and roles in `variables.yaml` (unmapped columns are kept anyway).
3. Add a reader in `ingest/` if the format is new.
4. Pick analyzers, validators and deep-analysis probes that fit the data (add new ones with
   the decorators) and, if the team decides so, set ranking weights.
5. Run discovery goals. Promote a finding to an insight only after expert review.

Brand: logo files are in `brand/logo/` (concept "Freefall": a flame's Earth shape with the sphere
it becomes in microgravity carved into it).

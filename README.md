# FlamexSI — Flame in Freefall
 
## Run the integrated dashboard

From the repository root, build and run the single-port application:

```bash
docker build -t falmex-v6 .
docker run --rm -p 3000:3000 -v falmex-data:/data falmex-v6
```

Open http://localhost:3000/review for the real FLEX workspace and http://localhost:3000/bass-review for the frozen BASS-II images and scores. On first launch an empty data volume is seeded with PSI-69. The image inspector can switch among 24 frames and the initial, A and B reference masks. The table compares v3 through v6 on each reference. Choose “Reviewers A and B” to compare the two human masks directly. [View the original dashboard demo](docs/FlameX-Demo.mp4), recorded before the dual-reference decision.



**SI-powered fire-safety insights from microgravity combustion data.** Research prototype for NASA Space Apps; not an operational fire-safety or suppression system.

**Live:** https://flamexsi.com · **Team NovaForge:** Pouya Latifiyan (team owner), Alireza Mosavi, Fatemeh Iranmanesh, Mohammad Ali Hatefi, Haniyeh Z. Budaqi, Fariba Shahrouei.

**Contributors:** Pouya Latifiyan (BASS-II computer vision, models v3 to v6, `bass-cv/`).

**AI use:** the logo is AI-generated (marked "AI" on the site); Ask FlamexSI answers with Google Gemini from FlamexSI's verified results; parts of the code were written with an AI coding assistant and reviewed by the team; no data is AI-generated. Full statement: [AI_USE.md](AI_USE.md).

## Current scientific status

### Real FLEX analysis — PSI-69

The application ingests and analyses the real FLEX investigation dataset (DOI: `10.60555/mbq8-0451`), rather than presenting synthetic results as NASA findings. The current review workspace contains 274 experiments and 44 primary outcomes: 12 `validated`, 3 `candidate`, 2 `rejected`, and 27 `not_significant` under the primary split. `validated` is an internal statistical-engine status, not independent replication, causal proof, or operational validation.

Implemented analysis paths include preregistered replication, time-series, compositional, uncertainty, and scientific-review workflows. FLEX-2/PSI-68 has no measured outcomes in the supplied source, so its hypotheses are `not_evaluable`; no missing statistics are invented.

### Real BASS-II computer vision — PSI-25

`bass-cv/` contains the supervised visibly-luminous-flame segmentation workflow for BASS-II (DOI: `10.60555/4qc4-de67`). The selected v6 LightGBM pixel classifier uses 74 features and video-grouped model selection over 15 development videos. Video, not frame, is the independence unit.

The reserved confirmation uses B14/B17/B18, with eight frames per video. Predictions were frozen before source-only coarse annotation and metric inspection. On the original coarse reference, **v6 has zero true-positive pixels on all 24 confirmation frames** (TP=0, FP=60,537, FN=9,218). This is a failed confirmation, not a successful deployment result. Development scores are model-selection estimates, not untouched confirmation.

Two supplied reviewer annotation sets have been processed without altering either submission. They disagree on visibility in 17 of 24 frames; positive-union Macro IoU is 0.110778 and Micro IoU is 0.257337. The team adopted separate A and B scores for this release. B covers more pixels in all 24 frames. Six frames contain A-only pixels. In the reviewed example, the shared region covers the brighter emission and B extends into the halo and isolated luminous spots. Their physical origin is unresolved. No third pixel mask was drawn. The frozen v6 predictions have pooled IoU 0.0271 against A and 0.0337 against B. Reviewer agreement is not correctness, and reviewer identity, expertise, and independence are not established by the uploaded files. No independent-expert-validation or operational-readiness claim is made.

The segmentation target is only the visibly luminous region. It is not a chemical flame boundary, temperature field, reaction zone, extinction-time label, suppression-effectiveness measure, or safety instruction.

## Repository layout

- `backend/` — FLEX ingestion, analysis, API, scientific review, and tests.
- `frontend/` — Next.js application for data, findings, simulator, and review views.
- `bass-cv/` — BASS-II code, compact models, frozen predictions, metrics, review results, and submission drafts.
- `docs/` — evidence boundaries and delivery notes.

Large raw videos, training caches, fold predictions, error-overlay collections, and download recovery files are intentionally excluded from GitHub. The lightweight BASS-II tree is sufficient to inspect the code and verify the included model/source/frozen-mask hashes; it is **not** sufficient to reproduce full training or video inference by itself.

## Run the FLEX application

Requirements: Docker Compose, or Python 3.12 and Node.js 20 for local development.

```bash
docker compose up --build
```

Backend checks:

```bash
cd backend
python3 -m pip install -e '.[dev]'
python3 -m pytest -q
python3 -m ruff check .
```

Frontend checks:

```bash
cd frontend
npm ci
npm run lint
npm run typecheck
npm run build
```

Do not commit `.env` files, API keys, signed object-storage URLs, or temporary cloud credentials. Configure local secrets only through the documented environment mechanism.

## Verify the lightweight BASS-II bundle

```bash
cd bass-cv
python3 -m pip install -r requirements.txt
python3 scripts/verify_lightweight_v6.py
```

This verifies the included source frames, 96 frozen prediction masks, available model hashes, pending-review status, and unchanged zero-TP v6 result. It does not claim full raw-video/training reproduction.

Optional future single-reference study, if 24 new adjudicated masks become available:

```bash
python3 scripts/finalize_adjudication_v6.py \
  --adjudicator /path/to/completed-adjudicator \
  --output adjudicated-confirmation-v6
```

JSON-only input is supported. The command writes a new reference freeze, provenance, per-frame metrics, and model comparison without overwriting the original annotations, predictions, model files, or metrics. It does not infer adjudicator expertise or independence.

## Evidence and submission boundary

The complete evidence archive contains raw confirmation videos, development assets, caches, large historical models, overlays, and the full 55-check delivery verifier. The GitHub update is deliberately smaller. The competition draft remains ready for team and portal details using the adopted dual-reference analysis; it is not a submitted entry or a claim of expert approval.

See `bass-cv/README.md`, `bass-cv/vision-v6/MODEL_CARD.md` for exact limitations and remaining work.

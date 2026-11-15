# FlamexSI v6 flame finder service

Pouya Latifiyan's frozen v6 model (`bass-cv/vision-v6`, LightGBM on 74 per-pixel features)
as a small Vercel Python function. It runs here, not on the main server, because one
frame needs about 1 GB of memory and the main server has less than that free.

- `api/predict.py`: the web service (protocol in its docstring).
- `api/_v6/falmex_vision_v3..v6.py`: Pouya's code, copied unchanged from `bass-cv/scripts`.
- `api/_v6/falmex-vision-v6.joblib`: the frozen model; its SHA-256 is checked before use.
- `api/_v6/lib/libgomp.so.1`: GNU OpenMP runtime that LightGBM needs and Vercel's Python
  image lacks (conda-forge `libgomp-12.2.0-h65d4601_19`, GPL-3.0 with the GCC Runtime
  Library Exception).
- Library versions are pinned to the ones the model was frozen with.

Deploy: `cd services/v6 && vercel deploy --prod` (project `flamexsi-v6`, 2 GB memory).
The shared secret is `FLAMEX_V6_KEY` on Vercel and `FALMEX_V6_KEY` (with `FALMEX_V6_URL`)
in the main server's `.env`; without both, the main server simply does not offer v6.

Checked on 2026-11-14 against Pouya's frozen masks for the B14 confirmation frames: IoU
0.82 to 0.98 on frames with a flame, the empty frame stays empty; same pixel counts as a
local run, so remaining differences come from the input video, not the service.

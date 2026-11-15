# FlamexSI demo video (Remotion)

The 29.5-second NASA Space Apps demo, written as React code with [Remotion](https://remotion.dev).
It follows the NASA script: team (0:00), challenge (0:02), title (0:05), how it works with NASA
data (0:10), the future (0:20).

- `src/FlamexSI.tsx`: every scene and animation.
- `public/shots`, `public/clips`: screenshots and screen recordings of the real site on NASA PSI data.
- `public/img`: NASA planet maps (public domain, see `frontend/public/textures/CREDITS.md`)
  and the FlamexSI logo (AI-generated, always shown with its AI mark).
- `public/audio/music.wav`: music synthesized in code by `scripts/music.py` (not AI-generated).

```bash
npm install
npx remotion studio                 # preview
npx remotion render FlamexSI out/FlamexSI-demo.mp4 --crf=16
```

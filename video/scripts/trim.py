"""Trim leading/trailing silence from each narration line; print speech lengths."""
import json, sys, wave
import numpy as np
d = sys.argv[1]
dur = json.load(open(f"{d}/durations.json"))
out = {}
for k in dur:
    w = wave.open(f"{d}/{k}.wav"); sr = w.getframerate()
    x = np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(float)
    env = np.convolve(np.abs(x), np.ones(240) / 240, "same")
    on = np.where(env > 400)[0]
    a, b = max(on[0] - int(0.04 * sr), 0), min(on[-1] + int(0.12 * sr), len(x))
    y = x[a:b].astype("<i2")
    with wave.open(f"{d}/{k}.wav", "wb") as o:
        o.setnchannels(1); o.setsampwidth(2); o.setframerate(sr); o.writeframes(y.tobytes())
    out[k] = round(len(y) / sr, 2)
json.dump(out, open(f"{d}/durations.json", "w"), indent=1)
print(out, "total", round(sum(out.values()), 1))

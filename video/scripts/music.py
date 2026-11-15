"""Soundtrack for the FlamexSI demo, synthesized in code (no AI, no samples).

usage: python music.py <out.wav>
Hits land on the video's cuts (seconds): 2.0 challenge, 5.0 title, 10.0 montage,
every 2 s in the montage, 20.0 future, 27.0 end card. Length 29.5 s.
"""

import sys
import wave

import numpy as np
from scipy.signal import fftconvolve

SR = 48000
DUR = 29.5
N = int(DUR * SR)
rng = np.random.default_rng(11)
t_all = np.arange(N) / SR
L = np.zeros(N)
R = np.zeros(N)


def midi(m):
    return 440 * 2 ** ((m - 69) / 12)


def place(sig, at, gain=1.0, pan=0.0):
    i = int(at * SR)
    if i >= N:
        return
    sig = sig[: N - i]
    L[i:i + len(sig)] += sig * gain * np.sqrt((1 - pan) / 2) * 1.414
    R[i:i + len(sig)] += sig * gain * np.sqrt((1 + pan) / 2) * 1.414


def lowpass(x, cutoff):
    cutoff = np.broadcast_to(cutoff, x.shape)
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    s = 0.0
    for i in range(len(x)):
        s = (1 - a[i]) * x[i] + a[i] * s
        y[i] = s
    return y


def env(n, attack, decay):
    t = np.arange(n) / SR
    return np.minimum(1, t / max(attack, 1e-4)) * np.exp(-t / decay)


# ---- sound design ----------------------------------------------------------------------
def boom(length=3.0):
    """Cinematic impact: pitch-dropping sine + noise burst + sub tail."""
    n = int(length * SR)
    t = np.arange(n) / SR
    f = 30 + 90 * np.exp(-t * 9)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.9)
    crack = lowpass(rng.standard_normal(n), 2500) * np.exp(-t / 0.06)
    return body * 0.9 + crack * 0.5


def riser(length):
    n = int(length * SR)
    p = np.linspace(0, 1, n)
    noise = lowpass(rng.standard_normal(n), 300 + 7000 * p ** 2)
    tone = np.sin(2 * np.pi * np.cumsum(200 + 1400 * p ** 2) / SR) * 0.15
    return (noise * 0.8 + tone) * p ** 2.2


def whoosh(length=0.7):
    n = int(length * SR)
    p = np.linspace(0, 1, n)
    s = lowpass(rng.standard_normal(n), 400 + 5000 * np.sin(np.pi * p))
    return s * np.sin(np.pi * p) ** 1.5


def tick():
    n = int(0.05 * SR)
    t = np.arange(n) / SR
    return np.diff(rng.standard_normal(n + 1)) * np.exp(-t / 0.004) * 0.6


def kick():
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    f = 45 + 120 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.16)


def hat():
    n = int(0.08 * SR)
    t = np.arange(n) / SR
    return np.diff(rng.standard_normal(n + 1)) * np.exp(-t / 0.018) * 0.35


def pad(notes, start, length, gain):
    n = int(length * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for m in notes:
        for d in (-0.003, 0, 0.003):
            f = midi(m) * (1 + d)
            for h, a in ((1, 1), (2, 0.35), (3, 0.12)):
                s += a * np.sin(2 * np.pi * f * h * t + rng.uniform(0, 6.28))
    e = np.minimum(1, t / 0.8) * np.minimum(1, (length - t) / 0.9).clip(0)
    place(s * e / len(notes) * 0.25, start, gain)


def bass_note(m, start, length, gain):
    n = int(length * SR)
    t = np.arange(n) / SR
    saw = 2 * ((midi(m) * t) % 1) - 1
    s = lowpass(saw, 900) * np.minimum(1, t / 0.005) * np.exp(-t / 0.22)
    place(s, start, gain)


# ---- arrangement ---------------------------------------------------------------------------
# 0-5: tension. low drone, a clock ticking faster, riser into the title
drone_n = int(5.2 * SR)
dt = np.arange(drone_n) / SR
drone = (np.sin(2 * np.pi * midi(33) * dt) + 0.5 * np.sin(2 * np.pi * midi(40) * dt)) \
    * np.minimum(1, dt / 1.2) * 0.35
place(drone, 0, 1.0)
for k, at in enumerate(np.cumsum([0.5] * 4 + [0.25] * 8 + [0.125] * 4)):
    if at < 4.9:
        place(tick(), at, 0.5 + 0.03 * k, pan=0.3 if k % 2 else -0.3)
place(riser(1.6), 3.4, 0.55)
place(whoosh(0.6), 1.75, 0.35)

# 5: title impact, then a held chord
place(boom(3.2), 5.0, 1.0)
pad([45, 52, 57, 60, 64], 5.0, 5.4, 1.0)            # A minor (add9 feel)
place(riser(1.0), 9.0, 0.45)

# 10-20: the montage. 120 bpm drive, a hit on every 2 s cut
bpm = 120
beat = 60 / bpm
prog = [45, 41, 48, 43]                                # A F C G
for i in range(20):                                    # 20 beats = 10 s
    at = 10 + i * beat
    place(kick(), at, 0.8)
    place(hat(), at + beat / 2, 0.8, pan=0.2)
    root = prog[(i // 4) % 4]
    for k in range(2):                                 # eighth-note bass
        bass_note(root - 12 + (12 if k else 0), at + k * beat / 2, beat / 2, 0.22)
for c, start in zip([[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]] * 2, np.arange(10, 20, 2)):
    pad(c, start, 2.2, 0.55)
for cut in (12, 14, 16, 18):
    place(whoosh(0.5), cut - 0.25, 0.3, pan=-0.2)
    place(boom(0.8), cut, 0.25)
place(riser(1.2), 18.8, 0.5)

# 20-27: the future. big, open, rising
place(boom(3.0), 20.0, 0.9)
pad([41, 48, 57, 60, 64, 69], 20.0, 3.6, 1.1)        # Fmaj9
pad([43, 50, 59, 62, 67, 71], 23.5, 3.7, 1.1)        # G6/9
for i in range(14):                                   # shimmering arpeggio
    at = 20.0 + i * 0.5
    m = [69, 72, 76, 79][i % 4] + (2 if at >= 23.5 else 0)
    n = int(0.9 * SR)
    tt = np.arange(n) / SR
    place(np.sin(2 * np.pi * midi(m) * tt) * np.exp(-tt / 0.35) * 0.18, at, 1.0,
          pan=0.4 if i % 2 else -0.4)
place(riser(1.4), 25.6, 0.5)

# 27-29.5: the end card. final hit and a resolving chord
place(boom(2.5), 27.0, 1.0)
pad([45, 52, 57, 61, 64, 69], 27.0, 2.5, 1.2)         # A major: resolve

# ---- mix -----------------------------------------------------------------------------------
ir_n = int(2.2 * SR)
ir = rng.standard_normal(ir_n) * np.exp(-np.arange(ir_n) / SR / 0.6)
ir /= np.sqrt((ir ** 2).sum())
L = L + 0.35 * fftconvolve(L, ir)[:N]
R = R + 0.35 * fftconvolve(R, ir[::-1])[:N]
fade = np.clip((DUR - t_all) / 1.2, 0, 1) * np.clip(t_all / 0.15, 0, 1)
L, R = L * fade, R * fade
peak = max(np.abs(L).max(), np.abs(R).max())
L, R = np.tanh(L / peak * 1.4) * 0.92, np.tanh(R / peak * 1.4) * 0.92
pcm = (np.stack([L, R], 1) * 32767).astype("<i2")
with wave.open(sys.argv[1], "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print("ok", sys.argv[1], DUR, "s")

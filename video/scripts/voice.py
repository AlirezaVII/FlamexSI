"""Narration for the demo with Gemini TTS (AI-generated voice: disclosed in the video,
its metadata and AI_USE.md). One WAV per line, so scenes can be timed to the voice.
usage: GEMINI_API_KEY=... python voice.py <out_dir>"""

import json
import os
import sys
import wave

from google import genai
from google.genai import types

LINES = {
    "team": "We're Team NovaForge.",
    "challenge": "In orbit, fire has no up. And NASA's flame data is scattered.",
    "title": "FlamexSI: fire-safety findings you can verify.",
    "rank": "Rank every NASA combustion investigation.",
    "validate": "Find patterns on seventy percent of the data. Prove them on the thirty percent it never saw.",
    "replay": "Replay real space-station burns in 3D.",
    "ask": "Ask anything. Every number is cited.",
    "future": "From spacecraft to the Moon and Mars: know which findings are ready.",
    "end": "FlamexSI dot com.",
}
STYLE = ("Read this as a confident, polished narrator of a formal NASA mission briefing. "
         "Speak at a fast, energetic trailer pace, about 3 words per second, no pauses: ")

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
durations = {}
for key, text in LINES.items():
    r = client.models.generate_content(
        model=os.environ.get("TTS_MODEL", "gemini-2.5-pro-preview-tts"),
        contents=STYLE + text,
        config=types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Charon"))),
        ),
    )
    pcm = r.candidates[0].content.parts[0].inline_data.data  # 24 kHz mono 16-bit
    with wave.open(f"{out}/{key}.wav", "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(pcm)
    durations[key] = round(len(pcm) / 2 / 24000, 2)
    print(key, durations[key])
json.dump(durations, open(f"{out}/durations.json", "w"), indent=1)

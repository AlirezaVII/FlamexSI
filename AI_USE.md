# How AI ("SI") was used in FlamexSI

NASA Space Apps 2026 asks teams to state clearly where and how AI tools were used. This is
Team NovaForge's statement.

## In the product

- **Ask FlamexSI** (the research assistant at `/assistant`) sends the question and FlamexSI's
  own verified results to **Google Gemini**, which writes the answer. Every number it may use
  comes from a source card built from NASA data; answers cite those cards and any citation
  that does not exist is flagged to the reader.
- **Interpretation helpers** on findings and insights (plain-language summaries, search
  plans, innovation suggestions) also use Google Gemini, and are labelled as AI output.
- **Statistics, validation and computer vision are not generative AI.** Correlations,
  bootstrap intervals, shuffle tests, unseen-data replication, the OpenCV flame finder and
  Pouya Latifiyan's LightGBM model (v6) are ordinary, reproducible code. Evidence level 7
  is never given by software: it needs a named human expert's review.

## In building it

- Parts of the source code, tests and documentation were written with an **AI coding
  assistant**, directed, reviewed and tested by the team. Ideas, scientific choices and
  the decision of what to build are the team's.

## Images, video and audio

- The **FlamexSI logo** and the **NovaForge team logo** are AI-generated. On the site every
  FlamexSI logo carries a visible **AI** mark; in slides and video they are labelled
  "AI-generated".
- The **30-second demo video**: narration voice (Google Gemini TTS) and background music
  (Google Lyria) are AI-generated; the video carries a visible "AI-generated" watermark and
  says so in its file metadata. All screen recordings show the real site running on NASA
  data.
- Team photos, NASA planet maps and background photos (Unsplash) are not AI-generated.

## Data

- **No data is AI-generated.** All datasets are NASA Physical Sciences Informatics (PSI)
  files: FLEX (PSI-69), FLEX-2 (PSI-68), SAME and SAME-R, Saffire-I/II/III (PSI-98, -99,
  -100) and BASS-II (PSI-25). A clearly labelled synthetic test generator exists only to
  check the pipeline and can never become an insight.

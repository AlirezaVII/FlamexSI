import { loadFont as loadSerif } from "@remotion/google-fonts/EBGaramond";
import { loadFont as loadSans } from "@remotion/google-fonts/Inter";
import type { ReactNode } from "react";
import {
  AbsoluteFill,
  Audio,
  Freeze,
  Img,
  interpolate,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
} from "remotion";
import voice from "../public/voice/durations.json";

const { fontFamily: SERIF } = loadSerif("normal", { weights: ["500"], subsets: ["latin"] });
const { fontFamily: SANS } = loadSans("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin"] });

/* The formal FlamexSI pitch: the real website, full screen, with a narrator.
 * Every frame of the site is a screen recording of flamexsi.com running on NASA PSI data;
 * the overlays only point at what the narrator is saying. 0:00 team · 0:02 challenge ·
 * 0:06 title · 0:10 how it works · 0:25 the future · end card.                            */
const FPS = 30;
const GAP = 0.12; // seconds of silence between lines
const LEAD = 0.15;

const C = { ink: "#f2f4fb", dim: "#aab3cf", blue: "#8b9bff", flame: "#ff8a3d", bg: "#05060c" };
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

type Key = keyof typeof voice;
const ORDER: Key[] = ["team", "challenge", "title", "rank", "validate", "replay", "ask", "future"];
const TEXT: Record<Key, string> = {
  team: "We’re Team NovaForge.",
  challenge: "In orbit, fire has no up. And NASA’s flame data is scattered.",
  title: "FlamexSI: fire-safety findings you can verify.",
  rank: "Rank every NASA combustion investigation.",
  validate: "Find patterns on 70% of the data. Prove them on the 30% it never saw.",
  replay: "Replay real space-station burns in 3D.",
  ask: "Ask anything. Every number is cited.",
  future: "From spacecraft to the Moon and Mars: know which findings are ready.",
  end: "flamexsi.com",
};

// when each line starts and how long its scene lasts (scene = line + gap)
const SCHED = (() => {
  let t = LEAD;
  const out = {} as Record<Key, { from: number; dur: number; speech: number }>;
  for (const k of ORDER) {
    const len = voice[k];
    out[k] = { from: Math.round(t * FPS), dur: Math.round((len + GAP) * FPS), speech: Math.round(len * FPS) };
    t += len + GAP;
  }
  out.end = { from: Math.round(t * FPS), dur: Math.round(1.45 * FPS), speech: 0 };
  return out;
})();
export const FORMAL_TOTAL = SCHED.end.from + SCHED.end.dur;

/** A gentle crossfade at both ends of every scene: the only transition used. */
const Fade = ({ dur, children, edge = 6 }: { dur: number; children: ReactNode; edge?: number }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, edge, dur - edge, dur], [0, 1, 1, 0], clamp);
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
};

const Logo = ({ size }: { size: number }) => (
  <div style={{ position: "relative", width: size, height: size, flex: "none" }}>
    <Img src={staticFile("img/logo-glow.png")} style={{ width: size, height: size }} />
    <div style={{ position: "absolute", right: -size * 0.04, bottom: -size * 0.02, padding: `0 ${size * 0.055}px`, borderRadius: size * 0.06, font: `700 ${size * 0.16}px/${size * 0.22}px ${SANS}`, color: "#fff", background: "#1f2a5c", border: `${Math.max(1, size * 0.012)}px solid rgba(255,255,255,0.7)` }}>
      AI
    </div>
  </div>
);

/** The real site, full screen. `freezeAt` holds one frame of the recording. */
const Site = ({ src, start = 0, rate = 1, freezeAt }: { src: string; start?: number; rate?: number; freezeAt?: number }) => {
  const video = (
    <OffthreadVideo src={staticFile(src)} startFrom={Math.round(start * FPS)} playbackRate={rate} muted style={{ width: 1920, height: 1080 }} />
  );
  return <AbsoluteFill>{freezeAt == null ? video : <Freeze frame={freezeAt}>{video}</Freeze>}</AbsoluteFill>;
};

/** A thin outline around the part of the page being talked about, with its label. */
const Focus = ({ x, y, w, h, label, at = 0 }: { x: number; y: number; w: number; h: number; label: string; at?: number }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [at, at + 8], [0, 1], clamp);
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, opacity: o, borderRadius: 14, border: `2px solid ${C.flame}`, boxShadow: "0 0 0 9999px rgba(3,4,10,0.38)" }}>
      <span style={{ position: "absolute", left: -2, top: -44, padding: "6px 14px", borderRadius: 8, background: C.flame, color: "#140a02", font: `700 21px ${SANS}`, whiteSpace: "nowrap" }}>
        {label}
      </span>
    </div>
  );
};

/** The page address, top right, so the viewer always knows where on the site we are. */
const Page = ({ path }: { path: string }) => (
  <div style={{ position: "absolute", right: 48, top: 92, padding: "8px 18px", borderRadius: 10, background: "rgba(8,10,20,0.82)", border: "1px solid rgba(255,255,255,0.18)", font: `600 22px ${SANS}`, color: C.ink }}>
    <span style={{ color: C.dim }}>flamexsi.com</span>
    {path}
  </div>
);

/** The narrator's words as an English caption (lower third). */
const Caption = ({ k }: { k: Key }) => {
  const s = SCHED[k];
  return (
    <Sequence from={s.from} durationInFrames={s.dur}>
      <Fade dur={s.dur} edge={5}>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 64, display: "flex", justifyContent: "center" }}>
          <div style={{ maxWidth: 1500, padding: "14px 30px", borderRadius: 12, background: "rgba(5,6,12,0.82)", border: "1px solid rgba(255,255,255,0.12)", font: `500 38px/1.3 ${SANS}`, color: C.ink, textAlign: "center" }}>
            {TEXT[k]}
          </div>
        </div>
      </Fade>
    </Sequence>
  );
};

// ---- scenes ---------------------------------------------------------------------------------
const NAMES = ["Pouya Latifiyan", "Alireza Mosavi", "Fatemeh Iranmanesh", "Mohammad Ali Hatefi", "Haniyeh Z. Budaqi", "Fariba Shahrouei"];

const Team = () => (
  <AbsoluteFill style={{ background: `radial-gradient(1100px 700px at 50% 40%, #121733 0%, ${C.bg} 70%)`, justifyContent: "center", alignItems: "center" }}>
    <div style={{ font: `600 22px ${SANS}`, letterSpacing: "0.32em", color: C.blue }}>NASA SPACE APPS CHALLENGE 2026</div>
    <div style={{ marginTop: 22, font: `500 120px/1 ${SERIF}`, color: C.ink }}>Team NovaForge</div>
    <div style={{ marginTop: 34, display: "flex", gap: 30, font: `500 27px ${SANS}`, color: C.dim }}>
      {NAMES.map((n) => <span key={n}>{n}</span>)}
    </div>
  </AbsoluteFill>
);

/* Title: a clean field of space. The title on the left; on the right only the site's real
 * 3D Earth, cut out of the landing-page recording as a circle (centre 1358,577, r 325 px),
 * so none of the page's text shows behind the title.                                     */
const EARTH = { cx: 1358, cy: 577, r: 318 };
const EARTH_SCALE = 1.3;
const Title = () => {
  const d = EARTH.r * 2 * EARTH_SCALE;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(900px 700px at 74% 52%, #0d1640 0%, ${C.bg} 62%)` }}>
      <div style={{ position: "absolute", left: 1385 - d / 2, top: 540 - d / 2, width: d, height: d, borderRadius: "50%", boxShadow: "0 0 160px 24px rgba(70,120,255,0.38), inset 0 0 60px rgba(90,150,255,0.5)" }} />
      <div
        style={{
          position: "absolute",
          left: 1385 - d / 2,
          top: 540 - d / 2,
          width: d,
          height: d,
          borderRadius: "50%",
          overflow: "hidden",
          // a soft edge: no hard crop line, and the site's label card at the rim fades out
          WebkitMaskImage: "radial-gradient(circle, #000 88%, transparent 99%)",
          maskImage: "radial-gradient(circle, #000 88%, transparent 99%)",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: 1920,
            height: 1080,
            left: -(EARTH.cx - EARTH.r),
            top: -(EARTH.cy - EARTH.r),
            transform: `scale(${EARTH_SCALE})`,
            transformOrigin: `${EARTH.cx - EARTH.r}px ${EARTH.cy - EARTH.r}px`,
          }}
        >
          <OffthreadVideo src={staticFile("rec2k/earth.mp4")} startFrom={Math.round(2.4 * FPS)} muted style={{ width: 1920, height: 1080 }} />
        </div>
      </div>
      <div style={{ position: "absolute", left: 150, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <Logo size={150} />
        <div style={{ marginTop: 34, font: `500 168px/0.95 ${SERIF}`, color: C.ink }}>FlamexSI</div>
        <div style={{ marginTop: 20, font: `600 26px ${SANS}`, letterSpacing: "0.3em", color: C.blue }}>FLAME IN FREEFALL</div>
        <div style={{ marginTop: 44, width: 120, height: 2, background: C.flame }} />
        <div style={{ marginTop: 34, font: `500 52px/1.2 ${SERIF}`, color: C.ink, maxWidth: 760 }}>
          Fire-safety findings you can <span style={{ color: C.flame }}>verify</span>.
        </div>
      </div>
    </AbsoluteFill>
  );
};

const End = () => (
  <AbsoluteFill style={{ background: `radial-gradient(1100px 700px at 50% 40%, #121733 0%, ${C.bg} 70%)`, justifyContent: "center", alignItems: "center" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
      <Logo size={150} />
      <div style={{ font: `500 120px/1 ${SERIF}`, color: C.ink }}>FlamexSI</div>
    </div>
    <div style={{ marginTop: 40, padding: "12px 34px", borderRadius: 999, border: `1px solid ${C.blue}`, font: `600 42px ${SANS}`, color: C.ink }}>flamexsi.com</div>
    <div style={{ marginTop: 26, font: `500 26px ${SANS}`, color: C.dim }}>Team NovaForge · NASA Space Apps Challenge 2026</div>
    <div style={{ position: "absolute", bottom: 40, font: `400 19px ${SANS}`, color: "rgba(170,179,207,0.8)" }}>
      Built on NASA open data (PSI). Not affiliated with or endorsed by NASA. Research support, not a certified fire-safety system.
    </div>
  </AbsoluteFill>
);

// validate: play the scroll from the chart to the validation card, then hold on it
const VALIDATE_PLAY = Math.round(3.7 * FPS);

const SCENES: { k: Key; node: ReactNode }[] = [
  { k: "team", node: <Team /> },
  { k: "challenge", node: <><Site src="rec2k/hero.mp4" start={0.2} /><Page path="" /></> },
  { k: "title", node: <Title /> },
  {
    k: "rank",
    node: <><Site src="rec2k/investigations.mp4" start={0.6} rate={1.15} /><Page path="/investigations" /></>,
  },
  {
    k: "validate",
    node: (
      <>
        <Sequence durationInFrames={VALIDATE_PLAY}>
          <Site src="rec2k/finding.mp4" start={0} rate={1.35} />
          {/* only while the chart is still: the page scrolls on after about 1.8 s */}
          <Sequence durationInFrames={48}>
            <Focus x={380} y={36} w={980} h={720} label="Discovery 70% (blue) · Unseen 30% (orange)" at={4} />
          </Sequence>
        </Sequence>
        <Sequence from={VALIDATE_PLAY}>
          <Site src="rec2k/finding.mp4" freezeAt={Math.round(5.05 * FPS)} />
          <Focus x={380} y={100} w={1490} h={380} label="Validated on experiments it never saw · 200 random shuffles" />
        </Sequence>
        <Page path="/findings" />
      </>
    ),
  },
  { k: "replay", node: <><Site src="rec2k/flame.mp4" start={0.8} /><Page path="/flame-lab" /></> },
  { k: "ask", node: <><Site src="rec2k/ask.mp4" start={8.4} rate={1.6} /><Page path="/assistant" /></> },
  { k: "future", node: <><Site src="rec2k/beyond.mp4" start={0} /><Page path="/beyond" /></> },
  { k: "end", node: <End /> },
];

export const Formal = () => (
  <AbsoluteFill style={{ background: C.bg, fontFamily: SANS }}>
    {SCENES.map(({ k, node }) => {
      const s = SCHED[k];
      // scenes overlap their neighbours by the fade length, so cuts are clean crossfades
      return (
        <Sequence key={k} from={Math.max(0, s.from - 4)} durationInFrames={s.dur + 8}>
          <Fade dur={s.dur + 8}>{node}</Fade>
        </Sequence>
      );
    })}
    {ORDER.filter((k) => k !== "title").map((k) => <Caption key={k} k={k} />)}
    {ORDER.map((k) => (
      <Sequence key={`v-${k}`} from={SCHED[k].from}>
        <Audio src={staticFile(`voice/${k}.wav`)} />
      </Sequence>
    ))}
    <Audio src={staticFile("audio/music.wav")} volume={0.16} />
    {/* AI disclosure, on screen throughout (NASA Space Apps rules) */}
    <div style={{ position: "absolute", top: 28, right: 48, padding: "6px 14px", borderRadius: 999, background: "rgba(31,42,92,0.85)", border: "1px solid rgba(255,255,255,0.35)", font: `600 17px ${SANS}`, color: "#e6ebff" }}>
      AI-generated narration and logo · real site on NASA data
    </div>
  </AbsoluteFill>
);

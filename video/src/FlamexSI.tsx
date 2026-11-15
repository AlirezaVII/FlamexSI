import { loadFont as loadSerif } from "@remotion/google-fonts/EBGaramond";
import { loadFont as loadSans } from "@remotion/google-fonts/Inter";
import type { CSSProperties, ReactNode } from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  interpolate,
  OffthreadVideo,
  random,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const { fontFamily: SERIF } = loadSerif();
const { fontFamily: SANS } = loadSans();

/* FlamexSI demo, 29.5 s, following the NASA Space Apps script:
 *   0:00 team · 0:02 challenge · 0:05 title · 0:10 how it works (NASA data) · 0:20 future
 * Every screen in the montage is the real site running on NASA PSI data.            */
export const TOTAL = 885; // 29.5 s at 30 fps

const C = {
  bg: "#05060c",
  ink: "#eef2ff",
  dim: "#a9b3d6",
  blue: "#7c8cff",
  disc: "#3987e5",
  unseen: "#e8703e",
  flame: "#ff8a3d",
  good: "#3ccf7a",
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.16, 1, 0.3, 1);

/** Fade a scene in and out over `edge` frames. */
function useFade(dur: number, edge = 8) {
  const f = useCurrentFrame();
  return interpolate(f, [0, edge, dur - edge, dur], [0, 1, 1, 0], clamp);
}

function useSpring(delay = 0, damping = 16) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: f - delay, fps, config: { damping, mass: 0.8 } });
}

// ---- background -----------------------------------------------------------------------
const STARS = Array.from({ length: 260 }, (_, i) => ({
  x: random(`x${i}`) * 100,
  y: random(`y${i}`) * 100,
  r: 0.6 + random(`r${i}`) * 1.8,
  tw: random(`t${i}`) * 6.28,
  depth: 0.3 + random(`d${i}`) * 0.7,
}));

const Space = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(1200px 800px at 70% 30%, #141a3a 0%, ${C.bg} 60%), ${C.bg}`,
      }}
    >
      {STARS.map((s, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${(s.x - f * 0.012 * s.depth + 100) % 100}%`,
            top: `${s.y}%`,
            width: s.r * 2,
            height: s.r * 2,
            borderRadius: "50%",
            background: "#fff",
            opacity: 0.25 + 0.55 * s.depth * (0.6 + 0.4 * Math.sin(f / 14 + s.tw)),
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

/** A planet: an equirectangular map scrolling inside a circle, lit from the top left. */
const Planet = ({ src, size, speed = 0.4, glow, style }: {
  src: string; size: number; speed?: number; glow?: string; style?: CSSProperties;
}) => {
  const f = useCurrentFrame();
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        position: "relative",
        overflow: "hidden",
        boxShadow: glow ? `0 0 ${size * 0.18}px ${glow}, inset 0 0 ${size * 0.04}px ${glow}` : undefined,
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `url(${staticFile(src)})`,
          backgroundSize: `${size * 2}px ${size}px`,
          backgroundPosition: `${-f * speed}px 0`,
          backgroundRepeat: "repeat-x",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background:
            "radial-gradient(circle at 32% 30%, rgba(255,255,255,0.12) 0%, rgba(0,0,0,0) 38%, rgba(0,0,0,0.55) 72%, rgba(0,0,0,0.92) 100%)",
        }}
      />
    </div>
  );
};

/** The FlamexSI logo. It is AI-generated, so it always carries its visible AI mark. */
const Logo = ({ size }: { size: number }) => (
  <div style={{ position: "relative", width: size, height: size }}>
    <Img src={staticFile("img/logo-glow.png")} style={{ width: size, height: size }} />
    <div
      style={{
        position: "absolute",
        right: -size * 0.04,
        bottom: -size * 0.02,
        padding: `${size * 0.01}px ${size * 0.055}px`,
        borderRadius: size * 0.06,
        font: `700 ${size * 0.16}px/${size * 0.21}px ${SANS}`,
        color: "#fff",
        background: "#1f2a5c",
        border: `${Math.max(1, size * 0.012)}px solid rgba(255,255,255,0.7)`,
      }}
    >
      AI
    </div>
  </div>
);

const Eyebrow = ({ children, color = C.blue, style }: { children: ReactNode; color?: string; style?: CSSProperties }) => (
  <div style={{ font: `600 24px/1 ${SANS}`, letterSpacing: "0.32em", textTransform: "uppercase", color, ...style }}>
    {children}
  </div>
);

// ---- 0:00 team -----------------------------------------------------------------------------
const NAMES = [
  "Pouya Latifiyan",
  "Alireza Mosavi",
  "Fatemeh Iranmanesh",
  "Mohammad Ali Hatefi",
  "Haniyeh Z. Budaqi",
  "Fariba Shahrouei",
];

const Team = ({ dur }: { dur: number }) => {
  const f = useCurrentFrame();
  const fade = useFade(dur);
  const word = "NovaForge";
  return (
    <AbsoluteFill style={{ opacity: fade, justifyContent: "center", alignItems: "center" }}>
      <Eyebrow style={{ opacity: interpolate(f, [0, 10], [0, 1], clamp) }}>
        NASA Space Apps 2026 · We are
      </Eyebrow>
      <div style={{ display: "flex", marginTop: 26, font: `500 150px/1 ${SERIF}`, color: C.ink }}>
        <span style={{ marginRight: 34, opacity: interpolate(f, [2, 12], [0, 1], clamp) }}>Team</span>
        {word.split("").map((ch, i) => {
          const p = interpolate(f, [4 + i * 1.6, 14 + i * 1.6], [0, 1], { ...clamp, easing: ease });
          return (
            <span key={i} style={{ display: "inline-block", opacity: p, transform: `translateY(${(1 - p) * 60}px)`, filter: `blur(${(1 - p) * 8}px)`, color: i < 4 ? C.ink : C.flame }}>
              {ch}
            </span>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 34, marginTop: 44, flexWrap: "wrap", justifyContent: "center", maxWidth: 1500 }}>
        {NAMES.map((n, i) => {
          const p = interpolate(f, [16 + i * 3, 26 + i * 3], [0, 1], { ...clamp, easing: ease });
          return (
            <span key={n} style={{ font: `500 30px/1.2 ${SANS}`, color: C.dim, opacity: p, transform: `translateY(${(1 - p) * 20}px)` }}>
              {n}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ---- 0:02 challenge ---------------------------------------------------------------------------
/** A flame that turns from Earth's teardrop into orbit's sphere as gravity drops. */
const MorphFlame = ({ t }: { t: number }) => {
  const f = useCurrentFrame();
  const flick = Math.sin(f / 2.3) * 0.03 * (1 - t);
  const h = 340 - 140 * t;
  const w = 150 + 50 * t;
  return (
    <div style={{ position: "relative", width: 360, height: 420, display: "grid", placeItems: "center" }}>
      <div
        style={{
          position: "absolute",
          width: w * 1.5,
          height: h * 1.05,
          borderRadius: `50% 50% 50% 50% / ${60 - 10 * t}% ${60 - 10 * t}% ${40 + 10 * t}% ${40 + 10 * t}%`,
          background: `radial-gradient(ellipse at 50% ${70 - 20 * t}%, rgba(90,120,255,${0.25 + 0.45 * t}) 0%, rgba(60,80,255,0) 70%)`,
          filter: "blur(18px)",
        }}
      />
      <div
        style={{
          width: w,
          height: h,
          transform: `scaleX(${1 + flick}) translateY(${-30 * (1 - t)}px)`,
          borderRadius: `50% 50% 50% 50% / ${62 - 12 * t}% ${62 - 12 * t}% ${38 + 12 * t}% ${38 + 12 * t}%`,
          background: `radial-gradient(ellipse at 50% ${78 - 28 * t}%, #fff6d8 0%, ${C.flame} ${28 + 10 * t}%, rgba(110,130,255,${0.4 + 0.5 * t}) ${55 + 10 * t}%, rgba(80,100,255,0) 75%)`,
          filter: "blur(2px)",
        }}
      />
      <div style={{ position: "absolute", bottom: -10, font: `600 26px ${SANS}`, color: C.dim, letterSpacing: "0.1em" }}>
        {t < 0.5 ? "EARTH · 1 g" : "ORBIT · 0 g"}
      </div>
    </div>
  );
};

const Challenge = ({ dur }: { dur: number }) => {
  const f = useCurrentFrame();
  const fade = useFade(dur);
  const morph = interpolate(f, [8, 42], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const l1 = interpolate(f, [4, 16], [0, 1], { ...clamp, easing: ease });
  const l2 = interpolate(f, [40, 54], [0, 1], { ...clamp, easing: ease });
  return (
    <AbsoluteFill style={{ opacity: fade, flexDirection: "row", alignItems: "center", padding: "0 180px", gap: 110 }}>
      <MorphFlame t={morph} />
      <div style={{ maxWidth: 1050 }}>
        <Eyebrow color={C.flame}>The challenge · Flame in Freefall</Eyebrow>
        <div style={{ marginTop: 28, font: `500 96px/1.05 ${SERIF}`, color: C.ink, opacity: l1, transform: `translateY(${(1 - l1) * 30}px)` }}>
          In orbit, fire has no “up”.
        </div>
        <div style={{ marginTop: 30, font: `400 40px/1.35 ${SANS}`, color: C.dim, opacity: l2, transform: `translateY(${(1 - l2) * 20}px)` }}>
          Decades of NASA flame experiments, scattered across <b style={{ color: C.ink }}>22 investigations</b>.
          Hard to find, compare and trust.
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---- 0:05 title -------------------------------------------------------------------------------
const Title = ({ dur }: { dur: number }) => {
  const f = useCurrentFrame();
  const fade = useFade(dur, 10);
  const pop = useSpring(0, 12);
  const word = useSpring(6, 18);
  const tag = interpolate(f, [22, 40], [0, 1], { ...clamp, easing: ease });
  const sub = interpolate(f, [48, 66], [0, 1], { ...clamp, easing: ease });
  const flash = interpolate(f, [0, 3, 14], [0, 0.85, 0], clamp);
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      {/* Earth rises at the bottom: the planet the data has to protect */}
      <div style={{ position: "absolute", left: "50%", top: 760 - 60 * interpolate(f, [0, dur], [0, 1]), transform: "translateX(-50%)" }}>
        <Planet src="img/earth.webp" size={1500} speed={0.5} glow="rgba(80,140,255,0.55)" />
      </div>
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(5,6,12,0.2) 0%, rgba(5,6,12,0) 55%, rgba(5,6,12,0.65) 100%)" }} />
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 150 }}>
        <div style={{ transform: `scale(${0.4 + 0.6 * pop})`, opacity: Math.min(1, pop * 1.5), filter: `drop-shadow(0 0 ${40 + 20 * Math.sin(f / 8)}px rgba(120,140,255,0.6))` }}>
          <Logo size={190} />
        </div>
        <div style={{ marginTop: 26, font: `500 190px/1 ${SERIF}`, letterSpacing: "-0.01em", opacity: word, transform: `translateY(${(1 - word) * 40}px)`, background: "linear-gradient(180deg, #ffffff 0%, #b9c4ff 100%)", WebkitBackgroundClip: "text", color: "transparent" }}>
          FlamexSI
        </div>
        <div style={{ marginTop: 18, font: `500 50px/1.2 ${SERIF}`, color: C.ink, opacity: tag, transform: `translateY(${(1 - tag) * 16}px)` }}>
          Fire-safety findings you can <span style={{ color: C.flame }}>verify</span>.
        </div>
        <div style={{ marginTop: 22, font: `500 28px/1.3 ${SANS}`, color: C.dim, opacity: sub, letterSpacing: "0.04em" }}>
          NASA microgravity combustion data → validated findings → insights → innovation
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "#dfe6ff", opacity: flash }} />
    </AbsoluteFill>
  );
};

// ---- 0:10 how it works --------------------------------------------------------------------------
type Media = { img?: string; video?: string; videoStart?: number; rate?: number };

/** A browser window with the real site, tilted in 3D, the camera drifting towards a detail. */
const Window = ({ media, url, from, to }: {
  media: Media; url: string; from: [number, number, number]; to: [number, number, number];
}) => {
  const f = useCurrentFrame();
  const enter = useSpring(-5, 18);
  const p = interpolate(f, [0, 60], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
  const [s, x, y] = from.map((v, i) => v + (to[i] - v) * p);
  const W = 1180;
  const H = W * (9 / 16);
  return (
    <div
      style={{
        position: "absolute",
        right: 90,
        top: 170,
        width: W,
        transform: `perspective(2200px) rotateY(${-14 + 6 * p}deg) rotateX(${4 - 2 * p}deg) translateX(${(1 - enter) * 500}px)`,
        opacity: enter,
        borderRadius: 18,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.14)",
        boxShadow: "0 50px 120px -20px rgba(0,0,0,0.8), 0 0 80px -20px rgba(124,140,255,0.45)",
        background: "#111",
      }}
    >
      <div style={{ height: 44, display: "flex", alignItems: "center", gap: 9, padding: "0 18px", background: "#1b1d26", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
          <span key={c} style={{ width: 13, height: 13, borderRadius: "50%", background: c }} />
        ))}
        <span style={{ marginLeft: 18, padding: "5px 16px", borderRadius: 8, background: "#0f1118", font: `500 18px ${SANS}`, color: C.dim }}>
          {url}
        </span>
      </div>
      <div style={{ width: W, height: H, overflow: "hidden", position: "relative" }}>
        <div style={{ position: "absolute", inset: 0, transformOrigin: `${x}% ${y}%`, transform: `scale(${s})` }}>
          {media.img && <Img src={staticFile(media.img)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
          {media.video && (
            <OffthreadVideo
              src={staticFile(media.video)}
              startFrom={Math.round((media.videoStart ?? 0) * 30)}
              playbackRate={media.rate ?? 1}
              muted
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          )}
        </div>
      </div>
    </div>
  );
};

const STEPS: {
  n: string; verb: string; title: ReactNode; url: string; media: Media;
  from: [number, number, number]; to: [number, number, number]; extra?: ReactNode;
}[] = [
  {
    n: "01", verb: "Rank", url: "flamexsi.com/investigations",
    title: <>All <b>22</b> NASA combustion investigations, ranked for your mission.</>,
    media: { img: "shots/investigations.png" }, from: [1.15, 70, 60], to: [1.55, 70, 78],
  },
  {
    n: "02", verb: "Validate", url: "flamexsi.com/findings",
    title: <>Found on <span style={{ color: C.disc }}>70%</span> of the experiments. Proven on the <span style={{ color: C.unseen }}>30%</span> it never saw.</>,
    media: { img: "shots/finding.png" }, from: [1.2, 45, 62], to: [1.75, 42, 62],
    extra: (
      <div style={{ display: "flex", gap: 14, marginTop: 30 }}>
        {[["Discovery 70%", C.disc], ["Unseen 30%", C.unseen], ["200 random shuffles", C.dim]].map(([t, c]) => (
          <span key={t} style={{ padding: "8px 16px", borderRadius: 999, border: `1px solid ${c}`, color: c, font: `600 21px ${SANS}`, whiteSpace: "nowrap" }}>
            {t}
          </span>
        ))}
      </div>
    ),
  },
  {
    n: "03", verb: "Replay", url: "flamexsi.com/flame-lab",
    title: <>Real FLEX droplet burns, replayed in 3D from NASA’s measurements.</>,
    media: { video: "clips/flame.mp4", videoStart: 2.2, rate: 1.4 }, from: [1.15, 60, 62], to: [1.45, 60, 62],
  },
  {
    n: "04", verb: "Ask", url: "flamexsi.com/assistant",
    title: <>Ask in plain words. Every number <span style={{ color: C.flame }}>cited</span>.</>,
    media: { video: "clips/ask.mp4", videoStart: 9.6, rate: 2.2 }, from: [1.2, 62, 40], to: [1.35, 62, 60],
  },
  {
    n: "05", verb: "See", url: "flamexsi.com/bass-review",
    title: <>NASA BASS-II flame footage, measured with computer vision. Scores reported honestly.</>,
    media: { img: "shots/bass.png" }, from: [1.1, 50, 70], to: [1.6, 45, 85],
  },
];

const Step = ({ i }: { i: number }) => {
  const f = useCurrentFrame();
  const s = STEPS[i];
  // steps overlap by 10 frames: the next one is already arriving while this one leaves
  // text never overlaps: the old caption is gone (frame 63) before the new one starts
  const t = interpolate(f, [i ? 8 : 0, i ? 18 : 10], [0, 1], { ...clamp, easing: ease }) *
    (i === STEPS.length - 1 ? 1 : interpolate(f, [57, 63], [1, 0], clamp));
  const out = i === STEPS.length - 1 ? 1 : interpolate(f, [60, 70], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ opacity: out }}>
      <Window media={s.media} url={s.url} from={s.from} to={s.to} />
      <div style={{ position: "absolute", left: 110, top: 300, width: 600, opacity: t, transform: `translateX(${(1 - t) * -40}px)` }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 20 }}>
          <span style={{ font: `600 30px ${SANS}`, color: C.flame }}>{s.n}</span>
          <span style={{ font: `600 30px ${SANS}`, color: C.blue, letterSpacing: "0.3em", textTransform: "uppercase" }}>{s.verb}</span>
        </div>
        <div style={{ marginTop: 20, font: `500 62px/1.1 ${SERIF}`, color: C.ink }}>{s.title}</div>
        {s.extra}
      </div>
    </AbsoluteFill>
  );
};

const Montage = ({ dur }: { dur: number }) => {
  const f = useCurrentFrame();
  const fade = useFade(dur, 6);
  const bar = interpolate(f, [0, dur], [0, 100], clamp);
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <div style={{ position: "absolute", left: 110, top: 90, display: "flex", alignItems: "center", gap: 18 }}>
        <Logo size={58} />
        <span style={{ font: `500 40px ${SERIF}`, color: C.ink }}>How FlamexSI works</span>
      </div>
      {STEPS.map((_, i) => (
        <Sequence key={i} from={i * 60 - (i ? 6 : 0)} durationInFrames={i === STEPS.length - 1 ? 66 : 76}>
          <Step i={i} />
        </Sequence>
      ))}
      {/* the NASA data it runs on */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 92, display: "flex", alignItems: "center", gap: 26, padding: "0 110px", background: "linear-gradient(0deg, rgba(5,6,12,0.95), rgba(5,6,12,0.6))", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <span style={{ font: `600 20px ${SANS}`, color: C.blue, letterSpacing: "0.25em" }}>NASA PSI OPEN DATA</span>
        {["FLEX · PSI-69", "FLEX-2 · PSI-68", "BASS-II · PSI-25", "Saffire I–III", "SAME"].map((d) => (
          <span key={d} style={{ font: `500 24px ${SANS}`, color: C.ink, opacity: 0.88 }}>{d}</span>
        ))}
        <span style={{ marginLeft: "auto", font: `500 22px ${SANS}`, color: C.dim }}>274 FLEX experiments analysed</span>
      </div>
      <div style={{ position: "absolute", left: 0, bottom: 92, height: 3, width: `${bar}%`, background: `linear-gradient(90deg, ${C.blue}, ${C.flame})` }} />
    </AbsoluteFill>
  );
};

// ---- 0:20 the future -------------------------------------------------------------------------------
const Future = ({ dur }: { dur: number }) => {
  const f = useCurrentFrame();
  const fade = useFade(dur, 10);
  const head = interpolate(f, [4, 20], [0, 1], { ...clamp, easing: ease });
  const worlds: [string, string, string, number, string][] = [
    ["Spacecraft", "0 g", "img/earth.webp", 230, "rgba(80,140,255,0.6)"],
    ["Moon base", "0.17 g", "img/moon.webp", 230, "rgba(220,220,230,0.35)"],
    ["Mars rover", "0.38 g", "img/mars.webp", 230, "rgba(255,120,70,0.45)"],
  ];
  return (
    <AbsoluteFill style={{ opacity: fade, alignItems: "center" }}>
      <div style={{ marginTop: 120, textAlign: "center", opacity: head, transform: `translateY(${(1 - head) * 24}px)` }}>
        <Eyebrow color={C.flame}>Looking ahead</Eyebrow>
        <div style={{ marginTop: 22, font: `500 92px/1.05 ${SERIF}`, color: C.ink }}>Fire-safety evidence for the next frontier.</div>
      </div>
      <div style={{ display: "flex", gap: 150, marginTop: 90 }}>
        {worlds.map(([name, g, src, size, glow], i) => {
          const p = interpolate(f, [14 + i * 8, 34 + i * 8], [0, 1], { ...clamp, easing: ease });
          return (
            <div key={name} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 26, opacity: p, transform: `translateY(${(1 - p) * 50}px) scale(${0.85 + 0.15 * p})` }}>
              <Planet src={src} size={size} speed={0.35 + i * 0.1} glow={glow} />
              <div style={{ textAlign: "center" }}>
                <div style={{ font: `500 44px ${SERIF}`, color: C.ink }}>{name}</div>
                <div style={{ font: `600 24px ${SANS}`, color: C.dim, letterSpacing: "0.12em" }}>{g}</div>
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const Ready = ({ dur }: { dur: number }) => {
  const f = useCurrentFrame();
  const fade = useFade(dur, 8);
  const head = interpolate(f, [2, 16], [0, 1], { ...clamp, easing: ease });
  const levels = ["Signal", "Not chance", "Unseen data", "Third variables", "Uncertainty", "Prior work", "Expert"];
  return (
    <AbsoluteFill style={{ opacity: fade, justifyContent: "center", alignItems: "center" }}>
      <div style={{ textAlign: "center", opacity: head, transform: `translateY(${(1 - head) * 20}px)`, maxWidth: 1500 }}>
        <div style={{ font: `500 80px/1.1 ${SERIF}`, color: C.ink }}>
          Know which findings are <span style={{ color: C.good }}>ready</span>,
        </div>
        <div style={{ font: `500 80px/1.1 ${SERIF}`, color: C.ink }}>
          and which need the <span style={{ color: C.flame }}>next experiment</span>.
        </div>
      </div>
      <div style={{ display: "flex", gap: 18, marginTop: 70 }}>
        {levels.map((l, i) => {
          const on = interpolate(f, [16 + i * 5, 24 + i * 5], [0, 1], clamp);
          const done = i < 5;
          const col = done ? C.good : C.flame;
          return (
            <div key={l} style={{ width: 196, padding: "18px 0 16px", borderRadius: 16, textAlign: "center", border: `2px ${done ? "solid" : "dashed"} ${col}`, background: done ? `rgba(60,207,122,${0.16 * on})` : "rgba(255,138,61,0.06)", opacity: 0.25 + 0.75 * on, transform: `translateY(${(1 - on) * 20}px)` }}>
              <div style={{ font: `700 34px ${SANS}`, color: col }}>{i + 1}</div>
              <div style={{ marginTop: 6, font: `500 21px ${SANS}`, color: C.ink }}>{l}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const End = ({ dur }: { dur: number }) => {
  const f = useCurrentFrame();
  const pop = useSpring(0, 14);
  const fadeOut = interpolate(f, [dur - 20, dur], [1, 0], clamp);
  const url = interpolate(f, [10, 24], [0, 1], { ...clamp, easing: ease });
  return (
    <AbsoluteFill style={{ opacity: fadeOut, justifyContent: "center", alignItems: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 46, transform: `scale(${0.85 + 0.15 * pop})`, opacity: pop }}>
        <Logo size={210} />
        <div>
          <div style={{ font: `500 150px/1 ${SERIF}`, color: C.ink }}>FlamexSI</div>
          <div style={{ marginTop: 12, font: `600 26px ${SANS}`, color: C.blue, letterSpacing: "0.3em" }}>FLAME IN FREEFALL</div>
        </div>
      </div>
      <div style={{ marginTop: 60, padding: "16px 40px", borderRadius: 999, border: `1px solid ${C.blue}`, font: `600 46px ${SANS}`, color: C.ink, opacity: url, transform: `translateY(${(1 - url) * 16}px)` }}>
        flamexsi.com
      </div>
      <div style={{ marginTop: 34, font: `500 28px ${SANS}`, color: C.dim, opacity: url }}>
        Team NovaForge · NASA Space Apps Challenge 2026
      </div>
      <div style={{ position: "absolute", bottom: 46, font: `400 19px ${SANS}`, color: "rgba(169,179,214,0.75)", opacity: url, textAlign: "center" }}>
        Built on NASA open data (PSI). Not affiliated with or endorsed by NASA. Research support, not a certified fire-safety system.
      </div>
    </AbsoluteFill>
  );
};

// ---- timeline ---------------------------------------------------------------------------------------
const SCENES: { from: number; dur: number; C: (p: { dur: number }) => ReactNode }[] = [
  { from: 0, dur: 66, C: Team },
  { from: 60, dur: 94, C: Challenge },
  { from: 150, dur: 154, C: Title },
  { from: 300, dur: 300, C: Montage },
  { from: 600, dur: 124, C: Future },
  { from: 720, dur: 94, C: Ready },
  { from: 810, dur: 75, C: End },
];

export const FlamexSI = () => (
  <AbsoluteFill style={{ background: C.bg, fontFamily: SANS }}>
    <Space />
    {SCENES.map(({ from, dur, C: Scene }) => (
      <Sequence key={from} from={from} durationInFrames={dur}>
        <Scene dur={dur} />
      </Sequence>
    ))}
    {/* AI disclosure, on screen the whole time (NASA Space Apps rules) */}
    <div style={{ position: "absolute", top: 30, right: 40, padding: "6px 14px", borderRadius: 999, background: "rgba(31,42,92,0.75)", border: "1px solid rgba(255,255,255,0.35)", font: `600 17px ${SANS}`, color: "#e6ebff", letterSpacing: "0.04em" }}>
      AI-assisted · logo AI-generated
    </div>
    <Audio src={staticFile("audio/music.wav")} />
  </AbsoluteFill>
);

// Illustrative flame shader shared by the loading screen and the landing-page chamber.
// Uniforms: res (drawing-buffer px), g (0..1 gravity), time (s), mode (0 candle, 1 droplet),
// bg (0 = opaque experiment chamber, 1 = transparent background for overlays).
export const FLAME_FRAGMENT = /* glsl */ `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif
  uniform vec2 res;
  uniform float g;
  uniform float time;
  uniform float mode; // 0 candle, 1 droplet
  uniform float zoom; // >1 shows more of the scene (smaller flame)
  uniform float bg; // 1: transparent background (no chamber vignette / scanlines)

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  void main() {
    vec2 p = (gl_FragCoord.xy - 0.5 * res) / res.y * 2.0 * max(zoom, 0.01);
    float gb = sqrt(clamp(g, 0.0, 1.0));
    float t = time;
    vec3 col = vec3(0.0);

    // fuel source: candle wick, or a droplet that shrinks as it burns (d^2 law, looped)
    float life = fract(t / 9.0);
    float drop = mode > 0.5 ? 0.075 * sqrt(max(1.0 - life, 0.0)) + 0.012 : 0.0;
    vec2 src = mode > 0.5 ? vec2(0.0, -0.05) : vec2(0.0, -0.42);
    float size = mode > 0.5 ? 0.3 + drop * 3.2 : 0.34;

    vec2 q = p - src;
    // a candle flame always sits above its wick; a droplet flame surrounds the droplet
    float up = (mode > 0.5 ? mix(0.0, 0.17, gb) : mix(0.2, 0.38, gb)) * size / 0.34;
    q.y -= up;
    // buoyant flicker grows with height, and only exists with gravity
    float h = max(q.y + up, 0.0);
    q.x += gb * (fbm(vec2(p.y * 3.2 - t * 2.6, t * 0.6)) - 0.5) * 0.26 * h;
    q.y += gb * (fbm(vec2(p.x * 4.0, t * 1.9)) - 0.5) * 0.05;

    vec2 s = q;
    if (s.y > 0.0) {
      s.y /= mix(1.0, 2.4, gb);
      s.x *= 1.0 + s.y * 2.2 * gb;
    } else {
      s.y /= mix(1.0, 0.7, gb);
    }
    float R = mix(size, size * 0.62, gb);
    float d = length(s) / R;

    // thin reaction sheet (blue), bright where we look along it (limb brightening)
    float sheet = exp(-pow((d - 0.96) * 6.5, 2.0));
    float limb = 0.55 + 0.45 * smoothstep(0.6, 1.0, d);
    // soot glow: needs time at high temperature, i.e. the buoyant plume
    float body = smoothstep(1.02, 0.15, d);
    float soot = body * gb * smoothstep(-0.25, 0.25, q.y + 0.08);
    float core = smoothstep(0.55, 0.0, d) * gb;
    // blue base of a candle flame, where fresh air meets the fuel
    float base = gb * exp(-pow(length(vec2(q.x * 1.3, q.y + up - 0.02)) / 0.11, 2.0));
    // microgravity: faint orange shell inside the sphere (soot that cannot escape)
    float shell0 = (1.0 - gb) * exp(-pow((d - 0.7) * 5.0, 2.0)) * 0.22;

    vec3 blue = vec3(0.22, 0.45, 1.0);
    col += blue * sheet * limb * mix(1.05, 0.45, gb);
    col += blue * base * 1.3;
    col += vec3(1.0, 0.55, 0.16) * soot * 1.25;
    col += vec3(1.0, 0.86, 0.55) * core * 0.9;
    col += vec3(1.0, 0.5, 0.2) * shell0;
    // soft glow around everything
    float glow = exp(-d * 2.2) * mix(0.16, 0.3, gb);
    col += mix(blue, vec3(1.0, 0.6, 0.25), gb) * glow;
    // gentle steady breathing in freefall, flicker in gravity
    col *= 0.93 + 0.07 * sin(t * mix(1.3, 9.0, gb) + fbm(vec2(t)) * 3.0);

    // hardware
    if (mode < 0.5) {
      // candle body and wick
      float wax = step(abs(p.x), 0.13) * step(p.y, src.y - 0.05);
      vec3 waxCol = vec3(0.86, 0.82, 0.76) * (0.35 + 0.25 * smoothstep(0.13, -0.13, p.x));
      col = mix(col, waxCol + col * 0.4, wax);
      float wick = step(abs(p.x), 0.012) * step(src.y - 0.06, p.y) * step(p.y, src.y + 0.05);
      col = mix(col, vec3(0.05), wick * 0.9);
    } else {
      // two thin support fibres crossing at the droplet, and the droplet itself
      float fib = smoothstep(0.006, 0.0, abs(p.y - src.y + p.x * 0.18)) +
                  smoothstep(0.006, 0.0, abs(p.y - src.y - p.x * 0.18));
      col += vec3(0.5, 0.55, 0.65) * fib * 0.35;
      float dd = length(p - src);
      float dropMask = smoothstep(drop, drop - 0.006, dd);
      vec3 dropCol = vec3(0.35, 0.22, 0.08) + vec3(0.6, 0.4, 0.2) * smoothstep(drop, 0.0, length(p - src - vec2(-0.3, 0.3) * drop));
      col = mix(col, dropCol, dropMask);
    }

    if (bg > 0.5) {
      // premultiplied over whatever is behind the canvas
      float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
      gl_FragColor = vec4(col, a);
      return;
    }
    // chamber vignette and faint scanlines, like experiment video
    col *= 1.0 - 0.35 * smoothstep(0.7, 1.6, length(p * vec2(0.8, 1.0)));
    col += 0.012 * sin(gl_FragCoord.y * 1.6);
    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * Three.js scene for the FLEX flame lab. One instance per viewport. Units: 1 scene unit = 1 mm.
 *
 * What is drawn from data (set every frame by the page): droplet diameter, whether the flame
 * is lit, how the test ended. What is illustrative (labelled in the UI): the flame's size
 * relative to the droplet, its colours and brightness, soot, the cool flame and the Earth
 * gravity shape. The flame is a ray-marched emissive volume (no textures, no downloads).
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

export type Fuel = "Heptane" | "Methanol";

export interface FrameState {
  t: number; // s since ignition
  d: number; // droplet diameter, mm
  flame: number; // 0..1 hot (visible) flame
  cool: number; // 0..1 cool flame glow (illustrative)
  disrupt: number; // 0..1 progress of a droplet disruption
  fuel: Fuel;
  o2: number; // mole fraction
  gravity: number; // 0 = orbit, 1 = Earth (illustrative shape)
  soot: boolean;
  igniter: number; // 0..1 igniter glow; <0 retracted
}

export interface FlameEngine {
  frame(s: FrameState, dt: number): void;
  setScale(maxFlameMm: number): void;
  resize(): void;
  onView(cb: (q: THREE.Quaternion, dist: number) => void): void;
  setView(q: THREE.Quaternion, dist: number): void;
  dispose(): void;
}

/** Flame size relative to the droplet (flame diameter / droplet diameter). Illustrative:
 *  the FLEX table does not include it. Order of magnitude from microgravity droplet work. */
export const STANDOFF: Record<Fuel, number> = { Heptane: 7, Methanol: 4.5 };

export function hasWebGL2(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!c.getContext("webgl2");
  } catch {
    return false;
  }
}

const FLAME_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FLAME_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
uniform float uTime, uRf, uDrop, uG, uBlue, uSoot, uCool, uCoolR, uBound;
uniform vec3 uOff;

float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                 mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                 mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5, s = 0.0;
  for (int i = 0; i < 3; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
vec2 hitSphere(vec3 ro, vec3 rd, float R) {
  float b = dot(ro, rd), c = dot(ro, ro) - R * R, h = b * b - c;
  if (h < 0.0) return vec2(-1.0); h = sqrt(h); return vec2(-b - h, -b + h);
}

vec3 emission(vec3 p) {
  float g = uG;
  vec3 q = p;
  // buoyancy (Earth only): hot gas rises, so the flame lifts and stretches into a teardrop
  q.y -= g * 0.55 * uRf;
  q.y = q.y > 0.0 ? q.y / (1.0 + 2.4 * g) : q.y / (1.0 + 0.2 * g);
  q.xz *= 1.0 + g * 0.35 * smoothstep(0.0, 1.0, q.y / uRf);
  float n = fbm(p / max(uRf, 0.05) * 2.6 + vec3(0.0, -uTime * (0.25 + 3.2 * g), uTime * 0.12));
  float r = length(q) * (1.0 + (n - 0.5) * (0.035 + 0.4 * g));
  float x = (r - uRf) / uRf;
  float shell = exp(-x * x / (0.010 + 0.035 * g));                    // blue reaction zone
  float band = smoothstep(0.66, 0.76, r / uRf) * (1.0 - smoothstep(0.80, 0.89, r / uRf));
  float tip = g * smoothstep(-0.1, 0.9, p.y / uRf);
  // on Earth the blue zone survives mainly at the base; the sooty tip glows yellow
  vec3 blue = vec3(0.10, 0.30, 1.0) * uBlue * shell * GAIN_B
            * (1.0 - 0.75 * g * smoothstep(-0.3, 0.7, p.y / uRf));
  vec3 soot = vec3(1.0, 0.46, 0.07) * uSoot * band * (0.35 + 1.0 * n) * (0.5 + 1.4 * tip) * GAIN_S;
  float xc = (length(p) - uCoolR) / max(uCoolR, 0.05);
  vec3 cool = vec3(0.55, 0.68, 1.0) * uCool * exp(-xc * xc / 0.03) * 0.55;
  return (blue + soot + cool) / max(uRf, 0.15);
}

void main() {
  vec3 ro = cameraPosition - uOff;                 // work in the droplet's frame
  vec3 rd = normalize(vWorld - cameraPosition);
  vec2 h = hitSphere(ro, rd, uBound);
  if (h.y < 0.0) discard;
  float t0 = max(h.x, 0.0), t1 = h.y;
  vec2 dh = hitSphere(ro, rd, uDrop * 0.5);
  if (dh.x > 0.0) t1 = min(t1, dh.x);                                   // stop at the droplet
  float dt = (t1 - t0) / float(STEPS);
  float j = hash(vec3(gl_FragCoord.xy, uTime * 60.0));
  vec3 col = vec3(0.0);
  for (int i = 0; i < STEPS; i++) {
    vec3 p = ro + rd * (t0 + (float(i) + j) * dt);
    col += emission(p) * dt;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const SOOT_VERT = /* glsl */ `
attribute vec3 dir; attribute float rr; attribute float phase;
uniform float uRf, uTime, uG, uPx;
varying float vA;
void main() {
  vec3 p = dir * rr * uRf;
  float w = uTime * (0.25 + phase);
  p += 0.04 * uRf * vec3(sin(w * 3.1 + phase * 9.0), cos(w * 2.3 + phase * 5.0), sin(w * 1.7));
  float rise = mod(uTime * 0.9 * uRf + phase * 3.0 * uRf, 3.2 * uRf);   // Earth: soot streams up
  p.y += uG * rise;
  p.xz *= 1.0 - uG * 0.45 * clamp(rise / (3.2 * uRf), 0.0, 1.0);
  vA = 1.0 - uG * smoothstep(1.6 * uRf, 3.2 * uRf, rise);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uPx * (0.5 + phase) * uRf / -mv.z * 18.0;
  gl_Position = projectionMatrix * mv;
}`;
const SOOT_FRAG = /* glsl */ `
precision mediump float;
uniform float uOn; varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d) * uOn * vA;
  gl_FragColor = vec4(vec3(1.0, 0.38, 0.06) * a * 0.35, 1.0);
}`;

export function createFlameEngine(
  canvas: HTMLCanvasElement,
  quality: "high" | "low",
  onLost?: () => void,
): FlameEngine | null {
  if (!hasWebGL2()) return null;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas, antialias: quality === "high", powerPreference: "high-performance",
    });
  } catch {
    return null;
  }
  const lost = (e: Event) => { e.preventDefault(); onLost?.(); };
  canvas.addEventListener("webglcontextlost", lost);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === "high" ? 2 : 1.25));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#04060c");
  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 2000);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;

  // chamber: a dark rounded room and a 1 mm grid as a true scale
  const chamberMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: "varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 c = mix(vec3(0.010,0.014,0.03), vec3(0.03,0.045,0.08), smoothstep(-0.6,0.8,h)); gl_FragColor = vec4(c,1.0); }",
  });
  const chamber = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), chamberMat);
  scene.add(chamber);
  let grid = new THREE.GridHelper(60, 60, 0x2a3c66, 0x16213d);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.55;
  scene.add(grid);

  // droplet
  const dropMat = new THREE.MeshPhysicalMaterial({
    color: 0x9c8a6c, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04,
    ior: 1.39, envMapIntensity: 0.7, emissive: new THREE.Color(0x000000),
  });
  const rig = new THREE.Group(); // droplet, flame, soot, igniters: moved together
  scene.add(rig);
  const drop = new THREE.Mesh(new THREE.SphereGeometry(0.5, 64, 48), dropMat);
  rig.add(drop);
  const light = new THREE.PointLight(0xffb060, 0, 0, 1.2);
  rig.add(light);
  scene.add(new THREE.AmbientLight(0x6080c0, 0.25));
  const key = new THREE.DirectionalLight(0xcfe0ff, 0.6);
  key.position.set(3, 5, 4);
  scene.add(key);

  // igniters: two hot wires that touch the droplet, glow, then retract
  const wireMat = new THREE.MeshStandardMaterial({ color: 0x8a8f98, metalness: 0.8, roughness: 0.35, emissive: new THREE.Color(0xff5a10), emissiveIntensity: 0 });
  const wires = [-1, 1].map((s) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 14, 10), wireMat);
    m.rotation.z = Math.PI / 2;
    m.userData.side = s;
    rig.add(m);
    return m;
  });

  // flame volume
  const STEPS = quality === "high" ? 56 : 26;
  const flameMat = new THREE.ShaderMaterial({
    vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG,
    defines: { STEPS, GAIN_B: "0.6", GAIN_S: "1.4" },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 }, uRf: { value: 1 }, uDrop: { value: 1 }, uG: { value: 0 },
      uBlue: { value: 1 }, uSoot: { value: 1 }, uCool: { value: 0 }, uCoolR: { value: 1 },
      uBound: { value: 2 }, uOff: { value: new THREE.Vector3() },
    },
  });
  const flame = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), flameMat);
  flame.renderOrder = 2;
  rig.add(flame);

  // soot particles (heptane)
  const N = quality === "high" ? 700 : 300;
  const sootGeo = new THREE.BufferGeometry();
  const dirs = new Float32Array(N * 3), rr = new Float32Array(N), ph = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const v = new THREE.Vector3().randomDirection();
    dirs.set([v.x, v.y, v.z], i * 3);
    rr[i] = 0.55 + Math.random() * 0.32;
    ph[i] = Math.random();
  }
  sootGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  sootGeo.setAttribute("dir", new THREE.BufferAttribute(dirs, 3));
  sootGeo.setAttribute("rr", new THREE.BufferAttribute(rr, 1));
  sootGeo.setAttribute("phase", new THREE.BufferAttribute(ph, 1));
  const sootMat = new THREE.ShaderMaterial({
    vertexShader: SOOT_VERT, fragmentShader: SOOT_FRAG, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uRf: { value: 1 }, uTime: { value: 0 }, uG: { value: 0 }, uOn: { value: 0 },
                uPx: { value: renderer.getPixelRatio() } },
  });
  const soot = new THREE.Points(sootGeo, sootMat);
  soot.frustumCulled = false;
  rig.add(soot);

  // disruption: the droplet breaks into fragments
  const FR = 40;
  const frags = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 16, 12), dropMat, FR);
  const fragDir = Array.from({ length: FR }, () =>
    new THREE.Vector3().randomDirection().multiplyScalar(0.6 + Math.random()));
  const fragSize = Array.from({ length: FR }, () => 0.08 + Math.random() * 0.16);
  frags.visible = false;
  rig.add(frags);

  // post-processing
  let composer: EffectComposer | null = null;
  let bloom: UnrealBloomPass | null = null;
  if (quality === "high") {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.45, 0.4);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.dampingFactor = 0.08;
  let viewCb: ((q: THREE.Quaternion, dist: number) => void) | null = null;
  let applying = false;
  controls.addEventListener("change", () => {
    if (!applying && viewCb) viewCb(camera.quaternion.clone(), camera.position.length());
  });

  let scale = 20;
  function setScale(maxFlameMm: number) {
    scale = Math.max(4, maxFlameMm);
    const dist = scale * 3.3;
    camera.position.set(0, 0.5, 1).normalize().multiplyScalar(dist);
    controls.minDistance = scale * 0.5;
    controls.maxDistance = scale * 6;
    controls.target.set(0, 0, 0);
    controls.update();
    scene.remove(grid);
    grid.geometry.dispose();
    (grid.material as THREE.Material).dispose();
    const size = Math.ceil(scale * 2.4);
    grid = new THREE.GridHelper(size, size, 0x2a3c66, 0x16213d); // 1 mm cells
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    grid.position.y = -scale * 0.62;
    scene.add(grid);
  }
  setScale(20);

  const tmp = new THREE.Object3D();
  const blueOf = (o2: number) => 0.55 + 1.1 * THREE.MathUtils.clamp((o2 - 0.12) / 0.22, 0, 1);

  function frame(s: FrameState, dt: number) {
    const r = Math.max(s.d, 0) / 2;
    const rf = STANDOFF[s.fuel] * r;
    const showDrop = s.disrupt <= 0 && r > 0.002;
    drop.visible = showDrop;
    drop.scale.setScalar(Math.max(s.d, 0.001));
    dropMat.color.set(s.fuel === "Heptane" ? 0x9c8a6c : 0x7f8a9c);

    const u = flameMat.uniforms;
    const hot = s.flame;
    u.uTime.value = s.t;
    u.uRf.value = Math.max(rf, 0.05);
    u.uDrop.value = s.d;
    u.uG.value = s.gravity;
    u.uBlue.value = hot * blueOf(s.o2) * (s.fuel === "Methanol" ? 0.75 : 1);
    u.uSoot.value = hot * (s.fuel === "Heptane" ? 0.9 - 0.35 * s.gravity : 0.03 + 0.12 * s.gravity);
    u.uCool.value = s.cool;
    u.uCoolR.value = Math.max(r * 2.4, 0.2);
    const coolBound = s.cool > 0 ? r * 3.2 : 0;
    u.uBound.value = Math.max(rf * (1.35 + 2.6 * s.gravity), coolBound, 0.1);
    flame.scale.setScalar(u.uBound.value);
    flame.visible = hot > 0.001 || s.cool > 0.001;

    sootMat.uniforms.uRf.value = Math.max(rf, 0.05);
    sootMat.uniforms.uTime.value = s.t;
    sootMat.uniforms.uG.value = s.gravity;
    sootMat.uniforms.uOn.value = s.soot && s.fuel === "Heptane" ? hot : 0;
    soot.visible = sootMat.uniforms.uOn.value > 0.001;

    const glow = hot * blueOf(s.o2);
    light.color.set(s.fuel === "Heptane" ? 0xffa64a : 0x7aa2ff);
    light.intensity = glow * 0.3 * Math.max(rf, 0.5);
    dropMat.emissive.set(s.fuel === "Heptane" ? 0x1a0c02 : 0x060a1c).multiplyScalar(glow);

    // igniters approach the droplet, glow, then pull back
    const reach = (s.d > 0 ? s.d / 2 : 0.5) + 0.25;
    const out = s.igniter < 0 ? Math.min(1, -s.igniter) : 0;
    wires.forEach((m) => {
      const side = m.userData.side as number;
      m.position.set(side * (reach + 7 + out * scale * 1.2), 0, 0);
      m.visible = out < 1;
    });
    wireMat.emissiveIntensity = s.igniter > 0 ? 2.5 * s.igniter : 0;

    // on Earth the teardrop rises above the droplet: lower everything so it stays centred
    rig.position.y = -s.gravity * rf * 1.0;
    u.uOff.value.set(0, rig.position.y, 0);

    frags.visible = s.disrupt > 0 && s.disrupt < 1;
    if (frags.visible) {
      const k = s.disrupt;
      for (let i = 0; i < FR; i++) {
        tmp.position.copy(fragDir[i]).multiplyScalar(r + k * scale * 0.9);
        tmp.scale.setScalar(fragSize[i] * Math.max(s.d, 0.4) * (1 - k * 0.8));
        tmp.updateMatrix();
        frags.setMatrixAt(i, tmp.matrix);
      }
      frags.instanceMatrix.needsUpdate = true;
    }

    controls.update();
    if (dt > 0) chamber.rotation.y += dt * 0.002;
    if (composer) composer.render(dt);
    else renderer.render(scene, camera);
  }

  function resize() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false); // CSS gives the canvas its size (width/height: 100%)
    composer?.setSize(w, h);
    bloom?.resolution.set(w / 2, h / 2);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();

  return {
    frame,
    setScale,
    resize,
    onView(cb) { viewCb = cb; },
    setView(q, dist) {
      applying = true;
      camera.quaternion.copy(q);
      camera.position.set(0, 0, dist).applyQuaternion(q);
      controls.update();
      applying = false;
    },
    dispose() {
      canvas.removeEventListener("webglcontextlost", lost);
      controls.dispose();
      composer?.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
      });
      env.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}

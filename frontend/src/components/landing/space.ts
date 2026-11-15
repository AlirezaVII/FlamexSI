// Real-time WebGL planets for the landing page (three.js).
// Earth: NASA Blue Marble day map, city lights on the night side, drifting clouds, sun glint
// on the oceans, relief from a normal map and an atmosphere halo. Moon and Mars: lit spheres
// with surface relief. The camera is orthographic in CSS pixels, so the scroll paths in
// planets.ts place each planet exactly where the old 2D version did.
import * as THREE from "three";

export type PlanetKey = "earth" | "moon" | "mars";

export interface PlanetPose {
  x: number; // px from the left of the viewport
  y: number; // px from the top
  r: number; // radius, px
  spin: number; // turns
}

export interface SceneState {
  time: number; // ms
  sun: number; // radians the sunlight has swung around the scene (scroll-driven)
  tiltX: number; // pointer tilt, radians
  tiltY: number;
  iss: number; // 0..1 visibility of the orbiting station
}

export interface Space {
  render: (poses: Record<PlanetKey, PlanetPose>, state: SceneState) => void;
  setTheme: (light: boolean) => void;
  dispose: () => void;
}

// sunlight from the upper left, slightly towards the viewer (y up, z towards the camera)
const SUN = new THREE.Vector3(-0.62, 0.38, 0.68).normalize();

/**
 * The tiny (~10 KB) maps that let every planet appear at once, even on a slow connection.
 * The loading screen waits for these; the sharp maps and extra layers stream in afterwards.
 */
export const TEXTURES = [
  "/textures/earth-lo.webp",
  "/textures/moon-lo.webp",
  "/textures/mars-lo.webp",
];

const TILT: Record<PlanetKey, number> = { earth: 0.41, moon: 0.03, mars: 0.44 };
// turn each globe so the interesting side faces the reader at spin 0
const SPIN0: Record<PlanetKey, number> = { earth: -0.18, moon: 0.5, mars: 0.12 };

const earthVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewPos;
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const earthFragment = /* glsl */ `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform sampler2D specMap;
  uniform sampler2D normalMap;
  uniform sampler2D cloudMap;
  uniform vec3 sunDir;
  uniform float cloudShift;
  uniform vec4 has; // night, clouds, specular, normal maps arrived (0/1)
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewPos;

  // tangent frame from screen-space derivatives (no tangents needed on the sphere)
  vec3 perturb(vec3 pos, vec3 n, vec2 uv, vec3 mapN) {
    vec3 q0 = dFdx(pos); vec3 q1 = dFdy(pos);
    vec2 st0 = dFdx(uv); vec2 st1 = dFdy(uv);
    vec3 q1perp = cross(q1, n); vec3 q0perp = cross(n, q0);
    vec3 T = q1perp * st0.x + q0perp * st1.x;
    vec3 B = q1perp * st0.y + q0perp * st1.y;
    float det = max(dot(T, T), dot(B, B));
    float s = det == 0.0 ? 0.0 : inversesqrt(det);
    return normalize(T * (mapN.x * s) + B * (mapN.y * s) + n * mapN.z);
  }

  void main() {
    vec3 n = normalize(vNormal);
    vec3 mapN = texture2D(normalMap, vUv).xyz * 2.0 - 1.0;
    mapN.xy *= 0.8;
    vec3 nb = has.w > 0.5 ? perturb(vViewPos, n, vUv, mapN) : n;

    float sunN = dot(n, sunDir);
    float lit = max(dot(nb, sunDir), 0.0);
    float dayMix = smoothstep(-0.12, 0.22, sunN);

    vec3 day = texture2D(dayMap, vUv).rgb;
    day = pow(day, vec3(0.92)) * 1.12;
    float cloud = texture2D(cloudMap, vec2(vUv.x + cloudShift, vUv.y)).r;
    cloud = smoothstep(0.12, 0.9, cloud) * has.y;
    // soft cloud shadow, offset away from the sun
    float shadow = texture2D(cloudMap, vec2(vUv.x + cloudShift + 0.0025, vUv.y - 0.002)).r * has.y;

    vec3 surface = day * (lit * 1.15 + 0.03) * (1.0 - 0.35 * smoothstep(0.2, 0.9, shadow));
    float ocean = texture2D(specMap, vUv).r * has.z;
    vec3 h = normalize(sunDir + vec3(0.0, 0.0, 1.0));
    float glint = pow(max(dot(n, h), 0.0), 220.0) * ocean;
    surface += vec3(1.0, 0.93, 0.8) * glint * 0.4 * (1.0 - cloud);
    vec3 clouds = vec3(1.0) * (max(sunN, 0.0) * 1.05 + 0.02);
    vec3 dayCol = mix(surface, clouds, cloud * 0.92);

    vec3 lights = texture2D(nightMap, vUv).rgb;
    vec3 nightCol = lights * vec3(1.35, 1.1, 0.8) * 1.6 * (1.0 - cloud * 0.75) * has.x;

    vec3 col = mix(nightCol, dayCol, dayMix);
    // thin blue atmosphere at the limb, on the lit side
    float rim = pow(1.0 - max(dot(n, vec3(0.0, 0.0, 1.0)), 0.0), 2.6);
    col += vec3(0.32, 0.58, 1.0) * rim * smoothstep(-0.25, 0.6, sunN) * 0.9;
    // twilight band along the terminator
    col += vec3(1.0, 0.45, 0.2) * 0.08 * (1.0 - abs(sunN * 4.0 - 0.2)) * step(-0.05, sunN) * step(sunN, 0.3);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const haloVertex = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const haloFragment = /* glsl */ `
  uniform vec3 color;
  uniform vec3 sunDir;
  uniform float strength;
  uniform float limb; // -z of the back-face normal where it meets the planet's edge
  varying vec3 vNormal;
  void main() {
    vec3 n = normalize(vNormal);
    // 0 at the halo's outer edge, 1 where it touches the planet: fades out smoothly
    float i = pow(clamp(-n.z / limb, 0.0, 1.0), 2.4);
    float side = 0.35 + 0.65 * smoothstep(-0.6, 0.6, dot(n, sunDir));
    float k = clamp(i * side * strength, 0.0, 1.0);
    // premultiplied: glows over a dark page and tints a light one, never paints black
    gl_FragColor = vec4(color * k, k);
  }
`;

function halo(color: string, scale: number, strength: number) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: haloVertex,
    fragmentShader: haloFragment,
    uniforms: {
      color: { value: new THREE.Color(color) },
      sunDir: { value: SUN.clone() },
      strength: { value: strength },
      limb: { value: Math.sqrt(1 - 1 / (scale * scale)) },
    },
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(scale, 96, 64), mat);
  return { mesh, mat };
}

export function createSpace(
  canvas: HTMLCanvasElement,
  onTexture?: () => void,
  onReady?: () => void,
): Space | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
  } catch {
    return null; // no WebGL: the page still works, just without planets
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -6000, 6000);
  camera.position.z = 3000;

  const loader = new THREE.TextureLoader();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const textures: THREE.Texture[] = [];
  let disposed = false;
  const prep = (t: THREE.Texture, color: boolean) => {
    t.wrapS = THREE.RepeatWrapping; // clouds drift across the date line
    t.anisotropy = Math.min(8, maxAniso);
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    textures.push(t);
    return t;
  };
  /** load a map; call `use` when it arrives (never throws: a missing map just stays off) */
  const load = (src: string, color: boolean, use: (t: THREE.Texture) => void) => {
    loader.load(
      src,
      (t) => {
        if (disposed) return t.dispose();
        use(prep(t, color));
        onTexture?.();
      },
      undefined,
      () => {},
    );
  };
  const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  blank.needsUpdate = true;
  const loaded: Record<PlanetKey, boolean> = { earth: false, moon: false, mars: false };

  // ---- lights (Moon, Mars, the station) ----
  const sunDir = SUN.clone();
  const sun = new THREE.DirectionalLight(0xfff4e6, 3.1);
  sun.position.copy(SUN).multiplyScalar(1000);
  scene.add(sun, new THREE.AmbientLight(0x6070a0, 0.06));

  // ---- Earth: tiny day map first, then the sharp one and the extra layers ----
  const has = new THREE.Vector4(0, 0, 0, 0);
  const earthMat = new THREE.ShaderMaterial({
    vertexShader: earthVertex,
    fragmentShader: earthFragment,
    uniforms: {
      dayMap: { value: blank },
      nightMap: { value: blank },
      specMap: { value: blank },
      normalMap: { value: blank },
      cloudMap: { value: blank },
      sunDir: { value: sunDir },
      cloudShift: { value: 0 },
      has: { value: has },
    },
  });
  const U = earthMat.uniforms;
  load("/textures/earth-lo.webp", true, (t) => {
    if (U.dayMap.value === blank) U.dayMap.value = t;
    loaded.earth = true;
    onReady?.();
    // the sharp map and the layers, most visible first
    load("/textures/earth.webp", true, (hi) => (U.dayMap.value = hi));
    load("/textures/earth-clouds.webp", false, (c) => {
      U.cloudMap.value = c;
      has.y = 1;
    });
    load("/textures/earth-night.webp", true, (n) => {
      U.nightMap.value = n;
      has.x = 1;
    });
    load("/textures/earth-specular.webp", false, (sp) => {
      U.specMap.value = sp;
      has.z = 1;
    });
    load("/textures/earth-normal.webp", false, (nm) => {
      U.normalMap.value = nm;
      has.w = 1;
    });
  });
  const sphere = new THREE.SphereGeometry(1, 128, 96);
  const earth = new THREE.Mesh(sphere, earthMat);
  const earthHalo = halo("#4f95ff", 1.13, 1.25);
  earthHalo.mat.uniforms.sunDir.value = sunDir;

  // ---- Moon ----
  const moonMat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, bumpScale: 2.2 });
  load("/textures/moon-lo.webp", true, (t) => {
    if (!moonMat.map) moonMat.map = t;
    moonMat.needsUpdate = true;
    loaded.moon = true;
    load("/textures/moon.webp", true, (hi) => {
      moonMat.map = hi;
      moonMat.needsUpdate = true;
    });
    load("/textures/moon-height.webp", false, (b) => {
      moonMat.bumpMap = b;
      moonMat.needsUpdate = true;
    });
  });
  const moon = new THREE.Mesh(sphere, moonMat);

  // ---- Mars ----
  const marsMat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, bumpScale: 1.6 });
  load("/textures/mars-lo.webp", true, (t) => {
    if (!marsMat.map) marsMat.map = t;
    marsMat.needsUpdate = true;
    loaded.mars = true;
    load("/textures/mars.webp", true, (hi) => {
      marsMat.map = hi;
      marsMat.bumpMap = hi;
      marsMat.needsUpdate = true;
    });
  });
  const mars = new THREE.Mesh(sphere, marsMat);
  const marsHalo = halo("#ff8f5a", 1.06, 0.55);
  marsHalo.mat.uniforms.sunDir.value = sunDir;

  // each planet: a tilt group holding the spinning globe (and its halo, which does not spin)
  const groups = {} as Record<PlanetKey, THREE.Group>;
  const globes: Record<PlanetKey, THREE.Mesh> = { earth, moon, mars };
  for (const key of ["earth", "moon", "mars"] as PlanetKey[]) {
    const outer = new THREE.Group();
    const tilt = new THREE.Group();
    tilt.rotation.z = -TILT[key];
    tilt.add(globes[key]);
    outer.add(tilt);
    if (key === "earth") outer.add(earthHalo.mesh);
    if (key === "mars") outer.add(marsHalo.mesh);
    groups[key] = outer;
    scene.add(outer);
  }

  // ---- the ISS: where NASA's flame experiments burn, circling Earth ----
  const ORBIT = 1.3;
  const orbitPlane = new THREE.Group();
  orbitPlane.rotation.set(1.18, 0, -0.42); // seen almost edge-on, inclined
  groups.earth.add(orbitPlane);
  const ringPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 256; i++) {
    const a = (i / 256) * Math.PI * 2;
    ringPts.push(new THREE.Vector3(Math.cos(a) * ORBIT, Math.sin(a) * ORBIT, 0));
  }
  const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
  const ringMat = new THREE.LineDashedMaterial({
    color: 0x9fb8ff,
    dashSize: 0.025,
    gapSize: 0.03,
    transparent: true,
    opacity: 0.35,
  });
  const ring = new THREE.Line(ringGeo, ringMat);
  ring.computeLineDistances();
  orbitPlane.add(ring);

  // glowing trail behind the station: an arc whose alpha fades towards its tail
  const TRAIL = 90;
  const trailPos = new Float32Array(TRAIL * 3);
  const trailCol = new Float32Array(TRAIL * 4);
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
  trailGeo.setAttribute("color", new THREE.BufferAttribute(trailCol, 4));
  const trailMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
  });
  const trail = new THREE.Line(trailGeo, trailMat);
  orbitPlane.add(trail);

  const iss = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0xd9dde6, metalness: 0.6, roughness: 0.35 });
  const panel = new THREE.MeshStandardMaterial({
    color: 0x2a3f8a,
    metalness: 0.7,
    roughness: 0.25,
    emissive: 0x0a1440,
    side: THREE.DoubleSide,
  });
  const truss = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.006, 0.006), metal);
  const modules = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.07, 12), metal);
  modules.rotation.x = Math.PI / 2;
  iss.add(truss, modules);
  for (const side of [-1, 1]) {
    for (const off of [-0.018, 0.018]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.022), panel);
      p.position.set(side * 0.06, 0, off);
      p.rotation.x = -Math.PI / 2;
      iss.add(p);
    }
  }
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.008, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  iss.add(beacon);
  orbitPlane.add(iss);

  let W = 0;
  let H = 0;
  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w === W && h === H) return;
    W = w;
    H = h;
    renderer.setSize(w, h, false);
    camera.left = -w / 2;
    camera.right = w / 2;
    camera.top = h / 2;
    camera.bottom = -h / 2;
    camera.updateProjectionMatrix();
  }

  let light = false;
  const trailColor = new THREE.Color();

  return {
    render(poses, state) {
      resize();
      // sunlight swings around the scene as the reader travels: the terminator sweeps
      sunDir.copy(SUN).applyAxisAngle(new THREE.Vector3(0, 1, 0), state.sun);
      sun.position.copy(sunDir).multiplyScalar(1000);

      for (const key of Object.keys(poses) as PlanetKey[]) {
        const { x, y, r, spin } = poses[key];
        const g = groups[key];
        const visible =
          r > 1 && x + r * 1.4 > -60 && x - r * 1.4 < W + 60 && y + r * 1.4 > -60 && y - r * 1.4 < H + 60;
        g.visible = visible && loaded[key];
        if (!g.visible) continue;
        g.position.set(x - W / 2, H / 2 - y, -r * 1.5); // bigger (nearer) planets in front
        g.scale.setScalar(r);
        g.rotation.set(state.tiltX, state.tiltY, 0);
        globes[key].rotation.y = (spin + SPIN0[key]) * Math.PI * 2;
      }

      // the station: one lap every ~28 s, panels turned to the sun, a comet-like trail
      const show = state.iss;
      orbitPlane.visible = show > 0.01;
      if (orbitPlane.visible) {
        const theta = (state.time / 28000) * Math.PI * 2;
        iss.position.set(Math.cos(theta) * ORBIT, Math.sin(theta) * ORBIT, 0);
        iss.rotation.z = theta + Math.PI / 2;
        iss.scale.setScalar(0.6 + 0.4 * show);
        trailColor.set(light ? 0x2f4bd6 : 0xa9c4ff);
        for (let i = 0; i < TRAIL; i++) {
          const a = theta - (i / TRAIL) * 1.1;
          trailPos[i * 3] = Math.cos(a) * ORBIT;
          trailPos[i * 3 + 1] = Math.sin(a) * ORBIT;
          trailPos[i * 3 + 2] = 0;
          const f = Math.pow(1 - i / TRAIL, 1.8) * show;
          trailCol[i * 4] = trailColor.r;
          trailCol[i * 4 + 1] = trailColor.g;
          trailCol[i * 4 + 2] = trailColor.b;
          trailCol[i * 4 + 3] = f;
        }
        trailGeo.attributes.position.needsUpdate = true;
        trailGeo.attributes.color.needsUpdate = true;
        ringMat.opacity = (light ? 0.45 : 0.3) * show;
        (beacon.material as THREE.MeshBasicMaterial).color.setHSL(
          0.6,
          0.2,
          0.6 + 0.4 * Math.max(0, Math.sin(state.time / 180)),
        );
      }

      earthMat.uniforms.cloudShift.value = (state.time / 1000) * 0.0009;
      renderer.render(scene, camera);
    },
    setTheme(isLight) {
      light = isLight;
      // on a bright page the halos would wash out: make them deeper instead of brighter
      earthHalo.mat.uniforms.strength.value = isLight ? 0.9 : 1.25;
      marsHalo.mat.uniforms.strength.value = isLight ? 0.4 : 0.55;
      ringMat.color.set(isLight ? 0x3a55d8 : 0x9fb8ff);
    },
    dispose() {
      disposed = true;
      blank.dispose();
      renderer.dispose();
      sphere.dispose();
      earthMat.dispose();
      moonMat.dispose();
      marsMat.dispose();
      earthHalo.mat.dispose();
      marsHalo.mat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      trailGeo.dispose();
      trailMat.dispose();
      metal.dispose();
      panel.dispose();
      textures.forEach((t) => t.dispose());
    },
  };
}

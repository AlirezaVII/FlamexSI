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

export interface Space {
  render: (poses: Record<PlanetKey, PlanetPose>, time: number) => void;
  setTheme: (light: boolean) => void;
  dispose: () => void;
}

// sunlight from the upper left, slightly towards the viewer (y up, z towards the camera)
const SUN = new THREE.Vector3(-0.62, 0.38, 0.68).normalize();

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
    vec3 nb = perturb(vViewPos, n, vUv, mapN);

    float sunN = dot(n, sunDir);
    float lit = max(dot(nb, sunDir), 0.0);
    float dayMix = smoothstep(-0.12, 0.22, sunN);

    vec3 day = texture2D(dayMap, vUv).rgb;
    day = pow(day, vec3(0.92)) * 1.12;
    float cloud = texture2D(cloudMap, vec2(vUv.x + cloudShift, vUv.y)).r;
    cloud = smoothstep(0.12, 0.9, cloud);
    // soft cloud shadow, offset away from the sun
    float shadow = texture2D(cloudMap, vec2(vUv.x + cloudShift + 0.0025, vUv.y - 0.002)).r;

    vec3 surface = day * (lit * 1.15 + 0.03) * (1.0 - 0.35 * smoothstep(0.2, 0.9, shadow));
    float ocean = texture2D(specMap, vUv).r;
    vec3 h = normalize(sunDir + vec3(0.0, 0.0, 1.0));
    float glint = pow(max(dot(n, h), 0.0), 220.0) * ocean;
    surface += vec3(1.0, 0.93, 0.8) * glint * 0.4 * (1.0 - cloud);
    vec3 clouds = vec3(1.0) * (max(sunN, 0.0) * 1.05 + 0.02);
    vec3 dayCol = mix(surface, clouds, cloud * 0.92);

    vec3 lights = texture2D(nightMap, vUv).rgb;
    vec3 nightCol = lights * vec3(1.35, 1.1, 0.8) * 1.6 * (1.0 - cloud * 0.75);

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
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -4000, 4000);
  camera.position.z = 2000;

  const manager = new THREE.LoadingManager();
  manager.onProgress = () => onTexture?.(); // redraw as each map arrives
  const loader = new THREE.TextureLoader(manager);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const tex = (src: string, color = true) => {
    const t = loader.load(src);
    t.wrapS = THREE.RepeatWrapping; // clouds drift across the date line
    t.anisotropy = Math.min(8, maxAniso);
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };

  // ---- lights (Moon, Mars) ----
  const sun = new THREE.DirectionalLight(0xfff4e6, 3.1);
  sun.position.copy(SUN).multiplyScalar(1000);
  scene.add(sun, new THREE.AmbientLight(0x6070a0, 0.06));

  // ---- Earth ----
  const earthMat = new THREE.ShaderMaterial({
    vertexShader: earthVertex,
    fragmentShader: earthFragment,
    uniforms: {
      dayMap: { value: tex("/textures/earth.jpg") },
      nightMap: { value: tex("/textures/earth-night.jpg") },
      specMap: { value: tex("/textures/earth-specular.jpg", false) },
      normalMap: { value: tex("/textures/earth-normal.jpg", false) },
      cloudMap: { value: tex("/textures/earth-clouds.jpg", false) },
      sunDir: { value: SUN.clone() },
      cloudShift: { value: 0 },
    },
  });
  const sphere = new THREE.SphereGeometry(1, 128, 96);
  const earth = new THREE.Mesh(sphere, earthMat);
  const earthHalo = halo("#4f95ff", 1.13, 1.25);

  // ---- Moon ----
  const moonMat = new THREE.MeshStandardMaterial({
    map: tex("/textures/moon.jpg"),
    bumpMap: tex("/textures/moon-height.jpg", false),
    bumpScale: 2.2,
    roughness: 1,
    metalness: 0,
  });
  const moon = new THREE.Mesh(sphere, moonMat);

  // ---- Mars ----
  const marsMap = tex("/textures/mars.jpg");
  const marsMat = new THREE.MeshStandardMaterial({
    map: marsMap,
    bumpMap: tex("/textures/mars.jpg", false),
    bumpScale: 1.6,
    roughness: 0.95,
    metalness: 0,
  });
  const mars = new THREE.Mesh(sphere, marsMat);
  const marsHalo = halo("#ff8f5a", 1.06, 0.55);

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

  return {
    render(poses, time) {
      resize();
      for (const key of Object.keys(poses) as PlanetKey[]) {
        const { x, y, r, spin } = poses[key];
        const g = groups[key];
        const visible =
          r > 1 && x + r > -60 && x - r < W + 60 && y + r > -60 && y - r < H + 60;
        g.visible = visible;
        if (!visible) continue;
        g.position.set(x - W / 2, H / 2 - y, -r); // bigger (nearer) planets in front
        g.scale.setScalar(r);
        globes[key].rotation.y = (spin + SPIN0[key]) * Math.PI * 2;
      }
      earthMat.uniforms.cloudShift.value = (time / 1000) * 0.0009;
      renderer.render(scene, camera);
    },
    setTheme(light) {
      // on a bright page the halos would wash out: make them deeper instead of brighter
      earthHalo.mat.uniforms.strength.value = light ? 0.9 : 1.25;
      marsHalo.mat.uniforms.strength.value = light ? 0.4 : 0.55;
    },
    dispose() {
      renderer.dispose();
      sphere.dispose();
      earthMat.dispose();
      moonMat.dispose();
      marsMat.dispose();
      earthHalo.mat.dispose();
      marsHalo.mat.dispose();
      marsMap.dispose();
    },
  };
}

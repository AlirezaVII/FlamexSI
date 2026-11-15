// A fragment shader on a full-canvas quad, in plain WebGL (1 or 2). Used for the flame on
// the loading screen and the landing-page chamber, so they work on any GPU that has WebGL
// at all, and so the loading screen does not have to ship three.js on every page.

export interface Quad {
  /** resize to the canvas' CSS size, set uniforms (floats or vec2s) and draw */
  draw: (uniforms: Record<string, number | [number, number]>) => void;
  dispose: () => void;
}

const VERTEX = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

export function createQuad(
  canvas: HTMLCanvasElement,
  fragment: string,
  transparent = false,
): Quad | null {
  const opts: WebGLContextAttributes = {
    alpha: transparent,
    premultipliedAlpha: true,
    antialias: false,
    preserveDrawingBuffer: false,
  };
  const gl =
    (canvas.getContext("webgl2", opts) as WebGL2RenderingContext | null) ??
    (canvas.getContext("webgl", opts) as WebGLRenderingContext | null);
  if (!gl) return null;

  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn("Falmex flame shader:", gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl.FRAGMENT_SHADER, fragment);
  if (!vs || !fs) return null;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "position");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const locs = new Map<string, WebGLUniformLocation | null>();
  const where = (name: string) => {
    if (!locs.has(name)) locs.set(name, gl.getUniformLocation(prog, name));
    return locs.get(name)!;
  };

  return {
    draw(uniforms) {
      const pr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(canvas.clientWidth * pr));
      const h = Math.max(1, Math.round(canvas.clientHeight * pr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(where("res"), w, h);
      for (const [k, v] of Object.entries(uniforms)) {
        const l = where(k);
        if (!l) continue;
        if (typeof v === "number") gl.uniform1f(l, v);
        else gl.uniform2f(l, v[0], v[1]);
      }
      if (transparent) {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    },
  };
}

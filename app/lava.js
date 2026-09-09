"use client";
import { useEffect, useRef } from "react";

// Lava lamp metaballs (ambient) + minimal Navier-Stokes fluid sim (mouse).
// The mouse injects velocity only — the fluid's velocity field warps the
// blobs (uWarp), so the cursor disrupts what's already floating there.
// Tune live at /?lab

const DEFAULTS = {
  force: 1600,   // mouse -> velocity strength
  radius: 0.005002, // stir radius
  hard: 0.4665,  // brush hardness: 1 = soft gaussian, higher = flat center + crisp edge
  curl: 0,       // swirl strength
  fade: 0.950985, // per-frame velocity dissipation (how fast it calms down)
  warp: 0.0153,  // how much the fluid distorts the blobs
  speed: 0.2075, // ambient drift speed
  s1: 0.4395, s2: 0.6865, s3: 0.6485, // blob sizes (cycled down the page)
  gap: 0.8,      // vertical spacing between blobs, in viewport-min units
};
const RANGES = {
  force: [0, 20000], radius: [0.0002, 0.01], hard: [0.3, 4], curl: [0, 50], fade: [0.9, 0.999],
  warp: [0, 0.06], speed: [0, 0.5], s1: [0.05, 1], s2: [0.05, 1], s3: [0.05, 1], gap: [0.3, 2],
};
const SIM_RES = 128;
const PRESSURE_ITERS = 20;

const VERT = `#version 300 es
precision highp float;
in vec2 aPos;
out vec2 vUv, vL, vR, vT, vB;
uniform vec2 uTexel;
void main() {
  vUv = aPos * 0.5 + 0.5;
  vL = vUv - vec2(uTexel.x, 0.0);
  vR = vUv + vec2(uTexel.x, 0.0);
  vB = vUv - vec2(0.0, uTexel.y);
  vT = vUv + vec2(0.0, uTexel.y);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const H = `#version 300 es
precision highp float;
in vec2 vUv, vL, vR, vT, vB;
out vec4 o;`;

const FRAGS = {
  splat: `${H}
  uniform sampler2D uTarget;
  uniform float uAspect, uRadius, uHard;
  uniform vec3 uColor;
  uniform vec2 uPoint;
  void main() {
    vec2 p = vUv - uPoint;
    p.x *= uAspect;
    vec3 v = texture(uTarget, vUv).xyz + exp(-pow(dot(p, p) / uRadius, uHard)) * uColor;
    float m = length(v.xy);
    if (m > 40.0) v.xy *= 40.0 / m; /* terminal speed: sustained stirring can't accumulate into a blowup */
    o = vec4(v, 1.0);
  }`,

  advect: `${H}
  uniform sampler2D uVel, uSource;
  uniform vec2 uTexel;
  uniform float uDt, uDissipation;
  void main() {
    vec2 coord = vUv - uDt * texture(uVel, vUv).xy * uTexel;
    o = uDissipation * texture(uSource, coord);
  }`,

  curl: `${H}
  uniform sampler2D uVel;
  void main() {
    float L = texture(uVel, vL).y, R = texture(uVel, vR).y;
    float T = texture(uVel, vT).x, B = texture(uVel, vB).x;
    o = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
  }`,

  vorticity: `${H}
  uniform sampler2D uVel, uCurl;
  uniform float uStrength, uDt;
  void main() {
    float L = texture(uCurl, vL).x, R = texture(uCurl, vR).x;
    float T = texture(uCurl, vT).x, B = texture(uCurl, vB).x;
    float C = texture(uCurl, vUv).x;
    vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
    force = force / (length(force) + 1e-4) * uStrength * C;
    force.y *= -1.0;
    o = vec4(texture(uVel, vUv).xy + force * uDt, 0.0, 1.0);
  }`,

  divergence: `${H}
  uniform sampler2D uVel;
  void main() {
    float L = texture(uVel, vL).x, R = texture(uVel, vR).x;
    float T = texture(uVel, vT).y, B = texture(uVel, vB).y;
    vec2 C = texture(uVel, vUv).xy;
    if (vL.x < 0.0) L = -C.x;
    if (vR.x > 1.0) R = -C.x;
    if (vT.y > 1.0) T = -C.y;
    if (vB.y < 0.0) B = -C.y;
    o = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
  }`,

  clear: `${H}
  uniform sampler2D uTexture;
  uniform float uValue;
  void main() { o = uValue * texture(uTexture, vUv); }`,

  pressure: `${H}
  uniform sampler2D uPressure, uDivergence;
  void main() {
    float L = texture(uPressure, vL).x, R = texture(uPressure, vR).x;
    float T = texture(uPressure, vT).x, B = texture(uPressure, vB).x;
    o = vec4((L + R + B + T - texture(uDivergence, vUv).x) * 0.25, 0.0, 0.0, 1.0);
  }`,

  project: `${H}
  uniform sampler2D uPressure, uVel;
  void main() {
    float L = texture(uPressure, vL).x, R = texture(uPressure, vR).x;
    float T = texture(uPressure, vT).x, B = texture(uPressure, vB).x;
    o = vec4(texture(uVel, vUv).xy - vec2(R - L, T - B), 0.0, 1.0);
  }`,

  display: `${H}
  uniform sampler2D uVel;
  uniform vec2 uRes;
  uniform float uT, uWarp, uScroll, uGap, uCount, uReveal, uGlowX, uDim;
  uniform vec3 uSizes;
  float blob(vec2 p, vec2 c, float r) {
    vec2 d = p - c;
    return exp(-dot(d, d) / (r * r));
  }
  void main() {
    vec2 asp = uRes / min(uRes.x, uRes.y);
    vec2 p = (vUv - 0.5) * asp - texture(uVel, vUv).xy * uWarp;
    vec2 q = p;
    q.y -= uScroll; /* blobs live in page space; scrolling travels through them */
    q.y += (1.0 - uReveal) * 0.85; /* preloader: field sunk below the fold, rises on reveal */
    float t = uT;
    /* preloader glow: sweeps left-right (JS drives uGlowX + stirs the fluid), hands off to the rising field */
    float f = blob(p, vec2(uGlowX, -0.85 + sin(t * 0.8) * 0.05), 0.8 + 0.06 * sin(t * 1.3))
      * (1.0 - uReveal) * 1.4;
    for (float i = 0.0; i < 24.0; i += 1.0) {
      if (i >= uCount) break;
      float h1 = fract(sin((i + 1.0) * 12.9898) * 43758.5453);
      float h2 = fract(sin((i + 1.0) * 78.233) * 43758.5453);
      vec2 c = vec2(
        sin(t * (0.4 + h1 * 0.5) + h1 * 6.283) * (0.3 + h2 * 0.35),
        -i * uGap + cos(t * (0.3 + h2 * 0.4) + h2 * 6.283) * 0.22
      );
      f += blob(q, c, uSizes[int(mod(i, 3.0))]);
    }

    vec3 base = vec3(0.000, 0.098, 0.102); /* #00191A */
    vec3 c0 = vec3(0.082, 0.216, 0.235);   /* #15373C */
    vec3 c1 = vec3(0.110, 0.325, 0.353);   /* #1C535A */
    vec3 c2 = vec3(0.522, 0.831, 0.878);   /* #85D4E0 */

    vec3 col = mix(base, c0, smoothstep(0.1, 0.7, f));
    col = mix(col, c1, smoothstep(0.5, 1.3, f));
    col = mix(col, c2, smoothstep(1.1, 2.2, f));
    col = mix(col, base * 0.6, uDim * 0.7); /* video expanding: field sinks toward the dark */
    col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 128.0;
    o = vec4(col, 1.0);
  }`,
};

export default function Lava() {
  const ref = useRef(null);
  const preRef = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    const pre = preRef.current;
    const gl = canvas.getContext("webgl2", { antialias: false, depth: false, stencil: false, alpha: false });
    if (!gl || !gl.getExtension("EXT_color_buffer_float")) {
      // no WebGL2 float targets -> CSS bg only, skip the preloader entirely
      document.body.classList.remove("preloading");
      pre.classList.add("done");
      return;
    }

    const P = { ...DEFAULTS };
    try { Object.assign(P, JSON.parse(localStorage.lavaP)); } catch {}

    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, VERT);
    gl.compileShader(vs);

    const progs = {};
    for (const [name, src] of Object.entries(FRAGS)) {
      const fs = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fs, src);
      gl.compileShader(fs);
      const p = gl.createProgram();
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.bindAttribLocation(p, 0, "aPos");
      gl.linkProgram(p);
      const u = {};
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) {
        const info = gl.getActiveUniform(p, i);
        u[info.name] = gl.getUniformLocation(p, info.name);
      }
      progs[name] = { p, u };
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const fbo = (w, h, ifmt, fmt, filter) => {
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, gl.HALF_FLOAT, null);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return {
        tex, fb, w, h,
        attach(id) {
          gl.activeTexture(gl.TEXTURE0 + id);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          return id;
        },
      };
    };
    const dfbo = (w, h, ifmt, fmt, filter) => {
      let read = fbo(w, h, ifmt, fmt, filter);
      let write = fbo(w, h, ifmt, fmt, filter);
      return {
        get read() { return read; },
        get write() { return write; },
        swap() { [read, write] = [write, read]; },
      };
    };

    let velocity, pressure, divergence, curl, simTexel;
    const initSim = () => {
      const a = innerWidth / innerHeight;
      const [sw, sh] = a > 1 ? [Math.round(SIM_RES * a), SIM_RES] : [SIM_RES, Math.round(SIM_RES / a)];
      simTexel = [1 / sw, 1 / sh];
      velocity = dfbo(sw, sh, gl.RG16F, gl.RG, gl.LINEAR);
      pressure = dfbo(sw, sh, gl.R16F, gl.RED, gl.NEAREST);
      divergence = fbo(sw, sh, gl.R16F, gl.RED, gl.NEAREST);
      curl = fbo(sw, sh, gl.R16F, gl.RED, gl.NEAREST);
    };

    const dpr = Math.min(devicePixelRatio, 1.5);
    const resize = () => {
      canvas.width = innerWidth * dpr;
      canvas.height = innerHeight * dpr;
      initSim();
    };
    resize();
    addEventListener("resize", resize);

    const blit = (prog, target, texel) => {
      gl.useProgram(prog.p);
      if (prog.u.uTexel) gl.uniform2f(prog.u.uTexel, texel[0], texel[1]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
      gl.viewport(0, 0, target ? target.w : canvas.width, target ? target.h : canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const splats = [];
    let last = null;
    const onMove = (e) => {
      const x = e.clientX / innerWidth, y = 1 - e.clientY / innerHeight;
      if (last && reveal >= 1) splats.push({ x, y, dx: (x - last.x) * P.force, dy: (y - last.y) * P.force });
      last = { x, y };
    };
    addEventListener("pointermove", onMove);

    const drawDisplay = (t) => {
      const d = progs.display;
      gl.useProgram(d.p);
      gl.uniform1i(d.u.uVel, velocity.read.attach(0));
      gl.uniform2f(d.u.uRes, canvas.width, canvas.height);
      gl.uniform1f(d.u.uT, t);
      gl.uniform1f(d.u.uWarp, P.warp);
      gl.uniform3f(d.u.uSizes, P.s1, P.s2, P.s3);
      const minDim = Math.min(innerWidth, innerHeight);
      gl.uniform1f(d.u.uScroll, scrollY / minDim); // Lenis animates real scroll, so this is already smoothed
      gl.uniform1f(d.u.uGap, P.gap);
      gl.uniform1f(d.u.uCount, Math.min(24, Math.ceil(document.documentElement.scrollHeight / minDim / P.gap) + 1));
      gl.uniform1f(d.u.uReveal, reveal);
      gl.uniform1f(d.u.uGlowX, glowX);
      gl.uniform1f(d.u.uDim, window.__videoDim || 0); // set by initVideoExpand (custom.js)
      blit(d, null, simTexel);
    };

    // --- lab panel (/?lab): live-tunes P, persists to localStorage ---
    let panel;
    if (new URLSearchParams(location.search).has("lab")) {
      panel = document.createElement("div");
      panel.className = "lab";
      for (const k of Object.keys(DEFAULTS)) {
        const [min, max] = RANGES[k];
        const row = document.createElement("label");
        const inp = Object.assign(document.createElement("input"), {
          type: "range", min, max, step: (max - min) / 200, value: P[k],
        });
        const val = document.createElement("span");
        val.textContent = P[k];
        inp.oninput = () => {
          P[k] = +inp.value;
          val.textContent = inp.value;
          localStorage.lavaP = JSON.stringify(P);
        };
        row.append(k, inp, val);
        panel.append(row);
      }
      const copy = document.createElement("button");
      copy.textContent = "copy values";
      copy.onclick = () => navigator.clipboard.writeText(JSON.stringify(P, null, 1)).then(() => (copy.textContent = "copied ✓"));
      const reset = document.createElement("button");
      reset.textContent = "reset";
      reset.onclick = () => { localStorage.removeItem("lavaP"); location.reload(); };
      panel.append(copy, reset);
      document.body.append(panel);
    }

    // --- preloader: shader starts sunk (reveal 0), rises once the page has loaded ---
    let reveal = 0, revealAt = 0, dead = false, glowX = 0, prevGlowX = null, sweepT0 = 0;
    document.documentElement.style.overflow = "hidden";
    const startReveal = () => {
      if (dead || revealAt) return;
      revealAt = performance.now();
      pre.classList.add("done");
      document.body.classList.remove("preloading"); // content fades in via CSS delay as the field rises
      document.documentElement.style.overflow = "";
      window.lenis?.start();
      dispatchEvent(new Event("rns:reveal"));
    };
    if (new URLSearchParams(location.search).has("nopre")) { reveal = 1; startReveal(); } // dev: skip preloader
    const loaded = new Promise((r) =>
      document.readyState === "complete" ? r() : addEventListener("load", r, { once: true })
    );
    Promise.all([loaded, new Promise((r) => setTimeout(r, 2800))]).then(startReveal); // min hold: ~one full sweep

    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      reveal = 1;
      startReveal();
      drawDisplay(0);
      return () => { removeEventListener("resize", resize); panel?.remove(); document.documentElement.style.overflow = ""; };
    }

    let raf, prev = 0, t = 0;
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min((now - prev) / 1000 || 0.016, 0.033);
      prev = now;
      t += dt * P.speed; // integrate so tuning speed live doesn't make blobs jump

      if (revealAt && reveal < 1) {
        const k = Math.min((now - revealAt) / 1600, 1);
        reveal = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2; // easeInOutCubic
      }

      // preloader choreography: glow sweeps left<->right, stirring the fluid it floats in
      if (reveal < 1) {
        if (!sweepT0) sweepT0 = now; // phase-lock: sweep always starts dead center
        glowX = Math.sin(((now - sweepT0) / 1000) * 1.1) * 0.55;
        const aspX = innerWidth / Math.min(innerWidth, innerHeight);
        if (prevGlowX !== null)
          splats.push({ x: glowX / aspX + 0.5, y: 0.06, dx: ((glowX - prevGlowX) / aspX) * P.force * 0.8 * (1 - reveal), dy: 0 });
        prevGlowX = glowX;
      }

      const s = progs.splat;
      for (const sp of splats) {
        gl.useProgram(s.p);
        gl.uniform1f(s.u.uAspect, innerWidth / innerHeight);
        gl.uniform2f(s.u.uPoint, sp.x, sp.y);
        gl.uniform1f(s.u.uRadius, P.radius);
        gl.uniform1f(s.u.uHard, P.hard);
        gl.uniform1i(s.u.uTarget, velocity.read.attach(0));
        gl.uniform3f(s.u.uColor, sp.dx, sp.dy, 0);
        blit(s, velocity.write, simTexel);
        velocity.swap();
      }
      splats.length = 0;

      gl.useProgram(progs.curl.p);
      gl.uniform1i(progs.curl.u.uVel, velocity.read.attach(0));
      blit(progs.curl, curl, simTexel);

      gl.useProgram(progs.vorticity.p);
      gl.uniform1i(progs.vorticity.u.uVel, velocity.read.attach(0));
      gl.uniform1i(progs.vorticity.u.uCurl, curl.attach(1));
      gl.uniform1f(progs.vorticity.u.uStrength, P.curl);
      gl.uniform1f(progs.vorticity.u.uDt, dt);
      blit(progs.vorticity, velocity.write, simTexel);
      velocity.swap();

      gl.useProgram(progs.divergence.p);
      gl.uniform1i(progs.divergence.u.uVel, velocity.read.attach(0));
      blit(progs.divergence, divergence, simTexel);

      gl.useProgram(progs.clear.p);
      gl.uniform1i(progs.clear.u.uTexture, pressure.read.attach(0));
      gl.uniform1f(progs.clear.u.uValue, 0.8);
      blit(progs.clear, pressure.write, simTexel);
      pressure.swap();

      gl.useProgram(progs.pressure.p);
      gl.uniform1i(progs.pressure.u.uDivergence, divergence.attach(1));
      for (let i = 0; i < PRESSURE_ITERS; i++) {
        gl.uniform1i(progs.pressure.u.uPressure, pressure.read.attach(0));
        blit(progs.pressure, pressure.write, simTexel);
        pressure.swap();
      }

      gl.useProgram(progs.project.p);
      gl.uniform1i(progs.project.u.uPressure, pressure.read.attach(0));
      gl.uniform1i(progs.project.u.uVel, velocity.read.attach(1));
      blit(progs.project, velocity.write, simTexel);
      velocity.swap();

      const a = progs.advect;
      gl.useProgram(a.p);
      gl.uniform1f(a.u.uDt, dt);
      gl.uniform1f(a.u.uDissipation, P.fade);
      gl.uniform1i(a.u.uVel, velocity.read.attach(0));
      gl.uniform1i(a.u.uSource, velocity.read.attach(0));
      blit(a, velocity.write, simTexel);
      velocity.swap();

      drawDisplay(t);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      removeEventListener("resize", resize);
      removeEventListener("pointermove", onMove);
      panel?.remove();
      document.documentElement.style.overflow = "";
    };
  }, []);

  return (
    <>
      <canvas ref={ref} className="lava" aria-hidden="true" />
      <div ref={preRef} className="preloader">
        <img src="/rns-logo.svg" alt="Rebel & Soul — The Memory Makers" />
      </div>
    </>
  );
}

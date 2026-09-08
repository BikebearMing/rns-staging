"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import gsap from "gsap";

/* --------------------------------------------------------------------------
   3D image staircase. Cards sit on a parametric helix, and the view is
   camera-locked to the front card: each frame the ring is shifted so the
   card at the camera-facing angle sits at eye level — the viewer never sees
   the helix's diagonal, just one big image with the rest winding below.

   Rest: card 1 up-right and receded (REST_ANGLE), the others overflow below
   the fold (negative pitch), with a gentle bounded sway (not endless drift —
   the helix is finite, unbounded spin would walk the front card off-screen).
   Intro: the entrance wind-up (off) decays and, through the camera-lock,
   itself drives the corkscrew climb from below.
   Scroll (window.__heroScroll 0..1 over the pinned hero — custom.js): the
   ring spins from the first pixel while the camera pulls back across the
   first RECEDE slice (depth, concurrent with the text receding in
   custom.js) — the top card spirals up and away, the next rises from below
   into the same pose, everything growing slightly — through the remaining
   N-1 cards; the last card then just holds while the next section scrolls
   over. (No scroll-linked canvas fade: a ScrollTrigger here raced
   the pin spacer on slow font loads — don't reintroduce one.)
   Drop real photos at public/stair/1.jpg ... 6.jpg (placeholders until then).
   -------------------------------------------------------------------------- */

const N = 6;
const START = { y: -20, pitch: -5, off: 13 };
const REST = { y: 0, pitch: -1.6, off: 0 }; /* negative pitch: upcoming cards wind DOWNWARD */
const INTRO_SECS = 4.2;
const FRONT_Y = -0.25; /* anchor the front pose locks to; lowered ~30% of view height so the top card reads centered */
const REST_ANGLE = -0.5; /* viewing pose: front card swung right + receded; cards cycle through it */
const GROW_START = 0.85; /* cards rest slightly small and scale up to 1 across the scroll */
const CAM_Z = 6.2; /* rest camera sits close — the front card reads big, so the zoom-out has travel */
/* Depth layer: the camera pulls BACK across the first slice of the pin
   (real parallax: the front card shrinks faster than the deep ones and more
   helix rises into view) — layered ON TOP of the spin, which runs over the
   whole pin from the first pixel. One motion, not two beats. */
const RECEDE = 0.3; /* fraction of the pin the dolly-out is spread across */
const DOLLY = 3; /* how far the camera backs off across that slice (lands at the same z as before) */
const INTRO_DOLLY = 6; /* preloader arrival: camera starts this far BEYOND rest and flies in */
const FOG_STEP = 0.3; /* per-step sink into depth shadow — deep cards darken toward near-black */
const INTRO_STAG = 0.35; /* deeper cards lag the intro rise — the helix assembles top-first */
const EXIT_STEPS = 1; /* extra card-steps of spin while the unpinned hero scrolls off */
/* Jelly scroll: cards bow in the scroll direction, driven by Lenis velocity
   through an underdamped spring — they lag, overshoot, and wobble settled. */
const BEND_K = 0.0068; /* Lenis velocity -> bend amount */
const BEND_MAX = 0.19; /* world-unit cap on the bow */
const BEND_STIFF = 55; /* spring stiffness */
const BEND_DAMP = 12; /* spring damping (per second) */
/* Second flutter mode: a lighter, faster spring excited by bend velocity
   (i.e. scroll acceleration) — the sheet ripples and flutters out after. */
const RIP_DRIVE = 0.09; /* how hard bend velocity pumps the ripple */
const RIP_STIFF = 260; /* ripple frequency (~2.5 Hz) */
const RIP_DAMP = 5; /* light damping so the flutter lingers briefly */
const RIP_MAX = 0.05; /* amplitude cap — violent scrolls saturate instead of thrashing */
const BLUR_STEP = 1.2; /* extra mip-blur per step below the front pose; unblurs as a card comes up */

function placeholderTexture(i) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 192;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 256, 192);
  grad.addColorStop(0, `hsl(${168 + i * 9} 45% ${16 + (i % 3) * 7}%)`);
  grad.addColorStop(1, `hsl(${186 + i * 7} 55% ${32 + (i % 4) * 6}%)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 192);
  return new THREE.CanvasTexture(c);
}

/* Depth of field without a postprocessing pass (which would paint an opaque
   background over the lava): each card samples its texture at a coarser
   mip level the further it sits from the focus plane. */
/* The reverse is soft but must stay READABLE as the photo — sampled too far
   up the mip chain it collapses to that texture's average colour, which is
   what made backs look like flat painted cards. */
const BACK_BLUR = 1.6; /* base softness on a card's reverse */
const BACK_LOD_MAX = 3.2; /* hard ceiling — beyond this the image goes flat */
const BACK_DIM = 0.62; /* how much darker the reverse sits */
const cardShader = {
  vertexShader: `
    uniform float uBend;
    uniform float uRipple;
    uniform float uTime;
    varying vec2 vUv;
    void main() {
      vUv = uv;
      vec3 p = position;
      float cx = uv.x * 2.0 - 1.0;
      float bow = 1.0 - cx * cx;
      float cy = uv.y * 2.0 - 1.0;
      p.y += uBend * bow; // mode 1: center leads, edges trail — jelly bow
      // mode 2: travelling ripple — wind moving across the sheet; amplitude
      // (uRipple) is excited by scroll acceleration and flutters out after
      float wave = sin(cy * 4.7 - uTime * 6.0) + 0.5 * sin(cy * 8.3 - uTime * 9.0 + cx * 2.0);
      p.xz -= normalize(p.xz) * (uBend * cy * cy * 0.6 + uRipple * wave);
      p.y += uRipple * 0.4 * sin(cx * 3.1 + uTime * 5.0); // slight cross-flutter
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D map;
    uniform float uBlur;
    uniform float uBend;
    uniform float uFog;
    varying vec2 vUv;
    void main() {
      // The BACK of a card shows its own image, mirrored and heavily
      // defocused — like light bleeding through the print, not a flat
      // colour. Mirroring vUv.x cancels the geometric flip, so the reverse
      // reads as a soft ghost of the photo in the same orientation.
      bool back = !gl_FrontFacing;
      vec2 uv = back ? vec2(1.0 - vUv.x, vUv.y) : vUv;
      // backs take only HALF the depth-of-field blur, then get clamped:
      // deep cards already push uBlur to 8, which would flatten them out
      float lod = back ? min(uBlur * 0.5 + ${BACK_BLUR.toFixed(1)}, ${BACK_LOD_MAX.toFixed(1)}) : uBlur;
      // motion blur: vertical 5-tap gaussian, radius follows the jelly bend
      float r = abs(uBend) * 0.12;
      vec4 c = texture2D(map, uv, lod) * 0.4
             + texture2D(map, uv + vec2(0.0, r), lod) * 0.24
             + texture2D(map, uv - vec2(0.0, r), lod) * 0.24
             + texture2D(map, uv + vec2(0.0, r * 2.0), lod) * 0.06
             + texture2D(map, uv - vec2(0.0, r * 2.0), lod) * 0.06;
      // the reverse sits in shade and loses saturation — paper, not screen
      if (back) {
        c.rgb = mix(vec3(dot(c.rgb, vec3(0.299, 0.587, 0.114))), c.rgb, 0.55) * ${BACK_DIM.toFixed(2)};
      }
      // light: the bulge catches a soft sheen while the card is flexed
      float cx = vUv.x * 2.0 - 1.0;
      c.rgb += abs(uBend) * (1.0 - cx * cx) * 0.5;
      // depth shadow: distant cards sink into a teal-black darker than the
      // lava base, so the front card glows against receding darkness
      // backs take less of it: at full strength the depth shadow buried the
      // reverse image back into a flat dark card
      c.rgb = mix(c.rgb, vec3(0.0, 0.045, 0.05), uFog * (back ? 0.65 : 1.0));
      gl_FragColor = c;
    }`,
};

/* Neural field (replaced the star dust): soma dots spread deep behind the
   helix, wired to their nearest neighbours by faint synapse lines. Every so
   often a neuron fires — it flashes, and bright pulses travel its synapses;
   an arriving pulse can chain-fire the next neuron (with a refractory hold
   so the field flickers in cascades, not a strobe). Nodes sway on bounded
   sinusoids (never wrap — a wrapped node would drag its synapses across the
   whole scene). All CPU: ~100 nodes / ~150 edges / 96-pulse pool.
   Everything renders additive, so "off" = black vertex color = invisible. */
const NEU_COUNT = 110;
const NEU_SIZE = 0.6; /* soma sprite size — mostly faint halo skirt, small bright core */
const NEU_LINK_DIST = 4.2; /* max synapse length */
const NEU_MAX_DEG = 3; /* synapses per neuron (nearest-first) */
const NEU_SWAY = 0.4; /* bounded drift amplitude */
const NEU_KINK = 0.22; /* synapse midpoint offset (fraction of its length) — organic, not straight wires */
const NEU_SHARP_P = 0.4; /* fraction of synapses that kink SHARP; the rest bend as smooth curves */
const NEU_SEG = 6; /* segments per synapse (smooth curves need the vertices) */
const FIRE_EVERY = 2.4; /* s between spontaneous fires — sparse, one event at a time */
const PULSE_SPEED = 2.6; /* world units/s along a synapse — unhurried drift, not a zap */
const PULSE_SIZE = 0.22;
const CHAIN_P = 0.3; /* chance an arriving pulse re-fires its target */
const REFRACTORY = 2.5; /* s a neuron ignores new fires after firing — kills overlapping cascades */
const MAX_PULSES = 96;
/* ambience, not content: everything rests just above the lava's own level */
const NODE_BASE = [0.043, 0.095, 0.114]; /* resting soma glow */
const NODE_FLASH = [0.3, 0.44, 0.48]; /* firing flash */
const EDGE_BASE = [0.017, 0.04, 0.048]; /* resting synapse */
const EDGE_BOOST = 0.1; /* synapse brightening while a pulse rides it */

/* All neuron materials output PREMULTIPLIED-VALID additive color (alpha =
   max channel, One/One blending). The canvas is alpha:true over the DOM
   lava: writing color with less alpha than color is an invalid premultiplied
   pixel — some compositors (Safari, some Chrome paths) clamp it to nothing,
   which made the whole field invisible on the user's machine while headless
   Chrome happily displayed it. Keep alpha >= each color channel. */
const PT_VERT = `
  uniform float uSize;
  uniform float uScale;
  attribute vec3 aColor;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const PT_FRAG = `
  uniform sampler2D uMap;
  varying vec3 vColor;
  void main() {
    vec3 c = vColor * texture2D(uMap, gl_PointCoord).a;
    gl_FragColor = vec4(c, max(c.r, max(c.g, c.b)));
  }`;
const LN_VERT = `
  attribute vec3 aColor;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const LN_FRAG = `
  varying vec3 vColor;
  void main() {
    gl_FragColor = vec4(vColor, max(vColor.r, max(vColor.g, vColor.b)));
  }`;

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  // bright core + wide soft dendrite-glow skirt (the reference look)
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.12, "rgba(255,255,255,0.85)");
  grad.addColorStop(0.3, "rgba(255,255,255,0.28)");
  grad.addColorStop(0.6, "rgba(255,255,255,0.08)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const _pA = [0, 0, 0], _pB = [0, 0, 0]; // evalEdge scratch
let _heroExit = 0; // 0..1+, how far the unpinned hero has scrolled off (set by Scene)

function Neurons() {
  const S = useMemo(() => {
    // -- nodes: home positions + per-axis sway phase/freq
    const home = new Float32Array(NEU_COUNT * 3);
    const phase = new Float32Array(NEU_COUNT * 3);
    const freq = new Float32Array(NEU_COUNT * 3);
    for (let i = 0; i < NEU_COUNT * 3; i += 3) {
      home[i] = (Math.random() - 0.5) * 28;
      home[i + 1] = (Math.random() - 0.5) * 18;
      home[i + 2] = -3 - Math.random() * 13; // always behind the helix
      for (let k = 0; k < 3; k++) {
        phase[i + k] = Math.random() * Math.PI * 2;
        freq[i + k] = 0.1 + Math.random() * 0.25;
      }
    }
    // -- synapses: nearest-first, capped degree, deduped (a<b)
    const adj = Array.from({ length: NEU_COUNT }, () => []);
    const edges = []; // [a, b]
    for (let a = 0; a < NEU_COUNT; a++) {
      const near = [];
      for (let b = 0; b < NEU_COUNT; b++) {
        if (b === a) continue;
        const dx = home[a * 3] - home[b * 3];
        const dy = home[a * 3 + 1] - home[b * 3 + 1];
        const dz = home[a * 3 + 2] - home[b * 3 + 2];
        const d = Math.hypot(dx, dy, dz);
        if (d < NEU_LINK_DIST) near.push([d, b]);
      }
      near.sort((p, q) => p[0] - q[0]);
      for (const [, b] of near.slice(0, NEU_MAX_DEG)) {
        if (adj[a].includes(b)) continue;
        adj[a].push(b);
        adj[b].push(a);
        edges.push([Math.min(a, b), Math.max(a, b)]);
      }
    }
    // dedupe mirrored pairs
    const seen = new Set();
    const E = edges.filter(([a, b]) => !seen.has(a * NEU_COUNT + b) && seen.add(a * NEU_COUNT + b));

    // fixed per-synapse midpoint offset; some synapses kink SHARP through it
    // (polyline), the rest bend smoothly (quadratic through the same point) —
    // the mix reads organic, not ruler-straight and not uniformly wavy
    const mid = new Float32Array(E.length * 3);
    const sharp = new Uint8Array(E.length);
    for (let e = 0; e < E.length; e++) {
      const [a, b] = E[e];
      const dx = home[a * 3] - home[b * 3], dy = home[a * 3 + 1] - home[b * 3 + 1], dz = home[a * 3 + 2] - home[b * 3 + 2];
      const len = Math.hypot(dx, dy, dz);
      sharp[e] = Math.random() < NEU_SHARP_P ? 1 : 0;
      const r = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];
      const rl = Math.hypot(...r) || 1;
      const amp = len * NEU_KINK * (sharp[e] ? 1.4 : 1); // sharp kinks bite harder
      for (let k = 0; k < 3; k++) mid[e * 3 + k] = (r[k] / rl) * amp;
    }

    const map = glowTexture();
    const mk = (n) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      return g;
    };
    const nodeGeo = mk(NEU_COUNT);
    nodeGeo.attributes.position.array.set(home);
    const edgeGeo = mk(E.length * NEU_SEG * 2); // NEU_SEG segments per synapse
    const pulseGeo = mk(MAX_PULSES);
    // park idle pulses below the frustum (skips their vertex work entirely)
    for (let s = 0; s < MAX_PULSES; s++) pulseGeo.attributes.position.array[s * 3 + 1] = -1000;
    // sway keeps everything near home; skip per-frame bounds recompute
    [nodeGeo, edgeGeo, pulseGeo].forEach((g) => (g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -9.5), 25)));
    const premulAdditive = {
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
    };
    const pointsMat = (size) =>
      new THREE.ShaderMaterial({
        uniforms: { uMap: { value: map }, uSize: { value: size }, uScale: { value: 1000 } },
        vertexShader: PT_VERT,
        fragmentShader: PT_FRAG,
        ...premulAdditive,
      });
    const nodeMat = pointsMat(NEU_SIZE);
    const pulseMat = pointsMat(PULSE_SIZE);
    const edgeMat = new THREE.ShaderMaterial({
      vertexShader: LN_VERT,
      fragmentShader: LN_FRAG,
      ...premulAdditive,
    });
    return {
      home, phase, freq, adj, E, mid, sharp, map, nodeGeo, edgeGeo, pulseGeo, nodeMat, pulseMat, edgeMat,
      bright: new Float32Array(NEU_COUNT), // firing flash, decays each frame
      lastFire: new Float32Array(NEU_COUNT).fill(-99),
      // pulse pool (parallel arrays): source/target node, edge row, progress
      pulse: { on: new Uint8Array(MAX_PULSES), a: new Int16Array(MAX_PULSES), b: new Int16Array(MAX_PULSES), e: new Int16Array(MAX_PULSES), t: new Float32Array(MAX_PULSES), dur: new Float32Array(MAX_PULSES) },
      edgeRow: new Map(E.map(([a, b], i) => [a * NEU_COUNT + b, i])),
      fireAcc: 0,
    };
  }, []);
  useEffect(() => () => {
    [S.nodeGeo, S.edgeGeo, S.pulseGeo].forEach((g) => g.dispose());
    [S.nodeMat, S.pulseMat, S.edgeMat].forEach((m) => m.dispose());
    S.map.dispose();
  }, [S]);

  useFrame((state, dt) => {
    dt = Math.min(dt, 1 / 30);
    const t = state.clock.elapsedTime;
    // world-size -> px point scale: bufferHeight / (2 * tan(fov/2)), fov 45
    const px = state.gl.domElement.height / 0.8284;
    S.nodeMat.uniforms.uScale.value = px;
    S.pulseMat.uniforms.uScale.value = px;
    const { home, phase, freq, adj, E, mid, sharp, bright, lastFire, pulse, edgeRow } = S;
    const np = S.nodeGeo.attributes.position.array;
    const nc = S.nodeGeo.attributes.aColor.array;
    const ep = S.edgeGeo.attributes.position.array;
    const ec = S.edgeGeo.attributes.aColor.array;
    const pp = S.pulseGeo.attributes.position.array;
    const pc = S.pulseGeo.attributes.aColor.array;

    const fire = (i) => {
      if (t - lastFire[i] < REFRACTORY) return;
      lastFire[i] = t;
      bright[i] = 1;
      for (const b of adj[i]) {
        const s = pulse.on.indexOf(0); // free slot; pool full = drop the spark
        if (s === -1) return;
        pulse.on[s] = 1;
        pulse.a[s] = i;
        pulse.b[s] = b;
        pulse.e[s] = edgeRow.get(Math.min(i, b) * NEU_COUNT + Math.max(i, b)) ?? -1;
        pulse.t[s] = 0;
        const dx = np[i * 3] - np[b * 3], dy = np[i * 3 + 1] - np[b * 3 + 1], dz = np[i * 3 + 2] - np[b * 3 + 2];
        pulse.dur[s] = Math.max(0.15, Math.hypot(dx, dy, dz) / PULSE_SPEED);
      }
    };

    // the whole field dims away over the first ~35% of the hero's scroll-off,
    // clearing the stage before the lower sections' star dust fades in —
    // otherwise the two fields clash in the hand-over zone
    const fade = Math.max(0, 1 - _heroExit / 0.35);

    // nodes: bounded sway + flash decay
    for (let i = 0; i < NEU_COUNT; i++) {
      const j = i * 3;
      np[j] = home[j] + NEU_SWAY * Math.sin(t * freq[j] + phase[j]);
      np[j + 1] = home[j + 1] + NEU_SWAY * Math.sin(t * freq[j + 1] + phase[j + 1]);
      np[j + 2] = home[j + 2] + NEU_SWAY * Math.sin(t * freq[j + 2] + phase[j + 2]);
      bright[i] *= Math.exp(-dt * 1.7); // slow flash fade — a swell, not a blink
      for (let k = 0; k < 3; k++) nc[j + k] = (NODE_BASE[k] + (NODE_FLASH[k] - NODE_BASE[k]) * bright[i]) * fade;
    }

    // path through a synapse: sharp = polyline through the kink point,
    // smooth = quadratic bezier THROUGH the same point (control = 2K - mid)
    const evalEdge = (e, u, out) => {
      const [a, b] = E[e];
      for (let m = 0; m < 3; m++) {
        const pa = np[a * 3 + m], pb = np[b * 3 + m];
        const K = (pa + pb) / 2 + mid[e * 3 + m];
        if (sharp[e]) out[m] = u < 0.5 ? pa + (K - pa) * u * 2 : K + (pb - K) * (u * 2 - 1);
        else {
          const C = 2 * K - (pa + pb) / 2;
          const v = 1 - u;
          out[m] = v * v * pa + 2 * v * u * C + u * u * pb;
        }
      }
    };

    // synapses follow their endpoints; colors reset to base (pulses re-boost below)
    for (let e = 0; e < E.length; e++) {
      const j = e * NEU_SEG * 6;
      evalEdge(e, 0, _pA);
      for (let s2 = 1; s2 <= NEU_SEG; s2++) {
        evalEdge(e, s2 / NEU_SEG, _pB);
        const o = j + (s2 - 1) * 6;
        for (let k = 0; k < 3; k++) {
          ep[o + k] = _pA[k];
          ep[o + 3 + k] = _pB[k];
          ec[o + k] = ec[o + 3 + k] = EDGE_BASE[k] * fade;
          _pA[k] = _pB[k];
        }
      }
    }

    // spontaneous activity
    S.fireAcc += dt;
    while (S.fireAcc > FIRE_EVERY) {
      S.fireAcc -= FIRE_EVERY;
      fire((Math.random() * NEU_COUNT) | 0);
    }

    // pulses: slide source -> target, glow their synapse, maybe chain-fire
    for (let s = 0; s < MAX_PULSES; s++) {
      if (!pulse.on[s]) continue; // parked out of frustum
      pulse.t[s] += dt / pulse.dur[s];
      const k = pulse.t[s];
      if (k >= 1) {
        pulse.on[s] = 0;
        pp[s * 3 + 1] = -1000; // park (see pool init — alpha:true canvas)
        if (Math.random() < CHAIN_P) fire(pulse.b[s]);
        continue;
      }
      const e = pulse.e[s];
      if (e >= 0) {
        evalEdge(e, k, _pA); // ride the synapse's own bend
        for (let m = 0; m < 3; m++) pp[s * 3 + m] = _pA[m];
      } else {
        const a = pulse.a[s] * 3, b = pulse.b[s] * 3;
        for (let m = 0; m < 3; m++) pp[s * 3 + m] = np[a + m] + (np[b + m] - np[a + m]) * k;
      }
      const glow = Math.sin(k * Math.PI) * 0.4 * fade; // ease in/out over the trip, kept subtle
      pc[s * 3] = 0.7 * glow;
      pc[s * 3 + 1] = pc[s * 3 + 2] = glow;
      if (e >= 0) {
        // a soft light travelling WITH the pulse: verts near it brighten
        const j = e * NEU_SEG * 6;
        for (let vi = 0; vi < NEU_SEG * 2; vi++) {
          const vt = ((vi >> 1) + (vi & 1)) / NEU_SEG;
          const w = Math.max(0, 1 - Math.abs(vt - k) * 2.5);
          for (let m = 0; m < 3; m++) ec[j + vi * 3 + m] += EDGE_BOOST * glow * w;
        }
      }
    }

    for (const g of [S.nodeGeo, S.edgeGeo, S.pulseGeo]) {
      g.attributes.position.needsUpdate = true;
      g.attributes.aColor.needsUpdate = true;
    }
  });

  return (
    <group>
      <points geometry={S.nodeGeo} material={S.nodeMat} />
      <lineSegments geometry={S.edgeGeo} material={S.edgeMat} />
      <points geometry={S.pulseGeo} material={S.pulseMat} />
    </group>
  );
}

const _center = new THREE.Vector3();

function Card({ i, vals }) {
  const ref = useRef();
  const [tex, setTex] = useState(() => placeholderTexture(i));

  // Curved card: a segment of the ring's own cylinder, so it wraps the circle
  const geo = useMemo(() => {
    const { radius, scale } = vals.current;
    const w = (1.6 * scale) / radius; // angular width matching the old flat card
    // 16 height segments so the flutter wave has vertices to travel through
    return new THREE.CylinderGeometry(radius, radius, 1.2 * scale, 24, 16, true, -w / 2, w);
  }, [vals]);
  useEffect(() => () => geo.dispose(), [geo]);

  useEffect(() => {
    let live = true;
    new THREE.TextureLoader().load(`/stair/${i + 1}.jpg`, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      if (live) setTex(t);
    });
    return () => (live = false);
  }, [i]);

  useFrame(({ camera, clock }) => {
    const v = vals.current;
    const a = i * v.step + v.spinTotal;
    // v.y is the intro rise (0 once settled); deeper cards lag it so the
    // helix assembles top-first instead of lifting as one rigid unit
    const y = v.y * (1 + i * INTRO_STAG) + (i - v.iFront) * v.pitch + FRONT_Y;
    ref.current.position.y = y;
    ref.current.rotation.y = -a;
    ref.current.scale.setScalar(v.grow); // scales about the cylinder axis: face and radius together
    const r = v.radius * v.grow;
    const focusWorld = camera.position.z - r; // focus rides the front card, always sharp
    _center.set(-Math.sin(a) * r, y, Math.cos(a) * r);
    const d = _center.distanceTo(camera.position);
    const below = Math.max(0, i - v.iFront); // steps from the front pose; unblurs as the card comes up
    ref.current.material.uniforms.uBlur.value = Math.min(8, Math.abs(d - focusWorld) * v.bokeh * 0.35 + below * BLUR_STEP);
    ref.current.material.uniforms.uFog.value = Math.min(0.88, below * FOG_STEP);
    ref.current.material.uniforms.uBend.value = v.bend;
    ref.current.material.uniforms.uRipple.value = v.ripple;
    ref.current.material.uniforms.uTime.value = clock.elapsedTime;
  });

  return (
    <mesh ref={ref} geometry={geo}>
      <shaderMaterial
        side={THREE.DoubleSide}
        uniforms={{ map: { value: tex }, uBlur: { value: 0 }, uBend: { value: 0 }, uRipple: { value: 0 }, uTime: { value: 0 }, uFog: { value: 0 } }}
        {...cardShader}
      />
    </mesh>
  );
}

function Scene() {
  const vals = useRef({
    ...START,
    introZ: INTRO_DOLLY, /* extra camera distance that decays to 0 across the intro */
    spinTotal: 0,
    iFront: 0,
    grow: GROW_START,
    bend: 0,
    bendVel: 0,
    ripple: 0,
    rippleVel: 0,
    step: (Math.PI * 2) / N,
    radius: 4.2,
    winds: 1,
    scale: 1.5,
    bokeh: 3,
  });

  useFrame(({ gl, camera, clock }, dt) => {
    const v = vals.current;
    const sp = Math.min(window.__heroScroll || 0, 1);
    // depth layer: the dolly-out rides the front of the scroll, concurrent
    // with the spin below — not a separate beat before it
    const rec = Math.min(sp / RECEDE, 1);
    const spin = sp;
    // intro fly-in (introZ -> 0) and scroll dolly-out compose on one axis —
    // crossfading influences, no hand-off jump if the user scrolls early
    camera.position.z = CAM_Z + v.introZ + DOLLY * rec * rec * (3 - 2 * rec);
    window.__camZ = camera.position.z; // debug/tuning readout
    // jelly: spring the bend toward scroll velocity — lags, overshoots, settles
    dt = Math.min(dt, 1 / 30); // clamp tab-switch spikes so the spring can't explode
    const bendTarget = Math.max(-BEND_MAX, Math.min(BEND_MAX, (window.lenis?.velocity || 0) * BEND_K));
    v.bendVel += (bendTarget - v.bend) * BEND_STIFF * dt;
    v.bendVel *= Math.exp(-BEND_DAMP * dt);
    v.bend += v.bendVel * dt;
    // flutter mode: pumped by bend velocity (scroll acceleration), rings out after
    v.rippleVel += (-v.ripple * RIP_STIFF + v.bendVel * RIP_DRIVE * RIP_STIFF) * dt;
    v.rippleVel *= Math.exp(-RIP_DAMP * dt);
    v.ripple = Math.max(-RIP_MAX, Math.min(RIP_MAX, v.ripple + v.rippleVel * dt));
    v.step = (Math.PI * 2 * v.winds) / N;
    const sway = 0.05 * Math.sin(clock.elapsedTime * 0.25); // bounded idle life
    // __heroScroll caps at 1 when the pin ends; the canvas's own top going
    // negative is the unpinned hero scrolling off — keep spinning through it
    const rect = gl.domElement.getBoundingClientRect();
    const exit = Math.max(0, -rect.top / (rect.height || 1));
    _heroExit = exit; // Neurons fades on this — no ScrollTrigger on the canvas (pin race)
    // after the recede: the top card spirals up and away, the next rises
    // from below into the same REST_ANGLE pose
    v.spinTotal = v.off + sway + REST_ANGLE - (spin * (N - 1) + exit * EXIT_STEPS) * v.step;
    v.iFront = -v.spinTotal / v.step; // continuous front index; +N-1 by full scroll
    v.grow = GROW_START + (1 - GROW_START) * spin; // small at rest, full size by the last card
  });

  useEffect(() => {
    const v = vals.current;
    const intro = () => {
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
        Object.assign(v, REST, { introZ: 0 });
      } else {
        gsap.to(v, { y: REST.y, pitch: REST.pitch, introZ: 0, duration: INTRO_SECS, ease: "power3.inOut" });
        gsap.to(v, { off: 0, duration: INTRO_SECS + 1.2, ease: "power3.out" }); // long tail into the sway
      }
    };
    if (document.body.classList.contains("preloading")) {
      addEventListener("rns:reveal", intro, { once: true });
      return () => removeEventListener("rns:reveal", intro);
    }
    intro();
    return () => gsap.killTweensOf(v);
  }, []);

  return (
    <>
      <Neurons />
      {Array.from({ length: N }, (_, i) => <Card key={i} i={i} vals={vals} />)}
    </>
  );
}

export default function Staircase() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [0, 0.6, CAM_Z], fov: 45, near: 0.1, far: 50 }}
      gl={{ alpha: true, antialias: false, powerPreference: "high-performance" }}
      style={{ position: "absolute", inset: 0, zIndex: -1, pointerEvents: "none" }}
    >
      <Scene />
    </Canvas>
  );
}

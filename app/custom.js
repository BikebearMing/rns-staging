"use client";
import { useEffect } from "react";
import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

gsap.registerPlugin(ScrollTrigger, SplitText);
if (typeof window !== "undefined") window.ScrollTrigger = ScrollTrigger; // debug/tuning access

/* --------------------------------------------------------------------------
   Text reveal — madewithgsap effect 058 (per-letter swing)
   Add data-text-reveal to any text element. Every letter is clipped to its
   own box and swings up into place from -80deg about a pivot just below it,
   with a slight overshoot, line by line. Scrolling past swings it out to
   +80deg; scrolling back reverses. SplitText handles the letter wrapping
   and re-splits on resize; waits for fonts so line breaks are right.

   data-text-reveal-delay="0.4" -> seconds to hold before the first swing-in
   -------------------------------------------------------------------------- */

function initTextReveal() {
  const splits = [];
  let cancelled = false;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  document.fonts.ready.then(() => {
    if (cancelled) return;
    document.querySelectorAll("[data-text-reveal]").forEach((el) => {
      let delay = parseFloat(el.dataset.textRevealDelay) || 0;

      if (reduced) {
        gsap.set(el, { visibility: "visible" });
        return;
      }

      const split = SplitText.create(el, {
        type: "lines,words,chars",
        mask: "chars",
        autoSplit: true,
        linesClass: "tr-line",
        charsClass: "tr-char",
        onSplit(self) {
          gsap.set(el, { visibility: "visible" });
          el._trCtx?.revert();
          el._trCtx = gsap.context(() => {
            self.lines.forEach((line) => {
              const chars = line.querySelectorAll(".tr-char");
              if (!chars.length) return;
              gsap.set(chars, { rotate: -70, transformOrigin: "50% 120%" });

              // smoother than the stock 058: longer travel, no back-overshoot
              // pop, letters overlapping into one wave
              const tl = gsap.timeline({ paused: true });
              tl.to(chars, { rotate: 0, duration: 0.7, stagger: 0.009, ease: "power3.out" });
              tl.addLabel("visible");
              tl.to(chars, { rotate: 80, duration: 0.4, stagger: 0.007, ease: "back.in(1.1)" });

              const enter = () => {
                gsap.delayedCall(delay, () => tl.tweenTo("visible"));
                delay = 0; // only the first entrance waits (preloader sequencing)
              };
              // Hero text keeps the full swing-out/return choreography;
              // everything else reveals ONCE and then just stays.
              ScrollTrigger.create(el.closest(".hero") ? {
                trigger: line,
                start: "bottom 80%",
                end: "top 30%",
                onEnter: enter,
                onLeave: () => tl.play(),
                onEnterBack: () => tl.tweenTo("visible"),
                onLeaveBack: () => tl.reverse(),
                // Self-heal: SplitText's async autoSplit rebuilds (late fonts,
                // ResizeObserver) can race the hero pin's spacer, leaving a
                // line's played state contradicting its true position —
                // symptom: text invisible mid-viewport, chars stuck at ±80.
                // On any refresh, resolve the contradiction from position.
                onRefresh: (self) => {
                  const p = tl.progress();
                  if (self.isActive && p === 1) tl.tweenTo("visible");
                  else if (!self.isActive && self.progress === 0 && p > 0) tl.pause(0);
                  else if (!self.isActive && self.progress === 1 && p === 0) tl.pause(tl.duration());
                },
              } : {
                trigger: line,
                start: "bottom 80%",
                once: true, // play in, never out — trigger kills itself after
                onEnter: enter,
                // self-heal (pre-kill): already past start but never played
                onRefresh: (self) => {
                  if (self.progress > 0 && tl.progress() === 0) tl.tweenTo("visible");
                },
              });
            });
          });
          return null;
        },
      });
      splits.push(split);
    });
  });

  return () => {
    cancelled = true;
    splits.forEach((s) => {
      s.elements?.forEach((el) => {
        el._trCtx?.revert();
        delete el._trCtx;
      });
      s.revert();
    });
  };
}

/* --------------------------------------------------------------------------
   Hero scroll: pins the hero for 3 viewport-heights. The first ~15% (the
   staircase's camera push-in) sends the text away; the staircase reads
   window.__heroScroll to dolly then spin through the cards over the full
   pin. As the next section arrives the staircase canvas fades out, so
   later sections are isolated from the hero's 3D layer.
   -------------------------------------------------------------------------- */
function initHeroScroll() {
  let ctx;
  let cancelled = false;
  if (new URLSearchParams(location.search).has("noscroll")) return () => {}; // debug: isolate scroll effects
  document.fonts.ready.then(() => {
    // runs BEFORE initTextReveal's fonts handler (see start()) — the exit
    // tweens target the authored .line/.body elements, not SplitText spans
    const hero = document.querySelector(".hero");
    if (cancelled || !hero) return;
    ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: hero,
          start: "top top",
          end: "+=300%",
          pin: true,
          scrub: true,
          onUpdate: (self) => (window.__heroScroll = self.progress),
        },
      });
      // fromTo + immediateRender:false — start states are pinned explicitly
      // and nothing renders until the user scrolls, so these can't fight the
      // entrance animations or capture pre-entrance states at build time.
      // The text exits BACKWARD into depth: translateZ under the .hero
      // perspective, so both lines shrink toward one vanishing point while
      // blurring away — the same recede the staircase camera makes.
      // Exit animates the .line wrappers, never the inner spans — the CSS
      // entrance owns filter/mask on the spans, and GSAP stamping start
      // values on a wrapper is harmless (they equal its resting state).
      // Two tweens per element: the zoom-out leads, the blur/fade joins
      // partway through — recede first, THEN dissolve, not both at once.
      tl.fromTo(".hero .h1 .line",
        { z: 0 },
        { z: -600, stagger: 0.03, duration: 0.12, ease: "power2.in", immediateRender: false },
        0);
      tl.fromTo(".hero .h1 .line",
        { opacity: 1, filter: "blur(0px)" },
        { opacity: 0, filter: "blur(12px)", stagger: 0.03, duration: 0.08, ease: "power1.in", immediateRender: false },
        0.06);
      // Whole-element exit for the body — its .tr-char rotations belong to the
      // text-reveal timeline alone (one owner per property; a scrub tween on
      // the chars left them garbled after a down-and-back scroll).
      // Shallower z than the h1: the two layers recede at different rates.
      tl.fromTo(".hero .body",
        { z: 0 },
        { z: -420, duration: 0.13, ease: "power2.in", immediateRender: false }, 0.02);
      tl.fromTo(".hero .body",
        { opacity: 1, filter: "blur(0px)" },
        { opacity: 0, filter: "blur(10px)", duration: 0.09, ease: "power1.in", immediateRender: false }, 0.08);
      tl.fromTo(".scroll-hint", { opacity: 1 }, { opacity: 0, duration: 0.06, immediateRender: false }, 0);
      tl.to({}, { duration: 0.84 }, 0.16); // rest of the pin belongs to the staircase
    });
    // The pin spacer just moved everything below the hero. Triggers created
    // before this (e.g. the staircase canvas fade — canvas mount vs slow
    // Typekit fonts is a race) hold pre-pin positions; recalc them all.
    ScrollTrigger.refresh();
  });
  return () => {
    cancelled = true;
    window.__heroScroll = 0;
    ctx?.revert();
  };
}

/* --------------------------------------------------------------------------
   Video section: pins for one viewport-height while the frame scrubs from
   its centered 400px rest size to 100vh x (100vw - 30px gutters). The video
   only plays once (nearly) expanded; the unmute button rides its corner.
   -------------------------------------------------------------------------- */
function initVideoExpand() {
  let ctx;
  let cancelled = false;
  // fonts.ready keeps creation order behind the hero pin (see start()) —
  // triggers created before a pin never learn about its spacer
  document.fonts.ready.then(() => {
    const frame = document.querySelector(".video-frame");
    if (cancelled || !frame) return;
    const video = frame.querySelector("video");
    const btn = frame.querySelector(".unmute");
    const after = document.querySelector(".video-section").nextElementSibling; // grab before the pin spacer wraps it
    let expand = 0, enter = 0, exit = 0; // → window.__videoDim (lava darkens, stars recede)
    const setDim = () => {
      const near = enter * (1 - exit);
      window.__videoDim = expand * near; // lava darkens with the expansion
      window.__starDim = (0.45 + 0.55 * expand) * near; // stars start receding on approach
    };
    const OPEN = 0.6; // fraction of the pin spent growing; the rest holds full size
    ctx = gsap.context(() => {
      gsap.timeline({
        scrollTrigger: {
          trigger: ".video-section",
          start: "top top",
          end: "+=100%",
          pin: true,
          scrub: true, // Lenis already smooths the scroll — extra scrub lag felt sluggish
          invalidateOnRefresh: true, // re-read innerWidth/Height on resize
          onUpdate(self) {
            expand = Math.min(1, self.progress / OPEN);
            setDim();
            frame.classList.toggle("expanded", self.progress > OPEN * 0.9);
          },
        },
      })
        .to(frame, {
          width: () => innerWidth - 30,
          height: () => innerHeight,
          ease: "power2.out", // most of the growth lands early — reads responsive
          duration: OPEN,
        })
        .to({}, { duration: 1 - OPEN }); // hold
      // plays whenever any of it is on screen (not just once expanded).
      // ScrollTrigger measures ends with pins reverted, so plain "bottom top"
      // paused it at the pin end with the video still on screen — add the
      // pin's own length (+=100% = innerHeight)
      ScrollTrigger.create({
        trigger: ".video-section",
        start: "top bottom",
        end: () => "bottom+=" + innerHeight + " top",
        onToggle: (self) => (self.isActive ? video.play().catch(() => {}) : video.pause()),
      });
      // the darkening follows the frame on screen: builds as it arrives
      // (matters once latched at full size) and lifts as the next section
      // rises over it
      ScrollTrigger.create({
        trigger: ".video-section",
        start: "top bottom",
        end: "top top",
        onUpdate: (self) => { enter = self.progress; setDim(); },
        onRefresh: (self) => { enter = self.progress; setDim(); },
      });
      after && ScrollTrigger.create({
        trigger: after,
        start: "top bottom",
        end: "top top",
        onUpdate: (self) => { exit = self.progress; setDim(); },
      });
    });
    btn.addEventListener("click", () => {
      video.muted = !video.muted;
      btn.textContent = video.muted ? "UNMUTE" : "MUTE";
    });
  });
  return () => {
    cancelled = true;
    ctx?.revert();
  };
}

/* --------------------------------------------------------------------------
   Star dust for the sections below the hero (the hero has the neuron field).
   A fixed 2D canvas of soft drifting dots — the pre-neuron star look —
   faded in by scroll as the hero leaves, riding along under every later
   section. 2D canvas, not WebGL: dots don't need a second GL context.
   -------------------------------------------------------------------------- */
const STAR_COUNT = 140;
function initStars() {
  const canvas = document.querySelector(".stars");
  if (!canvas) return () => {};
  const g = canvas.getContext("2d");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // soft radial sprite, drawn once
  const sp = document.createElement("canvas");
  sp.width = sp.height = 32;
  const sg = sp.getContext("2d");
  const grad = sg.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "rgba(196,236,244,1)");
  grad.addColorStop(0.4, "rgba(196,236,244,0.5)");
  grad.addColorStop(1, "rgba(196,236,244,0)");
  sg.fillStyle = grad;
  sg.fillRect(0, 0, 32, 32);

  // positions/velocities in CSS px; upward bias = rising dust. Sizes skew
  // SMALL (squared random) — big sprites read "too close up"
  const stars = Array.from({ length: STAR_COUNT }, () => {
    const depth = Math.random() ** 2; // most stars far away
    return {
      x: Math.random(), y: Math.random(), // 0..1, scaled to viewport on draw
      r: 1 + depth * 2.5,
      a: 0.2 + depth * 0.5, // far = fainter too
      vx: (Math.random() - 0.5) * 4,
      vy: -(1.5 + depth * 5), // far = slower (parallax-ish)
    };
  });

  let dpr, w, h;
  const resize = () => {
    dpr = Math.min(devicePixelRatio || 1, 1.5);
    w = canvas.width = Math.round(innerWidth * dpr);
    h = canvas.height = Math.round(innerHeight * dpr);
  };
  resize();
  addEventListener("resize", resize);

  let fade = 0, sd = 0;
  let raf, last = performance.now();
  const tick = (now) => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    if (fade <= 0) return; // invisible: skip the work, stars hold position
    g.clearRect(0, 0, w, h);
    // video expanding: stars fall back — shrink/fade and converge toward the
    // centre like a dolly-back. sd chases __starDim so the shift glides
    // instead of jumping with the scroll
    sd += ((window.__starDim || 0) - sd) * Math.min(1, dt * 4);
    const push = 1 - 0.7 * sd;
    const zoom = 1 - 0.22 * sd;
    for (const s of stars) {
      if (!reduced) {
        s.x += (s.vx * dt * dpr) / w;
        s.y += (s.vy * dt * dpr) / h;
        if (s.y < -0.03) s.y = 1.03;
        if (s.x < -0.03) s.x = 1.03;
        else if (s.x > 1.03) s.x = -0.03;
      }
      const r = s.r * dpr * push;
      g.globalAlpha = s.a * push;
      g.drawImage(sp, (0.5 + (s.x - 0.5) * zoom) * w - r, (0.5 + (s.y - 0.5) * zoom) * h - r, r * 2, r * 2);
    }
  };
  raf = requestAnimationFrame(tick);

  // fade with scroll as the first post-hero section arrives; fixed canvas
  // then just stays under everything further down. fonts.ready keeps the
  // trigger's creation behind the hero pin's (see start() ordering note)
  let st, cancelled = false;
  document.fonts.ready.then(() => {
    if (cancelled) return;
    // starts only once the neurons have fully dimmed (they fade over the
    // first ~35% of the hero's scroll-off) — a beat of bare lava between
    // the two fields instead of them clashing in the hand-over
    st = ScrollTrigger.create({
      trigger: ".about",
      start: "top 30%",
      end: "top top",
      onUpdate: (self) => (canvas.style.opacity = fade = self.progress),
      onRefresh: (self) => (canvas.style.opacity = fade = self.progress),
    });
  });

  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
    removeEventListener("resize", resize);
    st?.kill();
  };
}

/* --------------------------------------------------------------------------
   Clients roll-call: hover moves the bright gradient AND swaps the awards
   list bottom-right to that client's entries. Mastercard is the default
   (markup ships it active). ponytail: every client shows the same agency
   awards until real per-client data arrives — fill AWARDS below.
   -------------------------------------------------------------------------- */
const AGENCY_AWARDS = [
  "2025 Marketing-Interactive Agency of the Year Singapore",
  "Marketing-Interactive Agency of the Year 2020",
  "British Chamber of Commerce Singapore, 19th Annual Business Awards",
  "MARKies Awards 2021",
  "Marketing Events Awards 2023",
];
const AWARDS = {}; // e.g. { Mastercard: ["...", "..."] } — falls back to AGENCY_AWARDS

function initClients() {
  const section = document.querySelector(".clients");
  if (!section) return () => {};
  const list = section.querySelector(".awards-list");
  const clients = section.querySelectorAll(".client");
  const onEnter = (e) => {
    const el = e.currentTarget;
    if (el.classList.contains("active")) return;
    clients.forEach((c) => c.classList.toggle("active", c === el));
    const items = AWARDS[el.dataset.client] || AGENCY_AWARDS;
    // swap behind the swoosh: every WORD starts blurred-out and un-blurs on
    // a cascading delay (down the lines, across the words) so the reveal
    // edge follows word shapes; the offsetWidth read restarts the animations
    list.classList.remove("swoosh");
    list.innerHTML = items
      .map((a, i) => `<li>${a.split(" ").map((w, j) =>
        `<span class="w" style="animation-delay:${(i * 0.09 + j * 0.035).toFixed(3)}s">${w}</span>`).join(" ")}</li>`)
      .join("");
    void list.offsetWidth;
    list.classList.add("swoosh");
  };
  clients.forEach((c) => c.addEventListener("mouseenter", onEnter));
  return () => clients.forEach((c) => c.removeEventListener("mouseenter", onEnter));
}

/* OUR WORK parallax: the triptych images are 114% tall inside clipped
   columns; as the section crosses the viewport each image drifts from one
   end of its headroom to the other. Scrub rides Lenis, so it's already
   smoothed — no extra lag needed. */
function initWork() {
  let ctx;
  let cancelled = false;
  // fonts.ready keeps trigger creation behind the hero pin (see start())
  document.fonts.ready.then(() => {
    if (cancelled || !document.querySelector(".work")) return;
    ctx = gsap.context(() => {
      gsap.fromTo(".work-item img",
        { yPercent: -5.5 },
        {
          yPercent: 5.5,
          ease: "none",
          scrollTrigger: {
            trigger: ".work",
            start: "top bottom",
            end: "bottom top",
            scrub: true,
          },
        });
    });
  });
  return () => {
    cancelled = true;
    ctx?.revert();
  };
}

/* Services list: hover moves the focus row (crisp + bullet + thumbnail);
   Strategy ships active in the markup. */
function initServices() {
  const rows = document.querySelectorAll(".service");
  if (!rows.length) return () => {};
  const onEnter = (e) => rows.forEach((r) => r.classList.toggle("active", r === e.currentTarget));
  rows.forEach((r) => r.addEventListener("mouseenter", onEnter));
  return () => rows.forEach((r) => r.removeEventListener("mouseenter", onEnter));
}

/* Blur-wipe reveal (the h1 entrance, generalized — see [data-blur-reveal] in
   custom.css): SplitText wraps the text into .br-line divs, each line runs
   the wipe + sheen with a stagger; .br-in lands once on scroll-enter. */
const BR_STAG = 0.14; /* seconds between lines */
function initBlurReveal() {
  const items = [];
  let cancelled = false;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.fonts.ready.then(() => {
    if (cancelled) return;
    document.querySelectorAll("[data-blur-reveal]").forEach((el) => {
      if (reduced) {
        gsap.set(el, { visibility: "visible" }); // unsplit, static, normal color
        return;
      }
      items.push(
        SplitText.create(el, {
          type: "lines",
          autoSplit: true,
          linesClass: "br-line",
          onSplit(self) {
            gsap.set(el, { visibility: "visible" });
            // inline animation-delay survives the .br-in shorthand (inline
            // beats stylesheet): wipe at i*stag, sheen 1.2s behind it
            self.lines.forEach((l, i) => (l.style.animationDelay = `${i * BR_STAG}s, ${1.2 + i * BR_STAG}s`));
            return null;
          },
        })
      );
      items.push(
        ScrollTrigger.create({
          trigger: el,
          start: "top 80%",
          once: true,
          onEnter: () => el.classList.add("br-in"),
          // self-heal: created/refreshed already past its start
          onRefresh: (self) => self.progress > 0 && el.classList.add("br-in"),
        })
      );
    });
  });
  return () => {
    cancelled = true;
    items.forEach((x) => (x.kill ? x.kill() : x.revert()));
  };
}

/* Section dividers wipe in left -> right as each row enters (see .line-in in
   custom.css) — the scroll itself supplies the stagger down the list. */
function initLineReveal() {
  const rules = [...document.querySelectorAll(".service, .awards-list")];
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    rules.forEach((el) => el.classList.add("line-in"));
    return;
  }
  const sts = rules.map((el) =>
    ScrollTrigger.create({
      trigger: el,
      start: "top 88%",
      once: true,
      onEnter: () => el.classList.add("line-in"),
      onRefresh: (self) => self.progress > 0 && el.classList.add("line-in"),
    })
  );
  return () => sts.forEach((s) => s.kill());
}

export default function Custom() {
  useEffect(() => {
    const lenis = new Lenis({ autoRaf: true, lerp: 0.06 }); // lower = heavier glide (default 0.1)
    if (document.body.classList.contains("preloading")) lenis.stop(); // lava.js restarts it on reveal
    window.lenis = lenis;

    // Reveals wait for the preloader so ScrollTriggers don't fire behind it
    let cleanupReveal, cleanupHero, cleanupBlur, cleanupVideo, cleanupStars, cleanupClients, cleanupServices, cleanupWork, cleanupLines;
    const start = () => {
      // Hero pin FIRST: ScrollTrigger compensates for a pin's spacer only in
      // triggers refreshed after the pin, and refresh order = creation order.
      // Reveal triggers created before the pin never get the +300vh offset
      // (symptom: sections below the hero swing out as "already scrolled
      // past" and sit invisible).
      cleanupHero = initHeroScroll();
      cleanupVideo = initVideoExpand(); // second pin — must register after the hero's
      cleanupStars = initStars();
      cleanupClients = initClients();
      cleanupServices = initServices();
      cleanupWork = initWork();
      cleanupReveal = initTextReveal();
      cleanupBlur = initBlurReveal(); // registered after the pin (creation order)
      cleanupLines = initLineReveal();
      // Belt for async SplitText rebuilds landing out of order: re-sort by
      // document position, recompute, and let onRefresh self-heals run.
      gsap.delayedCall(1.5, () => {
        ScrollTrigger.sort();
        ScrollTrigger.refresh();
      });
    };
    if (document.body.classList.contains("preloading")) {
      addEventListener("rns:reveal", start, { once: true });
    } else {
      start();
    }

    return () => {
      removeEventListener("rns:reveal", start);
      cleanupReveal?.();
      cleanupHero?.();
      cleanupBlur?.();
      cleanupVideo?.();
      cleanupStars?.();
      cleanupClients?.();
      cleanupServices?.();
      cleanupWork?.();
      cleanupLines?.();
      lenis.destroy();
    };
  }, []);
  return null;
}

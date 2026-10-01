/* ==========================================================================
   edo security — script.js
   Vanilla JS + GSAP 3.12.5 (core + ScrollTrigger via cdnjs, deferred).

   Contents
     0. Config (HF-01 frame-sequence switch, form endpoint)
     1. Utilities
     2. Header: mobile overlay menu
     3. Stage: scroll-scrub canvas (dummy mode ⇄ frame mode), pin, chapter crossfade, intro
     4. Reveals (.reveal utility) and process timeline
     5. Contact form (stub until FORM_ENDPOINT is set)
     6. Footer year
     7. Init
     8. Acceptance checklist (result)
   ========================================================================== */
(() => {
  'use strict';

  /* ------------------------------------------------------------------------
     0. Config
     ------------------------------------------------------------------------ */

  /**
   * HF-01 frame sequence.
   * While the Higgsfield film is not rendered yet, the hero canvas runs in DUMMY mode:
   * it draws the frame number and a travelling gradient built from the design tokens,
   * so the scrub mechanics are verifiable without assets.
   *
   * Swap-in later: set HF01_FRAMES_READY = true and make sure the extracted WebP frames
   * live at HF01_FRAME_PATH(i) — that is the only change required.
   */
  const HF01_FRAMES_READY = true;
  // Three chained Kling 3.0 clips (16:9, start-frame continuity), extracted at 18 fps into ONE numbered
  // sequence (assets/hf01/frame_0001.webp …). Each chapter owns an equal share of the scroll distance and
  // maps it onto its own frame range, so clips of different length scrub at the same scroll pace.
  const HF01_CHAPTER_FRAMES = [91, 73, 73];                      // frames per clip at 18 fps: 5.04 s, 4.04 s, 4.04 s
  const HF01_FRAME_COUNT = HF01_CHAPTER_FRAMES.reduce((sum, n) => sum + n, 0);
  const HF01_FRAME_VERSION = 3;                                  // bump when frames are re-rendered under the same file names (cache-buster); keep in sync with the poster <img>/<link rel=preload> in index.html
  const HF01_FRAME_PATH = (i) => `assets/hf01/frame_${String(i).padStart(4, '0')}.webp?v=${HF01_FRAME_VERSION}`; // 1-based: frame_0001.webp …
  const HF01_PRELOAD = 20;                                       // eager frames, the rest loads lazily
  const HF01_LAZY_CONCURRENCY = 6;

  /**
   * Contact form endpoint. Empty string = STUB: the form validates, then shows an honest
   * "not connected yet" line instead of pretending the message was delivered.
   * TODO before launch: set to a Formspree URL ('https://formspree.io/f/<FORM_ID>') or an own endpoint
   * that accepts multipart/form-data POST and answers 2xx.
   */
  const FORM_ENDPOINT = '';                       // repo/preview: stub. The release build sets 'contact.php' (server/contact.php).

  const HERO_PIN_DISTANCE = '+=300%';                            // pin duration ≈ 300 vh: one viewport of scroll per chapter
  const CHAPTER_FADE = 0.14;                                     // share of a chapter's scroll used for the crossfade at each boundary
  const DESKTOP_MQ = '(min-width: 768px)';                       // below: no pin, static stack (poster frame + stacked chapters)
  const TIMELINE_DESKTOP_MQ = '(min-width: 1024px)';             // below: vertical process timeline (see styles.css)
  const MOTION_OK_MQ = '(prefers-reduced-motion: no-preference)';
  const NAV_DESKTOP_MQ = '(min-width: 1024px)';

  const REVEAL = { duration: 0.6, ease: 'power2.out', stagger: 0.06 };

  /* ------------------------------------------------------------------------
     1. Utilities
     ------------------------------------------------------------------------ */
  const doc = document;
  const root = doc.documentElement;
  const hasGSAP = typeof window.gsap !== 'undefined' && typeof window.ScrollTrigger !== 'undefined';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const pad = (n, len) => String(n).padStart(len, '0');

  /** Read the design tokens from CSS so canvas drawing stays in sync with styles.css. */
  const readTokens = () => {
    const cs = getComputedStyle(root);
    const fallback = {
      ink: '#0A0A0B', 'ink-2': '#0F0F12', panel: '#1A1A1E', paper: '#F2F2F0',
      muted: '#A6A6AA', dim: '#8B8E94', faint: '#3A3A3F', line: '#26262A',
    };
    const tokens = {};
    Object.keys(fallback).forEach((key) => {
      tokens[key] = cs.getPropertyValue(`--${key}`).trim() || fallback[key];
    });
    return tokens;
  };

  /** #RRGGBB → "r, g, b" for rgba() strings on the canvas. */
  const hexToRgb = (hex) => {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  };

  const headerHeight = () => {
    const header = doc.querySelector('.site-header');
    return header ? Math.round(header.getBoundingClientRect().height) : 64;
  };

  /* ------------------------------------------------------------------------
     2. Header: mobile overlay menu
     ------------------------------------------------------------------------ */
  function initMenu() {
    const toggle = doc.querySelector('.menu-toggle');
    const nav = doc.getElementById('site-nav');
    if (!toggle || !nav) return;

    const behind = [doc.querySelector('main'), doc.querySelector('.site-footer')].filter(Boolean);
    const isOpen = () => nav.classList.contains('is-open');

    const setOpen = (open, { focusFirst = true, restoreFocus = true } = {}) => {
      nav.classList.toggle('is-open', open);
      doc.body.classList.toggle('menu-open', open);
      // Visible label stays "Menü" (fits next to the wordmark at 360px); state is conveyed by aria-expanded
      // and the inverted button style, the accessible name by aria-label.
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Menü schließen' : 'Menü öffnen');
      // Keep keyboard focus inside the overlay: page content behind it is inert while open
      behind.forEach((el) => { el.inert = open; });

      if (open && focusFirst) {
        const first = nav.querySelector('a');
        if (first) first.focus();
      } else if (!open && restoreFocus) {
        toggle.focus();
      }
    };

    toggle.addEventListener('click', () => setOpen(!isOpen()));

    // Link activation: close without stealing focus, the anchor scroll proceeds on an unlocked page
    nav.addEventListener('click', (event) => {
      if (event.target.closest('a')) setOpen(false, { restoreFocus: false });
    });

    doc.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && isOpen()) setOpen(false);
    });

    // Reset when the viewport grows into the desktop navigation
    window.matchMedia(NAV_DESKTOP_MQ).addEventListener('change', (event) => {
      if (event.matches && isOpen()) setOpen(false, { restoreFocus: false });
    });
  }

  /* ------------------------------------------------------------------------
     3. Hero: scroll-scrub canvas
     ------------------------------------------------------------------------ */
  function initHeroScrub() {
    const stage = doc.querySelector('.stage');
    const panel = doc.querySelector('.stage__media');
    const canvas = doc.getElementById('hf01-canvas');
    const readout = doc.getElementById('hf01-readout');
    const chapters = gsap.utils.toArray('.chapter');
    const navItems = gsap.utils.toArray('.stage__nav-item');   // stage index + header mirror (same class, data-chapter-target)
    const headerIndex = doc.querySelector('.header-chapters');
    if (!stage || !panel || !canvas) return;

    // Chapter → frame range (cumulative offsets into the single numbered sequence)
    const CHAPTER_OFFSET = HF01_CHAPTER_FRAMES.map((_, i) => HF01_CHAPTER_FRAMES.slice(0, i).reduce((s, n) => s + n, 0));
    const chapterCount = Math.max(1, Math.min(chapters.length || HF01_CHAPTER_FRAMES.length, HF01_CHAPTER_FRAMES.length));

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const tokens = readTokens();
    const rgb = {
      paper: hexToRgb(tokens.paper),
      faint: hexToRgb(tokens.faint),
      dim: hexToRgb(tokens.dim),
    };

    const state = { progress: 0, frame: 0, chapter: 0, w: 1, h: 1, dpr: 1, dirty: true };
    let rafId = 0;
    let activeTrigger = null;                        // ScrollTrigger while the stage is pinned (nav clicks need it)

    /** Mark the active chapter (copy + index) — state only, the crossfade itself is scroll-driven. */
    const setActiveChapter = (index) => {
      chapters.forEach((el, i) => el.classList.toggle('is-active', i === index));
      navItems.forEach((btn) => {
        const target = Number(btn.dataset.chapterTarget) || 0;
        const active = target === index;
        btn.classList.toggle('is-active', active);
        if (btn.closest('[aria-hidden="true"]')) return;   // header mirror carries no ARIA state
        if (active) btn.setAttribute('aria-current', 'true');
        else btn.removeAttribute('aria-current');
      });
    };

    /* -- Render loop ------------------------------------------------------ */
    const render = () => {
      rafId = 0;
      if (!state.dirty) return;
      state.dirty = false;
      if (HF01_FRAMES_READY) drawFrameMode();
      else drawDummy();
      if (readout) readout.textContent = `Scrub ${pad(state.frame + 1, 3)} / ${HF01_FRAME_COUNT}`;
    };

    /** Mark dirty and schedule exactly one draw per animation frame. */
    const requestRender = () => {
      state.dirty = true;
      if (!rafId) rafId = requestAnimationFrame(render);
    };

    const setProgress = (p) => {
      const progress = clamp01(p);
      // Equal scroll share per chapter, mapped onto that chapter's own frame range
      const scaled = Math.min(progress * chapterCount, chapterCount - 1e-6);
      const chapter = Math.floor(scaled);
      const local = scaled - chapter;
      const frame = CHAPTER_OFFSET[chapter] + Math.round(local * (HF01_CHAPTER_FRAMES[chapter] - 1));
      if (chapter !== state.chapter) {
        state.chapter = chapter;
        setActiveChapter(chapter);
      }
      if (progress === state.progress && frame === state.frame) return;
      state.progress = progress;
      state.frame = frame;
      if (HF01_FRAMES_READY && !frames[frame]) loadFrame(frame);   // on-demand (save-data mode has no lazy tail)
      requestRender();
    };

    /* -- Frame store (frame mode only) ----------------------------------- */
    const frames = new Array(HF01_FRAME_COUNT);      // { img, ready }
    let lazyStarted = false;

    const loadFrame = (index) =>
      new Promise((resolve) => {
        if (frames[index]) { resolve(frames[index]); return; }
        const entry = { img: new Image(), ready: false };
        frames[index] = entry;
        entry.img.decoding = 'async';
        entry.img.onload = () => {
          entry.ready = true;
          if (Math.abs(index - state.frame) <= 2) requestRender(); // the frame we are waiting for arrived
          resolve(entry);
        };
        entry.img.onerror = () => resolve(entry);        // keep going; nearestLoaded() skips it
        entry.img.src = HF01_FRAME_PATH(index + 1);
      });

    /** Lazy tail: load remaining frames with limited concurrency, nearest-to-current first. */
    const loadLazyTail = async () => {
      if (lazyStarted) return;
      lazyStarted = true;
      const pending = [];
      for (let i = HF01_PRELOAD; i < HF01_FRAME_COUNT; i += 1) pending.push(i);
      const worker = async () => {
        while (pending.length) {
          pending.sort((a, b) => Math.abs(a - state.frame) - Math.abs(b - state.frame));
          const next = pending.shift();
          // eslint-disable-next-line no-await-in-loop
          await loadFrame(next);
        }
      };
      await Promise.all(Array.from({ length: HF01_LAZY_CONCURRENCY }, worker));
    };

    const preload = async () => {
      const first = [];
      for (let i = 0; i < Math.min(HF01_PRELOAD, HF01_FRAME_COUNT); i += 1) first.push(loadFrame(i));
      await Promise.all(first);
      requestRender();
      const saveData = navigator.connection && navigator.connection.saveData;
      if (!saveData) loadLazyTail();                  // save-data: frames load on demand from setProgress()
    };

    /** Nearest decoded frame to `index` so scrubbing never shows an empty canvas. */
    const nearestLoaded = (index) => {
      for (let d = 0; d < HF01_FRAME_COUNT; d += 1) {
        const lo = frames[index - d];
        if (lo && lo.ready) return lo.img;
        const hi = frames[index + d];
        if (hi && hi.ready) return hi.img;
      }
      return null;
    };

    /* -- Drawing ----------------------------------------------------------- */
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      state.dpr = Math.min(window.devicePixelRatio || 1, 1.5, 1600 / Math.max(1, Math.round(rect.width)));   // backing store never exceeds the 1600 px source width
      state.w = Math.max(1, Math.round(rect.width));
      state.h = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(state.w * state.dpr);
      canvas.height = Math.round(state.h * state.dpr);
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      requestRender();
    };

    /** Draw an image with object-fit: cover semantics (center crop). */
    const drawCover = (img) => {
      const { w, h } = state;
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      if (!iw || !ih) return;
      const scale = Math.max(w / iw, h / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    };

    /** DUMMY mode: panel colour, hatch, travelling gradient, scan line, frame counter. */
    function drawDummy() {
      const { w, h, progress, frame } = state;

      ctx.fillStyle = tokens.panel;
      ctx.fillRect(0, 0, w, h);

      // Hatch: same geometry as the CSS placeholder (repeating-linear-gradient 135deg, 16px period):
      // stripes run bottom-left → top-right, 16px apart measured perpendicular to the stripes.
      const step = 16 * Math.SQRT2;
      ctx.strokeStyle = `rgba(${rgb.paper}, 0.045)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = -h; x < w + h; x += step) {
        ctx.moveTo(x, h);
        ctx.lineTo(x + h, 0);
      }
      ctx.stroke();

      // Travelling gradient: a soft --faint band moves top → bottom with scroll progress
      const bandH = h * 0.7;
      const centerY = -bandH / 2 + (h + bandH) * progress;
      const grad = ctx.createLinearGradient(0, centerY - bandH / 2, 0, centerY + bandH / 2);
      grad.addColorStop(0, `rgba(${rgb.faint}, 0)`);
      grad.addColorStop(0.5, `rgba(${rgb.faint}, 0.85)`);
      grad.addColorStop(1, `rgba(${rgb.faint}, 0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Scan line at the current progress
      const scanY = Math.round(progress * (h - 1)) + 0.5;
      ctx.strokeStyle = `rgba(${rgb.paper}, 0.6)`;
      ctx.beginPath();
      ctx.moveTo(0, scanY);
      ctx.lineTo(w, scanY);
      ctx.stroke();

      // Frame counter (IBM Plex Mono, tabular)
      const size = Math.round(Math.min(w * 0.26, h * 0.18));
      ctx.fillStyle = tokens.dim;
      ctx.font = `500 ${size}px "IBM Plex Mono", "Courier New", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(pad(frame + 1, 3), w / 2, h * 0.36);

      // Meta line
      const meta = Math.max(10, Math.round(size * 0.11));
      ctx.font = `400 ${meta}px "IBM Plex Mono", "Courier New", monospace`;
      ctx.fillStyle = `rgba(${rgb.dim}, 0.9)`;
      ctx.fillText(`HF-01  ·  DUMMY  ·  ${pad(frame + 1, 3)} / ${HF01_FRAME_COUNT}`, w / 2, h * 0.36 + size * 0.75);
    }

    function drawFrameMode() {
      const { w, h } = state;
      ctx.fillStyle = tokens.panel;
      ctx.fillRect(0, 0, w, h);
      const img = nearestLoaded(state.frame);
      if (img) drawCover(img);
    }

    /* -- Mode setup ------------------------------------------------------- */
    if (HF01_FRAMES_READY) {
      panel.classList.add('has-media');            // hides the placeholder label (see styles.css)
      if (readout) readout.hidden = true;
      // The full sequence is only fetched where the scrub runs (see matchMedia below);
      // static contexts (mobile, reduced motion) load the poster frame alone.
    }

    // Keep the canvas resolution in sync with its box (pinning, viewport changes, DPR)
    if ('ResizeObserver' in window) {
      new ResizeObserver(resize).observe(panel);
    } else {
      window.addEventListener('resize', resize);
    }
    resize();                                       // also draws the poster frame (progress 0) in every mode
    if (HF01_FRAMES_READY) loadFrame(0);            // poster in EVERY mode — the matchMedia callback below never runs when no condition matches (mobile + reduced motion)

    // The poster is usually drawn before IBM Plex Mono has arrived → redraw once fonts are in
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(requestRender);

    /* -- Chapter index: click → scroll to that chapter's scrub position ----- */
    const scrollToChapter = (index) => {
      if (!activeTrigger) {                            // static stack: plain anchor behaviour
        if (chapters[index]) chapters[index].scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const span = activeTrigger.end - activeTrigger.start;
      // land past the crossfade window so the chapter copy is fully visible (chapter 0 = stage start)
      const offset = index ? (index + CHAPTER_FADE / 2) / chapterCount : 0;
      window.scrollTo({ top: activeTrigger.start + span * offset, behavior: 'smooth' });
    };
    navItems.forEach((btn) => {
      btn.addEventListener('click', () => {
        scrollToChapter(Number(btn.dataset.chapterTarget) || 0);
        if (btn.closest('[aria-hidden="true"]')) btn.blur();   // header mirror is decorative: never park focus on it
      });
    });
    // Keyboard: focusing something inside a faded chapter (e.g. the hero CTAs while chapter 2 is shown) scrolls it back into view
    stage.addEventListener('focusin', (event) => {
      const chapter = event.target.closest('.chapter');
      if (!chapter || chapter.classList.contains('is-active') || !activeTrigger) return;
      scrollToChapter(chapters.indexOf(chapter));
    });

    /* -- Pin + scrub (desktop, motion allowed) ---------------------------- */
    const mm = gsap.matchMedia();
    mm.add({ desktop: DESKTOP_MQ, motionOK: MOTION_OK_MQ }, (context) => {
      const { desktop, motionOK } = context.conditions;
      // Same gate as the stage-mode CSS (html.js …): when the inline timeout already dropped `js` (late GSAP),
      // the page is laid out as a static stack and must not be pinned.
      if (!(desktop && motionOK) || !root.classList.contains('js')) {
        setProgress(0);
        return undefined;                            // static stack, no pin, chapters stay visible via CSS
      }
      if (HF01_FRAMES_READY) preload();              // first 20 eager, rest lazy (unless the user asked for data saving)

      // quickSetters: no tween allocation on the hottest path of the page
      // quickSetter cannot drive the autoAlpha plugin property → set opacity and toggle visibility by hand
      const setters = chapters.map((el) => ({
        alpha: gsap.quickSetter(el, 'opacity'),
        y: gsap.quickSetter(el, 'y', 'px'),
        vis: (hidden) => { el.style.visibility = hidden ? 'hidden' : ''; },
      }));
      const smooth = (t) => t * t * (3 - 2 * t);     // smoothstep

      /** Crossfade the chapter copy around each boundary; chapter 0 has no fade-in, the last no fade-out. */
      const layoutChapters = (p) => {
        const n = chapterCount;
        const half = CHAPTER_FADE / 2;
        chapters.forEach((el, i) => {
          const t = p * n - i;                       // 0 = chapter start, 1 = chapter end
          const aIn = i === 0 ? 1 : smooth(clamp01((t + half) / CHAPTER_FADE));
          const aOut = i === n - 1 ? 1 : 1 - smooth(clamp01((t - (1 - half)) / CHAPTER_FADE));
          const a = aIn * aOut;
          setters[i].alpha(a);
          setters[i].vis(a <= 0.001);                // fully faded chapters leave the focus order and the a11y tree
          setters[i].y((1 - aIn) * 24 - (1 - aOut) * 24);
        });
      };

      const proxy = { p: 0 };
      const onScrub = () => {
        setProgress(proxy.p);
        layoutChapters(proxy.p);
      };

      // start as a string, evaluated once per matchMedia run (the callback re-runs across the 768px boundary,
      // so a header-height change is still picked up). Note: the 2026-09-17 "pin never re-engages" bug was
      // CSS scroll-behavior: smooth, not this — see styles.css §2 and initAnchors().
      const pinStart = `top ${headerHeight()}px`;
      const tween = gsap.to(proxy, {
        p: 1,
        ease: 'none',
        onUpdate: onScrub,
        scrollTrigger: {
          trigger: stage,
          start: pinStart,
          end: HERO_PIN_DISTANCE,
          pin: true,
          pinSpacing: true,
          anticipatePin: 1,
          scrub: 0.35,                               // slight smoothing, still direct
          invalidateOnRefresh: true,
          onRefresh: onScrub,
          onToggle: (self) => { if (headerIndex) headerIndex.classList.toggle('is-visible', self.isActive); },
        },
      });
      activeTrigger = tween.scrollTrigger || null;
      if (headerIndex && activeTrigger) headerIndex.classList.toggle('is-visible', activeTrigger.isActive);
      onScrub();

      // Cleanup when conditions change (matchMedia reverts the tween/trigger itself)
      return () => {
        activeTrigger = null;
        if (headerIndex) headerIndex.classList.remove('is-visible');
        gsap.set(chapters, { clearProps: 'opacity,visibility,transform' });
        setProgress(0);
        setActiveChapter(0);
      };
    });
  }

  /** Hero intro: eyebrow / lines / bottom block / film — once, on load (chapter 1 copy). */
  function initHeroIntro() {
    if (!doc.querySelector('.stage')) return;              // landing pages have no stage
    const lines = gsap.utils.toArray('.hero__line-inner');
    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });

    tl.fromTo('.hero__eyebrow', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.6 }, 0)
      // y: 0 is explicit: the CSS pre-state translateY(110%) is read back by GSAP as a px offset (not yPercent),
      // so without resetting y the lines would stay shifted by that residual after the tween.
      .fromTo(lines, { yPercent: 110, y: 0 }, { yPercent: 0, y: 0, duration: 0.9, ease: 'power3.out', stagger: 0.08 }, 0.1)
      .fromTo('.stage__media', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.8 }, 0.2)
      .fromTo('.hero__bottom', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.6 }, 0.5);
  }

  /**
   * In-page anchors scroll smoothly via JS instead of CSS scroll-behavior (which breaks ScrollTrigger's
   * pin measurement in Chrome — refresh() jumps to 0, Chrome animates the jump, start comes out as -scrollY).
   * scroll-margin-top on the sections keeps the fixed header clear; reduced motion → instant jump.
   */
  function initAnchors() {
    doc.addEventListener('click', (event) => {
      const link = event.target.closest('a[href^="#"]');
      if (!link || link.getAttribute('href').length < 2) return;
      const target = doc.getElementById(link.getAttribute('href').slice(1));
      if (!target) return;
      event.preventDefault();
      // focus first: a focus() call after scrollIntoView cancels Chrome's smooth scroll animation
      if (target.tabIndex < 0 && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
      if (history.pushState) history.pushState(null, '', link.getAttribute('href'));
      target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    });
  }

  /* ------------------------------------------------------------------------
     4. Reveals & process timeline
     ------------------------------------------------------------------------ */

  /**
   * .reveal utility — fade + 16px rise, 0.6 s, power2.out.
   * Elements inside a [data-reveal-group] container stagger together (60 ms),
   * all others trigger individually. Hero elements are handled by initHeroIntro().
   */
  function initReveals() {
    const grouped = new Set();

    gsap.utils.toArray('[data-reveal-group]').forEach((group) => {
      const items = gsap.utils.toArray('.reveal', group).filter((el) => !el.closest('.stage'));
      if (!items.length) return;
      items.forEach((el) => grouped.add(el));
      gsap.to(items, {
        opacity: 1,
        y: 0,
        duration: REVEAL.duration,
        ease: REVEAL.ease,
        stagger: REVEAL.stagger,
        scrollTrigger: { trigger: group, start: 'top 85%', once: true },
      });
    });

    gsap.utils.toArray('.reveal')
      .filter((el) => !grouped.has(el) && !el.closest('.stage'))
      .forEach((el) => {
        gsap.to(el, {
          opacity: 1,
          y: 0,
          duration: REVEAL.duration,
          ease: REVEAL.ease,
          scrollTrigger: { trigger: el, start: 'top 88%', once: true },
        });
      });
  }

  /** Process line: scaleX (≥1024px, horizontal) / scaleY (vertical) scrubbed by scroll. No pinning. */
  function initTimeline() {
    const progress = doc.querySelector('.timeline__progress');
    const steps = doc.querySelector('.timeline__steps');
    if (!progress || !steps) return;

    const mm = gsap.matchMedia();
    mm.add({ horizontal: TIMELINE_DESKTOP_MQ, motionOK: MOTION_OK_MQ }, (context) => {
      const { horizontal, motionOK } = context.conditions;
      if (!motionOK) return undefined;               // CSS shows the full line

      const from = horizontal ? { scaleX: 0, scaleY: 1 } : { scaleX: 1, scaleY: 0 };
      gsap.fromTo(progress, from, {
        scaleX: 1,
        scaleY: 1,
        ease: 'none',
        scrollTrigger: {
          trigger: steps,
          start: 'top 75%',
          end: horizontal ? 'bottom 55%' : 'bottom 65%',
          scrub: true,
          invalidateOnRefresh: true,
        },
      });
      return undefined;
    });
  }

  /* ------------------------------------------------------------------------
     5. Contact form
     ------------------------------------------------------------------------ */

  /**
   * Inline validation (blur / input / submit) for the two required fields. Submission:
   *  - FORM_ENDPOINT set   → POST as multipart/form-data, confirmation on 2xx, error line otherwise
   *  - FORM_ENDPOINT empty → STUB: honest status line, nothing is sent, fields stay editable
   */
  function initContactForm() {
    const form = doc.getElementById('contact-form');
    if (!form) return;

    const status = form.querySelector('.form-status');
    const submit = form.querySelector('button[type="submit"]');
    const required = [
      { input: form.elements.name, message: 'Bitte geben Sie Ihren Namen an.' },
      { input: form.elements.contact, message: 'Bitte geben Sie eine E-Mail-Adresse oder Telefonnummer an.' },
    ].filter((f) => f.input);

    const BASE_DESCRIBEDBY = 'form-note';
    if (form.elements.t) form.elements.t.value = String(Date.now());   // fill-time check in contact.php (bots submit at once)

    const setError = (input, message) => {
      const field = input.closest('.field');
      let error = field.querySelector('.field__error');
      if (!message) {
        field.classList.remove('is-invalid');
        input.removeAttribute('aria-invalid');
        input.setAttribute('aria-describedby', BASE_DESCRIBEDBY);
        if (error) error.remove();
        return;
      }
      if (!error) {
        error = doc.createElement('p');
        error.className = 'field__error';
        error.id = `${input.id}-error`;
        field.appendChild(error);
      }
      error.textContent = message;
      field.classList.add('is-invalid');
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', `${BASE_DESCRIBEDBY} ${error.id}`);
    };

    const announce = (text) => {
      if (!status) return;
      status.textContent = text;
      status.focus({ preventScroll: true });       // keep keyboard position; role="status" announces it
    };

    required.forEach(({ input, message }) => {
      input.addEventListener('blur', () => setError(input, input.value.trim() ? '' : message));
      input.addEventListener('input', () => { if (input.value.trim()) setError(input, ''); });
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      let firstInvalid = null;
      required.forEach(({ input, message }) => {
        const valid = input.value.trim().length > 0;
        setError(input, valid ? '' : message);
        if (!valid && !firstInvalid) firstInvalid = input;
      });
      if (firstInvalid) {
        firstInvalid.focus();
        return;
      }

      if (!FORM_ENDPOINT) {
        // STUB — no backend connected yet (see FORM_ENDPOINT)
        announce('Vielen Dank. Das Kontaktformular ist noch nicht angebunden — bitte nutzen Sie vorerst Telefon oder E-Mail.');
        return;
      }

      if (submit) submit.disabled = true;
      try {
        const response = await fetch(FORM_ENDPOINT, {
          method: 'POST',
          body: new FormData(form),
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        form.querySelectorAll('input, textarea').forEach((el) => { el.disabled = true; });
        announce('Vielen Dank. Ihre Nachricht ist eingegangen — wir melden uns vertraulich bei Ihnen.');
      } catch (error) {
        if (submit) submit.disabled = false;
        announce('Die Nachricht konnte nicht gesendet werden. Bitte versuchen Sie es erneut oder nutzen Sie Telefon oder E-Mail.');
        console.error('[edo] form submission failed', error);
      }
    });
  }

  /* ------------------------------------------------------------------------
     6. Footer year
     ------------------------------------------------------------------------ */
  function initYear() {
    const year = doc.getElementById('year');
    if (year) year.textContent = String(new Date().getFullYear());
  }

  /* ------------------------------------------------------------------------
     7. Init
     ------------------------------------------------------------------------ */
  function init() {
    initMenu();
    initAnchors();
    initContactForm();
    initYear();

    if (!hasGSAP) {
      // CDN unavailable: drop the pre-animation states, show everything statically
      root.classList.remove('js');
      console.warn('[edo] GSAP not available — animations disabled, content shown statically.');
      return;
    }

    gsap.registerPlugin(ScrollTrigger);
    ScrollTrigger.config({ ignoreMobileResize: true });

    // `js` may already have been dropped by the inline timeout (GSAP arrived late): content is visible,
    // so skip the entrance animations that rely on the CSS pre-states — scrub and timeline still run.
    const preStates = root.classList.contains('js');

    initHeroScrub();                                 // handles its own media queries
    if (preStates && !reduceMotion) {
      initHeroIntro();
      initReveals();
    }
    initTimeline();

    // Web fonts change line counts → recalculate trigger positions once they are in
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(() => ScrollTrigger.refresh());
  }

  try {
    init();
  } catch (error) {
    // Static fallback: nothing pinned, nothing hidden
    root.classList.remove('js');
    if (hasGSAP) {
      ScrollTrigger.getAll().forEach((trigger) => trigger.kill(true));
      gsap.set('.reveal, .hero-intro, .hero__line-inner, .timeline__progress, .stage__media, .chapter', { clearProps: 'all' });
    }
    console.error('[edo] init failed — falling back to static content.', error);
  }
})();

/* ==========================================================================
   8a. VARIANT v3 „Kapitel-Hero“ — 2026-09-16 afternoon (commissioned by Kyung: “die Loomere-Variante”)
   The split hero (3/5 copy | 2/5 pinned portrait film) became a full-bleed stage: ONE 16:9 film,
   three chained Kling clips (91 + 73 + 73 frames), scrubbed over +=300% with one viewport of scroll
   per chapter. Chapter copy (Slogan → Konzept head → Leitsatz) crossfades over a --ink scrim; a mono
   chapter index sits on a hairline at the bottom and scrolls to the chapter's scrub position.
   Below 768px, with reduced motion or without JS the stage is a static stack (4:5 poster + chapters).
   Deliberate deviation from the brief's hero layout — Kyung's decision on 2026-09-16. The Konzept
   section keeps only its two columns; head + band moved into chapters 2 and 3 (no text duplicated).
   Evidence (Claude Browser pane, 870×465 and 375×812; rAF throttled in the hidden pane, so states
   were forced for screenshots): pin from scroll 0, readout 001/237 → 128 @ 1.5 vh → 226 @ 2.85 vh,
   chapter opacities [1,0,0] / [0,1,0] / [0,0,1] at 0.9 / 1.5 / 2.5 vh, nav display block, no horizontal
   overflow, all 237 frames 200 with ?v=3; mobile: no pin, chapters stacked, nav/scrim hidden.
   Previous variant kept as git tag v2-split-hero-take4.

   Rebrand 2026-10-01 (Kyung): company is now "edo security" (www.edo-security.de), claim "Vertrauen als
   Grundlage. Leistung als Anspruch." Wordmark lowercase with bold "edo" (the one non-uppercase element), header
   sub "Personenschutz & Begleitservice", eyebrow "edo security / Berlin — …", chapter 2 title = the claim (two
   lines), chapter 3 = "Sicherheit und Handlungsfreiheit als Ergebnis.", chapter index 01 Sicherheit / 02 Konzept /
   03 Ergebnis, footer wordmark + claim, legal line "edo security · Berlin" (legal form TBC), JSON-LD name/url,
   canonical + og:url https://www.edo-security.de/ (DENIC listed the domain as FREE on 2026-10-01 — register it),
   favicon "e". No other copy changed. Mobile fixes: footer claim wraps, chapter title 6vw below 768px.
   Logo 2026-10-01, second decision the same day (Kyung: "Ich will die Alternative lieber nehmen"): the drawn
   wordmark "edo" ("Drei Kreise, ein Stamm", assets/brand) replaces the sign + typed wordmark. Inline SVG
   viewBox 0 -50 342 150 (bottom = baseline → align-items: baseline), x-height 16 px = 24 × 54.72 px (first cut
   20 px, reduced the same day — Kyung: "edo wirkt sehr dominant"); descriptor "SECURITY" as text in Plex Mono
   500 / 12 px / 0.16 em, one step above the 11 px nav labels, one module (16 px) away. Header svg aria-hidden (the
   link is labelled), footer svg role="img" aria-label="edo". Favicon = monogram "e" 32 px (inline data URI)
   + edo-favicon.ico (16/32/48) + apple-touch-icon; OG image rebuilt with the new lockup; JSON-LD paths unchanged.
   Assets v=13. Verified at 16 px: 375 (header 56 px, brand 144 × 26 px, no horizontal scroll), 1024 (brand with
   sub 360 × 45 px, 32 px to the nav), 1440 (brand ends 443 px, header mirror 487–812 px, nav from 856 px);
   console empty.
   The sign "Die Rückendeckung" stays in git history (commit 1d3e4cc), not used in parallel.
   Fonts 2026-10-01 (v=14): Google Fonts replaced by self-hosted woff2 in assets/fonts (Google's own builds: Space
   Grotesk variable 300–700, IBM Plex Mono 400/500, latin + latin-ext with Google's unicode-range), @font-face at the
   top of styles.css, font-display: swap, two latin files preloaded. No request to fonts.googleapis/gstatic remains
   (LG München 2022). Form note now lists the four facts Edwin needs for the first conversation (interview 01.10.:
   Leistungsbedarf, Zeitraum, Ort, Ansprechpartner) — copy from the interview answers, no layout change.
   Landing page 2026-10-01 (v=15, Kyung: Hub + Landingpages = ja, keine Preise, FAQ auf der Landingpage):
   personenschutz-berlin/index.html, generated by scratchpad brand/../lp/build_lp.py from the one-pager's shared
   blocks (header without chapter mirror, founder + "Stand: Oktober 2026", facts bar, contact, footer) plus copy from
   the brief and Edwin's interview answers; Kriterien block = six legal facts with gesetze-im-internet.de sources
   (§ 34a/§ 11b GewO, §§ 6/14/16/17/18/21 BewachV, § 28 WaffG), FAQ = seven answers as visible text (no FAQPage
   schema by plan). CSS section 9 (lp-*, criteria, faq) on the same tokens. script.js: initHeroIntro() now returns
   without a .stage so landing pages log no GSAP target warnings. Home links to it (services section + footer);
   robots.txt + sitemap.xml at the root (deploy/ carries Disallow + noindex). Verified 1024 (2×3 criteria grid,
   46/46 reveals, console empty), 375 (single column, no horizontal scroll).
   Review 2026-10-01 (5 lenses × adversarial verify, 30 findings, 24 confirmed, all applied, v=16): two legal
   corrections (Bewacherregister: exists since 2019, Destatis is the register authority — not "since 2019";
   retention = three years after the end of the year the contract ended, § 21 Abs. 4 BewachV), unsourced clause
   "Auftraggeber nicht" removed, "keine hoheitlichen Befugnisse" replaced by the § 17 Abs. 1 BewachV wording,
   § 28 WaffG also covers objects; duplicates between Einordnung/FAQ/Zielgruppen removed, Begleitschutz bridged
   to Sicherheitsbegleitung, meta description 151 chars, Service.availableChannel instead of availableLanguage,
   H1 mobile size, poster path; CSS: the .lp-row classes, .lp-stand and .lp-hero__lead dropped in favour of .audience__item--wide,
   .footnote and .section__intro. Refuted (kept): "Stand: Oktober 2026", criterion 01 next to the facts bar.
   Hosting 2026-10-01 (v=17, Kyung: all-inkl Privat, domain there): mailer server/contact.php (mail() to RECIPIENT,
   stores nothing, honeypot "website" + fill-time "t" + per-IP-hash rate limit, header-injection safe, same-origin
   check); form carries the two extra fields (.field--hp off-screen, aria-hidden, tabindex -1). FORM_ENDPOINT stays
   '' in the repo; release.py writes 'contact.php' into release/script.js. Stub behaviour in previews unchanged.

   Pin bug 2026-09-17/18 (reported by Kyung: after scrolling past the stage and back, the film sat 1–2
   viewports too low with black above it). Root cause: CSS `html { scroll-behavior: smooth }`.
   ScrollTrigger.refresh() (fired by fonts.ready, resize, visibilitychange) scrolls to 0 to measure pinned
   elements and switches scroll-behavior to auto via an inline style right before — Chrome applied the
   stale "smooth" value, animated the jump, and the stage was measured at the old scroll position:
   start = -scrollY, end = start + 300vh → the pin never re-engaged. Fix: no CSS smooth scrolling;
   in-page anchors scroll via JS (initAnchors, focus before scrollIntoView, reduced motion → instant).
   Verified in Chrome 1710×833: refresh at 0 / 900 / 1800 / 3000 px → start 0, end 2667, pinned; wheel
   down past the end and back → fixed at top 64, chapters crossfade; synthetic visibilitychange → intact.

   Review 2026-09-16/17 (workflow: layout / JS / a11y / brand+perf, adversarial verification; 9 confirmed,
   all fixed): static stack width transfer (.stage__media width 100%), poster in every mode (loadFrame(0)
   unconditionally + <img class="hf-media"> under the canvas + <link rel=preload>), pin gated on html.js like
   the CSS, real crossfade (opacity quickSetter + manual visibility; autoAlpha via quickSetter was a no-op),
   chapter click lands past the fade window, header mirror (≥1440px, flex item, aria-hidden, blurs on click),
   focusin on a faded chapter scrolls it back, save-data → on-demand frames only, canvas backing ≤ 1600px.
   Evidence 1280×800 (ScrollTrigger driven manually — rAF throttled in the hidden pane): p=0 [1,0,0];
   p=1/3 [0.5,0.5,0]; p=0.5 [0,1,0]; p=2/3 [0,0.5,0.5]; p=1 [0,0,1]; visibility hidden at 0 → the hero CTA
   cannot take focus while faded; click targets 856/1656 px = start + span·(i+0.07)/3; mirror hidden after the
   pin. 740×360 and no-js: poster full width, label hidden, all chapters visible. 1440/1920: mirror between
   brand and nav without overlap; hidden at 1280.
   ==========================================================================

   8. ACCEPTANCE CHECKLIST — verified 2026-09-15
   Chrome (Claude Browser pane) on a local static server; widths 360 / 757 / 900 / 1024 / 1100 / 1280 / 1440 px.
   Static analysis: 7-dimension review (spec, design system, a11y, responsive, JS/GSAP, SEO/perf, copy) with
   adversarial verification of every finding; all confirmed items fixed before this checklist was written.

   [x] 4 Leistungen, 5 Zielgruppen, 4 Prozessschritte, alle Claims korrekt
       index.html: .service ×4 (01–04 → HF-03a–d), .audience__item ×5, .step ×4, 6 credentials. Slogan,
       sub-claims, band, founder quote and all section copy taken verbatim from the brief; the founder intro
       is limited to the two facts the brief names. No prices, no invented references.
   [x] Kein externes Bild/Video geladen; alle 7+ HF-Platzhalter mit korrekten data-Attributen und Ratios
       Network: Google Fonts CSS/woff2 + cdnjs GSAP + local assets/ (WebP stills, hf01 frame sequence); no third-party
       media; favicon is an inline data: SVG (no /favicon.ico 404).
       Assets live since 2026-09-16: HF-01 (163-frame scrub; take 4 "Kolonnade" replaced take 1 the same day — figure fills
       25–100 % of frame height, bright glass field for contrast, no face at any frame; frame URLs carry ?v=HF01_FRAME_VERSION
       because re-rendered frames under the same names were served from cache), HF-03a–d and HF-04 (WebP ≤ 85 KB), HF-02 as a
       monochrome 4:5 still cut from the founder's own portrait (assets/hf02.webp, no generation, no synthetic face). Placeholders: HF-01 (video, 4:5–9:16, canvas scrub),
       HF-02 (image, 4:5; video loop markup kept commented), HF-03a–d (image, 1:1), HF-04 (image, 21:9) — each with class hf-placeholder + data-hf-id / -type / -ratio / -note, role="img"
       + aria-label (HF-04 decorative → aria-hidden, see deviations), commented <video autoplay muted loop
       playsinline> / <img> swap-in markup, .hf-media pre-provisioned with object-fit: cover, label hides
       itself via :has(.hf-media). aspect-ratio on every media box.
   [x] prefers-reduced-motion deaktiviert alle Animationen
       styles.css §9 resets the pre-states (.reveal, .hero-intro, .hero__line-inner, .timeline__progress),
       stops the scroll-hint keyframe and zeroes all transition/animation durations. script.js skips intro and
       reveals when reduceMotion is set; hero pin and timeline live inside gsap.matchMedia
       '(prefers-reduced-motion: no-preference)', so nothing is pinned or scrubbed.
   [x] Mobile 360 px ohne horizontales Scrollen; Header-Menü funktioniert
       360×740: scrollWidth 360 = viewport, no element extends past the right edge (footer brand wraps, header
       toggle ends at 336 px). Overlay menu: aria-expanded toggles, focus moves to the first link, main/footer
       are inert while open, Escape closes and returns focus to the toggle, link click closes and scrolls.
   [x] Kontrast AA; Fokus-Zustände sichtbar; ein h1
       Text on --ink: --paper ≈18:1, --muted ≈8.2:1, --dim ≈6.0:1; --dim on --panel ≈5.2:1. --faint only for
       the decorative, aria-hidden numerals the brief prescribes. :focus-visible = 1 px --paper outline; form
       fields switch their border to --paper on focus. Exactly one <h1>; h2 per section, h3 inside.
   [x] border-radius durchgängig 0, keine box-shadows, keine Akzentfarbe — Rasterlinien konsequent aus --line
       Global reset border-radius: 0; no box-shadow anywhere; the only hex values in styles.css are the eight
       tokens, the canvas derives its rgba() from the same tokens. Exceptions, all documented in the CSS:
       dev-only placeholder label frame uses --dim (--line is invisible on --panel); quote bar, focus and
       invalid-field border use --paper; ghost button border --faint as briefed.
   [x] Scroll-Scrub-Hero: Dummy-Modus läuft flüssig (Frame-Zähler folgt dem Scroll), Pin löst sich sauber,
       Mobile/reduced-motion ohne Pin
       1024×768: pinned from scroll 0 under the fixed header, readout 002 @ 4 px, 082 @ 701 px, 160 @ end
       (pin distance 180 vh, pin-spacer 2086 px), hero returns to position: relative afterwards, anchor links
       (#konzept …) land correctly behind the pin spacer. <768 px: no pin-spacer, static poster frame 001,
       panel 4:5. Frame mode live since 2026-09-16: 163 WebP frames (900×1600, grayscale-graded) from the
       Kling 3.0 take; full sequence only fetched on desktop + motion allowed, poster frame elsewhere.
   [x] Footer: UG (haftungsbeschränkt) i.G., Impressum-/Datenschutz-TODOs
       "Trust and Performance Concept UG (haftungsbeschränkt) — in Gründung · Berlin", Impressum/Datenschutz
       as href="#" with TODO comment, © year set by initYear().
   [x] GSAP-Trigger werfen keine Konsolen-Fehler
       Console clean at every tested width, across pin/unpin, menu and form interactions.

   Open before launch (each marked TODO in the code): confirm the § 34a wording against the Antragsstatus
   (facts bar entry + footnote), set FORM_ENDPOINT, insert phone / e-mail, create Impressum + Datenschutz pages,
   add og:url / og:image / canonical and JSON-LD @id / url / telephone, flip HF01_FRAMES_READY once the frame
   sequence exists, decide whether the DE/EN switch is unhidden.
   Deliberate deviations from the brief: HF-04 is aria-hidden (pure background texture) instead of role="img";
   H1 is capped at 5rem with a column-based clamp (a 6rem "Ihre Handlungsfreiheit." does not fit the 3/5 column
   on one line) and breaks at &shy; between 768 and ~1080 px; 1 px --line field borders are below the 3:1
   non-text contrast of WCAG 1.4.11 by design-system definition — labels and the --paper focus border identify
   the fields; Google Fonts CSS stays render-blocking on purpose (a font swap after first paint would shift the
   typographic layout).
   ========================================================================== */

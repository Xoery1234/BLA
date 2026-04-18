/* ==========================================================================
   Brand Launch Accelerator — Interaction Controller
   ES Module loaded by: scripts/scripts.js → import('./interactions.js')

   Runtime handlers only — reveal CLASSES are applied pre-paint in scripts.js
   (decorateMain → autoRevealBlocks) to prevent FOUC flicker.

   Foundational tier:
   1. Scroll-triggered reveals (IntersectionObserver)
   2. Parallax hero images (rAF)
   3. Number count-up animation
   4. Sticky nav scroll state + progress bar
   5. Sticky CTA visibility

   Cinematic tier:
   6. Scene (pinned scrollytelling stage)
   7. Parallax layers (multi-depth)
   8. Horizontal scroll strip
   9. Text reveal by word
   ========================================================================== */

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Detect if we're on the interaction showcase page (re-triggerable demos) */
const isShowcase = window.location.pathname.includes('interaction-showcase');

/* ============================================================================
   SHARED — rAF scroll scheduler. One listener, many subscribers.
   Reduces scroll-event thrash when many cinematic patterns are on the page.
   ============================================================================ */
const scrollHandlers = new Set();
let scrollTicking = false;

function onScroll() {
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(() => {
    scrollHandlers.forEach((fn) => fn());
    scrollTicking = false;
  });
}

function scheduleScrollHandler(fn) {
  scrollHandlers.add(fn);
  if (scrollHandlers.size === 1) {
    window.addEventListener('scroll', onScroll, { passive: true });
    // Also re-run on resize since cinematic patterns rely on viewport dims
    window.addEventListener('resize', onScroll, { passive: true });
  }
  // Run once immediately so initial state paints correctly
  fn();
}

/* ── SCROLL-TRIGGERED REVEALS ───────────────────────────────────────────── */

function initReveals() {
  const revealElements = document.querySelectorAll(
    '.reveal, .reveal-fade, .reveal-scale, .reveal-stagger',
  );
  if (!revealElements.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
          if (!isShowcase) {
            observer.unobserve(entry.target); // Once only on production pages
          }
        } else if (isShowcase) {
          // On showcase page: re-trigger when scrolling back
          entry.target.classList.remove('is-revealed');
        }
      });
    },
    { threshold: 0.15, rootMargin: '0px 0px -60px 0px' },
  );

  revealElements.forEach((el) => observer.observe(el));
}

/* ── PARALLAX HERO ──────────────────────────────────────────────────────── */

function initParallax() {
  if (prefersReducedMotion) return;

  const heroes = document.querySelectorAll('.hero');
  if (!heroes.length) return;

  const strength = parseFloat(
    getComputedStyle(document.documentElement)
      .getPropertyValue('--parallax-strength') || '0.25',
  );

  scheduleScrollHandler(() => {
    heroes.forEach((hero) => {
      const img = hero.querySelector('img');
      if (!img) return;
      const rect = hero.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) return;

      // Rect-relative offset: 0 when hero center aligns with viewport center.
      // Negative (img translates up) when hero is above center; positive when below.
      // Using hero center avoids the absolute-scrollY drift that made strength feel wrong.
      const heroCenter = rect.top + rect.height / 2;
      const viewCenter = window.innerHeight / 2;
      const offset = (heroCenter - viewCenter) * strength * -1;

      img.style.transform = `translate3d(0, ${offset.toFixed(1)}px, 0) scale(1.15)`;
    });
  });
}

/* ── NUMBER COUNT-UP ──────────────────────────────────────────────────── */

function initCountUp() {
  const counters = document.querySelectorAll('[data-count-target]');
  if (!counters.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;

        const el = entry.target;
        const target = parseFloat(el.dataset.countTarget);
        const duration = parseInt(el.dataset.countDuration || '1500', 10);
        const decimals = el.dataset.countDecimals || '0';
        const prefix = el.dataset.countPrefix || '';
        const suffix = el.dataset.countSuffix || '';
        const start = performance.now();

        function update(now) {
          const elapsed = now - start;
          const progress = Math.min(elapsed / duration, 1);
          const eased = 1 - (1 - progress) ** 3;
          const current = eased * target;
          el.textContent = prefix + current.toFixed(parseInt(decimals, 10)) + suffix;
          if (progress < 1) requestAnimationFrame(update);
        }

        if (prefersReducedMotion) {
          el.textContent = prefix + target.toFixed(parseInt(decimals, 10)) + suffix;
        } else {
          requestAnimationFrame(update);
        }
        observer.unobserve(el);
      });
    },
    { threshold: 0.5 },
  );

  counters.forEach((el) => observer.observe(el));
}

/* ── STICKY NAV ────────────────────────────────────────────────────────── */

function initStickyNav() {
  const header = document.querySelector('header');
  if (!header) return;

  scheduleScrollHandler(() => {
    const scrolled = window.scrollY > 50;
    header.classList.toggle('is-scrolled', scrolled);
  });
}

/* ── SCROLL PROGRESS ───────────────────────────────────────────────────── */

function initScrollProgress() {
  const header = document.querySelector('header');
  if (!header) return;

  scheduleScrollHandler(() => {
    const scrollTop = window.scrollY;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
    header.style.setProperty('--scroll-progress', `${progress}%`);
  });
}

/* ── STICKY CTA (Mobile) ────────────────────────────────────────────────── */

function initStickyCTA() {
  const stickyCta = document.querySelector('.sticky-cta');
  if (!stickyCta) return;

  document.body.classList.add('has-sticky-cta');

  const hero = document.querySelector('.hero');
  if (!hero) {
    stickyCta.classList.add('is-visible');
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        stickyCta.classList.toggle('is-visible', !entry.isIntersecting);
      });
    },
    { threshold: 0 },
  );

  observer.observe(hero);
}

/* ── SCENE (pinned scrollytelling) ──────────────────────────────────────── */

function initScenes() {
  if (prefersReducedMotion) return;

  const scenes = document.querySelectorAll('.scene');
  if (!scenes.length) return;

  scheduleScrollHandler(() => {
    scenes.forEach((scene) => {
      const rect = scene.getBoundingClientRect();
      const vh = window.innerHeight;
      const total = rect.height - vh;
      if (total <= 0) return;

      // Progress 0 when scene top aligns with viewport top.
      // Progress 1 when scene bottom aligns with viewport bottom (all scrolled).
      const scrolled = Math.max(0, -rect.top);
      const progress = Math.min(1, scrolled / total);

      scene.querySelectorAll('.scene-layer').forEach((layer) => {
        const from = parseFloat(layer.dataset.sceneFrom) || 0;
        const to = parseFloat(layer.dataset.sceneTo) || 1;
        let lp = 0;
        if (progress <= from) lp = 0;
        else if (progress >= to) lp = 1;
        else if (to > from) lp = (progress - from) / (to - from);
        layer.style.setProperty('--layer-progress', lp.toFixed(3));
      });
    });
  });
}

/* ── PARALLAX LAYERS ─────────────────────────────────────────────────── */

function initParallaxLayers() {
  if (prefersReducedMotion) return;

  const blocks = document.querySelectorAll('.parallax-layers');
  if (!blocks.length) return;

  scheduleScrollHandler(() => {
    blocks.forEach((block) => {
      const rect = block.getBoundingClientRect();
      const vh = window.innerHeight;
      if (rect.bottom < -vh || rect.top > vh * 2) return;

      // Offset: 0 when block center aligns with viewport center.
      // Positive when block is above center (we've scrolled past).
      const blockCenter = rect.top + rect.height / 2;
      const viewCenter = vh / 2;
      const offset = viewCenter - blockCenter;

      block.querySelectorAll('.parallax-layer').forEach((layer) => {
        const speed = parseFloat(layer.dataset.parallaxSpeed);
        const s = Number.isFinite(speed) ? speed : 0.5;
        // s = 1: no parallax (translate = 0, moves naturally with scroll)
        // s < 1: lagging background (translate same direction as scroll diff)
        // s > 1: leading foreground (translate opposite direction, faster motion)
        const translate = offset * (1 - s);
        layer.style.setProperty('--layer-translate', `${translate.toFixed(1)}px`);
      });
    });
  });
}

/* ── HORIZONTAL SCROLL ────────────────────────────────────────────────── */

function initHorizontalScroll() {
  if (prefersReducedMotion) return;
  // Desktop-only. Mobile falls back to vertical stack via CSS.
  if (window.innerWidth < 900) return;

  const blocks = document.querySelectorAll('.horizontal-scroll');
  if (!blocks.length) return;

  scheduleScrollHandler(() => {
    blocks.forEach((block) => {
      const rect = block.getBoundingClientRect();
      const vh = window.innerHeight;
      const total = rect.height - vh;
      if (total <= 0) return;

      const scrolled = Math.max(0, -rect.top);
      const progress = Math.min(1, scrolled / total);

      const slides = block.querySelectorAll('.horizontal-scroll-slide');
      const track = block.querySelector('.horizontal-scroll-track');
      if (!track || slides.length < 2) return;

      const maxX = (slides.length - 1) * window.innerWidth;
      track.style.setProperty('--track-x', `${(-progress * maxX).toFixed(1)}px`);
    });
  });
}

/* ── TEXT REVEAL BY WORD ──────────────────────────────────────────────── */

function initTextReveal() {
  const elements = document.querySelectorAll('.text-reveal');
  if (!elements.length) return;

  const stagger = parseFloat(
    getComputedStyle(document.documentElement)
      .getPropertyValue('--anim-stagger-text') || '40',
  ) || 40;

  // Split text nodes into .word spans in-place. Preserves inline markup
  // (<strong>, <em>, etc.) by only wrapping text nodes, not elements.
  elements.forEach((el) => {
    // Idempotence guard — dapreview re-runs loadPage(), skip if already split.
    if (el.dataset.textRevealSplit === '1') return;
    el.dataset.textRevealSplit = '1';

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let node = walker.nextNode();
    while (node) {
      // Skip empty/whitespace-only nodes
      if (node.textContent.trim()) textNodes.push(node);
      node = walker.nextNode();
    }

    let wordIndex = 0;
    textNodes.forEach((textNode) => {
      const parts = textNode.textContent.split(/(\s+)/);
      const frag = document.createDocumentFragment();
      parts.forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) {
          frag.appendChild(document.createTextNode(part));
        } else {
          const span = document.createElement('span');
          span.className = 'word';
          span.textContent = part;
          span.style.transitionDelay = `${wordIndex * stagger}ms`;
          frag.appendChild(span);
          wordIndex += 1;
        }
      });
      textNode.parentNode.replaceChild(frag, textNode);
    });
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
          if (!isShowcase) observer.unobserve(entry.target);
        } else if (isShowcase) {
          entry.target.classList.remove('is-revealed');
        }
      });
    },
    { threshold: 0.3 },
  );

  elements.forEach((el) => observer.observe(el));
}

/* ── INIT ────────────────────────────────────────────────────────────────── */

export default function initInteractions() {
  // Foundational
  initReveals();
  initParallax();
  initCountUp();
  initStickyNav();
  initScrollProgress();
  initStickyCTA();
  // Cinematic
  initScenes();
  initParallaxLayers();
  initHorizontalScroll();
  initTextReveal();
}

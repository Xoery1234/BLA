/* ==========================================================================
   Brand Launch Accelerator — Interaction Controller
   ES Module loaded by: scripts/scripts.js → import('./interactions.js')

   Runtime handlers only — reveal CLASSES are applied pre-paint in scripts.js
   (decorateMain → autoRevealBlocks) to prevent FOUC flicker.

   1. Scroll-triggered reveals (IntersectionObserver)
   2. Parallax hero images
   3. Number count-up animation
   4. Sticky nav scroll state + progress bar
   5. Sticky CTA visibility
   ========================================================================== */

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Detect if we're on the interaction showcase page (re-triggerable demos) */
const isShowcase = window.location.pathname.includes('interaction-showcase');

/* ── SCROLL-TRIGGERED REVEALS ──────────────────────────────────────────── */

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

/* ── PARALLAX HERO ─────────────────────────────────────────────────────── */

function initParallax() {
  if (prefersReducedMotion) return;

  const heroes = document.querySelectorAll('.hero');
  if (!heroes.length) return;

  const strength = parseFloat(
    getComputedStyle(document.documentElement)
      .getPropertyValue('--parallax-strength') || '0.15',
  );

  let ticking = false;

  function updateParallax() {
    const { scrollY } = window;
    heroes.forEach((hero) => {
      const img = hero.querySelector('img');
      if (!img) return;
      const rect = hero.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) return;
      const offset = scrollY * strength;
      img.style.transform = `translateY(${offset}px) scale(1.05)`;
    });
    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(updateParallax);
      ticking = true;
    }
  }, { passive: true });
}

/* ── NUMBER COUNT-UP ───────────────────────────────────────────────────── */

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

  let ticking = false;

  function updateNav() {
    const scrolled = window.scrollY > 50;
    header.classList.toggle('is-scrolled', scrolled);
    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(updateNav);
      ticking = true;
    }
  }, { passive: true });
}

/* ── SCROLL PROGRESS ───────────────────────────────────────────────────── */

function initScrollProgress() {
  const header = document.querySelector('header');
  if (!header) return;

  let ticking = false;

  function updateProgress() {
    const scrollTop = window.scrollY;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
    header.style.setProperty('--scroll-progress', `${progress}%`);
    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(updateProgress);
      ticking = true;
    }
  }, { passive: true });
}

/* ── STICKY CTA (Mobile) ──────────────────────────────────────────────── */

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

/* ── INIT ──────────────────────────────────────────────────────────────── */

export default function initInteractions() {
  initReveals();
  initParallax();
  initCountUp();
  initStickyNav();
  initScrollProgress();
  initStickyCTA();
}

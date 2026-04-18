import {
  buildBlock,
  loadHeader,
  loadFooter,
  decorateIcons,
  decorateSections,
  decorateBlocks,
  decorateTemplateAndTheme,
  waitForFirstImage,
  loadSection,
  loadSections,
  loadCSS,
} from './aem.js';

/* --- Brand resolution (TD-1 §3.1, TD-2 §5) --- */
const BRAND_SLUG_RE = /^[a-z][a-z0-9-]{1,30}$/;

/**
 * Resolves the active brand and sets data-brand on <html>.
 * Priority: 1) <meta name="brand"> 2) hostname parse 3) fallback
 * Brand CSS is lazy-loaded after resolution (TD-1 §3.3).
 * Idempotent: safe to call repeatedly (required for da.live dapreview re-invocation).
 */
function resolveBrand() {
  // Idempotent guard: if already resolved, skip silently.
  // Required because dapreview.js re-runs loadPage() on every content update,
  // and the brand-guard below would throw on a second resolve attempt.
  if (document.documentElement.hasAttribute('data-brand')) return;

  const meta = document.querySelector('meta[name="brand"]');
  let slug = meta && meta.content ? meta.content.trim().toLowerCase() : '';

  // Fallback: extract brand from hostname (dev/preview: {branch}--{brand}-site--{org}.aem.page)
  if (!slug || !BRAND_SLUG_RE.test(slug)) {
    const match = window.location.hostname.match(/--([a-z][a-z0-9-]*?)-site--/);
    if (match) { [, slug] = match; }
  }

  if (slug && BRAND_SLUG_RE.test(slug)) {
    document.documentElement.setAttribute('data-brand', slug);
    // Lazy-load brand CSS — only the active brand's file is requested (TD-1 §3.3)
    loadCSS(`${window.hlx.codeBasePath}/styles/brands/${slug}.css`);
  }
}

/**
 * Resolves the active campaign and sets data-campaign on <html> (TD-1 §3.7).
 * Source: ?campaign= query param or <meta name="campaign">.
 * Campaign palette CSS is lazy-loaded from /styles/campaigns/{campaignId}.css.
 * If no campaign CSS exists, cascade falls back to brand tokens gracefully.
 */
function resolveCampaign() {
  const params = new URLSearchParams(window.location.search);
  let campaignId = params.get('campaign') || '';

  if (!campaignId) {
    const meta = document.querySelector('meta[name="campaign"]');
    campaignId = meta && meta.content ? meta.content.trim() : '';
  }

  const CAMPAIGN_ID_RE = /^[a-z][a-z0-9-]{1,50}$/;
  if (campaignId && CAMPAIGN_ID_RE.test(campaignId)) {
    document.documentElement.setAttribute('data-campaign', campaignId);
    // Lazy-load campaign palette CSS — 404 is non-fatal (TD-1 §3.7 rule 7)
    loadCSS(`${window.hlx.codeBasePath}/styles/campaigns/${campaignId}.css`);
  }
}

/**
 * Resolves the active page template and sets data-template on <body>.
 * Source: <meta name="template"> (page-metadata row in da.live).
 * Template CSS is lazy-loaded from /styles/templates/{slug}.css — 404 is non-fatal
 * (pages without a template meta simply get no template-specific CSS).
 *
 * Why <body> not <html>? Template is page-level concern (one template per page),
 * while brand is site-level (cascades across the whole site). Keeping the scope
 * signals matters for mental model + avoids collision with the brand guard.
 *
 * See: /Adobe AEM/page-templates-strategy.md for the narrative-first template
 * design and the current template catalogue (home, pdp, category, about,
 * campaign, editorial).
 */
const TEMPLATE_SLUG_RE = /^[a-z][a-z0-9-]{1,30}$/;
function resolveTemplate() {
  const meta = document.querySelector('meta[name="template"]');
  const slug = meta && meta.content ? meta.content.trim().toLowerCase() : '';

  if (slug && TEMPLATE_SLUG_RE.test(slug)) {
    document.body.setAttribute('data-template', slug);
    // Lazy-load template CSS — 404 is non-fatal for templates not yet styled
    loadCSS(`${window.hlx.codeBasePath}/styles/templates/${slug}.css`);
  }
}

/**
 * Installs a guard that prevents runtime mutation of data-brand (TD-1 §3.1).
 * Brand is read-only after first paint.
 * Idempotent: safe to call repeatedly (required for da.live dapreview re-invocation).
 * Also idempotent on set — allows re-setting the same value (no-op), only throws on mutation.
 */
const BRAND_GUARD_KEY = Symbol.for('bla.brandGuardInstalled');

function installBrandGuard() {
  const html = document.documentElement;
  // Idempotent install guard: skip if already installed.
  if (html[BRAND_GUARD_KEY]) return;
  html[BRAND_GUARD_KEY] = true;

  const original = html.setAttribute.bind(html);
  html.setAttribute = (name, value) => {
    if (name === 'data-brand' && html.hasAttribute('data-brand') && html.getAttribute('data-brand') !== value) {
      throw new TypeError('[brand-guard] data-brand is read-only after first paint (TD-1 §3.1)');
    }
    return original(name, value);
  };
}

/**
 * Pre-decorates blocks with reveal classes BEFORE first paint.
 * Prevents FOUC flicker — content starts hidden from the moment body.appear
 * lifts display:none, and IntersectionObserver fades it in smoothly.
 * Must run AFTER decorateSections (so .section exists) and BEFORE body.appear.
 * @param {Element} main The container element
 */
function autoRevealBlocks(main) {
  // Section-level fade-up for descriptive/single-column blocks
  const fadeSelectors = [
    '.trust', '.social-proof', '.intrigue', '.email-capture',
    '.columns', '.accordion', '.tabs',
    '.where-to-buy', '.carousel',
    // New foundational blocks (page-templates cycle)
    '.statement', '.product-summary', '.reviews-condensed',
    '.cta-sticky', '.press-quotes',
  ].join(', ');
  main.querySelectorAll(fadeSelectors).forEach((block) => {
    const section = block.closest('.section');
    if (section) section.classList.add('reveal');
  });

  // Grid-level stagger — class goes on the BLOCK so direct children animate
  // (putting it on the section would stagger the single block-wrapper, which is invisible)
  main.querySelectorAll('.product-grid, .cards, .feature-grid, .cta-grid').forEach((block) => {
    block.classList.add('reveal-stagger');
  });
}

/**
 * Builds hero block and prepends to main in a new section.
 * @param {Element} main The container element
 */
function buildHeroBlock(main) {
  const h1 = main.querySelector('h1');
  const picture = main.querySelector('picture');
  // eslint-disable-next-line no-bitwise
  if (h1 && picture && (h1.compareDocumentPosition(picture) & Node.DOCUMENT_POSITION_PRECEDING)) {
    // Check if h1 or picture is already inside a hero block
    if (h1.closest('.hero') || picture.closest('.hero')) {
      return; // Don't create a duplicate hero block
    }
    const section = document.createElement('div');
    section.append(buildBlock('hero', { elems: [picture, h1] }));
    main.prepend(section);
  }
}

/**
 * load fonts.css and set a session storage flag
 */
async function loadFonts() {
  await loadCSS(`${window.hlx.codeBasePath}/styles/fonts.css`);
  try {
    if (!window.location.hostname.includes('localhost')) sessionStorage.setItem('fonts-loaded', 'true');
  } catch (e) {
    // do nothing
  }
}

/**
 * Builds all synthetic blocks in a container element.
 * @param {Element} main The container element
 */
function buildAutoBlocks(main) {
  try {
    // auto load `*/fragments/*` references
    const fragments = [...main.querySelectorAll('a[href*="/fragments/"]')].filter((f) => !f.closest('.fragment'));
    if (fragments.length > 0) {
      // eslint-disable-next-line import/no-cycle
      import('../blocks/fragment/fragment.js').then(({ loadFragment }) => {
        fragments.forEach(async (fragment) => {
          try {
            const { pathname } = new URL(fragment.href);
            const frag = await loadFragment(pathname);
            fragment.parentElement.replaceWith(...frag.children);
          } catch (error) {
            // eslint-disable-next-line no-console
            console.error('Fragment loading failed', error);
          }
        });
      });
    }

    buildHeroBlock(main);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Auto Blocking failed', error);
  }
}

/**
 * Decorates formatted links to style them as buttons.
 * @param {HTMLElement} main The main container element
 */
function decorateButtons(main) {
  main.querySelectorAll('p a[href]').forEach((a) => {
    a.title = a.title || a.textContent;
    const p = a.closest('p');
    const text = a.textContent.trim();

    // quick structural checks
    if (a.querySelector('img') || p.textContent.trim() !== text) return;

    // skip URL display links
    try {
      if (new URL(a.href).href === new URL(text, window.location).href) return;
    } catch { /* continue */ }

    // require authored formatting for buttonization
    const strong = a.closest('strong');
    const em = a.closest('em');
    if (!strong && !em) return;

    p.className = 'button-wrapper';
    a.className = 'button';
    if (strong && em) { // high-impact call-to-action
      a.classList.add('accent');
      const outer = strong.contains(em) ? strong : em;
      outer.replaceWith(a);
    } else if (strong) {
      a.classList.add('primary');
      strong.replaceWith(a);
    } else {
      a.classList.add('secondary');
      em.replaceWith(a);
    }
  });
}

/**
 * Decorates the main element.
 * @param {Element} main The main element
 */
// eslint-disable-next-line import/prefer-default-export
export function decorateMain(main) {
  decorateIcons(main);
  buildAutoBlocks(main);
  decorateSections(main);
  decorateBlocks(main);
  decorateButtons(main);
  autoRevealBlocks(main); // must be last — after .section wrappers exist
}

/**
 * Loads everything needed to get to LCP.
 * @param {Element} doc The container element
 */
async function loadEager(doc) {
  document.documentElement.lang = 'en';
  resolveBrand();
  resolveCampaign();
  resolveTemplate();
  installBrandGuard();
  // Load reveal/animation styles BEFORE first paint so .reveal class has effect
  // the moment body.appear lifts display:none. Prevents FOUC flicker.
  loadCSS(`${window.hlx.codeBasePath}/styles/interactions.css`);
  decorateTemplateAndTheme();
  const main = doc.querySelector('main');
  if (main) {
    decorateMain(main);
    document.body.classList.add('appear');
    await loadSection(main.querySelector('.section'), waitForFirstImage);
  }

  try {
    /* if desktop (proxy for fast connection) or fonts already loaded, load fonts.css */
    if (window.innerWidth >= 900 || sessionStorage.getItem('fonts-loaded')) {
      loadFonts();
    }
  } catch (e) {
    // do nothing
  }
}

/**
 * Loads everything that doesn't need to be delayed.
 * @param {Element} doc The container element
 */
async function loadLazy(doc) {
  loadHeader(doc.querySelector('header'));

  const main = doc.querySelector('main');
  await loadSections(main);

  // Interaction runtime — CSS is already loaded eagerly (see loadEager)
  const { default: initInteractions } = await import('./interactions.js');
  initInteractions();

  const { hash } = window.location;
  const element = hash ? doc.getElementById(hash.substring(1)) : false;
  if (hash && element) element.scrollIntoView();

  loadFooter(doc.querySelector('footer'));

  loadCSS(`${window.hlx.codeBasePath}/styles/lazy-styles.css`);
  loadFonts();
}

/**
 * Loads everything that happens a lot later,
 * without impacting the user experience.
 */
function loadDelayed() {
  // eslint-disable-next-line import/no-cycle
  window.setTimeout(() => import('./delayed.js'), 3000);
  // load anything that can be postponed to the latest here
}

async function loadPage() {
  await loadEager(document);
  await loadLazy(document);
  loadDelayed();
}

loadPage();

// DA live-preview wiring — enables right-pane live preview in da.live editor
// (no-op in production; only activates when ?dapreview is present in URL)
(async function loadDa() {
  if (!new URL(window.location.href).searchParams.get('dapreview')) return;
  // eslint-disable-next-line import/no-unresolved
  import('https://da.live/scripts/dapreview.js').then(({ default: daPreview }) => daPreview(loadPage));
}());

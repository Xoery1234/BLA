/**
 * Intrigue block decorator — R1.B §4 item 2
 * Parses 2-3 authored rows into statement strip with scroll-reveal.
 * TD-1 §3.6: cascade only, never reads data-brand.
 *
 * Authored structure (da.live):
 *   Row 1: block name ("Intrigue")
 *   Row 2: statement 1
 *   Row 3: statement 2
 *   Row 4: statement 3 (optional)
 */
export default function decorate(block) {
  const rows = [...block.children];
  const statements = document.createElement('ul');
  statements.className = 'intrigue-statements';
  statements.setAttribute('role', 'list');

  rows.forEach((row) => {
    const text = row.textContent.trim();
    if (!text) return;

    const li = document.createElement('li');
    li.className = 'intrigue-statement';
    li.textContent = text;
    statements.append(li);
  });

  block.textContent = '';
  block.append(statements);

  // Scroll-reveal with staggered delay (TD-1 §3.7 decorative tokens)
  const stagger = parseInt(
    getComputedStyle(document.documentElement)
      .getPropertyValue('--scroll-reveal-stagger') || '120',
    10,
  );

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const items = entry.target.querySelectorAll('.intrigue-statement');
        items.forEach((item, i) => {
          setTimeout(() => item.classList.add('revealed'), i * stagger);
        });
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.2 },
  );

  observer.observe(statements);
}

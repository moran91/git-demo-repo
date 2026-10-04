// "Something went into the basket": a thumbnail flies from where the customer tapped into the visible
// cart icon (bottom nav on phones, top bar on desktop), which then bumps. Replaces the add-to-cart toast.

let lastTap: { x: number; y: number; el: Element | null; at: number } | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => { lastTap = { x: e.clientX, y: e.clientY, el: e.target as Element | null, at: Date.now() }; }, { capture: true, passive: true });
}

function visibleTarget(): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>('[data-cart-target]')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

function bump(target: HTMLElement) {
  target.classList.remove('is-bump');
  void target.offsetWidth; // restart the animation on rapid adds
  target.classList.add('is-bump');
  target.addEventListener('animationend', () => target.classList.remove('is-bump'), { once: true });
}

export function flyToCart() {
  const target = visibleTarget();
  if (!target) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tap = lastTap && Date.now() - lastTap.at < 15000 ? lastTap : null;
  if (reduce || !tap) { bump(target); return; }

  // The dish photo nearest the tap (row, sheet or combo), if there is one.
  const scope = tap.el?.closest('li, dialog, article, .card');
  const img = scope?.querySelector<HTMLImageElement>('img[src]');
  const size = 48;
  const token = document.createElement(img ? 'img' : 'span');
  if (img && token instanceof HTMLImageElement) { token.src = img.currentSrc || img.src; token.alt = ''; }
  token.className = 'cart-fly';
  token.setAttribute('aria-hidden', 'true');
  Object.assign(token.style, { width: `${size}px`, height: `${size}px`, left: `${tap.x - size / 2}px`, top: `${tap.y - size / 2}px` });
  document.body.appendChild(token);

  const t = target.getBoundingClientRect();
  const dx = t.left + t.width / 2 - tap.x;
  const dy = t.top + t.height / 2 - tap.y;
  const lift = Math.min(120, Math.abs(dx) * 0.35 + 40); // arc up before dropping in
  const anim = token.animate(
    [
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - lift}px) scale(0.8)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.25)`, opacity: 0.6 },
    ],
    { duration: 620, easing: 'cubic-bezier(0.45, 0, 0.55, 1)', fill: 'forwards' },
  );
  const done = () => { token.remove(); bump(target); };
  anim.onfinish = done;
  anim.oncancel = done;
}

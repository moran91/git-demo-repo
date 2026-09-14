import { useEffect, useState } from 'react';

/**
 * Tracks which of a list of sections is "current" as the page scrolls: the last section whose top has
 * crossed the sticky-chrome line (topbar + category nav, published as CSS vars by useHeightVar).
 * Once the page is scrolled to the bottom, the last section wins even if it is too short to reach
 * the line — otherwise the final category could never light up; above the first section, the first
 * one is current.
 *
 * A plain scroll listener (rAF-throttled) rather than IntersectionObserver: the question is "which
 * heading is at the line", and observers only answer "is a box visible", which flickers for short
 * sections and sections taller than the viewport.
 */
export function useScrollSpy(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join('|');
  useEffect(() => {
    if (ids.length === 0) {
      setActive(null);
      return;
    }
    let raf = 0;
    const measure = () => {
      raf = 0;
      const root = document.documentElement;
      const cs = getComputedStyle(root);
      const line = parseFloat(cs.getPropertyValue('--topbar-height')) + parseFloat(cs.getPropertyValue('--cat-nav-height'));
      const offset = (Number.isFinite(line) ? line : 112) + 8;
      const atBottom = window.innerHeight + window.scrollY >= root.scrollHeight - 2;
      let current: string | null = null;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= offset) current = id;
        else break;
      }
      if (atBottom) current = ids[ids.length - 1]!;
      // Nothing has crossed the line yet (page top, header still on screen): the first section is next.
      if (!current) current = ids[0]!;
      setActive((prev) => (prev === current ? prev : current));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return active;
}

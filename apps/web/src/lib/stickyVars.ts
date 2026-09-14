import { useCallback, useEffect, useRef } from 'react';

/**
 * Publishes an element's live height on :root as a CSS custom property, and returns a ref callback
 * to attach to that element.
 *
 * The fixed and sticky chrome (topbar, category nav, floating cart bar) used to be hardcoded as
 * magic numbers in the stylesheet — `.cat-nav { top: 56px }` against a topbar that is really 61px,
 * and a page padding that reserved the bottom nav but not the cart bar floating above it. Every one
 * of those constants was wrong on a notched device, at 320px, or once a label wrapped, and each time
 * the result was chrome painted on top of content. Measuring is the only version that stays true.
 *
 * This is a *callback* ref rather than useRef + useEffect on purpose: these elements mount after
 * their data arrives and change height again when it fills in, and an effect with a dependency list
 * cannot see either moment — the first version published the category nav's empty 16px and never
 * corrected it. The callback fires on every attach/detach, and a border-box ResizeObserver catches
 * the rest, including padding changes from a safe-area inset on rotation.
 *
 * `extra` is appended inside the calc() so callers can add a gap in design tokens. The property is
 * removed when the element detaches or is CSS-hidden (offsetHeight 0, which is what the mobile-only
 * bars report at >=900px), so the stylesheet's own fallback takes over.
 */
export function useHeightVar<T extends HTMLElement>(name: string, extra?: string) {
  const observer = useRef<ResizeObserver | null>(null);
  const node = useRef<T | null>(null);
  const publish = useCallback(
    (px: number) => {
      const root = document.documentElement;
      if (px > 0) root.style.setProperty(name, extra ? `calc(${Math.round(px)}px + ${extra})` : `${Math.round(px)}px`);
      else root.style.removeProperty(name);
    },
    [name, extra],
  );
  const attach = useCallback(
    (el: T | null) => {
      observer.current?.disconnect();
      observer.current = null;
      node.current = el;
      if (!el) {
        publish(0);
        return;
      }
      publish(el.offsetHeight);
      if (typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(() => publish(el.offsetHeight));
      ro.observe(el, { box: 'border-box' });
      observer.current = ro;
    },
    [publish],
  );
  // Deliberately no dependency array: re-measure after every render of the owning component. These
  // bars attach while their data is still loading — the category nav mounts with no links at all —
  // and grow a frame later when it arrives. The ResizeObserver did not reliably catch that growth on
  // a cold load, which left the nav published at its empty 16px height. A render-driven read cannot
  // miss it, and writing a custom property does not itself re-render, so this cannot loop.
  useEffect(() => {
    publish(node.current?.offsetHeight ?? 0);
  });
  useEffect(() => {
    // Only the window listeners belong to the effect. The observer is owned entirely by the ref
    // callback: React runs an unmounting effect's cleanup after the replacement tree's refs have
    // already attached, so tearing the observer down from here would kill the one the new node just
    // installed.
    const remeasure = () => publish(node.current?.offsetHeight ?? 0);
    window.addEventListener('resize', remeasure);
    window.addEventListener('orientationchange', remeasure);
    return () => {
      window.removeEventListener('resize', remeasure);
      window.removeEventListener('orientationchange', remeasure);
    };
  }, [publish]);
  return attach;
}

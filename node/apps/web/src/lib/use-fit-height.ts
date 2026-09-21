import { useLayoutEffect, useRef, useState } from "react";

/**
 * A grid is never squeezed below this; on a very short window the page scrolls
 * instead. 160px is three or four rows: at 240 a 650px-tall window left the
 * inventory grid clamped and the page scrolling beside it, which is the double
 * scrollbar this hook exists to remove.
 */
export const FIT_MIN_HEIGHT = 160;

/**
 * How much is laid out BELOW the box, up to the scrolling container: at each
 * level, the following siblings that sit under this element (a pager, a note,
 * the rest of a card), plus the parent's bottom padding and border.
 *
 * Only siblings BELOW count. A sibling beside the box — the other column of a
 * two-column layout, such as the permission matrix next to the users list — is
 * not in the way of the box reaching the bottom of the page, and counting it
 * (as measuring the content's overall bottom did) would squeeze the box by the
 * height of its neighbour.
 */
function spaceBelow(box: HTMLElement, container: HTMLElement): number {
  let below = 0;
  let element: HTMLElement = box;
  while (element.parentElement && element !== container && element.parentElement !== container) {
    const parent = element.parentElement;
    const bottom = element.getBoundingClientRect().bottom;
    let lowest = bottom;
    for (let sibling = element.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
      if (sibling.getClientRects().length === 0) continue;
      const rect = sibling.getBoundingClientRect();
      if (rect.top >= bottom - 1) lowest = Math.max(lowest, rect.bottom);
    }
    const style = getComputedStyle(parent);
    below += lowest - bottom + (parseFloat(style.paddingBottom) || 0) + (parseFloat(style.borderBottomWidth) || 0);
    element = parent;
  }
  // Siblings of the page itself inside the container.
  const bottom = element.getBoundingClientRect().bottom;
  let lowest = bottom;
  for (let sibling = element.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
    if (sibling.getClientRects().length > 0) lowest = Math.max(lowest, sibling.getBoundingClientRect().bottom);
  }
  return below + lowest - bottom;
}

/**
 * The max-height that lets a scrolling box end exactly where the page does, so
 * the page itself never scrolls and the box's own scrollbar is the only one
 * (client request, 18 Sep 2026: "remove vertical scroll", first on the reports
 * and then on every other grid).
 *
 * Without it, a grid taller than the window scrolled the page, and the page
 * scrolled away the grid's header and pager; with a fixed height such as 70vh,
 * the grid plus whatever sat above and below it came to more than the window,
 * so the page scrolled a little AND the grid scrolled inside it — two
 * scrollbars. Measured rather than done in CSS: every screen sits several
 * wrappers deep inside `<main>`, and a percentage height would have to thread
 * through every one of them.
 *
 * What is left = the scrolling container's inner height, less the box's top
 * within it, less everything laid out after the box (a pager, a note) and the
 * container's bottom padding. Recomputed on every render of the owner (rows
 * arriving, a pager appearing) and whenever the container or the box changes
 * size — the window, the side pane, a list coming back from behind a record.
 */
export function useFitHeight<T extends HTMLElement = HTMLDivElement>(enabled = true) {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState<number>();

  useLayoutEffect(() => {
    const box = ref.current;
    if (!enabled || !box) return;
    let scroller: HTMLElement | null = box.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    const container = scroller ?? document.documentElement;

    const measure = () => {
      // Hidden (a record has the page): nothing to measure, and nothing to see.
      if (box.getClientRects().length === 0) return;
      const containerTop = container.getBoundingClientRect().top;
      const top = box.getBoundingClientRect().top - containerTop + container.scrollTop;
      const after = spaceBelow(box, container);
      const padding = parseFloat(getComputedStyle(container).paddingBottom) || 0;
      const available = Math.floor(container.clientHeight - top - after - padding);
      setHeight(Math.max(FIT_MIN_HEIGHT, available));
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    if (box.parentElement) observer.observe(box.parentElement);
    return () => observer.disconnect();
  });

  return { ref, height: enabled ? height : undefined };
}

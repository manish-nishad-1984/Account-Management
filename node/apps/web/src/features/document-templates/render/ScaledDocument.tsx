import { useLayoutEffect, useRef, useState } from "react";
import type { PrintDocument, TemplateLayout } from "@accountmanagement/contracts";
import { DocumentRenderer, pageSizeMm } from "./DocumentRenderer";

const PX_PER_MM = 96 / 25.4;

/**
 * A document drawn at full size and scaled down to fit its box — a thumbnail
 * that is the real page, not a picture of one.
 *
 * `crop` shows only the top of the page, as the cards do; without it the whole
 * sheet fits.
 */
export function ScaledDocument({
  layout,
  document,
  crop,
  className,
}: {
  layout: TemplateLayout;
  document: PrintDocument;
  /** Height of the visible part as a fraction of the page's width. */
  crop?: number;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    setWidth(element.clientWidth);
    // jsdom has no ResizeObserver; a test gets the first measurement only.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const page = pageSizeMm(layout.page);
  const pageWidthPx = page.width * PX_PER_MM;
  const scale = width > 0 ? width / pageWidthPx : 0.3;
  const height = crop ? width * crop : page.height * PX_PER_MM * scale;

  return (
    <div
      ref={box}
      aria-hidden
      className={className}
      style={{ position: "relative", overflow: "hidden", height, pointerEvents: "none" }}
    >
      <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: pageWidthPx }}>
        <DocumentRenderer layout={layout} document={document} />
      </div>
    </div>
  );
}
